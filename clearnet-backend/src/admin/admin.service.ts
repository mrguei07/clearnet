import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Driver, int } from 'neo4j-driver';
import { NEO4J_DRIVER } from '../neo4j/neo4j.module';
import { ONCHAIN_QUEUE } from '../transactions/transaction.constants';

/**
 * V1.4 Axe 1 - Administration de la file de règlements (DLQ & Retry).
 * - GET  /admin/queue/failed      : jobs en échec (BullMQ, paginé)
 * - GET  /admin/queue/failed-audit: trace d'audit durable FailedJob (Neo4j)
 * - POST /admin/queue/retry/:id   : relance d'un job
 * - DELETE /admin/queue/clean/:q  : purge (file whitelistée)
 * La file n'existe que si QUEUE_ENABLED=true (@Optional, même sémantique que
 * TransactionsService V1.3) : les routes queue répondent 503 sinon ; l'audit
 * Neo4j reste disponible en toutes circonstances.
 */
@Injectable()
export class AdminService {
  constructor(
    @Inject(NEO4J_DRIVER) private readonly driver: Driver,
    /** File BullMQ - présente uniquement si QUEUE_ENABLED=true (@Optional). */
    @Optional() @InjectQueue(ONCHAIN_QUEUE) private readonly queue?: Queue,
  ) {}

  private assertQueue(): Queue {
    if (!this.queue) {
      throw new ServiceUnavailableException('queue disabled (QUEUE_ENABLED=false)');
    }
    return this.queue;
  }

  /** Jobs en état failed (BullMQ), paginés, triés du plus récent au plus ancien. */
  async listFailed(page = 1, limit = 20) {
    const queue = this.assertQueue();
    const p = Math.max(1, page);
    const l = Math.min(100, Math.max(1, limit));
    const [jobs, total] = await Promise.all([
      queue.getJobs(['failed'], (p - 1) * l, p * l - 1),
      queue.getJobCountByTypes('failed'),
    ]);
    return {
      items: jobs.map((job) => ({
        id: job.id,
        name: job.name,
        attemptsMade: job.attemptsMade,
        failedReason: String(job.failedReason ?? '').slice(0, 500),
        data: job.data,
        stacktrace: job.stacktrace?.slice(-1)?.[0] ?? null,
        finishedOn: job.finishedOn,
      })),
      total,
      page: p,
      limit: l,
    };
  }

  /** Audit durable des échecs définitifs (nœuds FailedJob V1.3, Neo4j). */
  async listFailedAudit(page = 1, limit = 20) {
    const p = Math.max(1, page);
    const l = Math.min(100, Math.max(1, limit));
    const session = this.driver.session();
    try {
      const [items, total] = await Promise.all([
        session.run(
          `MATCH (f:FailedJob)
           RETURN f ORDER BY f.failedAt DESC SKIP $skip LIMIT $limit`,
          { skip: int((p - 1) * l), limit: int(l) },
        ),
        session.run(`MATCH (f:FailedJob) RETURN count(f) AS total`),
      ]);
      return {
        items: items.records.map((r) => r.get('f').properties),
        total: total.records[0]?.get('total').toNumber() ?? 0,
        page: p,
        limit: l,
      };
    } finally {
      await session.close();
    }
  }

  /** Relance un job (conservation des attempts consommés, backoff normal). */
  async retryJob(jobId: string): Promise<boolean> {
    const job = await this.assertQueue().getJob(jobId);
    if (!job) return false;
    await job.retry();
    return true;
  }

  /** Purge complète de la file (obliterate force). File whitelistée en dur. */
  async cleanQueue(name: string): Promise<void> {
    const queue = this.assertQueue();
    if (name !== ONCHAIN_QUEUE) {
      throw new ServiceUnavailableException(`queue whitelisted: ${ONCHAIN_QUEUE} only`);
    }
    await queue.obliterate({ force: true });
  }
}