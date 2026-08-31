import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Driver } from 'neo4j-driver';
import { NEO4J_DRIVER } from '../neo4j/neo4j.module';

export type KybLevel = 'N0' | 'N1' | 'N2' | 'N3';
export type KybStatus = 'PENDING' | 'APPROVED' | 'REVIEW' | 'BLOCKED';

export interface KybStatusReport {
  email: string;
  level: KybLevel;
  status: KybStatus;
  sanctioned: boolean;
}

/**
 * KYB (Know Your Business) — Phase A conformité (voir
 * docs/EXECUTION_PACK_PHASE_A_JURIDIQUE.md §2).
 * Niveaux : N0 email+SIREN auto, N1 KBis+représentant, N2 bénéficiaires
 * effectifs+screening sanctions, N3 conformité renforcée (> 1 M€).
 * V1 : lecture du statut (l'alimentation N1-N3 arrive avec les connecteurs).
 */
@Injectable()
export class KybService {
  constructor(@Inject(NEO4J_DRIVER) private readonly driver: Driver) {}

  async getStatus(email: string): Promise<KybStatusReport> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (u:User {email: $email})
         RETURN coalesce(u.kybLevel, 'N0') AS level,
                coalesce(u.kybStatus, 'PENDING') AS status,
                coalesce(u.sanctioned, false) AS sanctioned`,
        { email },
      );
      if (result.records.length === 0) {
        throw new NotFoundException('Utilisateur introuvable');
      }
      const record = result.records[0];
      return {
        email,
        level: record.get('level') as KybLevel,
        status: record.get('status') as KybStatus,
        sanctioned: Boolean(record.get('sanctioned')),
      };
    } finally {
      await session.close();
    }
  }
}
