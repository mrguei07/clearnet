import { Module } from '@nestjs/common';
import { ConnectorsController } from './connectors.controller';
import { ConnectorsService } from './connectors.service';
import { ConnectorAuthGuard } from './connector-auth.guard';

@Module({
  controllers: [ConnectorsController],
  providers: [ConnectorsService, ConnectorAuthGuard],
  exports: [ConnectorsService],
})
export class ConnectorsModule {}
