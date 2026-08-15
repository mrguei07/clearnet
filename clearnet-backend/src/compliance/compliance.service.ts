import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface OFACScreeningReport {
  sanctioned: boolean;
  matchedName?: string;
  source: 'embedded' | 'csv' | 'api' | 'none';
}

export interface OfacProfile {
  name: string;
  industry?: string | null;
  country?: string | null;
}

const EMBEDDED_SANCTIONED_ENTITIES = ['ClearNet Sanctioned Corp', 'North Supply Line Ltd', 'Orbis Test Entity'];

const ITAR_ALLOWED_COUNTRIES = ['US', 'FR', 'UK', 'DE', 'IT', 'JP', 'AU'] as const;
const ITAR_RESTRICTED_INDUSTRIES = ['Defense', 'Spatial'] as const;

/**
 * Conformité ITAR / OFAC (feature flag ITAR_ENABLED, désactivé par défaut).
 * Tant que ITAR_ENABLED !== 'true', toutes les vérifications sont no-op :
 * le comportement V1.1 est strictement conservé (règle d'or).
 */
@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);
  private readonly enabled: boolean;
  private readonly ofacApiKey: string;
  private readonly csvPath: string;

  constructor(private readonly config: ConfigService) {
    this.enabled = this.config.get<string>('ITAR_ENABLED', 'false') === 'true';
    this.ofacApiKey = this.config.get<string>('OFAC_API_KEY', '');
    this.csvPath = this.config.get<string>('OFAC_CSV_PATH', '');
    if (this.enabled) {
      this.logger.log(`Conformité ITAR/OFAC ACTIVE (pays autorisés: ${ITAR_ALLOWED_COUNTRIES.join(', ')})`);
    } else {
      this.logger.warn('Conformité ITAR/OFAC DÉSACTIVÉE (ITAR_ENABLED != true). Aucun blocage.');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Screening OFAC : liste embarquée + CSV optionnel + API externe optionnelle. */
  async screenOfac(entityName: string): Promise<OFACScreeningReport> {
    if (!this.enabled) return { sanctioned: false, source: 'none' };
    const name = entityName.trim().toLowerCase();
    if (EMBEDDED_SANCTIONED_ENTITIES.some((entity) => entity.toLowerCase() === name)) {
      return { sanctioned: true, matchedName: entityName, source: 'embedded' };
    }
    if (this.csvPath && (await this.csvContainsName(name))) {
      return { sanctioned: true, matchedName: entityName, source: 'csv' };
    }
    if (this.ofacApiKey) {
      const apiHit = await this.queryExternalOfac(entityName);
      if (apiHit) return { sanctioned: true, matchedName: entityName, source: 'api' };
    }
    return { sanctioned: false, source: this.ofacApiKey ? 'api' : 'embedded' };
  }

  /** Restriction ITAR : secteur Défense/Spatial réservé aux pays autorisés. */
  isItarAllowed(industry: string | null | undefined, country: string | null | undefined): boolean {
    if (!this.enabled) return true;
    if (!industry || !ITAR_RESTRICTED_INDUSTRIES.includes(industry as (typeof ITAR_RESTRICTED_INDUSTRIES)[number])) {
      return true;
    }
    return ITAR_ALLOWED_COUNTRIES.includes((country ?? '').toUpperCase() as (typeof ITAR_ALLOWED_COUNTRIES)[number]);
  }

  /** Vérification complète d'une transaction : ITAR + OFAC des deux parties. */
  async assertTransactionAllowed(
    sender: OfacProfile,
    recipient: OfacProfile,
  ): Promise<void> {
    if (!this.enabled) return;
    const restricted = [sender, recipient].some(
      (party) => party.industry != null && ITAR_RESTRICTED_INDUSTRIES.includes(party.industry as (typeof ITAR_RESTRICTED_INDUSTRIES)[number]),
    );
    if (restricted) {
      if (!this.isItarAllowed(sender.industry ?? null, sender.country ?? null)) {
        throw new Error(`ITAR: émetteur "${sender.name}" non autorisé (secteur ${sender.industry}, pays ${sender.country ?? 'inconnu'})`);
      }
      if (!this.isItarAllowed(recipient.industry ?? null, recipient.country ?? null)) {
        throw new Error(`ITAR: destinataire "${recipient.name}" non autorisé (secteur ${recipient.industry}, pays ${recipient.country ?? 'inconnu'})`);
      }
    }
    const senderReport = await this.screenOfac(sender.name);
    if (senderReport.sanctioned) throw new Error(`OFAC: "${sender.name}" est sous sanction`);
    const recipientReport = await this.screenOfac(recipient.name);
    if (recipientReport.sanctioned) throw new Error(`OFAC: "${recipient.name}" est sous sanction`);
  }

  private async csvContainsName(lowerName: string): Promise<boolean> {
    try {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(this.csvPath, 'utf8');
      return content.split(/\r?\n/).some((line) => line.trim().toLowerCase() === lowerName);
    } catch {
      this.logger.warn(`CSV OFAC illisible (${this.csvPath}) — ignoré`);
      return false;
    }
  }

  private async queryExternalOfac(entityName: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(
        `https://api.ofac.example.org/v1/screen?name=${encodeURIComponent(entityName)}`,
        { headers: { Authorization: `Bearer ${this.ofacApiKey}` }, signal: controller.signal },
      );
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { totalSanctions: number };
      return (body.totalSanctions ?? 0) > 0;
    } catch (error) {
      this.logger.warn(`API OFAC externe indisponible (${(error as Error).message}) — dégradation: non-sanctionné`);
      return false;
    }
  }
}