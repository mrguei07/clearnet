import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as net from 'net';
import { TransactionsService } from './transactions.service';
import { TransactionGateway } from './transactions.gateway';
import { TransactionProcessor, ONCHAIN_QUEUE } from './transaction.processor';
import { NEO4J_DRIVER } from '../neo4j/neo4j.module';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ComplianceService } from '../compliance/compliance.service';
import { UsersService } from '../users/users.service';

/**
 * Test d'INTÉGRATION de la file BullMQ (point de vigilance 3.2) :
 * création de transaction → job `onchain-settlement` (Redis réel) →
 * processor → statut SUCCESS/FAILED (écriture Neo4j) → événement WebSocket.
 *
 * Exigences : un Redis local (REDIS_HOST/REDIS_PORT, défaut localhost:6379).
 * Sans Redis joignable, chaque test est marqué SKIPPED (pas d'échec en CI
 * locale sans Redis). Le driver Neo4j est mocké (la boucle « job → statut »
 * est le cœur testé ; le E2E Sepolia couvre Neo4j réel).
 */

jest.setTimeout(60000);

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || '6379');

/** Sonde TCP (2 s) : un service Redis écoute-t-il sur REDIS_HOST:REDIS_PORT ? */
function redisAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: REDIS_HOST, port: REDIS_PORT });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(2000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

describe('File BullMQ — intégration (Redis requis, 3.2)', () => {
  const driverMock = {
    session: jest.fn(() => ({
      run: jest.fn(async (query: string) => {
        if (query.includes('CREATE (t:Transaction')) {
          return {
            records: [
              {
                get: (key: string) =>
                  key === 't'
                    ? {
                        properties: {
                          id: 'tx-integration-1',
                          amount: 100,
                          note: 'test intégration',
                          createdAt: new Date(),
                        },
                      }
                    : undefined,
              },
            ],
          };
        }
        return { records: [] };
      }),
      close: jest.fn(async () => undefined),
    })),
  };

  const blockchainMock = {
    settleCompensation: jest.fn(),
  };
  const complianceMock = { isEnabled: jest.fn(() => false) };
  const usersMock = {};
  const gatewayMock = { notifyTransactionStatus: jest.fn() };

  let redisOk = false;
  let service: TransactionsService;
  let queue: Queue;
  let app: TestingModule | undefined;

  beforeAll(async () => {
    redisOk = await redisAvailable();
    if (!redisOk) {
      // eslint-disable-next-line no-console
      console.warn(`Redis injoignable sur ${REDIS_HOST}:${REDIS_PORT} — tests d'intégration BullMQ SKIPPÉS.`);
      return;
    }

    app = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            connection: {
              host: config.get<string>('REDIS_HOST', REDIS_HOST),
              port: Number(config.get<string>('REDIS_PORT', String(REDIS_PORT))),
              maxRetriesPerRequest: null,
            },
            defaultJobOptions: {
              attempts: 1, // tests rapides : pas d'attente de backoff
              removeOnComplete: 100,
              removeOnFail: 100,
            },
          }),
        }),
        BullModule.registerQueue({ name: ONCHAIN_QUEUE }),
      ],
      providers: [
        TransactionsService,
        TransactionProcessor,
        { provide: NEO4J_DRIVER, useValue: driverMock },
        { provide: BlockchainService, useValue: blockchainMock },
        { provide: ComplianceService, useValue: complianceMock },
        { provide: UsersService, useValue: usersMock },
        { provide: TransactionGateway, useValue: gatewayMock },
      ],
    }).compile();

    service = app.get(TransactionsService);
    queue = app.get<Queue>(getQueueToken(ONCHAIN_QUEUE));
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  /** Attente d'une condition (poll 200 ms, timeout en ms). */
  async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs: number, label: string) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await condition()) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Délai dépassé : ${label}`);
  }

  /** Requêtes Cypher exécutées via la session mockée. */
  function neo4jQueries(): Array<[string, Record<string, unknown>]> {
    return driverMock.session.mock.results
      .map((r) =>
        ((r.value.run as jest.Mock).mock.calls as Array<[string, Record<string, unknown>]>).map(
          ([query, params]) => [String(query), params ?? {}] as [string, Record<string, unknown>],
        ),
      )
      .flat();
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('flux complet : transaction → file → processor → SUCCESS (Neo4j + WebSocket)', async () => {
    if (!redisOk) {
      // Redis absent (ex. poste de dev) : test inopérant mais vert — la CI
      // provisionne un service redis et exécute réellement ces assertions.
      console.warn("Redis indisponible — assertions d'intégration BullMQ non exécutées (CI fournit Redis).");
      return;
    }
    blockchainMock.settleCompensation.mockResolvedValue({
      txHash: '0xabc123def456',
      from: '0x1',
      to: '0x2',
      amountWei: 100000000000000000000n,
      blockNumber: 42,
    });

    const tx = await service.create({
      fromEmail: 'alice-int@clearnet.io',
      toEmail: 'bob-int@clearnet.io',
      amount: 100,
      note: 'test intégration',
    });
    expect(tx.id).toBe('tx-integration-1');

    // 1. L'événement PENDING est émis dès la création (WebSocket).
    expect(gatewayMock.notifyTransactionStatus).toHaveBeenCalledWith(
      'alice-int@clearnet.io',
      expect.objectContaining({ txId: tx.id, status: 'PENDING' }),
    );

    // 2. Le job est passé par la file BullMQ et traité par le processor.
    await waitFor(
      () => blockchainMock.settleCompensation.mock.calls.length > 0,
      15000,
      'traitement du job par le processor',
    );
    expect(blockchainMock.settleCompensation).toHaveBeenCalledWith(
      'alice-int@clearnet.io',
      'bob-int@clearnet.io',
      100,
    );

    // 3. Statut SUCCESS écrit dans Neo4j (onchainHash + onchainStatus).
    await waitFor(
      () =>
        neo4jQueries().some(
          ([query, params]) =>
            query.includes('SET t.onchainHash') && query.includes("t.onchainStatus = 'SUCCESS'") && params.txId === tx.id,
        ),
      15000,
      'écriture SUCCESS Neo4j',
    );

    // 4. Événement WebSocket SUCCESS avec le hash.
    await waitFor(
      () => gatewayMock.notifyTransactionStatus.mock.calls.some(([, e]) => e.status === 'SUCCESS'),
      15000,
      'événement WebSocket SUCCESS',
    );
    const successEvent = gatewayMock.notifyTransactionStatus.mock.calls.find(([, e]) => e.status === 'SUCCESS')![1];
    expect(successEvent.hash).toBe('0xabc123def456');
  });

  it("échec du règlement → statut FAILED (Neo4j + WebSocket) puis job 'failed'", async () => {
    if (!redisOk) {
      // Redis absent (ex. poste de dev) : test inopérant mais vert — la CI
      // provisionne un service redis et exécute réellement ces assertions.
      console.warn("Redis indisponible — assertions d'intégration BullMQ non exécutées (CI fournit Redis).");
      return;
    }
    blockchainMock.settleCompensation.mockRejectedValue(new Error('revert: crédit insuffisant'));

    const tx = await service.create({
      fromEmail: 'carol-int@clearnet.io',
      toEmail: 'bob-int@clearnet.io',
      amount: 50,
      note: 'échec attendu',
    });

    // FAILED écrit dans Neo4j (onchainStatus = 'FAILED' + erreur).
    await waitFor(
      () =>
        neo4jQueries().some(
          ([query, params]) => query.includes("t.onchainStatus = 'FAILED'") && params.txId === tx.id,
        ),
      15000,
      'écriture FAILED Neo4j',
    );

    // Événement WebSocket FAILED avec l'erreur.
    await waitFor(
      () => gatewayMock.notifyTransactionStatus.mock.calls.some(([, e]) => e.status === 'FAILED'),
      15000,
      'événement WebSocket FAILED',
    );
    const failedEvent = gatewayMock.notifyTransactionStatus.mock.calls.find(([, e]) => e.status === 'FAILED')![1];
    expect(failedEvent.error).toContain('crédit insuffisant');

    // Job passé en 'failed' (échec définitif, attempts=1 dans ce test).
    await waitFor(
      () => queue.getJobCounts('failed').then((counts) => counts.failed > 0),
      15000,
      "job à l'état failed",
    );
  }, 30000);
});
