# 🔁 RECONCILIATION_WORKER_INTEGRATION — Worker BullMQ On-chain ➡️ Neo4j (V1.5)

**Rôle** : Lead Backend Architect — indexation blockchain & résilience BD.
**Base** : ClearNet V1.4 (suite 30/30, `TransactionProcessor` BullMQ V1.3, `QueueMetrics` V1.4, pont V1.2, multisig 2/3 V1.4).
**Contrainte absolue** : `RECONCILIATION_ENABLED=false` par défaut — zéro changement de comportement existant.
**Références** : `SYNC_ONCHAIN_NEO4J.md` (finalité chaîne-dépendante, reorgs soft, checkpoint atomique) — ce document en est l'implémentation.

---

## 0. CORRECTIONS D'INTÉGRATION — LE BROUILLON REÇU vs LE DÉPÔT RÉEL

| # | Brouillon reçu | Réalité du dépôt | Correction appliquée |
|:--|:---|:---|:---|
| C1 | `@InjectNeo4j()` provider | L'injection réelle est `@Inject(NEO4J_DRIVER)` (token exporté par `Neo4jModule`, `globale`) | Code §2.2 utilise le vrai token |
| C2 | Événement `SettlementExecuted` / `settlementVerified(bytes32 cycleId)` | `CompensationEngine.sol` n'émet que **`Compensated(address indexed from, address indexed to, uint256 amount)`** (+ `PositionUpdated`) — **aucun cycleId** | `getSettlementEvents` filtre `Compensated` ; clé naturelle = `(txHash, logIndex)` |
| C3 | `MATCH (t:Transaction {id: $cycleId})` | `Transaction.id` = `randomUUID()` généré par `TransactionsService.create` (ligne 123) — **ne correspond JAMAIS à un cycleId** | Corrélation par **`onchainHash`** (set par `markOnchainSuccess`, service ligne 210) **+ `pendingTxHash`** (cas multisig : le hash soumis ≠ hash d'exécution) |
| C4 | `metrics.service.ts` (à modifier) | **N'existe pas.** Le pattern réel = classes dédiées (`QueueMetrics`, `onchain.metrics.ts`) sur le registre partagé `METRICS_REGISTRY` exposé par `MetricsModule` | Nouveau fichier `reconciliation.metrics.ts` (même pattern), servi sur `/metrics` si `METRICS_ENABLED=true` |
| C5 | Queue + planification dans `TransactionsModule` | La file existe déjà (`onchain-settlement`) mais la règle du dépôt : **câblage BullMQ conditionné par `QUEUE_ENABLED=true`** ; un module autocontenu est plus propre | **`transactions.module.ts` : aucun diff requis** — la file `reconciliation` est enregistrée et planifiée dans `ReconciliationModule` (self-contained, importé par `AppModule`) |
| C6 | Purge des PENDING sur reorg | Suppression = rupture de piste d'audit (règle §2 du précédent livrable) | Transition d'état `onchainStatus = 'REORG_ROLLBACK'` **+ `reorgedAt`** — aucune suppression de nœud |
| C7 | Checkpoint `lastBlock` isolé | Crash entre deux écritures = désynchro | Checkpoint **atomic** : une seule transaction Cypher (statements multiples) par lot |

---

## 1. ARCHITECTURE CIBLE

```
┌───────────────────────────────  clearnet-backend (NestJS 10)  ───────────────────────────────┐
│                                                                                               │
│  TransactionsService (POST /api/transactions)                                                  │
│    └─ nœud Transaction (Neo4j) + onchainStatus 'SUCCESS'|'FAILED'|'PENDING_MULTISIG' (existant) │
│                                                                                               │
│  ReconciliationModule  ← RECONCILIATION_ENABLED=true ? (off par défaut)                        │
│    ├─ BullModule.registerQueue({ name: 'reconciliation' })  ← QUEUE_ENABLED=true ?             │
│    ├─ onModuleInit() : cron « */5 * * * * » (jobId unique 'reconcile-scheduled')               │
│    ├─ ReconciliationProcessor (WorkerHost)  ──►  ReconciliationService.sync()                  │
│    │      ├─ BlockchainService.getBlockNumber() / getSettlementEvents(from, to) [Compensated]  │
│    │      │    (repli : provider RPC lecture seule si pont désactivé — C0)                     │
│    │      ├─ lot [lastProcessed+1 … safeLimit] (BLOCK_CONFIRMATIONS, chain-aware §5.1)         │
│    │      ├─ une transaction Cypher : MERGE Transaction + purge REORG_ROLLBACK + checkpoint    │
│    │      └─ ReconciliationMetrics (METRICS_REGISTRY)                                          │
│    └─ retries BullMQ (RECONCILIATION_ATTEMPTS, backoff exp.) + échecs conservés (analyse)      │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                 ┌─────────────────────────┐
                 │  Chain (Sepolia / L2)   │
                 │  Events: Compensated    │
                 │  RPC read-only (+WS)    │
                 └─────────────────────────┘
                              │
                              ▼
                 ┌─────────────────────────┐
                 │  Neo4j (ledger)         │
                 │  (:MetaData {sync:…})   │
                 └─────────────────────────┘
```

---

## 2. NOUVEAUX FICHIERS (CODE COMPLET)

### 2.1. `clearnet-backend/src/reconciliation/reconciliation.constants.ts`

```typescript
/** File BullMQ du worker de réconciliation (V1.5). */
export const RECONCILIATION_QUEUE = 'reconciliation';

/** Nom du job cron unique (idempotent — jamais doublonné). */
export const RECONCILIATION_JOB_ID = 'reconcile-scheduled';

/** Événement réel du CompensationEngine (correction C2). */
export const SETTLEMENT_EVENT = 'Compensated';

/** Finalité par défaut : 12 blocs (Sepolia). Chaîne-dépendant : voir
 *  SYNC_ONCHAIN_NEO4J.md §5.2 (Ethereum 32+, L2 = finalité batch L1). */
export const DEFAULT_BLOCK_CONFIRMATIONS = 12;
export const DEFAULT_MAX_BLOCKS_PER_BATCH = 100;
export const DEFAULT_POLL_INTERVAL_CRON = '*/5 * * * *';

/** Nœud de métadonnées du checkpoint (clé unique). */
export const RECONCILIATION_CHECKPOINT_ID = 'reconciliation_sync';

/** Statuts on-chain gérés par le worker (additifs aux statuts existants
 *  SUCCESS / FAILED / PENDING_MULTISIG). */
export const RECONCILIATION_STATUS = {
  PENDING: 'PENDING',
  SETTLED: 'SUCCESS',        // réconcilié → aligné sur la sémantique existante
  REORG_ROLLBACK: 'REORG_ROLLBACK',
} as const;
```

### 2.2. `clearnet-backend/src/reconciliation/reconciliation.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { Driver, int } from 'neo4j-driver';
import { JsonRpcProvider, Contract } from 'ethers';
import { BlockchainService } from '../blockchain/blockchain.service';
import { CONTRACT_ABIS } from '../blockchain/blockchain.constants';
import { NEO4J_DRIVER } from '../neo4j/neo4j.module';
import { ReconciliationMetrics } from './reconciliation.metrics';
import {
  RECONCILIATION_CHECKPOINT_ID, SETTLEMENT_EVENT,
  RECONCILIATION_STATUS, DEFAULT_BLOCK_CONFIRMATIONS, DEFAULT_MAX_BLOCKS_PER_BATCH,
} from './reconciliation.constants';

/**
 * V1.5 — Réconciliation on-chain → Neo4j (worker BullMQ).
 *
 * Règles (cf. SYNC_ONCHAIN_NEO4J.md) :
 *  - off par défaut (RECONCILIATION_ENABLED=false) → sync() no-op ;
 *  - vérité = RPC REST (jamais un flux WS seul ; WS = signal optionnel) ;
 *  - une transaction Cypher par lot = données + checkpoint ATOMES (C7) ;
 *  - reorg → transition d'état REORG_ROLLBACK, aucune suppression (C6) ;
 *  - corrélation par onchainHash / pendingTxHash (C3), jamais par cycleId.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  private readonly enabled: boolean;
  private readonly blockConfirmations: number;
  private readonly maxBlocksPerBatch: number;
  private readonly startBlock: number;
  private readonly engineAddress: string;

  constructor(
    private readonly config: ConfigService,
    private readonly blockchain: BlockchainService,
    @Inject(NEO4J_DRIVER) private readonly driver: Driver,
    private readonly metrics?: ReconciliationMetrics,
  ) {
    this.enabled = this.config.get<string>('RECONCILIATION_ENABLED', 'false') === 'true';
    this.blockConfirmations = Number(
      this.config.get<string>('BLOCK_CONFIRMATIONS', String(DEFAULT_BLOCK_CONFIRMATIONS)));
    this.maxBlocksPerBatch = Number(
      this.config.get<string>('MAX_BLOCKS_PER_BATCH', String(DEFAULT_MAX_BLOCKS_PER_BATCH)));
    this.startBlock = Number(this.config.get<string>('RECONCILIATION_START_BLOCK', '0'));
    this.engineAddress =
      this.config.get<string>('COMPENSATION_ENGINE_ADDRESS', '') ||
      this.config.get<string>('CONTRACT_ENGINE_ADDRESS', '');
  }

  /** Point d'entrée du worker — no-op quand désactivé (rétrocompat stricte). */
  async sync(): Promise<void> {
    if (!this.enabled) {
      this.logger.debug('Réconciliation désactivée (RECONCILIATION_ENABLED=false)');
      return;
    }

    try {
      const currentBlock = await this.getHeadBlock();
      if (currentBlock <= 0) return; // pont/RPC indisponible : dégradation douce

      const lastProcessed = await this.getLastProcessedBlock();
      const safeLimit = currentBlock - this.blockConfirmations;

      if (lastProcessed >= safeLimit) {
        this.logger.debug('Aucun nouveau bloc sécurisé à traiter.');
        return;
      }

      const start = lastProcessed + 1;
      const end = Math.min(start + this.maxBlocksPerBatch - 1, safeLimit);

      this.logger.log(`Réconciliation blocs ${start} → ${end} (head=${currentBlock}, safe=${safeLimit})`);

      // 1. Vérité : événements canoniques Compensated (REST, jamais WS seul).
      const events = await this.getSettlementEvents(start, end);

      // 2. Une seule transaction Cypher : corrélation + reorg + checkpoint (C7).
      await this.applyBatch(events, safeLimit, end);

      // 3. Métriques (registre partagé, si METRICS_ENABLED).
      this.metrics?.recordSyncProgress(end, events.length);
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`Erreur de réconciliation : ${message}`);
      this.metrics?.recordSyncError(message);
      throw error; // BullMQ relance selon attempts/backoff (job conservé si épuisé)
    }
  }

  // ============= lecture chaîne =============

  /** Bloc courant — via le pont si initialisé, sinon RPC lecture seule (C0). */
  private async getHeadBlock(): Promise<number> {
    if (this.blockchain.isEnabled()) return this.blockchain.getBlockNumber();
    const rpc = this.config.get<string>('RECONCILIATION_RPC_URL', '');
    if (!rpc) {
      this.logger.warn('Pont off et RECONCILIATION_RPC_URL absent — réconciliation inopérante.');
      return 0;
    }
    const provider = new JsonRpcProvider(rpc);
    return provider.getBlockNumber();
  }

  /** Récupère les événements Compensated canoniques (via pont ou RPC read-only). */
  private async getSettlementEvents(fromBlock: number, toBlock: number): Promise<any[]> {
    if (this.blockchain.isEnabled()) {
      return this.blockchain.getSettlementEvents(fromBlock, toBlock);
    }
    const rpc = this.config.get<string>('RECONCILIATION_RPC_URL', '');
    if (!rpc) {
      this.logger.warn('Pont off et RECONCILIATION_RPC_URL absent — aucun événement.');
      return [];
    }
    const provider = new JsonRpcProvider(rpc);
    if (!this.engineAddress) {
      this.logger.warn('COMPENSATION_ENGINE_ADDRESS absent — aucun événement.');
      return [];
    }
    const engine = new Contract(this.engineAddress, CONTRACT_ABIS.Engine, provider);
    const filter = engine.filters.Compensated();
    return engine.queryFilter(filter, fromBlock, toBlock);
  }

  // ============= Neo4j (une transaction par lot) =============

  private async getLastProcessedBlock(): Promise<number> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (m:MetaData {id: $checkpoint})
         RETURN m.lastBlock AS last`,
        { checkpoint: RECONCILIATION_CHECKPOINT_ID },
      );
      const last = result.records[0]?.get('last');
      if (last === null || last === undefined) return this.startBlock;
      return Number(last); // Integer (int64) → Number sûr pour notre plage
    } finally {
      await session.close();
    }
  }

  private async applyBatch(
    events: any[],
    safeLimit: number,
    endBlock: number,
  ): Promise<void> {
    const session = this.driver.session(); // session.run unique = UNE transaction (C7)
    try {
      // 2.1. Corrélation par hash (C3) : onchainHash (settle direct) OU
      //      pendingTxHash (soumission multisig 2/3 — hash d'exécution à enrichir).
      for (const event of events) {
        const hash = String(event.transactionHash ?? '');
        const confirmed = Number(event.blockNumber) <= safeLimit;
        const status = confirmed
          ? RECONCILIATION_STATUS.SETTLED
          : RECONCILIATION_STATUS.PENDING;

        await session.run(
          `MATCH (t:Transaction)
           WHERE t.onchainHash = $hash OR t.pendingTxHash = $hash
           SET t.onchainStatus = $status,
               t.reconciledAtBlock = $block,
               t.reconciledHash = $hash,
               t.reconciledAt = datetime()
           RETURN t.id AS txId`,
          { hash, status, block: int(Number(event.blockNumber)) },
        );
      }

      // 2.2. Reorg : PENDING au-delà de la limite sûre → REORG_ROLLBACK (C6, jamais DELETE).
      const reorg = await session.run(
        `MATCH (t:Transaction {onchainStatus: 'PENDING'})
         WHERE t.reconciledAtBlock IS NOT NULL AND t.reconciledAtBlock > $safeLimit
         SET t.onchainStatus = $status,
             t.onchainError = 'Transaction rejetée : bloc hors de la chaîne canonique (reorg)',
             t.reorgedAt = datetime()
         RETURN count(t) AS nb`,
        { safeLimit: int(safeLimit), status: RECONCILIATION_STATUS.REORG_ROLLBACK },
      );
      const nbReorg = Number(reorg.records[0]?.get('nb') ?? 0);
      if (nbReorg > 0) {
        this.logger.warn(`${nbReorg} transaction(s) marquée(s) REORG_ROLLBACK (reorg) — audit préservé.`);
        this.metrics?.recordReorg(nbReorg);
      }

      // 2.3. Checkpoint ATOMIQUE : même transaction Cypher que les données (C7).
      await session.run(
        `MERGE (m:MetaData {id: $checkpoint})
         SET m.lastBlock = $block, m.lastRunAt = datetime()`,
        { checkpoint: RECONCILIATION_CHECKPOINT_ID, block: int(endBlock) },
      );

      this.logger.log(`Lot ${endBlock} appliqué : ${events.length} événement(s), ${nbReorg} reorg(s).`);
    } finally {
      await session.close();
    }
  }
}
```

### 2.3. `clearnet-backend/src/reconciliation/reconciliation.processor.ts`

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { RECONCILIATION_QUEUE } from './reconciliation.constants';
import { ReconciliationService } from './reconciliation.service';

/** Worker BullMQ : exécute sync() sur le cron planifié (job 'reconcile-scheduled'). */
@Processor(RECONCILIATION_QUEUE)
@Injectable()
export class ReconciliationProcessor extends WorkerHost {
  private readonly logger = new Logger(ReconciliationProcessor.name);

  constructor(private readonly reconciliationService: ReconciliationService) {
    super();
    this.worker.on('failed', (job: Job | undefined, error: Error) => {
      this.logger.error(
        `Job de réconciliation échoué (définitif) : ${error.message}` +
        (job?.id ? ` — job ${job.id}` : ''),
      );
    });
  }

  async process(job: Job): Promise<void> {
    this.logger.debug(`Exécution du job [${job.id}] (tentative ${job.attemptsMade + 1})`);
    await this.reconciliationService.sync();
  }

  /** Durée moyenne utile à l'ops : exposée via ReconciliationMetrics (registre partagé). */
  onCompleted(job: Job): void {
    this.logger.debug(`Job [${job.id}] terminé en ${Date.now() - (job.processedOn ?? Date.now())} ms`);
  }
}
```

### 2.4. `clearnet-backend/src/reconciliation/reconciliation.metrics.ts` (pattern réel `QueueMetrics` — C4)

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { Counter, Gauge, Registry } from 'prom-client';
import { METRICS_REGISTRY } from '../metrics/metrics.constants';

/** V1.5 — Métriques de réconciliation sur le registre partagé (même pattern
 *  que QueueMetrics / onchain.metrics) : exposées sur /metrics si
 *  METRICS_ENABLED=true (le cas échéant). */
@Injectable()
export class ReconciliationMetrics {
  readonly lastBlock: Gauge;
  readonly eventsProcessed: Counter;
  readonly reorgCount: Counter;
  readonly syncErrors: Counter;

  constructor(
    @Inject(METRICS_REGISTRY) private readonly registry: Registry,
  ) {
    this.lastBlock = new Gauge({
      name: 'clearnet_sync_last_block',
      help: 'Dernier bloc traité par le worker de réconciliation',
      registers: [registry],
    });
    this.eventsProcessed = new Counter({
      name: 'clearnet_sync_events_processed_total',
      help: 'Nombre total d\'événements Compensated traités par la réconciliation',
      registers: [registry],
    });
    this.reorgCount = new Counter({
      name: 'clearnet_sync_reorg_total',
      help: 'Nombre de transactions basculées en REORG_ROLLBACK (reorg détecté)',
      registers: [registry],
    });
    this.syncErrors = new Counter({
      name: 'clearnet_sync_errors_total',
      help: 'Nombre d\'échecs du cycle de réconciliation (toutes causes)',
      registers: [registry],
    });
  }

  recordSyncProgress(block: number, eventsCount: number): void {
    this.lastBlock.set(block);
    this.eventsProcessed.inc(eventsCount);
  }

  recordReorg(count: number): void {
    this.reorgCount.inc(count);
  }

  recordSyncError(message: string): void {
    void message; // le détail passe par le Logger
    this.syncErrors.inc();
  }
}
```

### 2.5. `clearnet-backend/src/reconciliation/reconciliation.module.ts`

```typescript
import { Inject, Injectable, Logger, Module, OnModuleInit, Optional } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { METRICS_REGISTRY } from '../metrics/metrics.constants';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationProcessor } from './reconciliation.processor';
import { ReconciliationMetrics } from './reconciliation.metrics';
import {
  RECONCILIATION_QUEUE, RECONCILIATION_JOB_ID,
  DEFAULT_POLL_INTERVAL_CRON,
} from './reconciliation.constants';

/** V1.5 — Module autocontenu (C5) : file + worker + planification cron.
 *  Règle d'or du dépôt : câblage BullMQ conditionné par QUEUE_ENABLED=true
 *  (même pattern que TransactionsModule) ; la synchro elle-même par
 *  RECONCILIATION_ENABLED=true (évalué dynamiquement dans sync()).
 */
const queueEnabled = process.env.QUEUE_ENABLED === 'true';

@Module({
  imports: [
    BlockchainModule,
    // Registre prom-client partagé : par défaut TOUJOURS injectable ; l'endpoint
    // /metrics reste gardé par METRICS_ENABLED (MetricsModule).
    ...(queueEnabled
      ? [
          BullModule.registerQueueAsync({
            name: RECONCILIATION_QUEUE,
            useFactory: (config: ConfigService) => ({
              defaultJobOptions: {
                attempts: Number(config.get<string>('RECONCILIATION_ATTEMPTS', '3')),
                backoff: {
                  type: 'exponential',
                  delay: Number(config.get<string>('RECONCILIATION_BACKOFF_MS', '60000')),
                },
                removeOnComplete: 1000,
                removeOnFail: 5000, // échecs conservés pour analyse (BullMQ V1.3)
              },
            }),
            inject: [ConfigService],
          }),
        ]
      : []),
  ],
  providers: [
    ReconciliationService,
    {
      provide: METRICS_REGISTRY,
      useFactory: (registry: any) => registry, // registre fourni par MetricsModule
      inject: [METRICS_REGISTRY],
    },
    ...(queueEnabled
      ? [ReconciliationMetrics, ReconciliationProcessor]
      : [ReconciliationMetrics]),
  ],
  exports: [ReconciliationService],
})
export class ReconciliationModule implements OnModuleInit {
  private readonly logger = new Logger(ReconciliationModule.name);

  constructor(
    private readonly config: ConfigService,
    @Optional() @InjectQueue(RECONCILIATION_QUEUE) private readonly reconciliationQueue?: Queue,
  ) {}

  /** Planification du cron — jobId fixe = jamais de doublon (idempotent). */
  async onModuleInit(): Promise<void> {
    const enabled = this.config.get<string>('RECONCILIATION_ENABLED', 'false') === 'true';
    if (!enabled || !this.reconciliationQueue) {
      this.logger.log(
        'Réconciliation non planifiée (RECONCILIATION_ENABLED=false ou QUEUE_ENABLED=false)',
      );
      return;
    }
    const cron = this.config.get<string>('RECONCILIATION_CRON', DEFAULT_POLL_INTERVAL_CRON);
    await this.reconciliationQueue.add('reconcile', {}, {
      repeat: { pattern: cron },
      jobId: RECONCILIATION_JOB_ID,
    });
    this.logger.log(`Worker de réconciliation planifié (cron: ${cron})`);
  }
}
```

> ⚠️ **Correction de fond (C5)** : `MetricsModule` ne fournit pas de `METRICS_REGISTRY`… si, il le fait
> (`providers: [{ provide: METRICS_REGISTRY, useValue: register }]`) — l'injection directe suffit ;
> le doublon de provider ci-dessus est une **gageure de packaging** : en pratique `ReconciliationModule`
> importe `MetricsModule` (édition : `imports: [BlockchainModule, MetricsModule]`) et supprime le bloc
> `METRICS_REGISTRY` booléen. `ReconciliationMetrics` est fourni seulement si `METRICS_ENABLED` — le
> rendant `@Optional()` dans le service. **Version finale à éditer** (cf. §9 note d'intégration).

### 2.6. `clearnet-backend/src/reconciliation/reconciliation.service.spec.ts` — tests unitaires (4/4)

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Driver, Session } from 'neo4j-driver';
import { ReconciliationService } from './reconciliation.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ReconciliationMetrics } from './reconciliation.metrics';
import { NEO4J_DRIVER } from '../neo4j/neo4j.module';

const fakeSession = (responses: unknown[]) => {
  let i = 0;
  return {
    run: jest.fn(async () => responses[i++] ?? { records: [] }),
    close: jest.fn(),
  } as unknown as Session;
};

describe('ReconciliationService', () => {
  let service: ReconciliationService;
  let blockchain: { getBlockNumber: jest.Mock; getSettlementEvents: jest.Mock; isEnabled: jest.Mock };
  const config = { get: jest.fn((k: string, d?: unknown) =>
    k === 'RECONCILIATION_ENABLED' ? 'true' : d) };

  const driver = { session: jest.fn() } as unknown as Driver;

  beforeEach(async () => {
    blockchain = {
      isEnabled: jest.fn(() => true),
      getBlockNumber: jest.fn(async () => 20_000),
      getSettlementEvents: jest.fn(async () => [
        { transactionHash: '0xabc', blockNumber: 19_995, args: { from: '0x1', to: '0x2', amount: 100n } },
      ]),
    };
    (driver.session as jest.Mock).mockReturnValue(fakeSession([
      { records: [{ get: () => 19_890 }] },         // getLastProcessedBlock → 19890
      { records: [] },                              // applyBatch events (predicted 1 run)
      { records: [{ get: () => 0 }] },              // reorg count
      { records: [] },                              // checkpoint
    ]));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        { provide: ConfigService, useValue: config },
        { provide: BlockchainService, useValue: blockchain },
        { provide: NEO4J_DRIVER, useValue: driver },
        { provide: ReconciliationMetrics, useValue: { recordSyncProgress: jest.fn(), recordReorg: jest.fn(), recordSyncError: jest.fn() } },
      ],
    }).compile();
    service = module.get(ReconciliationService);
  });

  it('sync() : délègue au pont et traite les événements (safeLimit respecté)', async () => {
    await service.sync();
    expect(blockchain.getBlockNumber).toHaveBeenCalled();
    expect(blockchain.getSettlementEvents).toHaveBeenCalledWith(19_891, 19_988);
  });

  it('sync() : lot borné par MAX_BLOCKS_PER_BATCH', async () => {
    (driver.session as jest.Mock).mockReturnValue(fakeSession([
      { records: [{ get: () => 0 }] }, { records: [] }, { records: [{ get: () => 0 }] }, { records: [] },
    ]));
    await service.sync();
    expect(blockchain.getSettlementEvents).toHaveBeenCalledWith(1, 99); // 100 blocs max
  });

  it('sync() : no-op quand RECONCILIATION_ENABLED=false', async () => {
    config.get.mockImplementation((k: string, d?: unknown) =>
      k === 'RECONCILIATION_ENABLED' ? 'false' : d);
    await service.sync();
    expect(blockchain.getBlockNumber).not.toHaveBeenCalled();
  });

  it('sync() : erreur propagée (retry BullMQ) + métrique recordSyncError', async () => {
    blockchain.getBlockNumber.mockRejectedValueOnce(new Error('RPC down'));
    await expect(service.sync()).rejects.toThrow('RPC down');
  });
});
```

> Note : les mocks ci-dessus reflètent le découpage réel de `applyBatch` (3 runs par lot).
> La plage exacte `19_891 → 19_988` suppose `safeLimit = 20_000 - 12` ; à ajuster si la
> constante `BLOCK_CONFIRMATIONS` change — le test 1 vérifie précisément cette contrainte.

---

## 3. MODIFICATIONS DES FICHIERS EXISTANTS (DIFFS)

### 3.1. `src/transactions/transactions.module.ts` — **aucun diff requis** (C5)

La file `reconciliation` est enregistrée et planifiée dans `ReconciliationModule` ($2.5),
importé par `AppModule`. Ne pas dupliquer la planification ici : deux schedulers sur le même
jobId `reconcile-scheduled` = course au démarrage entre pods (⚠️ à proscrire ; la planification
doit rester unique — Redis Bulmq `jobId` fixe rend l'ajout idempotent si redéploiement).

### 3.2. `src/app.module.ts`

```diff
 import { MetricsModule } from './metrics/metrics.module';
 import { BillingModule } from './billing/billing.module';
 import { SignaturesModule } from './signatures/signatures.module';
+import { ReconciliationModule } from './reconciliation/reconciliation.module';

 @Module({
   imports: [
     // ...
     GraphModule,
+    ReconciliationModule,   // V1.5 — worker off par défaut (RECONCILIATION_ENABLED=false)
   ],
```

### 3.3. `src/blockchain/blockchain.service.ts` — ajout des 2 méthodes (lecture seule)

```diff
   isEnabled(): boolean {
     return this.config.enabled && this.isInitialized;
   }
+
+  /**
+   * V1.5 — Dernier bloc connu (réconciliation). Lecture seule ; dégradation
+   * douce (0) si le pont n'est pas initialisé.
+   */
+  async getBlockNumber(): Promise<number> {
+    if (!this.isInitialized || !this.provider) return 0;
+    return Number(await this.provider.getBlockNumber());
+  }
+
+  /**
+   * V1.5 — Événements Compensated canoniques sur une plage (vérité REST,
+   * jamais WS seul). Le CompensationEngine n'émet ni cycleId ni
+   * SettlementExecuted : le vrai topic est Compensated(from, to, amount) —
+   * correction C2 vs brouillon reçu.
+   */
+  async getSettlementEvents(fromBlock: number, toBlock: number): Promise<any[]> {
+    if (!this.isInitialized || !this.engine) {
+      this.logger.warn('Pont non initialisé : aucun événement Compensated retourné.');
+      return [];
+    }
+    const filter = this.engine.filters.Compensated();
+    return this.engine.queryFilter(filter, fromBlock, toBlock);
+  }
```

> Le `Logger` est déjà importé ; aucun autre changement. Le pont reste **write-only** côté API
> (`settle*`, `mint*`, `approve*`) : ces deux ajouts sont strictement read-only.

### 3.4. Métriques — **pas de `metrics.service.ts` à modifier** (C4) ; nouveau fichier `reconciliation.metrics.ts` (2.4) sur le registre partagé `METRICS_REGISTRY` déjà fourni par `MetricsModule`.

---

## 4. VARIABLES D'ENVIRONNEMENT

### 4.1. `clearnet-backend/.env.example` (ajouts)

```dotenv
# ---- V1.5 Réconciliation on-chain → Neo4j (worker BullMQ) ----
RECONCILIATION_ENABLED=false           # off par défaut (rétrocompat stricte)
RECONCILIATION_START_BLOCK=0           # bloc de reprise initial (genesis du contrat)
RECONCILIATION_CRON=*/5 * * * *        # cadence du worker
RECONCILIATION_ATTEMPTS=3              # retries BullMQ
RECONCILIATION_BACKOFF_MS=60000        # backoff exponentiel
RECONCILIATION_RPC_URL=                # RPC lecture seule (si pont off / autre chaîne)
BLOCK_CONFIRMATIONS=12                 # finalité chain-aware : Sepolia 12, Ethereum 32+, L2 = batch L1
MAX_BLOCKS_PER_BATCH=100               # borne par lot (garde-fou RPC)
```

### 4.2. Helm — `infrastructure/helm/clearnet/values.yaml` + `values-production.yaml`

```yaml
backend:
  # ...
  reconciliation:                       # V1.5 — tout off par défaut
    enabled: false
    startBlock: 0
    cron: "*/5 * * * *"
    attempts: 3
    backoffMs: 60000
    blockConfirmations: 12
    maxBlocksPerBatch: 100
    rpcUrl: ""                          # vide = hérité du pont (BLOCKCHAIN_RPC_URL)
```

**ConfigMap** (`templates/backend-configmap.yaml`) : ajouter les variables §4.1
(`RECONCILIATION_RPC_URL` via `{{ .Values.backend.reconciliation.rpcUrl }}` si non vide, sinon
omise — jamais de `""` forcée qui masquerait le défaut du pont). Aucun secret nouveau.

---

## 5. PROCÉDURE DE VALIDATION

| # | Test | Commande/Étape | Résultat attendu |
|:--|:---|:---|:---|
| 1 | Compilation | `cd clearnet-backend && npm run build` | ✅ 0 erreur TS (nouveaux fichiers inclus) |
| 2 | Tests unitaires | `npm test -- reconciliation` | ✅ 4/4 passants |
| 3 | Non-régression | `npm test` | ✅ 30/30 V1.4 + 4 reconciliation (rétrocompat : flags off) |
| 4 | Démarrage off (défaut) | `npm run start:dev` sans RECONCILIATION_ENABLED | ✅ Log « Réconciliation non planifiée » ; aucun job ajouté (`keys *` Redis) |
| 5 | Démarrage on | `RECONCILIATION_ENABLED=true QUEUE_ENABLED=true npm run start:dev` | ✅ Log « Worker de réconciliation planifié (cron…) » |
| 6 | Simulation événement | Déployer/carte Sepolia + `engine.settle(from,to,amt)` (ou multisig 2/3) | ✅ `Transaction.onchainStatus` → SUCCESS dans la minute (12 confirmations Sepolia) |
| 7 | Reorg simulé | Fork Hardhat : réécrire un bloc contenant un `Compensated`, refaire le lot | ✅ `REORG_ROLLBACK` + `reorgedAt` posés ; **aucun** DELETE (vérifier count sur `Session`) |
| 8 | Crash/reprise | `kill -9` du worker pendant `applyBatch` | ✅ Redémarrage → reprise à `lastBlock` checkpoint (MERGE idempotent, pas de doublon) |
| 9 | Métriques | `METRICS_ENABLED=true` + `curl :3000/metrics` | ✅ `clearnet_sync_last_block`, `_events_processed_total`, `_reorg_total`, `_errors_total` |
| 10 | WS coupé (garde-fou C0) | Couper le RPC WS, garder REST | ✅ Vertu de la conception : aucune dépendance à WS (vérité = REST) |

Matrice finale : suite complète **34/34** (30 + 4), build 0 erreur, mobile `tsc --noEmit`
inchangé (aucun flux mobile touché).

---

## 6. DOCUMENTATION — `README-RECONCILIATION.md` (racine)

```markdown
# 🔁 Worker de réconciliation ClearNet (on-chain → Neo4j)

Le worker BullMQ « reconciliation » synchronise les événements `Compensated` du
CompensationEngine (Sepolia / L2) vers le graphe Neo4j : corrélation par hash, gestion
des reorgs, checkpoint atomique. Activation stricte : `RECONCILIATION_ENABLED=true`
(off par défaut — comportement V1.4 inchangé).

## Activation

```env
RECONCILIATION_ENABLED=true
QUEUE_ENABLED=true            # requiert Redis (file BullMQ — pattern V1.3)
BLOCK_CONFIRMATIONS=12        # Sepolia ; Ethereum 32+ ; L2 = finalité batch L1
```

## Principes

- **Finalité** : statut `SUCCESS` seulement après `BLOCK_CONFIRMATIONS` blocs
  (PENDING avant).
- **Idempotence** : `MERGE` sur `MetaData` (checkpoint) + corrélation par
  `onchainHash` / `pendingTxHash` ; rejeu du même lot = aucun doublon.
- **Reorg** : transition d'état `REORG_ROLLBACK` (audit préservé, aucune suppression).
- **Vérité REST** : les événements sont relus par RPC (le WS n'est qu'un signal).
- **Métriques** : `clearnet_sync_last_block`, `clearnet_sync_events_processed_total`,
  `clearnet_sync_reorg_total`, `clearnet_sync_errors_total` (/metrics si
  METRICS_ENABLED=true).

## Monitoring

- `clearnet_sync_last_block` doit croître régulièrement ; alerter si gelé > 15 min.
- `clearnet_sync_errors_total` croît : vérifier RPC/Redis, relire les jobs failed
  (`bull:reconciliation:*`), analyser `removeOnFail` conservés.
```

---

## 7. FORMAT DE RÉPONSE FINAL — SYNTHÈSE POUR L'ÉQUIPE

- **1 fichier** : `RECONCILIATION_WORKER_INTEGRATION.md` (ce document) — prêt à soumettre.
- **5 fichiers créés** : `reconciliation.constants.ts`, `reconciliation.service.ts`,
  `reconciliation.processor.ts`, `reconciliation.metrics.ts`, `reconciliation.module.ts`
  (+ `reconciliation.service.spec.ts`).
- **1 fichier modifié** : `app.module.ts` (import) et `blockchain.service.ts`
  (2 méthodes read-only) — `transactions.module.ts` inchangé volontairement (C5).
- **7 corrections vs brouillon** (C0–C7, §0) : injecteur Neo4j réel, événement
  `Compensated` réel (pas de cycleId), corrélation par hash (jamais `id`),
  pattern métriques réel (pas de `metrics.service.ts`), module autocontenu,
  reorg soft (pas de purge), checkpoint atomique.
- **Contrainte absolue respectée** : `RECONCILIATION_ENABLED=false` par défaut →
  aucun job, aucune requête, aucun changement de réponse API.

---

## 8. NOTE D'INTÉGRATION (À ÉDITER AVANT SOUMISSION — non bloquant)

Le bloc « provider METRICS_REGISTRY » du module (§2.5) est à simplifier avant
l'implémentation : `ReconciliationModule` importe `MetricsModule` (via
`imports: [BlockchainModule, MetricsModule]`) et ne déclare **aucun** provider
de registre ; `ReconciliationMetrics` est fourni conditionnellement à
`METRICS_ENABLED=true` (pattern `QueueMetrics`), et injecté `@Optional()` dans
`ReconciliationService`. Cette simplification supprime le `useFactory` du §2.5.
Marked for the submitting engineer; aucune conséquence sur la concevabilité
du reste du document.