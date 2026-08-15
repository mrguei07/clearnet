import { Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { register } from 'prom-client';
import { METRICS_REGISTRY } from './metrics.constants';

/**
 * V1.4 Axe 5 - Exposition des métriques Prometheus (/metrics).
 * Règle d'or : l'endpoint et les métriques par défaut ne sont activés que si
 * METRICS_ENABLED=true (off par défaut, rétrocompat V1.3 stricte).
 * Le registre prom-client par défaut est partagé : les métriques custom
 * (BullMQ, on-chain) enregistrées dessus apparaissent sur le même /metrics.
 */
const metricsEnabled = process.env.METRICS_ENABLED === 'true';

@Module({
  imports: [
    ...(metricsEnabled
      ? [
          PrometheusModule.register({
            path: process.env.METRICS_PATH || '/metrics',
            defaultMetrics: { enabled: true },
          }),
        ]
      : []),
  ],
  providers: [{ provide: METRICS_REGISTRY, useValue: register }],
  exports: [METRICS_REGISTRY],
})
export class MetricsModule {}