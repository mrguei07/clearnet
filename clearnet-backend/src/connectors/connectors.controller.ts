import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ConnectorsService, IngestResult } from './connectors.service';
import { ConnectorAuthGuard } from './connector-auth.guard';
import { IngestEventDto } from './dto/ingest-event.dto';

/**
 * Gateway d'ingestion ERP (Phase A) : POST /api/connectors/events
 * (machine-to-machine, en-tête x-api-key). Voir
 * docs/EXECUTION_PACK_PHASE_A_TECH.md §3 pour la spec OpenAPI.
 */
@Controller('connectors')
@UseGuards(ConnectorAuthGuard)
export class ConnectorsController {
  constructor(private readonly connectorsService: ConnectorsService) {}

  @Post('events')
  @HttpCode(HttpStatus.ACCEPTED)
  ingest(@Body() dto: IngestEventDto): Promise<IngestResult> {
    return this.connectorsService.ingest(dto);
  }
}
