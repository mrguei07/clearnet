import { Module } from '@nestjs/common';
import { OracleModule } from '../oracles/oracle.module';
import { GraphService } from './graph.service';
import { GraphController } from './graph.controller';

@Module({
  imports: [OracleModule],
  controllers: [GraphController],
  providers: [GraphService],
  exports: [GraphService],
})
export class GraphModule {}
