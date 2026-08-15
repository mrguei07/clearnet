import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface DemurrageOracleResult {
  demurrageDays: number;
  source: 'stormglass' | 'fallback';
  unit: 'days';
}

export interface LaunchWindowOracleResult {
  windowDays: number;
  nextLaunchAt: Date | null;
  source: 'space-track' | 'fallback';
}

export interface MilestoneOracleResult {
  valid: boolean;
  trialId: string | null;
  source: 'clinicaltrials' | 'fallback';
}

const DEFAULTS = Object.freeze({
  demurrageDays: 3,
  launchWindowDays: 60,
  milestoneValid: true,
});

/**
 * Oracles sectoriels (feature flag ORACLES_ENABLED, désactivé par défaut).
 * API : Stormglass (maritime), Space-Track (spatial), ClinicalTrials.gov (biotech).
 * Dégradation douce : API indisponible ou flag éteint → valeurs par défaut
 * (identiques au comportement V1.1) + log d'alerte.
 */
@Injectable()
export class OracleService {
  private readonly logger = new Logger(OracleService.name);
  private readonly enabled: boolean;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.enabled = this.config.get<string>('ORACLES_ENABLED', 'false') === 'true';
    this.timeoutMs = this.config.get<number>('ORACLE_TIMEOUT_MS', 2500);
    if (this.enabled) {
      this.logger.log('Oracles sectoriels ACTIFS');
    } else {
      this.logger.warn('Oracles sectoriels DÉSACTIVÉS (ORACLES_ENABLED != true). Valeurs par défaut.');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Maritime — Stormglass : niveau de la mer → surcoût de demeurage (demurrage). */
  async getDemurrageDays(port?: string, lat?: number, lng?: number): Promise<DemurrageOracleResult> {
    const fallback: DemurrageOracleResult = { demurrageDays: DEFAULTS.demurrageDays, source: 'fallback', unit: 'days' };
    if (!this.enabled) return fallback;
    try {
      const apiKey = this.config.get<string>('STORMGLASS_API_KEY', '');
      if (!apiKey) throw new Error('STORMGLASS_API_KEY manquante');
      const params = new URLSearchParams();
      if (lat != null && lng != null) {
        params.set('lat', String(lat));
        params.set('lng', String(lng));
      }
      const res = await fetchWithTimeout(
        `https://api.stormglass.io/v2/tide/sea-level?${params.toString()}`,
        { headers: { Authorization: apiKey } },
        this.timeoutMs,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data?: { seaLevel?: { m: number } }[] };
      const meters = body.data?.[0]?.seaLevel?.m;
      if (meters == null) throw new Error('donnée sea-level absente');
      return { demurrageDays: meters > 2.5 ? 5 : meters > 1.2 ? 3 : 1, source: 'stormglass', unit: 'days' };
    } catch (error) {
      this.logger.warn(`Oracle Stormglass indisponible — fallback ${fallback.demurrageDays}j (${(error as Error).message})`);
      return fallback;
    }
  }

  /** Spatial — Space-Track : prochaine fenêtre de lancement. */
  async getLaunchWindow(objectNumber?: string): Promise<LaunchWindowOracleResult> {
    const fallback: LaunchWindowOracleResult = { windowDays: DEFAULTS.launchWindowDays, nextLaunchAt: null, source: 'fallback' };
    if (!this.enabled) return fallback;
    try {
      const user = this.config.get<string>('SPACE_TRACK_USER', '');
      const password = this.config.get<string>('SPACE_TRACK_PASSWORD', '');
      if (!user || !password) throw new Error('SPACE_TRACK_USER/PASSWORD manquants');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const auth = await fetch('https://www.space-track.org/ajaxauth/login', {
        method: 'POST',
        body: new URLSearchParams({ identity: user, password }),
        signal: controller.signal,
      });
      if (!auth.ok) throw new Error(`auth HTTP ${auth.status}`);
      const query = `https://www.space-track.org/basicspacedata/query/class/launch_window/limit/1/orderby/launch_date asc`;
      const res = await fetchWithTimeout(query, { signal: controller.signal }, this.timeoutMs);
      clearTimeout(timer);
      if (!res.ok) throw new Error(`query HTTP ${res.status}`);
      const rows = (await res.json()) as { launch_date?: string }[];
      const next = rows[0]?.launch_date ? new Date(rows[0].launch_date) : null;
      return {
        windowDays: next ? DEFAULTS.launchWindowDays : DEFAULTS.launchWindowDays,
        nextLaunchAt: next,
        source: 'space-track',
      };
    } catch (error) {
      this.logger.warn(`Oracle Space-Track indisponible — fallback ${fallback.windowDays}j (${(error as Error).message})`);
      return fallback;
    }
  }

  /** Biotech : validité de milestone (essais cliniques) via ClinicalTrials.gov. */
  async getMilestoneValidity(nctId?: string): Promise<MilestoneOracleResult> {
    const fallback: MilestoneOracleResult = { valid: DEFAULTS.milestoneValid, trialId: null, source: 'fallback' };
    if (!this.enabled) return fallback;
    try {
      const terms = nctId ?? 'breast cancer';
      const res = await fetchWithTimeout(
        `https://clinicaltrials.gov/api/query/study_fields?expr=${encodeURIComponent(terms)}&fields=NCTId,OverallStatus&fmt=json`,
        {},
        this.timeoutMs,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        study_fields_response?: {
          study_fields?: { NCTId?: string[]; OverallStatus?: string[] }[];
        };
      };
      const first = body.study_fields_response?.study_fields?.[0];
      const status = first?.OverallStatus?.[0] ?? '';
      return {
        valid: status === 'Recruiting' || status === 'Completed',
        trialId: first?.NCTId?.[0] ?? null,
        source: 'clinicaltrials',
      };
    } catch (error) {
      this.logger.warn(`Oracle ClinicalTrials.gov indisponible — fallback (${(error as Error).message})`);
      return fallback;
    }
  }
}

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}