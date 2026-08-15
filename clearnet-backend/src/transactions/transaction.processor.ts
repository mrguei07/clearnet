import { Inject, Logger, OnApplicationBootstrap, OnApplicationShutdown, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Registry } from 'prom-client';
import { BlockchainService } from '../blockchain/blockchain.service';
import { METRICS_REGISTRY } from '../metrics/metrics.constants';
import { TransactionGateway } from './transactions.gateway';
import { TransactionsService } from './transactions.service';
import { QueueMetrics } from './queue.metrics';

/** Nom de la file BullMQ des règlements on-chain (V1.3, industrialisation). */
export const ONCHAIN_QUEUE = 'onchain-settlement';

/** Payload d'un job de règlement — mêmes champs que le déclencheur HTTP. */
export interface OnchainSettlementJob {
  txId: string;
  fromEmail: string;
  toEmail: string;
  amount: number;
}

/**
 * Consommateur BullMQ (V1.3, industrialisation) : remplace le « fire-and-forget »
 * silencieux du TransactionsService lorsque QUEUE_ENABLED=true.
 *
 * Comportement :
 *  - chaque job = un règlement `settleCompensation(from, to, amount)` ;
 *  - succès → onchainHash + onchainStatus SUCCESS sur le nœud Transaction,
 *    puis diffusion `transaction:status` (gateway socket.io) ;
 *  - échec → onchainStatus FAILED + onchainError, diffusion FAILED, puis
 *    rethrow pour activer les retries BullMQ (QUEUE_ATTEMPTS / backoff) ;
 *  - échec DÉFINITIF (retries épuisées) → événement `failed` du worker :
 *    audit FailedJob (Neo4j) + notification Slack (3.3) via
 *    TransactionsService.recordFailedJob ;
 *  - la transaction reste valide hors-chaîne en toutes circonstances
 *    (dégradation douce — comportement V1.1/V1.2 préservé).
 */
@Processor(ONCHAIN_QUEUE)
export class TransactionProcessor extends WorkerHost
  implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TransactionProcessor.name);
  private metrics?: QueueMetrics;
  private poller?: NodeJS.Timeout;

  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly transactionsService: TransactionsService,
    private readonly gateway: TransactionGateway,
    private readonly config: ConfigService,
    /** File BullMQ - présente uniquement si QUEUE_ENABLED=true (@Optional, V1.3). */
    @Optional() @InjectQueue(ONCHAIN_QUEUE) private readonly settlementQueue?: Queue,
    /** Registre prom-client partagé (MetricsModule). */
    @Inject(METRICS_REGISTRY) private readonly metricsRegistry?: Registry,
  ) {
    super();
  }

  /** Le worker BullMQ est prêt ici (WorkerHost.worker) : souscriptions. */
  onApplicationBootstrap(): void {
    this.worker.on('failed', (job: Job, error: Error) => {
      void this.transactionsService.recordFailedJob(job, error);
    });

    // V1.4 Axe 5 : métriques BullMQ (hooks événements + polling d'état 15 s).
    if (this.config.get<string>('METRICS_ENABLED') === 'true' && this.metricsRegistry) {
      this.metrics = new QueueMetrics(this.metricsRegistry, this.config);
      this.worker.on('completed', (job: Job) => {
        this.metrics!.completed.inc({ queue: ONCHAIN_QUEUE });
        this.metrics!.observeDuration(job.processedOn);
      });
      this.worker.on('failed', (job: Job) => {
        this.metrics!.failed.inc({ queue: ONCHAIN_QUEUE });
        this.metrics!.observeDuration(job.processedOn);
      });
      this.poller = this.metrics.startPolling(this.settlementQueue);
    }
  }

  /** Arrêt propre du polling d'état (évite les fuites à l'arrêt du pod). */
  onApplicationShutdown(): void {
    if (this.poller) clearInterval(this.poller);
  }

  async process(job: Job<OnchainSettlementJob>): Promise<void> {
    const { txId, fromEmail, toEmail, amount } = job.data;
    this.logger.log(
      `[job ${job.id}] Règlement on-chain ${fromEmail} → ${toEmail} (${amount} CLRN) — tentative ${job.attemptsMade + 1}/${job.opts.attempts ?? 1}`,
    );

    try {
      const result = await this.blockchainService.settleCompensation(fromEmail, toEmail, amount);
      const status: 'SUCCESS' | 'PENDING_MULTISIG' = result.status ?? 'SUCCESS';
      await this.transactionsService.markOnchainSuccess(txId, result.txHash, status);
      this.gateway.notifyTransactionStatus(fromEmail, {
        txId,
        status,
        hash: result.txHash,
        at: new Date().toISOString(),
      });
      this.logger.log(`[job ${job.id}] Règlement réussi — ${result.txHash}`);
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`[job ${job.id}] Échec du règlement : ${message}`);
      await this.transactionsService.markOnchainFailed(txId, message);
      this.gateway.notifyTransactionStatus(fromEmail, {
        txId,
        status: 'FAILED',
        error: message,
        at: new Date().toISOString(),
      });
      // Re-throw : BullMQ relance le job selon attempts/backoff ; si épuisé,
      // le job passe en failed et reste traçable (dette de règlement).
      throw error;
    }
  }
}
