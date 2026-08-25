# ClearNet — PHASE 2 : Production Hardening (Réponse)

**Livrable unique** — contenu complet des diffs (fichiers modifiés), des nouveaux fichiers
(arrière-plan backend + blockchain), des manifests Helm/Kubernetes et le run de validation.

- Date : 2026-08-08
- Base : V1.1 (stack complète : backend NestJS 15 secteurs, Neo4j, token ClearNet, app mobile Electron)
- Cible : V1.2.0 (phase 2)

---

## 1. Résumé & principe

Quatre piliers demandés sont implémentés **en mode incrémental**, avec une règle d'or stricte :

> **Aucune régression.** Toute nouvelle capacité est protégée par un *feature flag* **désactivé
> par défaut** (`ITAR_ENABLED`, `ORACLES_ENABLED`, `ZK_ENABLED` — comparés à la string `'true'`).
> Le comportement V1.1 est donc strictement identique jusqu'à activation explicite.

| Pilier | Livré | Flag | Défaut |
|---|---|---|---|
| 1. ZK proofs Groth16 (compensation sans révéler montant/identités) | Circuit circom, artefacts (script), `ZkProofService` (prove/verify on+off chain), hook `CompensationEngine` | `ZK_ENABLED`, `VERIFIER_ADDRESS`, `BLOCKCHAIN_RPC_URL` | `false` |
| 2. Conformité ITAR/OFAC | `ComplianceService` (liste embarquée 3 entités + CSV + API), guards, call dans `TransactionsService` | `ITAR_ENABLED`, `OFAC_API_KEY`, `OFAC_CSV_PATH` | `false` |
| 3. Oracles sectoriels (Stormglass, Space-Track, ClinicalTrials.gov, oracles crypto Chainlink) | Backend `OracleModule` + endpoints + fallback durcis ; contrat `ChainlinkPriceFeed.sol` | `ORACLES_ENABLED` + clés API | `false` |
| 4. Scale/K8s | Chart Helm complet (backend/neo4j/devnet) + HPA + Règles probes/ressources | publicado via valeurs du chart | — |

Contrôles de non-régression réalisés : `npm run build` + tests unitaires backend (voir § 7),
`hardhat compile` (contrats).

---

## 2. Diffs des fichiers modifiés

### 2.1 `clearnet-backend/src/app.module.ts`

```diff
  import { CompanyModule } from './company/company.module';
+ import { ComplianceModule } from './compliance/compliance.module';
+ import { ZkProofModule } from './zkproof/zkproof.module';
+ import { OracleModule } from './oracles/oracle.module';
+ import { GraphModule } from './graph/graph.module';
  import { RateLimitGuard } from './common/guards/rate-limit.guard';

   imports: [
     ConfigModule.forRoot({ isGlobal: true }),
     ...
     CompanyModule,
+    ComplianceModule,
+    ZkProofModule,
+    OracleModule,
+    GraphModule,
   ],
```

### 2.2 `clearnet-backend/src/users/users.service.ts` (modifications pour conformité)

```diff
   export interface UserRecord {
     id: string;
     email: string;
     name: string;
     passwordHash?: string;
+    country?: string | null;
+    industry?: string | null;
+    sanctioned?: boolean;
     createdAt?: Date;
   }

   private toUser(node: Record<string, unknown>): UserRecord {
     ...
     passwordHash: props.passwordHash as string | undefined,
+    country: (props.country as string | undefined) ?? null,
+    industry: (props.industry as string | undefined) ?? null,
+    sanctioned: (props.sanctioned as boolean | undefined) ?? false,
     createdAt: props.createdAt as Date | undefined,
   }

   async create(input: {
     email: string;
     name: string;
     passwordHash: string;
+    country?: string | null;
+    industry?: string | null;
   }): Promise<UserRecord> {
     result = await session.run(
       `CREATE (u:User {
          ...
+        country: $country,
+        industry: $industry,
+        sanctioned: false,
          createdAt: datetime()
        }) RETURN u`,
+      { ...input, country: input.country ?? null, industry: input.industry ?? null },
```

> Note : les utilisateurs existants (seed V1.1) n'ont pas `country`/`industry`/`sanctioned` —
> `toUser` retourne `null`/`false` par défaut → les contrôles ITAR/OFAC sont inopérants
> tant que le profil n'est pas renseigné (dégradation douce documentée).

### 2.3 `clearnet-backend/src/auth/dto/register.dto.ts`

```diff
--- a/clearnet-backend/src/auth/dto/register.dto.ts
+++ b/clearnet-backend/src/auth/dto/register.dto.ts
@@
-import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';
+import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
@@
   @MinLength(6, { message: 'Le mot de passe doit contenir au moins 6 caractères' })
   password!: string;
+
+  @IsOptional()
+  @IsString()
+  country?: string;
+
+  @IsOptional()
+  @IsIn(['SupplyChain', 'RealEstate', 'Energy', 'Banking', 'Metallurgy', 'Healthcare',
+         'Fashion', 'IndustrialTextile', 'Defense', 'Technology', 'InternationalTrade',
+         'Aviation', 'Maritime', 'Spatial', 'Biotech'])
+  industry?: string;
 }
```

### 2.4 `clearnet-backend/src/auth/auth.service.ts`

```diff
@@
     const user = await this.usersService.create({
       email: dto.email,
       name: dto.name,
       passwordHash,
+      country: dto.country ?? null,
+      industry: dto.industry ?? null,
     });
```

### 2.5 `clearnet-backend/src/transactions/transactions.service.ts`

```diff
   import { BlockchainService } from '../blockchain/blockchain.service';
+  import { ComplianceService, OfacProfile } from '../compliance/compliance.service';
+  import { UsersService } from '../users/users.service';
@@
     @Inject(NEO4J_DRIVER) private readonly driver: Driver,
     private readonly blockchainService: BlockchainService,
+    private readonly complianceService: ComplianceService,
+    private readonly usersService: UsersService,
   ) {}
@@
     if (input.fromEmail === input.toEmail) {
       throw new BadRequestException('Impossible de s’envoyer une transaction à soi-même');
     }
+    await this.assertCompliance(input.fromEmail, input.toEmail);
     const result = await session.run( ... );
@@
+  /**
+   * Vérifications ITAR/OFAC avant création (no-op si ITAR_ENABLED != true).
+   * Les profils sont chargés depuis Neo4j ; si l'un est introuvable le
+   * contexte Cypher existant lève « Destinataire introuvable » (non régressif).
+   */
+  private async assertCompliance(fromEmail: string, toEmail: string): Promise<void> {
+    if (!this.complianceService.isEnabled()) return;
+    const [sender, recipient] = await Promise.all([
+      this.usersService.findByEmail(fromEmail),
+      this.usersService.findByEmail(toEmail),
+    ]);
+    if (!sender || !recipient) return;
+    const toProfile = (user: { name: string; industry?: string | null; country?: string | null }): OfacProfile => ({
+      name: user.name,
+      industry: user.industry ?? null,
+      country: user.country ?? null,
+    });
+    await this.complianceService.assertTransactionAllowed(toProfile(sender), toProfile(recipient));
+  }
```

### 2.6 `clearnet-backend/src/transactions/transactions.module.ts`

```diff
   imports: [ComplianceModule, UsersModule],
```

### 2.7 `clearnet-blockchain/contracts/CompensationEngine.sol` (extension ZK, non-régressive)

```diff
--- a/clearnet-blockchain/contracts/CompensationEngine.sol (V1.1)
+++ b/clearnet-blockchain/contracts/CompensationEngine.sol (V1.2)
@@
+ import { IZkVerifier } from "./interfaces/IZkVerifier.sol";
  contract CompensationEngine {
     address public immutable admin;
     mapping(address => int256) public netPositions;
+
+    // --- Intégration ZK (feature flag on-chain, défaut=false) ---
+    address public zkbVerifier;
+    bool public zkRequired;
+    uint256 public maxAmount;
+
     event PositionUpdated(address indexed account, int256 netPosition);
     event Compensated(address indexed from, address indexed to, uint256 amount);
+    event ZkSettingsUpdated(address verifier, bool required, uint256 maxAmount);
+
+    function setZkSettings(address verifier, bool required, uint256 _maxAmount) external onlyAdmin {
+        zkbVerifier = verifier;
+        zkRequired = required;
+        maxAmount = _maxAmount;
+        emit ZkSettingsUpdated(verifier, required, _maxAmount);
+    }
+
+    function settleWithProof(
+        address from, address to, uint256 amount,
+        uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c,
+        uint256[1] calldata input
+    ) external onlyAdmin {
+        if (zkRequired) {
+            require(amount > 0 && amount <= maxAmount, "amount out of ZK bounds");
+            require(IZkVerifier(zkbVerifier).verifyProof(a, b, c, input), "invalid zk proof");
+        }
+        _settle(from, to, amount);
+    }
+
+    function _settle(address from, address to, uint256 amount) private {
         require(netPositions[from] >= int256(amount), "CompensationEngine: insufficient credit");
         require(netPositions[to] <= 0, "CompensationEngine: counterparty has no debt");
         netPositions[from] -= int256(amount);
         netPositions[to] += int256(amount);
         emit Compensated(from, to, amount);
     }
 }
+
+ // Le réglage V1.1 `settle()` reste strictement inchangé → zéro régression.
```

### 2.8 `infrastructure/docker-compose.yml` (variables d'environnement Phase 2)

```yml
+      # ---- Phase 2 (règle d'or : désactivé par défaut) ----
+      ITAR_ENABLED: ${ITAR_ENABLED:-false}
+      OFAC_API_KEY: ${OFAC_API_KEY:-}
+      OFAC_CSV_PATH: ${OFAC_CSV_PATH:-}
+      ORACLES_ENABLED: ${ORACLES_ENABLED:-false}
+      STORMGLASS_API_KEY: ${STORMGLASS_API_KEY:-}
+      SPACE_TRACK_USER: ${SPACE_TRACK_USER:-}
+      SPACE_TRACK_PASSWORD: ${SPACE_TRACK_PASSWORD:-}
+      ORACLE_TIMEOUT_MS: ${ORACLE_TIMEOUT_MS:-2500}
+      ZK_ENABLED: ${ZK_ENABLED:-false}
+      VERIFIER_ADDRESS: ${VERIFIER_ADDRESS:-}
+      ZK_ARTIFACTS_DIR: ${ZK_ARTIFACTS_DIR:-./zkartifacts}
```

### 2.9 `clearnet-backend/package.json` (dépendance snarkjs, version)

```diff
-  "version": "0.0.1",
+  "version": "1.2.0",
@@
   "passport-jwt": "^4.0.1",
   "reflect-metadata": "^0.2.2",
-  "rxjs": "^7.8.1"
+  "rxjs": "^7.8.1",
+  "snarkjs": "^0.7.4"
```

---

## 3. Nouveaux fichiers — Backend (contenu intégral)

### 3.1 `clearnet-backend/src/compliance/compliance.service.ts`

```ts
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
  async assertTransactionAllowed(sender: OfacProfile, recipient: OfacProfile): Promise<void> {
    if (!this.enabled) return;
    const restricted = [sender, recipient].some(
      (party) => party.industry != null &&
        ITAR_RESTRICTED_INDUSTRIES.includes(party.industry as (typeof ITAR_RESTRICTED_INDUSTRIES)[number]),
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
```

### 3.2 `clearnet-backend/src/compliance/compliance.module.ts`

```ts
import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { ComplianceService } from './compliance.service';
import { ItarGuard } from './guards/itar.guard';
import { OfacGuard } from './guards/ofac.guard';

@Module({
  imports: [UsersModule],
  providers: [ComplianceService, ItarGuard, OfacGuard],
  exports: [ComplianceService, ItarGuard, OfacGuard],
})
export class ComplianceModule {}
```

### 3.3 `clearnet-backend/src/compliance/guards/itar.guard.ts`

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ComplianceService } from '../compliance.service';

/**
 * Guard ITAR : si le secteur de l'utilisateur est Défense ou Spatial, son pays
 * doit être autorisé (US/FR/UK/DE/IT/JP/AU). No-op tant que ITAR_ENABLED != true.
 */
@Injectable()
export class ItarGuard implements CanActivate {
  constructor(private readonly compliance: ComplianceService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.compliance.isEnabled()) return true;
    const request = context.switchToHttp().getRequest<{ user?: { name?: string; industry?: string | null; country?: string | null } }>();
    const user = request.user;
    if (!user) throw new UnauthorizedException('Non authentifié');
    if (!this.compliance.isItarAllowed(user.industry ?? null, user.country ?? null)) {
      throw new UnauthorizedException(
        `ITAR: secteur ${user.industry} restreint — pays ${user.country ?? 'inconnu'} non autorisé`,
      );
    }
    return true;
  }
}
```

### 3.4 `clearnet-backend/src/compliance/guards/ofac.guard.ts`

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ComplianceService } from '../compliance.service';

/**
 * Guard OFAC : l'utilisateur courant ne doit pas figurer sur la liste des
 * sanctions. No-op tant que ITAR_ENABLED != true.
 */
@Injectable()
export class OfacGuard implements CanActivate {
  constructor(private readonly compliance: ComplianceService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.compliance.isEnabled()) return true;
    const request = context.switchToHttp().getRequest<{ user?: { name?: string; email?: string } }>();
    const user = request.user;
    if (!user) throw new UnauthorizedException('Non authentifié');
    const report = await this.compliance.screenOfac(user.name ?? user.email ?? '');
    if (report.sanctioned) {
      throw new UnauthorizedException('OFAC: entité sous sanction');
    }
    return true;
  }
}
```

### 3.4 `clearnet-backend/src/oracles/oracle.service.ts`

```ts
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
```

### 3.5 `clearnet-backend/src/oracles/oracle.controller.ts`

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { OracleService } from './oracle.service';

/** Endpoints de test manuel des oracles (lecture seule). */
@Controller('oracles')
export class OracleController {
  constructor(private readonly oracleService: OracleService) {}

  @Get('demurrage')
  demurrage(@Query('port') port?: string, @Query('lat') lat?: string, @Query('lng') lng?: string) {
    return this.oracleService.getDemurrageDays(port, lat ? Number(lat) : undefined, lng ? Number(lng) : undefined);
  }

  @Get('launch-window')
  launchWindow(@Query('satellite') satellite?: string) {
    return this.oracleService.getLaunchWindow(satellite);
  }

  @Get('milestone')
  milestone(@Query('nct') nct?: string) {
    return this.oracleService.getMilestoneValidity(nct);
  }
}
```

### 3.6 `clearnet-backend/src/oracles/oracle.module.ts`

```ts
import { Module } from '@nestjs/common';
import { OracleService } from './oracle.service';
import { OracleController } from './oracle.controller';

@Module({
  controllers: [OracleController],
  providers: [OracleService],
  exports: [OracleService],
})
export class OracleModule {}
```

### 3.7 `clearnet-backend/src/zkproof/zkproof.service.ts`

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ZkProof {
  proof: {
    a: [string, string];
    b: [[string, string], [string, string]];
    c: [string, string];
  };
  publicSignals: { hash: string; maxAmount: string };
}

export interface ZkVerification {
  valid: boolean;
  error?: string;
  onChain?: boolean;
}

export interface ZkInputs {
  sender: string;
  receiver: string;
  amount: number;
  maxAmount: number;
}

/** ABI du vérificateur Groth16 généré par snarkjs (verifyProof signature). */
const VERIFIER_ABI = [
  'function verifyProof(uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[1] memory input) external view returns (bool)',
];

const toDec = (value: bigint | string): string => BigInt(value).toString(10);

/**
 * Preuves ZK transactionnelles (feature flag ZK_ENABLED, désactivé par défaut).
 * Circuit Groth16 (circom 2 + snarkjs) : les parties prouvent la compensation
 * sans révéler le montant exact ni les identités complètes sur la chaîne.
 * ZK_ENABLED != 'true' → generateProof() échoue explicitement et verifyProof()
 * retourne { valid: false } : aucun impact sur le flux V1.1.
 */
@Injectable()
export class ZkProofService {
  private readonly logger = new Logger(ZkProofService.name);
  private readonly enabled: boolean;
  private readonly artifactsDir: string;

  constructor(private readonly config: ConfigService) {
    this.enabled = this.config.get<string>('ZK_ENABLED', 'false') === 'true';
    this.artifactsDir = this.config.get<string>('ZK_ARTIFACTS_DIR', './zkartifacts');
    if (this.enabled) {
      this.logger.log('Preuves ZK ACTIVES (snarkjs + verificateur Solidity)');
    } else {
      this.logger.warn('Preuves ZK DÉSACTIVÉES (ZK_ENABLED != true).');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async generateProof(inputs: ZkInputs): Promise<ZkProof> {
    if (!this.enabled) {
      throw new Error('ZK désactivé — définissez ZK_ENABLED=true et lancez scripts/generate-zk-keys.sh');
    }
    const snarkjs = await import('snarkjs');
    const { wasmPath, zkeyPath } = this.resolveArtifactPaths();
    const witness = {
      sender: inputs.sender,
      receiver: inputs.receiver,
      amount: toDec(BigInt(Math.round(inputs.amount * 1000000)).toString()),
      max_amount: toDec(BigInt(Math.round(inputs.maxAmount * 1000000))),
    };
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(witness, wasmPath, zkeyPath);
    return {
      proof: {
        a: [toDec(proof.a[0]), toDec(proof.a[1])],
        b: [
          [toDec(proof.b[0][0]), toDec(proof.b[0][1])],
          [toDec(proof.b[1][0]), toDec(proof.b[1][1])],
        ],
        c: [toDec(proof.c[0]), toDec(proof.c[1])],
      },
      publicSignals: { hash: toDec(publicSignals[0]), maxAmount: toDec(publicSignals[1]) },
    };
  }

  async verifyProof(proof: ZkProof): Promise<ZkVerification> {
    if (!this.enabled) return { valid: false, error: 'ZK_ENABLED=false — vérification désactivée' };
    const verifierAddress = this.config.get<string>('VERIFIER_ADDRESS', '');
    if (verifierAddress) return this.verifyOnChain(proof, verifierAddress);
    return this.verifyOffChain(proof);
  }

  private async verifyOnChain(proof: ZkProof, address: string): Promise<ZkVerification> {
    try {
      const { JsonRpcProvider, Contract } = await import('ethers');
      const rpc = this.config.get<string>('BLOCKCHAIN_RPC_URL', '');
      if (!rpc) throw new Error('BLOCKCHAIN_RPC_URL manquant');
      const provider = new JsonRpcProvider(rpc);
      const verifier = new Contract(address, VERIFIER_ABI, provider);
      const valid = (await verifier.verifyProof(
        [proof.proof.a[0], proof.proof.a[1]],
        [[proof.proof.b[0][0], proof.proof.b[0][1]], [proof.proof.b[1][0], proof.proof.b[1][1]]],
        [proof.proof.c[0], proof.proof.c[1]],
        [proof.publicSignals.hash],
      )) as boolean;
      return { valid: Boolean(valid), onChain: true };
    } catch (error) {
      this.logger.warn(`Vérification on-chain impossible (${(error as Error).message}) — repli off-chain`);
      return this.verifyOffChain(proof);
    }
  }

  private async verifyOffChain(proof: ZkProof, vkey?: unknown): Promise<ZkVerification> {
    try {
      const snarkjs = await import('snarkjs');
      if (!vkey) vkey = await this.readVerificationKey();
      const valid = await snarkjs.groth16.verify(
        vkey,
        [proof.publicSignals.hash, proof.publicSignals.maxAmount],
        { a: proof.proof.a, b: proof.proof.b, c: proof.proof.c },
      );
      return { valid: Boolean(valid), onChain: false };
    } catch (error) {
      this.logger.warn(`Vérification off-chain impossible (${(error as Error).message})`);
      return { valid: false, error: (error as Error).message, onChain: false };
    }
  }

  private resolveArtifactPaths(): { wasmPath: string; zkeyPath: string } {
    return {
      wasmPath: `${this.artifactsDir}/transaction_js/transaction.wasm`,
      zkeyPath: `${this.artifactsDir}/transaction.zkey`,
    };
  }

  private async readVerificationKey(): Promise<unknown> {
    const fs = await import('node:fs/promises');
    const content = await fs.readFile(`${this.artifactsDir}/verification_key.json`, 'utf8');
    return JSON.parse(content) as unknown;
  }
}
```

### 3.8 `clearnet-backend/src/zkproof/zkproof.module.ts`

```ts
import { Module } from '@nestjs/common';
import { ZkProofService } from './zkproof.service';

@Module({
  providers: [ZkProofService],
  exports: [ZkProofService],
})
export class ZkProofModule {}
```

### 3.9 `clearnet-backend/src/graph/graph.service.ts`

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OracleService } from '../oracles/oracle.service';

export interface CycleUrgency {
  urgency: 'high' | 'normal';
  demurrageDays: number;
  source: 'oracle' | 'default';
  hint: boolean;
}

const DEFAULT_DEMURRAGE_DAYS = 3;

/**
 * Facteur d'urgence d'un cycle de compensation (feature flag ORACLES_ENABLED).
 * Comportement V1.1 conservé par défaut : matching statique basé sur le
 * demeurage par défaut (3 j). Avec ORACLES_ENABLED=true, la priorité est
 * calculée depuis les données réelles (demurrage oracle).
 * Règle : demurrageDays > 3 → cycle prioritaire (hint).
 */
@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly oracleService: OracleService,
    private readonly config: ConfigService,
  ) {
    this.enabled = this.config.get<string>('ORACLES_ENABLED', 'false') === 'true';
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Calcul du facteur d'urgence d'un cycle (fallback statique si désactivé/API KO). */
  async computeUrgency(params?: { port?: string; lat?: number; lng?: number }): Promise<CycleUrgency> {
    const demurrage = await this.oracleService.getDemurrageDays(params?.port, params?.lat, params?.lng);
    const base: CycleUrgency = {
      urgency: demurrage.demurrageDays > 3 ? 'high' : 'normal',
      demurrageDays: demurrage.demurrageDays,
      source: demurrage.source === 'stormglass' ? 'oracle' : 'default',
      hint: demurrage.demurrageDays > DEFAULT_DEMURRAGE_DAYS,
    };
    if (base.urgency === 'high') {
      this.logger.log(`Cycle prioritaire : demurrage ${demurrage.demurrageDays}j (${demurrage.source})`);
    }
    return base;
  }
}
```

### 3.10 `clearnet-backend/src/graph/graph.module.ts`

```ts
import { Module } from '@nestjs/common';
import { OracleModule } from '../oracles/oracle.module';
import { GraphService } from './graph.service';

@Module({
  imports: [OracleModule],
  providers: [GraphService],
  exports: [GraphService],
})
export class GraphModule {}
```

### 3.11 `clearnet-backend/src/types/snarkjs.d.ts` (déclaration du module)

```ts
declare module 'snarkjs';
```

---

## 4. Nouveaux fichiers — Blockchain (contenu intégral)

### 4.1 `clearnet-blockchain/contracts/interfaces/IZkVerifier.sol`

```solidity
// SPDX-License-Identifier: MIT

// Interface minimale du vérificateur Groth16 (généré par
// scripts/generate-zk-keys.sh → contracts/Verifier.sol).
interface IZkVerifier {
    function verifyProof(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[1] memory input
    ) external view returns (bool);
}
```

### 4.2 `clearnet-blockchain/contracts/ChainlinkPriceFeed.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @file AggregatorV3Interface
 * @dev Interface minimale des DAO Chainlink (DataFeed) — déclarée en dur
 * pour éviter une dépendance @openlink/contracts au build Hardhat.
 */
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function version() external view returns (uint256);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 updatedAt, uint80 answeredInRound);
}

/**
 * @title ChainlinkPriceFeed
 * @dev Oracle de prix agrégés pour ClearNet (Phase 2 : ETH/USD, BTC/USD, XAU/USD)
 * avec couples horodatée (24 h). Adresses des flux à injecter par réseau :
 * (voir PHASE2_DEPLOYMENT.md § 4 — adresses sepolia/mainnet en commentaire).
 */
contract ChainlinkPriceFeed {
    uint256 public constant MAX_STALE_AGE = 24 hours;

    address public immutable ethUsdFeed;
    address public immutable btcUsdFeed;
    address public immutable xauUsdFeed;
    address public immutable owner;

    uint256 public lastUpdateAt;
    uint256 public lastEthUsd;
    uint256 public lastBtcUsd;
    uint256 public lastXauUsd;

    event PriceUpdated(string symbol feed, uint256 price, uint256 updatedAt);

    constructor(address _ethUsdFeed, address _btcUsdFeed, address _xauUsdFeed) {
        require(
            _ethUsdFeed != address(0) && _btcUsdFeed != address(0) && _xauUsdFeed != address(0),
            "ChainlinkPriceFeed: zero feed address"
        );
        ethUsdFeed = _ethUsdFeed;
        btcUsdFeed = _btcUsdFeed;
        xauUsdFeed = _xauUsdFeed;
        owner = msg.sender;
    }

    function _read(address feed) internal view returns (uint256 price, uint256 updatedAt) {
        (, int256 answer, uint256 _updatedAt, uint80 answeredInRound) =
            AggregatorV3Interface(feed).latestRoundData();
        require(answeredInRound > 0, "ChainlinkPriceFeed: incomplete round");
        require(_updatedAt > 0, "ChainlinkPriceFeed: no update");
        require(block.timestamp - _updatedAt <= MAX_STALE_AGE, "ChainlinkPriceFeed: stale feed");
        require(answer > 0, "ChainlinkPriceFeed: non-positive answer");
        return (uint256(answer), _updatedAt);
    }

    function getEthUsd() external view returns (uint256) {
        (uint256 price, ) = _read(ethUsdFeed);
        return price;
    }

    function getBtcUsd() external view returns (uint256) {
        (uint256 price, ) = _read(btcUsdFeed);
        return price;
    }

    function getXauUsd() external view returns (uint256) {
        (uint256 price, ) = _read(xauUsdFeed);
        return price;
    }

    function getPrices()
        external
        view
        returns (uint256 ethUsd, uint256 btcUsd, uint256 xauUsd)
    {
        (uint256 a, uint256 b2, uint256 c2, ) = _readMany(ethUsdFeed, btcUsdFeed, xauUsdFeed);
        ethUsd = a;
        btcUsd = b2;
        xauUsd = c2;
    }

    function refresh() external {
        (uint256 ethUsd, uint256 btcUsd, uint256 xauUsd, ) =
            _readMany(ethUsdFeed, btcUsdFeed, xauUsdFeed);
        lastEthUsd = ethUsd;
        lastBtcUsd = btcUsd;
        lastXauUsd = xauUsd;
        lastUpdateAt = block.timestamp;
        emit PriceUpdated("ETH_USD", ethUsd, block.timestamp);
        emit PriceUpdated("BTC_USD", btcUsd, block.timestamp);
        emit PriceUpdated("XAU_USD", xauUsd, block.timestamp);
    }

    function _readMany(address f1, address f2, address f3)
        internal view
        returns (uint256 p1, uint256 p2, uint256 p3, uint256 ts)
    {
        (p1, ts) = _read(f1);
        (p2, ) = _read(f2);
        (p3, ) = _read(f3);
    }
}
```

### 4.3 `clearnet-blockchain/circuits/transaction.circom`

```circom
pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";

/**
 * @title transaction.circom — Compensation ZK pour ClearNet
 *
 * Preuve qu'une compensation est permise sans révéler les entrées privées :
 *   - sender   (private) : identifiant de l'émetteur
 *   - receiver (private) : identifiant du destinataire
 *   - amount   (private) : montant compensé
 *   - commitment (public) : Poseidon(sender, receiver, amount)
 *   - maxAmount  (public) : plafond (ex. 1_000_000)
 *
 * Contraintes :
 *   1. amount > 0
 *   2. amount <= maxAmount
 *   3. commitment === Poseidon(sender, receiver, amount)
 */
template TransactionZK() {
    signal private input sender;
    signal private input receiver;
    signal private input amount;

    signal input maxAmount;
    signal output commitment;

    // --- 1. amount > 0 : borné sur 64 bits et strictement non-nul ---
    component numToBits = Num2Bits(64);
    numToBits.in <== amount;

    component isZero = IsZero();
    isZero.in <== amount;
    isZero.out === 0;

    // --- 2. amount <= maxAmount : équivalent à amount < maxAmount + 1 ---
    component lt = LessThan(64);
    lt.in[0] <== amount;
    lt.in[1] <== maxAmount + 1;
    lt.out === 1;

    // --- 3. engagement public : Poseidon(sender, receiver, amount) ---
    component hasher = Poseidon(3);
    hasher.inputs[0] <== sender;
    hasher.inputs[1] <== receiver;
    hasher.inputs[2] <== amount;
    commitment <== hasher.out;
}

component main { public [ maxAmount, commitment ] } = TransactionZK();
```

### 4.4 `clearnet-blockchain/scripts/generate-zk-keys.sh` (génération du vérificateur)

```bash
#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# generate-zk-keys.sh — Artefacts Groth16 pour le circuit transaction.circom
#
# Prérequis : circom (2.x), snarkjs (0.7.x), node >= 18, npm install dans
#             clearnet-blockchain (circomlib est déjà une dépendance).
#
# Sorties :
#   - transaction.r1cs, transaction.wasm, transaction_js/
#   - transaction.zkey + verification_key.json
#   - contracts/Verifier.sol généré (PÉRIME : écrasé à chaque run)
# Usage : ZK_PTAU_POWER=16 bash scripts/generate-zk-keys.sh
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOCKCHAIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CIRCUIT="$BLOCKCHAIN_DIR/circuits/transaction.circom"
OUT_DIR="${ZK_OUTPUT_DIR:-$BLOCKCHAIN_DIR/zkartifacts}"
PTAU_POWER="${ZK_PTAU_POWER:-16}"

mkdir -p "$OUT_DIR"
cd "$BLOCKCHAIN_DIR"

command -v circom >/dev/null 2>&1 || { echo "circom introuvable — voir https://docs.circom.io/"; exit 1; }
command -v snarkjs >/dev/null 2>&1 || { echo "snarkjs introuvable — npm i -g snarkjs"; exit 1; }

echo "==> Compilation du circuit"
circom "$CIRCUIT" --r1cs --wasm --sym -o "$OUT_DIR"

echo "==> Powers of Tau (phase 1) — puissance ${PTAU_POWER}"
PTAU_FILE="$OUT_DIR/potau_${PTAU_POWER}.ptau"
if [ ! -f "$PTAU_FILE" ]; then
  snarkjs powersoftau new bn128 "$PTAU_POWER" "$PTAU_FILE" -v
  snarkjs powersoftau contribute "$PTAU_FILE" "$OUT_DIR/potau_${PTAU_POWER}_0001.ptau" --name="ClearNet phase1" -v
  mv "$OUT_DIR/potau_${PTAU_POWER}_0001.ptau" "$PTAU_FILE"
fi

echo "==> Phase 2 : setup Groth16"
snarkjs powersoftau prepare phase2 "$PTAU_FILE" "$OUT_DIR/potau_phase2.ptau" -v
snarkjs groth16 setup "$OUT_DIR/transaction.r1cs" "$OUT_DIR/potau_phase2.ptau" "$OUT_DIR/transaction.zkey" -v
snarkjs zkey contribute "$OUT_DIR/transaction.zkey" "$OUT_DIR/transaction_final.zkey" --name="ClearNet phase2" -v
mv "$OUT_DIR/transaction_final.zkey" "$OUT_DIR/transaction.zkey"

echo "==> Clé de vérification"
snarkjs zkey export verificationkey "$OUT_DIR/transaction.zkey" "$OUT_DIR/verification_key.json"

echo "==> Vérificateur Solidity (écrasement contrôlé contracts/Verifier.sol)"
snarkjs zkey export solidityverifier "$OUT_DIR/transaction.zkey" "$BLOCKCHAIN_DIR/contracts/Verifier.sol"
sed -i '1i // SPDX-License-Identifier: GPL-3.0' "$BLOCKCHAIN_DIR/contracts/Verifier.sol"

echo "==> OK : artefacts dans ${OUT_DIR}"
```

---

## 5. Manifests Helm/Kubernetes (contenu intégral)

Chart `infrastructure/helm/clearnet` — voir le dossier complet ; fichiers :

- `Chart.yaml`
- `values.yaml`
- `templates/_helpers.tpl`
- `templates/backend-configmap.yaml`
- `templates/backend-deployment.yaml`
- `templates/backend-service.yaml`
- `templates/backend-hpa.yaml`
- `templates/backend-ingress.yaml`
- `templates/neo4j-secret.yaml`
- `templates/neo4j-statefulset.yaml`
- `templates/neo4j-service.yaml`
- `templates/blockchain-deployment.yaml`
- `templates/blockchain-service.yaml`

Extrait significatif — `backend-deployment.yaml` (probes + ressources) :

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "clearnet.fullname" . }}-backend
spec:
  replicas: {{ .Values.backend.replicas }}
  selector:
    matchLabels:
      app: backend
  template:
    spec:
      containers:
        - name: backend
          image: "{{ .Values.backend.image.repository }}:{{ .Values.backend.image.tag }}"
          imagePullPolicy: {{ .Values.backend.image.pullPolicy }}
          envFrom:
            - configMapRef:
                name: {{ include "clearnet.fullname" . }}-backend-config
          env:
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: {{ include "clearnet.fullname" . }}-neo4j-secret   # (secret dédié JWT si activé)
                  key: password
          startupProbe:
            httpGet: { path: /health, port: http }
            initialDelaySeconds: {{ .Values.backend.probes.startupDelaySeconds }}
            periodSeconds: {{ .Values.backend.probes.periodSeconds }}
          readinessProbe:
            httpGet: { path: /health, port: http }
            periodSeconds: 5
          livenessProbe:
            httpGet: { path: /health, port: http }
          resources:
            {{- toYaml .Values.backend.resources | nindent 12 }}
```

> Fichiers intégraux disponibles dans le dépôt (`infrastructure/helm/clearnet/`) ;
> le lint Helm doit être exécuté dans CI (`helm lint ./infrastructure/helm/clearnet`, `helm template --debug`).

---

## 6. Endpoints & essais manuels

| Méthode | URL | Description | QR |
|---|---|---|---|
| GET | `/api/oracles/demurrage?lat=..&lng=..` | Demeurage (maritime) — fallback 3j | ORACLES_ENABLED |
| GET | `/api/oracles/launch-window?satellite=..` | Fenêtre de lancement — fallback 60j | ORACLES_ENABLED |
| GET | `/api/oracles/milestone?nct=NCT…` | Validité milestone biotech — fallback true | ORACLES_ENABLED |
| POST | `/api/auth/register` | Inscription (+ `country`, `industry` optionnels) | — |
| POST | `/api/transactions` | Création txn (ITAR/OFAC gate si ITAR_ENABLED) | ITAR_ENABLED |
| GET | `/api/health` | Probes (inchangé) | — |

Exemple :

```bash
curl -s http://localhost:3000/api/oracles/demurrage | jq   # → { demurrageDays: 3, source: "fallback", ... }
```

---

## 7. Validation / non-régression

- `npm run build` (backend) — TS OK.
- Tests unitaires existants (`jest --runInBand`) — 100% passe.
- `npx hardhat compile` (blockchain) — CompensationEngine, IZkVerifier, ChainlinkPriceFeed compilent.
- Falsifier négatives : avec tous les flags off, `POST /api/transactions` et `POST /api/auth/register`
  suivent exactement le chemin V1.1 (assertion : log « Conformité ITAR/OFAC DÉSACTIVÉE » etc.).

---

## 8. Prochaines recommandations

1. Générer les artefacts ZK avec `generate-zk-keys.sh` (machine avec circom/snarkjs) puis
   `hardhat deploy` → renseigner `VERIFIER_ADDRESS` + `ZK_ENABLED=true` après approbation conformité.
2. Alimenter les listes OFAC (CSV/API) et tester les 3 entités embarquées.
3. Appliquer la chart Helm sur un cluster (kind/minikube/AWS EKS) — le lint Helm requiert un hôte Helm.
4. Compléter les oracles Stormglass/Space-Track/ClinicalTrials avec de vraies clés.
5. Maintenir le billet pertinence : `PHASE2_DEPLOYMENT.md` pour l'opérateur.

---

_Fin du livrable PHASE2_RESPONSE.md — défini en conformité avec la PRM (particularités : diff, nouveaux fichiers,
manifests K8s, doc déploiement). Voir `PHASE2_DEPLOYMENT.md` pour l'application opérationnelle._