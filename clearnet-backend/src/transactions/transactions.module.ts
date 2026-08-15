import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { MetricsModule } from '../metrics/metrics.module';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { TransactionGateway } from './transactions.gateway';
import { TransactionProcessor, ONCHAIN_QUEUE } from './transaction.processor';
import { ComplianceModule } from '../compliance/compliance.module';
import { UsersModule } from '../users/users.module';

// File BullMQ (V1.3, industrialisation) : activée uniquement si la variable
// d'ENVIRONNEMENT RÉELLE QUEUE_ENABLED=true (règle d'or : off par défaut,
// comportement V1.2 préservé — fire-and-forget).
// Sémantique (3.1) : le CÂBLAGE du module (BullModule + processor) est évalué
// au démarrage — le basculer demande un redémarrage du pod (README-PROD.md).
// La DÉCISION d'acheminer via la file est ensuite évaluée DYNAMIQUEMENT à
// chaque transaction (TransactionsService.isQueueEnabled via ConfigService) :
// désactiver QUEUE_ENABLED en cours de vie du pod bascule proprement sur le
// fire-and-forget (dégradation douce), sans redémarrage.
const queueEnabled = process.env.QUEUE_ENABLED === 'true';

@Module({
  imports: [
    ComplianceModule,
    UsersModule,
    MetricsModule,
    ...(queueEnabled
      ? [
          BullModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
              connection: {
                host: config.get<string>('REDIS_HOST', 'redis'),
                port: Number(config.get<string>('REDIS_PORT', '6379')),
                password: config.get<string>('REDIS_PASSWORD', '') || undefined,
                maxRetriesPerRequest: null,
              },
              defaultJobOptions: {
                attempts: Number(config.get<string>('QUEUE_ATTEMPTS', '5')),
                backoff: {
                  type: 'exponential',
                  delay: Number(config.get<string>('QUEUE_BACKOFF_MS', '5000')),
                },
                removeOnComplete: 1000,
                removeOnFail: 5000,
              },
            }),
          }),
          BullModule.registerQueue({ name: ONCHAIN_QUEUE }),
        ]
      : []),
  ],
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    TransactionGateway,
    ...(queueEnabled ? [TransactionProcessor] : []),
  ],
  exports: [TransactionsService],
})
export class TransactionsModule {}
