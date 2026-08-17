import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Inject,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Driver, int } from 'neo4j-driver';
import { NEO4J_DRIVER } from '../neo4j/neo4j.module';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ComplianceService, OfacProfile } from '../compliance/compliance.service';
import { UsersService } from '../users/users.service';
import { TransactionGateway } from './transactions.gateway';
import { ONCHAIN_QUEUE } from './transaction.processor';
import { commissionForTier, quotaForTier, SubscriptionTier, upgradeMessage } from '../billing/pricing';

export interface TransactionRecord {
  id: string;
  fromEmail: string;
  toEmail: string;
  amount: number;
  note: string | null;
  onchainHash?: string | null;
  onchainStatus?: string | null;
  onchainError?: string | null;
  /** V1.5 Pricing : commission ClearNet du niveau de l'émetteur (null si billing off). */
  feeRate?: number | null;
  createdAt: string;
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);
  private readonly onchainEnabled: boolean;

  constructor(
    @Inject(NEO4J_DRIVER) private readonly driver: Driver,
    private readonly blockchainService: BlockchainService,
    private readonly complianceService: ComplianceService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
    private readonly gateway: TransactionGateway,
    /** File BullMQ — présente uniquement si QUEUE_ENABLED=true (@Optional). */
    @Optional() @InjectQueue(ONCHAIN_QUEUE) private readonly queue?: Queue,
  ) {
    this.onchainEnabled = this.config.get<string>('ONCHAIN_ENABLED') === 'true';
  }

  /** Évaluation DYNAMIQUE de QUEUE_ENABLED (à chaque appel, via ConfigService). */
  private isQueueEnabled(): boolean {
    return this.config.get<string>('QUEUE_ENABLED') === 'true';
  }

  /**
   * Échec DÉFINITIF d'un job de règlement (événement `failed` du worker BullMQ,
   * 3.3 — DLQ légère) : notification Slack (SLACK_WEBHOOK_URL, optionnel) +
   * trace d'audit persistée (nœud FailedJob en Neo4j — équivalent de la table
   * failed_jobs) pour revue post-incident. Souscrit par TransactionProcessor.
   */
  async recordFailedJob(job: Job, error: Error): Promise<void> {
    const { txId } = (job.data ?? {}) as { txId?: string };
    this.logger.error(`[job ${job.id}] Échec définitif après ${job.attemptsMade} tentative(s) : ${error.message}`);

    const session = this.driver.session();
    try {
      await session.run(
        `CREATE (f:FailedJob {
           jobId: $jobId,
           queue: $queue,
           txId: $txId,
           error: $error,
           attemptsMade: $attemptsMade,
           failedAt: datetime()
         })
         RETURN f`,
        { jobId: job.id, queue: job.queueName, txId: txId ?? null, error: error.message, attemptsMade: job.attemptsMade },
      );
    } catch (auditError) {
      this.logger.error(`Audit FailedJob impossible : ${(auditError as Error).message}`);
    } finally {
      await session.close();
    }

    const webhook = this.config.get<string>('SLACK_WEBHOOK_URL');
    if (webhook) {
      fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `[ClearNet] Règlement on-chain échoué définitivement — job ${job.id} (tx ${txId ?? '?'}), ${job.attemptsMade} tentative(s) : ${error.message}`,
        }),
      }).catch((notifError) => {
        this.logger.warn(`Notification Slack impossible : ${(notifError as Error).message}`);
      });
    }
  }

  async create(input: {
    fromEmail: string;
    toEmail: string;
    amount: number;
    note?: string;
  }): Promise<TransactionRecord> {
    const session = this.driver.session();
    try {
      if (input.fromEmail === input.toEmail) {
        throw new BadRequestException('Impossible de s’envoyer une transaction à soi-même');
      }
      // V1.4 Axe 2 + 3.6 : quota Freemium (no-op strict si BILLING_ENABLED !== 'true').
      // V1.5 Pricing : renvoie le niveau — commission appliquée à la création.
      const tier = await this.assertBillingQuota(input.fromEmail);
      await this.assertCompliance(input.fromEmail, input.toEmail);
      const feeRate = tier ? commissionForTier(tier) : null;
      const result = await session.run(
        `MATCH (sender:User {email: $fromEmail})
         MATCH (recipient:User {email: $toEmail})
         CREATE (t:Transaction {
           id: randomUUID(),
           amount: $amount,
           note: $note,
           feeRate: $feeRate,
           createdAt: datetime()
         })
         CREATE (sender)-[:SENT]->(t)
         CREATE (recipient)-[:RECEIVED]->(t)
         RETURN t`,
        { ...input, note: input.note ?? null, feeRate },
      );
      if (result.records.length === 0) {
        throw new BadRequestException('Destinataire introuvable');
      }
      const record = this.toTransaction(input.fromEmail, input.toEmail, result.records[0].get('t'));

      // --- PONT ON-CHAIN (temps réel + file BullMQ si activée) ---
      // Ne pas bloquer la réponse : le règlement (settleCompensation) est
      // exécuté en arrière-plan — via la file BullMQ (QUEUE_ENABLED=true) ou
      // en fire-and-forget (défaut V1.2) ; chaque évolution est diffusée en
      // temps réel via TransactionGateway (transaction:status).
      this.gateway.notifyTransactionStatus(input.fromEmail, {
        txId: record.id,
        status: 'PENDING',
        at: new Date().toISOString(),
      });
      if (this.onchainEnabled) {
        // QUEUE_ENABLED est évalué DYNAMIQUEMENT à chaque transaction (3.1) :
        // si la variable bascule en cours de vie du pod (module câblé au
        // démarrage), la décision file / fire-and-forget s'adapte sans redémarrage.
        if (this.isQueueEnabled() && this.queue) {
          await this.queue.add(ONCHAIN_QUEUE, {
            txId: record.id,
            fromEmail: input.fromEmail,
            toEmail: input.toEmail,
            amount: input.amount,
          });
          this.logger.log(`Tx ${record.id} → file ${ONCHAIN_QUEUE} (BullMQ)`);
        } else {
          this.processOnChainSettlement(record.id, input.fromEmail, input.toEmail, input.amount).catch((error) => {
            this.logger.error(`On-chain settlement failed for tx ${record.id}: ${(error as Error).message}`);
          });
        }
      }

      return record;
    } finally {
      await session.close();
    }
  }

  /**
   * Règlement on-chain de la transaction (settleCompensation) puis écriture
   * du hash et du statut sur le nœud Transaction (onchainHash/onchainStatus).
   * Les adresses sont dérivées des emails (acide déterministe, voir
   * BlockchainService.addressFromEmail) — aucune donnée wallet à stocker.
   * En cas d'échec : statut FAILED + message, la transaction reste valide
   * hors-chaîne (dégradation douce).
   */
  private async processOnChainSettlement(txId: string, fromEmail: string, toEmail: string, amount: number) {
    try {
      this.logger.log(`Processing on-chain settlement: ${fromEmail} -> ${toEmail} for ${amount} CLRN (tx ${txId})`);
      const result = await this.blockchainService.settleCompensation(fromEmail, toEmail, amount);
      const status: 'SUCCESS' | 'PENDING_MULTISIG' = result.status ?? 'SUCCESS';
      await this.markOnchainSuccess(txId, result.txHash, status);
      this.gateway.notifyTransactionStatus(fromEmail, {
        txId,
        status,
        hash: result.txHash,
        at: new Date().toISOString(),
      });
      this.logger.log(`On-chain settlement successful for tx ${txId}. Hash: ${result.txHash}`);
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`On-chain settlement error for tx ${txId}: ${message}`);
      await this.markOnchainFailed(txId, message);
      this.gateway.notifyTransactionStatus(fromEmail, {
        txId,
        status: 'FAILED',
        error: message,
        at: new Date().toISOString(),
      });
      throw error;
    }
  }

  /** Écriture du hash + statut SUCCESS/PENDING_MULTISIG sur le nœud Transaction (partagé service/processor). */
  async markOnchainSuccess(txId: string, hash: string, status: 'SUCCESS' | 'PENDING_MULTISIG' = 'SUCCESS'): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `MATCH (t:Transaction {id: $txId})
         SET t.onchainHash = $hash, t.onchainStatus = '${status}'
         RETURN t`,
        { txId, hash },
      );
    } finally {
      await session.close();
    }
  }

  /** Écriture du statut FAILED + erreur sur le nœud Transaction (partagé service/processor). */
  async markOnchainFailed(txId: string, errorMessage: string): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `MATCH (t:Transaction {id: $txId})
         SET t.onchainStatus = $status, t.onchainError = $errorMessage
         RETURN t`,
        { txId, status: 'FAILED', errorMessage },
      );
    } finally {
      await session.close();
    }
  }

  async history(email: string, limit = 50): Promise<TransactionRecord[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (u:User {email: $email})-[r]-(t:Transaction)
         MATCH (sender:User)-[:SENT]->(t)
         MATCH (recipient:User)-[:RECEIVED]->(t)
         RETURN t, sender.email AS fromEmail, recipient.email AS toEmail
         ORDER BY t.createdAt DESC
         LIMIT $limit`,
        { email, limit: int(Number.isFinite(Number(limit)) ? Number(limit) : 50) },
      );
      return result.records.map((record) => this.toRecord(record));
    } finally {
      await session.close();
    }
  }

  /**
   * Historique paginé (V1.3) — GET /api/transactions?page=&limit=
   * Retourne {items, total, page, limit} ; page ≥ 1, limit borné à [1..100].
   * Consommé par l'écran Transactions du mobile.
   */
  async list(
    email: string,
    page = 1,
    limit = 25,
  ): Promise<{ items: TransactionRecord[]; total: number; page: number; limit: number }> {
    const pageClamped = Math.max(Math.trunc(page) || 1, 1);
    const limitClamped = Math.min(Math.max(Math.trunc(limit) || 25, 1), 100);
    const session = this.driver.session();
    try {
      const totalResult = await session.run(
        `MATCH (u:User {email: $email})-[r]-(t:Transaction)
         RETURN COUNT(DISTINCT t) AS total`,
        { email },
      );
      const total = Number(totalResult.records[0]?.get('total') ?? 0);
      const result = await session.run(
        `MATCH (u:User {email: $email})-[r]-(t:Transaction)
         MATCH (sender:User)-[:SENT]->(t)
         MATCH (recipient:User)-[:RECEIVED]->(t)
         RETURN t, sender.email AS fromEmail, recipient.email AS toEmail
         ORDER BY t.createdAt DESC
         SKIP $skip LIMIT $limit`,
        { email, skip: int((pageClamped - 1) * limitClamped), limit: int(limitClamped) },
      );
      return {
        items: result.records.map((record) => this.toRecord(record)),
        total,
        page: pageClamped,
        limit: limitClamped,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Solde net (V1.3) — GET /api/transactions/balance
   * Reçus − émis (agrégats Cypher séparés, pas de cross-product) + dernière
   * transaction de l'utilisateur. Consommé par l'écran d'accueil mobile.
   */
  async balance(email: string): Promise<{
    balance: number;
    currency: 'CLRN';
    lastTransaction: TransactionRecord | null;
  }> {
    const session = this.driver.session();
    try {
      const [receivedResult, sentResult] = await Promise.all([
        session.run(
          `MATCH (me:User {email: $email})-[:RECEIVED]->(t:Transaction)
           RETURN COALESCE(SUM(t.amount), 0) AS total`,
          { email },
        ),
        session.run(
          `MATCH (me:User {email: $email})-[:SENT]->(t:Transaction)
           RETURN COALESCE(SUM(t.amount), 0) AS total`,
          { email },
        ),
      ]);
      const received = Number(receivedResult.records[0]?.get('total') ?? 0);
      const sent = Number(sentResult.records[0]?.get('total') ?? 0);
      const [lastTransaction] = await this.history(email, 1);
      return { balance: received - sent, currency: 'CLRN', lastTransaction: lastTransaction ?? null };
    } finally {
      await session.close();
    }
  }

  /** Mapping nœud Cypher → TransactionRecord (partagé history/list). */
  private toRecord(record: { get: (key: string) => unknown }): TransactionRecord {
    const raw = record.get('t') as { properties?: Record<string, unknown> };
    const props = raw.properties ?? (raw as unknown as Record<string, unknown>);
    return {
      id: (props.id as string) ?? '',
      fromEmail: record.get('fromEmail') as string,
      toEmail: record.get('toEmail') as string,
      amount: Number(props.amount ?? 0),
      note: (props.note as string | null) ?? null,
      onchainHash: (props.onchainHash as string | null) ?? null,
      onchainStatus: (props.onchainStatus as string | null) ?? null,
      onchainError: (props.onchainError as string | null) ?? null,
      createdAt: this.toIso(props.createdAt),
    };
  }

  private toIso(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    const dt = value as { toStandardDate?: () => Date; toString?: () => string };
    if (dt && typeof dt.toStandardDate === 'function') return dt.toStandardDate().toISOString();
    if (value != null) return new Date(String(value)).toISOString();
    return '';
  }

  /**
   * V1.5 Pricing — Quota mensuel à la création (Free 15 / Essentiel 50 /
   * Pro 500 / Enterprise illimité) :
   *  - tiers à quota fini → max transactions SENT par mois civil UTC ;
   *  - dépassement → 402 Payment Required (code BILLING_QUOTA_EXCEEDED) ;
   *  - early adopters (3.6) exemptés si EARLY_ADOPTER_ENABLED=true ;
   *  - ≥ 80 % du quota → alerte Slack 1×/jour/user (3.2, non bloquante).
   *  BILLING_ENABLED !== 'true' → no-op strict (flux V1.3 inchangé).
   *  Renvoie le niveau de l'émetteur (null si billing désactivé) — utilisé
   *  pour appliquer la commission du niveau (feeRate).
   */
  private async assertBillingQuota(fromEmail: string): Promise<SubscriptionTier | null> {
    if (this.config.get<string>('BILLING_ENABLED') !== 'true') return null;
    const { tier, earlyAdopter } = await this.billingTier(fromEmail);
    const ea = this.config.get<string>('EARLY_ADOPTER_ENABLED') === 'true' && earlyAdopter;
    if (!ea) {
      const q = quotaForTier(tier as SubscriptionTier, this.config);
      if (q != null) {
        const used = await this.billingCount(fromEmail);
        if (used >= q) {
          throw new HttpException(
            {
              statusCode: 402,
              code: 'BILLING_QUOTA_EXCEEDED',
              tier,
              used,
              quota: q,
              message: upgradeMessage(tier as SubscriptionTier),
            },
            HttpStatus.PAYMENT_REQUIRED,
          );
        }
        // 3.2 : alerte à 80 % (1×/jour calendaire UTC, Slack non bloquant)
        if (used >= Math.ceil(q * 0.8)) {
          await this.notifyQuotaAlert(fromEmail, used, q, tier as SubscriptionTier);
        }
      }
    }
    return tier as SubscriptionTier;
  }

  private async billingTier(email: string): Promise<{ tier: string; earlyAdopter: boolean }> {
    const session = this.driver.session();
    try {
      const res = await session.run(
        `MATCH (u:User {email: $email})
         RETURN coalesce(u.subscriptionTier, 'FREE') AS tier,
                coalesce(u.isEarlyAdopter, false) AS ea`,
        { email },
      );
      return {
        tier: res.records[0]?.get('tier') ?? 'FREE',
        earlyAdopter: Boolean(res.records[0]?.get('ea')),
      };
    } finally {
      await session.close();
    }
  }

  /** Transactions SENT depuis le début du mois civil UTC (aligné facturation). */
  private async billingCount(email: string): Promise<number> {
    const session = this.driver.session();
    try {
      const start = new Date();
      start.setUTCDate(1);
      start.setUTCHours(0, 0, 0, 0);
      const res = await session.run(
        `MATCH (u:User {email: $email})-[:SENT]->(t:Transaction)
         WHERE t.createdAt >= $start
         RETURN count(t) AS n`,
        { email, start: start.toISOString() },
      );
      return res.records[0]?.get('n')?.toNumber?.() ?? 0;
    } finally {
      await session.close();
    }
  }

  /** 3.2 — alerte Slack à ≥ 80 % du quota, idempotente par jour calendaire UTC. */
  private async notifyQuotaAlert(
    email: string,
    used: number,
    quota: number,
    tier: SubscriptionTier,
  ): Promise<void> {
    const url = this.config.get<string>('SLACK_WEBHOOK_URL', '');
    if (!url) return;
    const session = this.driver.session();
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await session.run(
        `MATCH (u:User {email: $email})
         WHERE coalesce(u.lastQuotaAlertAt, '1970-01-01') < $today
         SET u.lastQuotaAlertAt = $today
         RETURN u`,
        { email, today },
      );
      if (res.records.length) {
        await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: `⚠️ Quota ${tier} ${used}/${quota} atteint (80 %) — ${email}` }),
        }).catch(() => undefined);
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Vérifications ITAR/OFAC avant création (no-op si ITAR_ENABLED != true).
   * Les profils sont chargés depuis Neo4j ; si l'un est introuvable le
   * contexte cypher existant lève « Destinataire introuvable » (non régressif).
   */
  private async assertCompliance(fromEmail: string, toEmail: string): Promise<void> {
    if (!this.complianceService.isEnabled()) return;
    const [sender, recipient] = await Promise.all([
      this.usersService.findByEmail(fromEmail),
      this.usersService.findByEmail(toEmail),
    ]);
    if (!sender || !recipient) return;
    const toProfile = (user: { name: string; industry?: string | null; country?: string | null }): OfacProfile => ({
      name: user.name,
      industry: user.industry ?? null,
      country: user.country ?? null,
    });
    await this.complianceService.assertTransactionAllowed(toProfile(sender), toProfile(recipient));
  }

  private toTransaction(fromEmail: string, toEmail: string, node: unknown): TransactionRecord {
    const props = ((node as { properties?: Record<string, unknown> }).properties ??
      (node as Record<string, unknown>)) as {
      id?: string;
      amount?: number;
      note?: string;
      onchainHash?: string | null;
      onchainStatus?: string | null;
      onchainError?: string | null;
      feeRate?: number | null;
      createdAt?: Date;
    };
    return {
      id: props.id ?? '',
      fromEmail,
      toEmail,
      amount: Number(props.amount ?? 0),
      note: props.note ?? null,
      onchainHash: props.onchainHash ?? null,
      onchainStatus: props.onchainStatus ?? null,
      onchainError: props.onchainError ?? null,
      feeRate: props.feeRate != null ? Number(props.feeRate) : null,
      createdAt: this.toIso(props.createdAt),
    };
  }
}
