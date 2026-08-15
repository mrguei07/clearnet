import { createHmac, timingSafeEqual } from 'crypto';
import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Driver } from 'neo4j-driver';
import { NEO4J_DRIVER } from '../neo4j/neo4j.module';

/**
 * V1.4 Axe 4 - 2FA MVP du ledgers d'approbation multisig : code à 6 caractères
 * = HMAC-SHA256(SIGNATURE_2FA_SECRET, txId) tronqué (RFC 4226 style),
 * transmis hors bande. Exige SIGNATURE_2FA_SECRET (>= 32 car.) en prod ;
 * vide = feature désactivée (règle d'or).
 */
@Injectable()
export class SignaturesService {
  constructor(
    private readonly config: ConfigService,
    @Inject(NEO4J_DRIVER) private readonly driver: Driver,
  ) {}

  private assertEnabled(): void {
    if (
      this.config.get<string>('MULTISIG_ENABLED') !== 'true' ||
      !this.config.get<string>('SIGNATURE_2FA_SECRET', '')
    ) {
      throw new ServiceUnavailableException('multisig signing disabled');
    }
  }

  private codeFor(txId: string): string {
    const secret = this.config.get<string>('SIGNATURE_2FA_SECRET')!;
    return createHmac('sha256', secret).update(txId).digest('hex').slice(0, 6).toUpperCase();
  }

  /** Soumission : crée la demande d'approbation + renvoie l'OTP (hors bande). */
  async request(txId: string, fromEmail: string, dataDescription: string) {
    this.assertEnabled();
    const session = this.driver.session();
    try {
      const res = await session.run(
        `CREATE (s:SignatureRequest {id: randomUUID(), txId: $txId, fromEmail: $fromEmail,
                 dataDescription: $desc, status: 'PENDING', createdAt: datetime()})
         RETURN s.id AS id`,
        { txId, fromEmail, desc: dataDescription },
      );
      return { id: res.records[0].get('id'), otp: this.codeFor(txId) };
    } finally {
      await session.close();
    }
  }

  /** Approbation : vérifie l'OTP (comparaison à temps constant). */
  async approve(id: string, otp: string, adminEmail: string) {
    this.assertEnabled();
    const session = this.driver.session();
    try {
      const res = await session.run(
        `MATCH (s:SignatureRequest {id: $id}) RETURN s`,
        { id },
      );
      if (!res.records.length) throw new BadRequestException('request not found');
      const expected = this.codeFor(res.records[0].get('s').properties.txId);
      const ok =
        expected.length === otp.length && timingSafeEqual(Buffer.from(expected), Buffer.from(otp));
      if (!ok) throw new BadRequestException('invalid OTP');
      await session.run(
        `MATCH (s:SignatureRequest {id: $id})
         SET s.status = 'APPROVED', s.approvedBy = $by, s.approvedAt = datetime()`,
        { id, by: adminEmail },
      );
      return { approved: true, id };
    } finally {
      await session.close();
    }
  }

  /** Liste des demandes en attente (dashboard ops). */
  async pending() {
    this.assertEnabled();
    const session = this.driver.session();
    try {
      const res = await session.run(
        `MATCH (s:SignatureRequest {status: 'PENDING'})
         RETURN s.id AS id, s.txId AS txId, s.fromEmail AS fromEmail,
                s.dataDescription AS dataDescription, s.createdAt AS createdAt
         ORDER BY s.createdAt DESC`,
      );
      return res.records.map((r) => ({
        id: r.get('id'),
        txId: r.get('txId'),
        fromEmail: r.get('fromEmail'),
        dataDescription: r.get('dataDescription'),
        createdAt: r.get('createdAt'),
      }));
    } finally {
      await session.close();
    }
  }
}