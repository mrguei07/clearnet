import { ConfigService } from '@nestjs/config';
import { Inject, Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { Queue } from 'bullmq';
import { METRICS_REGISTRY } from '../metrics/metrics.constants';
import { ONCHAIN_QUEUE } from './transaction.constants';

/**
 * V1.4 Axe 5 - Métriques BullMQ dédiées (onchain-settlement) :
 * - bull_queue_jobs_completed_total (Counter)
 * - bull_queue_jobs_failed_total    (Counter)
 * - bull_queue_jobs_active/waiting/failed (Gauge, état stock)
 * - bull_queue_job_duration_seconds (Histogram)
 * Enregistrées sur le registre par défaut prom-client → servies par /metrics
 * (uniquement exposé si METRICS_ENABLED=true, règle d'or).
 */
@Injectable()
export class QueueMetrics {
  readonly completed: Counter;
  readonly failed: Counter;
  readonly active: Gauge;
  readonly waiting: Gauge;
  readonly failedGauge: Gauge;
  readonly duration: Histogram;

  constructor(
    @Inject(METRICS_REGISTRY) registry: Registry,
    private readonly config: ConfigService,
  ) {
    this.completed = new Counter({
      name: 'bull_queue_jobs_completed_total',
      help: 'Jobs de règlement terminés (BullMQ, onchain-settlement)',
      labelNames: ['queue'],
      registers: [registry],
    });
    this.failed = new Counter({
      name: 'bull_queue_jobs_failed_total',
      help: 'Jobs de règlement échoués (toutes tentatives confondues)',
      labelNames: ['queue'],
      registers: [registry],
    });
    this.active = new Gauge({
      name: 'bull_queue_jobs_active',
      help: 'Jobs de règlement en cours de traitement',
      labelNames: ['queue'],
      registers: [registry],
    });
    this.waiting = new Gauge({
      name: 'bull_queue_jobs_waiting',
      help: 'Jobs de règlement en attente',
      labelNames: ['queue'],
      registers: [registry],
    });
    this.failedGauge = new Gauge({
      name: 'bull_queue_jobs_failed',
      help: 'Jobs de règlement en état failed (stock)',
      labelNames: ['queue'],
      registers: [registry],
    });
    this.duration = new Histogram({
      name: 'bull_queue_job_duration_seconds',
      help: 'Durée de traitement d un job de règlement (processus → fin)',
      buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30],
      labelNames: ['queue'],
      registers: [registry],
    });
  }

  /** Polling d'état (active/waiting/failed) - 15 s, silencieux si Redis down. */
  startPolling(queue: Queue | undefined): NodeJS.Timeout {
    return setInterval(async () => {
      if (!queue) return;
      try {
        const counts = await queue.getJobCounts('active', 'waiting', 'failed');
        this.active.set({ queue: ONCHAIN_QUEUE }, counts.active ?? 0);
        this.waiting.set({ queue: ONCHAIN_QUEUE }, counts.waiting ?? 0);
        this.failedGauge.set({ queue: ONCHAIN_QUEUE }, counts.failed ?? 0);
      } catch {
        /* Redis indisponible : dégradation douce */
      }
    }, 15_000);
  }

  /** Durée d'un job à partir du timestamp de démarrage du traitement. */
  observeDuration(processedOn: number | undefined): void {
    this.duration.observe(
      { queue: ONCHAIN_QUEUE },
      (Date.now() - (processedOn ?? Date.now())) / 1000,
    );
  }
}