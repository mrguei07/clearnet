import { Global, Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { ZkProofModule } from '../zkproof/zkproof.module';
import { BlockchainService } from './blockchain.service';
import { BlockchainController } from './blockchain.controller';
import { OnchainMetrics } from './onchain.metrics';
import { MultisigMonitor } from './multisig.monitor';

@Global()
@Module({
  imports: [ZkProofModule, MetricsModule],
  controllers: [BlockchainController],
  providers: [BlockchainService, OnchainMetrics, MultisigMonitor],
  exports: [BlockchainService],
})
export class BlockchainModule {}