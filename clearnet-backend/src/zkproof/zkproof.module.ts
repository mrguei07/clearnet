import { Module } from '@nestjs/common';
import { ZkProofService } from './zkproof.service';
import { ZkProofController } from './zkproof.controller';

@Module({
  controllers: [ZkProofController],
  providers: [ZkProofService],
  exports: [ZkProofService],
})
export class ZkProofModule {}
