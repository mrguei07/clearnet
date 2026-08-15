import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SignaturesController } from './signatures.controller';
import { SignaturesService } from './signatures.service';

/**
 * V1.4 Axe 4 - Ledger local d'approbation des soumissions multisig.
 * Monté toujours ; les routes sont no-ops (503) si MULTISIG_ENABLED !== 'true'
 * (règle d'or : feature flag explicite).
 */
const enabled = process.env.MULTISIG_ENABLED === 'true';

@Module({
  imports: [ConfigModule],
  controllers: enabled ? [SignaturesController] : [],
  providers: [SignaturesService],
  exports: [SignaturesService],
})
export class SignaturesModule {}