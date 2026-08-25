import { Injectable } from '@nestjs/common';
import { Driver } from 'neo4j-driver';
import { NEO4J_DRIVER } from '../neo4j/neo4j.module';
import { Inject } from '@nestjs/common';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash?: string;
  country?: string | null;
  industry?: string | null;
  sanctioned?: boolean;
  createdAt?: Date;
}

@Injectable()
export class UsersService {
  constructor(@Inject(NEO4J_DRIVER) private readonly driver: Driver) {}

  private toUser(node: Record<string, unknown>): UserRecord {
    const props = (node as { properties?: Record<string, unknown> }).properties ?? node;
    return {
      id: (props.id as string) ?? '',
      email: (props.email as string) ?? '',
      name: (props.name as string) ?? '',
      passwordHash: props.passwordHash as string | undefined,
      country: (props.country as string | undefined) ?? null,
      industry: (props.industry as string | undefined) ?? null,
      sanctioned: (props.sanctioned as boolean | undefined) ?? false,
      createdAt: props.createdAt as Date | undefined,
    };
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const session = this.driver.session();
    try {
      const result = await session.run('MATCH (u:User {email: $email}) RETURN u', { email });
      if (result.records.length === 0) return null;
      return this.toUser(result.records[0].get('u') as unknown as Record<string, unknown>);
    } finally {
      await session.close();
    }
  }

  async findById(id: string): Promise<UserRecord | null> {
    const session = this.driver.session();
    try {
      const result = await session.run('MATCH (u:User {id: $id}) RETURN u', { id });
      if (result.records.length === 0) return null;
      return this.toUser(result.records[0].get('u') as unknown as Record<string, unknown>);
    } finally {
      await session.close();
    }
  }

  /**
   * Suppression de compte (RGPD / droit à l'effacement + exigence Google Play).
   * Anonymise le nœud :User plutôt que de le détruire afin de préserver
   * l'intégrité du registre de compensation (les :Transaction restent reliées
   * à un expéditeur/destinataire pseudonymisé, l'historique des contreparties
   * reste cohérent). L'email devient injoignable et le hash de mot de passe est
   * retiré : la connexion devient impossible.
   */
  async deleteAccount(id: string): Promise<boolean> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (u:User {id: $id})
         SET u.email = 'deleted+' + u.id + '@clearnet.invalid',
             u.name = 'Compte supprimé',
             u.passwordHash = null,
             u.country = null,
             u.industry = null,
             u.deletedAt = datetime()
         RETURN u`,
        { id },
      );
      return result.records.length > 0;
    } finally {
      await session.close();
    }
  }

  async create(input: {
    email: string;
    name: string;
    passwordHash: string;
    country?: string | null;
    industry?: string | null;
  }): Promise<UserRecord> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `CREATE (u:User {
           id: randomUUID(),
           email: $email,
           name: $name,
           passwordHash: $passwordHash,
           country: $country,
           industry: $industry,
           subscriptionTier: 'FREE',
           sanctioned: false,
           createdAt: datetime()
         }) RETURN u`,
        { ...input, country: input.country ?? null, industry: input.industry ?? null },
      );
      return this.toUser(result.records[0].get('u') as unknown as Record<string, unknown>);
    } finally {
      await session.close();
    }
  }

  /** Coût d'opportunité moyen du capital immobilisé (15 % / an, documenté). */
  static readonly OPPORTUNITY_COST_RATE = 0.15;

  /**
   * ROI ClearNet (V1.3) :
   * - total_immobilise : créances (transactions émises) de plus de 30 jours ;
   * - total_liberes    : montants reçus via compensation (historique reçu) ;
   * - economie_potentielle : immobilise × 15 % (coût d'opportunité du capital).
   */
  async computeRoi(email: string): Promise<{
    total_immobilise: number;
    total_liberes: number;
    economie_potentielle: number;
    currency: 'CLRN';
    calculatedAt: string;
  }> {
    const session = this.driver.session();
    try {
      const [immobiliseResult, liberesResult] = await Promise.all([
        session.run(
          `MATCH (me:User {email: $email})-[:SENT]->(t:Transaction)
           WHERE t.createdAt < datetime() - duration({days: 30})
           RETURN COALESCE(SUM(t.amount), 0) AS total`,
          { email },
        ),
        session.run(
          `MATCH (me:User {email: $email})-[:RECEIVED]->(t:Transaction)
           RETURN COALESCE(SUM(t.amount), 0) AS total`,
          { email },
        ),
      ]);
      const immobilise = Number(immobiliseResult.records[0]?.get('total') ?? 0);
      const liberes = Number(liberesResult.records[0]?.get('total') ?? 0);
      return {
        total_immobilise: immobilise,
        total_liberes: liberes,
        economie_potentielle: Number((immobilise * UsersService.OPPORTUNITY_COST_RATE).toFixed(4)),
        currency: 'CLRN',
        calculatedAt: new Date().toISOString(),
      };
    } finally {
      await session.close();
    }
  }
}
