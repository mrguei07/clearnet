import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Driver } from 'neo4j-driver';
import { NEO4J_DRIVER } from '../neo4j/neo4j.module';
import { IngestEventDto } from './dto/ingest-event.dto';

export interface IngestResult {
  id: string;
  status: 'ACCEPTED';
  externalKey: string;
}

/**
 * Gateway connecteurs ERP (Phase A) : normalise les dettes/créances ingérées
 * depuis SAP / Oracle / Dynamics / Odoo en nœuds `IngestedDebt` (Neo4j).
 * Idempotence stricte : source + externalId uniques → 409 en cas de doublon.
 */
@Injectable()
export class ConnectorsService {
  constructor(@Inject(NEO4J_DRIVER) private readonly driver: Driver) {}

  async ingest(dto: IngestEventDto): Promise<IngestResult> {
    const externalKey = `${dto.source}:${dto.externalId}`;
    const session = this.driver.session();
    try {
      const existing = await session.run(
        'MATCH (d:IngestedDebt {externalKey: $k}) RETURN d',
        { k: externalKey },
      );
      if (existing.records.length > 0) {
        throw new ConflictException(`Événement déjà ingéré (idempotence) : ${externalKey}`);
      }
      const result = await session.run(
        `CREATE (d:IngestedDebt {
           id: randomUUID(),
           externalKey: $externalKey,
           source: $source,
           externalId: $externalId,
           fromCompany: $fromCompany,
           toCompany: $toCompany,
           amount: $amount,
           currency: $currency,
           invoiceRef: $invoiceRef,
           dueDate: $dueDate,
           createdAt: datetime()
         }) RETURN d`,
        {
          externalKey,
          source: dto.source,
          externalId: dto.externalId,
          fromCompany: dto.fromCompany,
          toCompany: dto.toCompany,
          amount: dto.amount,
          currency: dto.currency ?? 'EUR',
          invoiceRef: dto.invoiceRef ?? null,
          dueDate: dto.dueDate ?? null,
        },
      );
      const node = result.records[0].get('d') as { properties: { id: string } };
      return { id: node.properties.id, status: 'ACCEPTED', externalKey };
    } finally {
      await session.close();
    }
  }
}
