import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Driver, int } from 'neo4j-driver';
import { NEO4J_DRIVER } from '../neo4j/neo4j.module';
import { OracleService } from '../oracles/oracle.service';

/** Nœud du réseau egocentré (contrepartie de l'utilisateur ou de ses pairs). */
export interface GraphNode {
  id: string;
  label: string;
  email: string;
  /** Créance que le nœud détient sur l'utilisateur (wei CLRN). */
  balance?: number;
  /** Marqué urgence surestaries (oracle actif uniquement). */
  urgency?: boolean;
}

/** Arête orientée dettes/créances. */
export interface GraphLink {
  /** Débiteur (qui doit). */
  source: string;
  /** Créancier (à qui). */
  target: string;
  value: number;
  kind: 'debt' | 'credit';
}

export interface EgoNetwork {
  ego: string;
  nodes: GraphNode[];
  links: GraphLink[];
  depth: number;
  oracleEnabled: boolean;
  generatedAt: string;
}

const PRINCIPAL_LIMIT = 5;
const SECONDARY_LIMIT = 3;

/**
 * Extraction du réseau egocentré (V1.3) : les 5 principales contreparties de
 * l'utilisateur (volumes agrégés SENT/RECEIVED) puis, selon la profondeur,
 * les pairs de ces contreparties — pour la visualisation Force Graph mobile.
 * Les arêtes sont orientées débiteur → créancier (détection de cycles aisée).
 * Feature flag ORACLES_ENABLED : les nœuds peuvent être marqués "urgence"
 * (surestaries &gt; 3 j) lorsque l'oracle retourne un demurrage élevé.
 */
@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);
  private readonly oracleEnabled: boolean;

  constructor(
    @Inject(NEO4J_DRIVER) private readonly driver: Driver,
    private readonly oracleService: OracleService,
    private readonly config: ConfigService,
  ) {
    this.oracleEnabled = this.config.get<string>('ORACLES_ENABLED', 'false') === 'true';
  }

  /** Requête des créances/dettes agrégées d'un utilisateur vis-à-vis de ses pairs. */
  private async aggregatedBalances(
    email: string,
    excludeEmail: string,
    limit: number,
  ): Promise<Array<{ email: string; name: string; owedTo: number; owedBy: number }>> {
    const session = this.driver.session();
    try {
      // Requêtes SÉQUENTIELLES : le driver Neo4j interdit les session.run()
      // concurrents sur la même session (transactions implicites imbriquées).
      const sent = await session.run(
        `MATCH (me:User {email: $email})-[:SENT]->(t:Transaction)<-[:RECEIVED]-(other:User)
         WHERE other.email <> $excludeEmail
         WITH other, SUM(t.amount) AS owedToMe
         RETURN other.email AS email, other.name AS name, owedToMe
         ORDER BY owedToMe DESC LIMIT $limit`,
        { email, excludeEmail, limit: int(limit + SECONDARY_LIMIT) },
      );
      const received = await session.run(
        `MATCH (me:User {email: $email})-[:RECEIVED]->(t:Transaction)<-[:SENT]-(other:User)
         WHERE other.email <> $excludeEmail
         WITH other, SUM(t.amount) AS owedByMe
         RETURN other.email AS email, other.name AS name, owedByMe
         ORDER BY owedByMe DESC LIMIT $limit`,
        { email, excludeEmail, limit: int(limit + SECONDARY_LIMIT) },
      );
      const map = new Map<string, { email: string; name: string; owedTo: number; owedBy: number }>();
      for (const record of sent.records) {
        const email_ = record.get('email') as string;
        map.set(email_, {
          email: email_,
          name: (record.get('name') as string) ?? email_,
          owedTo: Number(record.get('owedToMe') ?? 0),
          owedBy: 0,
        });
      }
      for (const record of received.records) {
        const email_ = record.get('email') as string;
        const entry = map.get(email_) ?? { email: email_, name: (record.get('name') as string) ?? email_, owedTo: 0, owedBy: 0 };
        entry.owedBy = Number(record.get('owedByMe') ?? 0);
        map.set(email_, entry);
      }
      return [...map.values()]
        .sort((a, b) => Math.max(b.owedTo, b.owedBy) - Math.max(a.owedTo, a.owedBy))
        .slice(0, limit);
    } finally {
      await session.close();
    }
  }

  /** Réseau egocentré : nœuds + arêtes orientées débiteur → créancier. */
  async getEgoNetwork(
    email: string,
    depth = 2,
    lat?: number,
    lng?: number,
  ): Promise<EgoNetwork> {
    const depthClamped = Math.min(Math.max(Math.trunc(depth) || 2, 1), 3);
    const ego: GraphNode = { id: email, label: 'Moi', email, balance: 0 };
    const nodes = new Map<string, GraphNode>([[email, ego]]);
    const links: GraphLink[] = [];
    const addLink = (debtor: string, creditor: string, value: number) => {
      if (value <= 0 || debtor === creditor) return;
      links.push({ source: debtor, target: creditor, value, kind: debtor === email ? 'debt' : 'credit' });
    };

    const direct = await this.aggregatedBalances(email, '', PRINCIPAL_LIMIT);
    for (const entry of direct) {
      const node: GraphNode = { id: entry.email, label: entry.name, email: entry.email, balance: entry.owedTo };
      nodes.set(entry.email, node);
      // entry.owedTo = ils me doivent → lien (other → me)
      addLink(entry.email, email, entry.owedTo);
      // entry.owedBy = je leur dois → lien (me → other)
      addLink(email, entry.email, entry.owedBy);
    }

    // Profondeur 2 : pairs des contreparties (hors ego), volumes agrégés.
    if (depthClamped >= 2) {
      const secondaryEmails = [...nodes.keys()].filter((id) => id !== email).slice(0, SECONDARY_LIMIT);
      for (const cpEmail of secondaryEmails) {
        const pairs = await this.aggregatedBalances(cpEmail, email, SECONDARY_LIMIT);
        for (const pair of pairs) {
          if (!nodes.has(pair.email)) {
            nodes.set(pair.email, { id: pair.email, label: pair.name, email: pair.email, balance: pair.owedTo });
          }
          addLink(pair.email, cpEmail, pair.owedTo);
          addLink(cpEmail, pair.email, pair.owedBy);
        }
      }
    }

    // Urgence surestaries (oracle actif uniquement) — MVP : appliquée aux
    // contreparties si le demurrage réel excède 3 jours.
    if (this.oracleEnabled) {
      const demurrage = await this.oracleService.getDemurrageDays(undefined, lat, lng);
      if (demurrage.source === 'stormglass' && demurrage.demurrageDays > 3) {
        for (const [id, node] of nodes) {
          if (id !== email) node.urgency = true;
        }
        this.logger.log(`Egonet ${email} : ${demurrage.demurrageDays} j de demurrage → urgences marquées`);
      }
    }

    return {
      ego: email,
      nodes: [...nodes.values()],
      links,
      depth: depthClamped,
      oracleEnabled: this.oracleEnabled,
      generatedAt: new Date().toISOString(),
    };
  }
}
