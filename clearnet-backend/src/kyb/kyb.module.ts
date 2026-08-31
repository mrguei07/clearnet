import { Module } from '@nestjs/common';
import { KybController } from './kyb.controller';
import { KybService } from './kyb.service';

@Module({
  controllers: [KybController],
  providers: [KybService],
  exports: [KybService],
})
export class KybModule {}
