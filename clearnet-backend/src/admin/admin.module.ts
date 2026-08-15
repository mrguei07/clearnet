import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { RolesGuard } from '../common/guards/roles.guard';
import { ONCHAIN_QUEUE } from '../transactions/transaction.processor';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/**
 * V1.4 Axe 1 - Administration DLQ/Retry.
 * Règle d'or : si ADMIN_EMAILS est vide, aucun contrôleur n'est monté
 * (routes inaccessibles). La file BullMQ n'est requise qu'avec QUEUE_ENABLED
 * (câblage au démarrage, comme le BullModule V1.3) ; l'injection dans
 * AdminService est @Optional -> 503 explicite sur les routes queue sinon.
 */
const adminEnabled = (process.env.ADMIN_EMAILS ?? '').trim().length > 0;
const queueEnabled = process.env.QUEUE_ENABLED === 'true';

@Module({
  imports: [
    ConfigModule,
    ...(queueEnabled ? [BullModule.registerQueue({ name: ONCHAIN_QUEUE })] : []),
  ],
  controllers: adminEnabled ? [AdminController] : [],
  providers: [AdminService, RolesGuard],
  exports: [RolesGuard],
})
export class AdminModule {}