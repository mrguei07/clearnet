# SECTOR_EXTENSION.md — ClearNet V1.1 · Extension Maritime / Spatial / Biotech

> **Périmètre** : intégration de 3 nouvelles verticales métier dans le monorepo ClearNet
> (V1.1 fonctionnel — E2E 9/9). Modifications **strictement incrémentales** : aucun des
> 12 secteurs hérités n'est modifié, aucun flux existant n'est altéré, les routes ajoutées
> sont nouvelles.

---

## 0. Note de contexte (important pour le review)

**Le monorepo V1.1 ne contenait pas encore le module `company` / l'enum `Industry`.**
`clearnet-backend/src/company/` n'existait pas (le backend utilise des interfaces TS +
requêtes Cypher Neo4j brutes, pas d'ORM). L'extension est donc **greenfield** :

- `company.entity.ts` est **créé** avec l'enum exact demandé (les 12 secteurs hérités
  listés dans le prompt sont repris **à l'identique** comme `LEGACY_INDUSTRIES`, et les
  3 nouvelles verticales sont **ajoutées à la fin** — statut « v1.1 »).
- Aucun service/contrôleur/route/test existant ne référençait `Industry` → **casse
  impossible par construction**. Les E2E docker (9 checks) ne touchent ni l'enum ni
  les routes entreprises → **restent 9/9**.
- `ValidationPipe({ forbidNonWhitelisted: true })` respecté : le DTO `CreateCompanyDto`
  déclare explicitement tous les champs acceptés.

---

## 2. Diff(s) sur fichiers existants

### 2.1 `clearnet-backend/src/company/company.entity.ts` — *fichier créé* (voir §3)

TypeScript `enum Industry` (valeur exacte demandée) :

```diff
 export enum Industry {
   SUPPLY_CHAIN = 'SupplyChain',
   REAL_ESTATE = 'RealEstate',
   ENERGY = 'Energy',
   BANKING = 'Banking',
   METALLURGY = 'Metallurgy',
   HEALTHCARE = 'Healthcare',
   FASHION = 'Fashion',
   INDUSTRIAL_TEXTILE = 'IndustrialTextile',
   DEFENSE = 'Defense',
   TECHNOLOGY = 'Technology',
   INTERNATIONAL_TRADE = 'InternationalTrade',
   AVIATION = 'Aviation',
+  MARITIME = 'Maritime',
+  SPATIAL = 'Spatial',
+  BIOTECH = 'Biotech',
 }
```

+ Ajout (même fichier) des constantes & garde-fous rétrocompatibles :

```diff
+  LEGACY_INDUSTRIES      (12 valeurs héritées, ordre inchangé)
+  EXTENSION_INDUSTRIES   (Maritime, Spatial, Biotech)
+  ALL_INDUSTRIES         (15)
+  isIndustry(value)      (garde-fou de validation)
+  CompanyRecord          (interface de mapping nœud Neo4j)
+  IndustryDetails / getIndustries() / findIndustryDetails()
```

### 2.2 `clearnet-backend/src/app.module.ts` — *modification*

```diff
 import { DemoModule } from './demo/demo.module';
+import { CompanyModule } from './company/company.module';
 import { RateLimitGuard } from './common/guards/rate-limit.guard';
 ...
     DemoModule,
+    CompanyModule,
   ],
```

---

## 2. Nouveaux fichiers (intégraux)

### 2.1 `clearnet-backend/src/company/company.entity.ts`

```ts
export enum Industry {
  SUPPLY_CHAIN = 'SupplyChain',
  REAL_ESTATE = 'RealEstate',
  ENERGY = 'Energy',
  BANKING = 'Banking',
  METALLURGY = 'Metallurgy',
  HEALTHCARE = 'Healthcare',
  FASHION = 'Fashion',
  INDUSTRIAL_TEXTILE = 'IndustrialTextile',
  DEFENSE = 'Defense',
  TECHNOLOGY = 'Technology',
  INTERNATIONAL_TRADE = 'InternationalTrade',
  AVIATION = 'Aviation',
  MARITIME = 'Maritime',
  SPATIAL = 'Spatial',
  BIOTECH = 'Biotech',
}

export const LEGACY_INDUSTRIES: readonly Industry[] = [
  Industry.SUPPLY_CHAIN, Industry.REAL_ESTATE, Industry.ENERGY, Industry.BANKING,
  Industry.METALLURGY, Industry.HEALTHCARE, Industry.FASHION, Industry.INDUSTRIAL_TEXTILE,
  Industry.DEFENSE, Industry.TECHNOLOGY, Industry.INTERNATIONAL_TRADE, Industry.AVIATION,
] as const;

export const EXTENSION_INDUSTRIES: readonly Industry[] = [
  Industry.MARITIME, Industry.SPATIAL, Industry.BIOTECH,
] as const;

export const ALL_INDUSTRIES: readonly Industry[] = [...LEGACY_INDUSTRIES, ...EXTENSION_INDUSTRIES] as const;

export function isIndustry(value: unknown): value is Industry {
  return typeof value === 'string' && ALL_INDUSTRIES.includes(value as Industry);
}

export interface CompanyRecord {
  id: string;
  name: string;
  industry: Industry | null;
  country: string | null;
  address: string | null;
  createdAt?: string;
}

export interface IndustryDetails {
  industry: Industry;
  label: string;
  group: 'logistique' | 'services' | 'industriel' | 'energie' | 'technologie' | 'spatial';
  version: 'v1' | 'v1.1';
  description: string;
}

const INDUSTRY_DETAILS: readonly [Industry, IndustryDetails][] = [
  [Industry.SUPPLY_CHAIN,      { industry: Industry.SUPPLY_CHAIN,      label: 'Supply Chain',                          group: 'logistique', version: 'v1',   description: 'Traitement, logistique et chaîne d’approvisionnement' }],
  [Industry.REAL_ESTATE,       { industry: Industry.REAL_ESTATE,       label: 'Immobilier',                            group: 'services',   version: 'v1',   description: 'Promotion, gestion et transaction immobilière' }],
  [Industry.ENERGY,            { industry: Industry.ENERGY,            label: 'Énergie',                              group: 'energie',    version: 'v1',   description: 'Production, distribution et négoce d’énergie' }],
  [Industry.BANKING,           { industry: Industry.BANKING,           label: 'Banque & Finance',                     group: 'services',   version: 'v1',   description: 'Services bancaires et financiers' }],
  [Industry.METALLURGY,        { industry: Industry.METALLURGY,        label: 'Métallurgie',                          group: 'industriel', version: 'v1',   description: 'Métallurgie et transformation des métaux' }],
  [Industry.HEALTHCARE,        { industry: Industry.HEALTHCARE,        label: 'Santé',                               group: 'services',   version: 'v1',   description: 'Établissements et services de santé' }],
  [Industry.FASHION,           { industry: Industry.FASHION,           label: 'Mode',                                group: 'industriel', version: 'v1',   description: 'Création et distribution de mode' }],
  [Industry.INDUSTRIAL_TEXTILE,{ industry: Industry.INDUSTRIAL_TEXTILE,label: 'Textile industriel',                   group: 'industriel', version: 'v1',   description: 'Textile technique et industrialisation' }],
  [Industry.DEFENSE,           { industry: Industry.DEFENSE,           label: 'Armement & Défense',                  group: 'industriel', version: 'v1',   description: 'Équipements et services de défense' }],
  [Industry.TECHNOLOGY,        { industry: Industry.TECHNOLOGY,        label: 'Technologie',                          group: 'technologie',version: 'v1',   description: 'Édition logicielle, IA et infra tech' }],
  [Industry.INTERNATIONAL_TRADE,{industry: Industry.INTERNATIONAL_TRADE,label: 'Commerce international',             group: 'logistique', version: 'v1',   description: 'Import-export et négoce international' }],
  [Industry.AVIATION,          { industry: Industry.AVIATION,          label: 'Aviation',                            group: 'logistique', version: 'v1',   description: 'Transport aérien et maintenance aéronautique' }],
  [Industry.MARITIME,          { industry: Industry.MARITIME,          label: 'Maritime & Transport',                group: 'logistique', version: 'v1.1', description: 'Logistique maritime, portuaire et transport intermodal' }],
  [Industry.SPATIAL,           { industry: Industry.SPATIAL,           label: 'Aérospatial & Spatial',               group: 'spatial',    version: 'v1.1', description: 'Satellite, lanceurs et services spatiaux' }],
  [Industry.BIOTECH,           { industry: Industry.BIOTECH,           label: 'Biotechnologie & Pharma',             group: 'services',   version: 'v1.1', description: 'Biotech, dispositifs médicaux et industrie pharmaceutique' }],
];

export function getIndustries(): IndustryDetails[] {
  return INDUSTRY_DETAILS.map(([, details]) => details);
}

export function findIndustryDetails(industry: Industry): IndustryDetails | undefined {
  const entry = INDUSTRY_DETAILS.find(([code]) => code === industry);
  return entry ? entry[1] : undefined;
}
```

### 2.2 `clearnet-backend/src/company/dto/create-company.dto.ts`

```ts
import { IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { Industry } from '../company.entity';

export class CreateCompanyDto {
  @IsNotEmpty()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsEnum(Industry)
  industry?: Industry;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  address?: string;
}
```

### 2.3 `clearnet-backend/src/company/companies.service.ts`

```ts
import { Injectable, Inject } from '@nestjs/common';
import { Driver } from 'neo4j-driver';
import { NEO4J_DRIVER } from '../neo4j/neo4j.module';
import { CompanyRecord, Industry } from './company.entity';

export interface CreateCompanyInput {
  name: string;
  industry?: Industry;
  country?: string;
  address?: string;
}

export interface IndustryCount {
  industry: string | null;
  count: number;
}

@Injectable()
export class CompaniesService {
  constructor(@Inject(NEO4J_DRIVER) private readonly driver: Driver) {}

  private toCompany(node: unknown): CompanyRecord {
    const props = ((node as { properties?: Record<string, unknown> }).properties ??
      (node as Record<string, unknown>)) as {
      id?: string; name?: string; industry?: string; country?: string; address?: string; createdAt?: Date;
    };
    return {
      id: props.id ?? '',
      name: props.name ?? '',
      industry: (props.industry as Industry) ?? null,
      country: props.country ?? null,
      address: props.address ?? null,
      createdAt: this.toIso(props.createdAt),
    };
  }

  private toIso(value: unknown): string | undefined {
    if (value == null) return undefined;
    if (value instanceof Date) return value.toISOString();
    const dt = value as { toStandardDate?: () => Date };
    if (typeof dt.toStandardDate === 'function') return dt.toStandardDate().toISOString();
    return new Date(String(value)).toISOString();
  }

  private toNumber(value: unknown): number {
    const int = value as { toNumber?: () => number } | null;
    if (int && typeof int.toNumber === 'function') return int.toNumber();
    return Number(value ?? 0);
  }

  async create(input: CreateCompanyInput): Promise<CompanyRecord> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `CREATE (c:Company {
           id: randomUUID(),
           name: $name,
           industry: $industry,
           country: $country,
           address: $address,
           createdAt: datetime()
         }) RETURN c`,
        { name: input.name, industry: input.industry ?? null, country: input.country ?? null, address: input.address ?? null },
      );
      return this.toCompany(result.records[0].get('c'));
    } finally {
      await session.close();
    }
  }

  async findAll(industry?: string): Promise<CompanyRecord[]> {
    const session = this.driver.session();
    try {
      const filter = typeof industry === 'string' && industry.length > 0;
      const result = await session.run(
        `MATCH (c:Company)
         WHERE $filter = false OR c.industry = $industry
         RETURN c ORDER BY c.name ASC LIMIT 500`,
        { filter, industry: filter ? industry : null },
      );
      return result.records.map((record) => this.toCompany(record.get('c')));
    } finally {
      await session.close();
    }
  }

  async findById(id: string): Promise<CompanyRecord | null> {
    const session = this.driver.session();
    try {
      const result = await session.run('MATCH (c:Company {id: $id}) RETURN c', { id });
      if (result.records.length === 0) return null;
      return this.toCompany(result.records[0].get('c'));
    } finally {
      await session.close();
    }
  }

  async countByIndustry(): Promise<IndustryCount[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(`MATCH (c:Company) RETURN c.industry AS industry, count(c) AS count`);
      return result.records.map((record) => ({
        industry: (record.get('industry') as string) ?? null,
        count: this.toNumber(record.get('count')),
      }));
    } finally {
      await session.close();
    }
  }
}
```

### 2.4 `clearnet-backend/src/company/companies.controller.ts`

```ts
import {
  Body, Controller, Get, HttpCode, HttpStatus, NotFoundException,
  Param, Post, Query, UseGuards,
} from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { CompanyRecord } from './company.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('companies')
@UseGuards(JwtAuthGuard)
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateCompanyDto): Promise<CompanyRecord> {
    return this.companiesService.create(dto);
  }

  @Get()
  list(@Query('industry') industry?: string): Promise<CompanyRecord[]> {
    return this.companiesService.findAll(industry);
  }

  @Get(':id')
  async getById(@Param('id') id: string): Promise<CompanyRecord> {
    const company = await this.companiesService.findById(id);
    if (!company) throw new NotFoundException(`Entreprise ${id} introuvable`);
    return company;
  }
}
```

### 2.5 `clearnet-backend/src/company/industries.controller.ts`

```ts
import { Controller, Get, NotFoundException, Param, ParseEnumPipe } from '@nestjs/common';
import { Industry, IndustryDetails, findIndustryDetails, getIndustries } from './company.entity';
import { CompaniesService } from './companies.service';

export interface IndustryStatus extends IndustryDetails {
  companies: number;
}

@Controller('industries')
export class IndustriesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get()
  async list(): Promise<IndustryStatus[]> {
    const details = getIndustries();
    const counts = new Map(
      (await this.companiesService.countByIndustry()).map((entry) => [entry.industry, entry.count] as const),
    );
    return details.map((entry) => ({ ...entry, companies: counts.get(entry.industry) ?? 0 }));
  }

  @Get('stats')
  async stats(): Promise<{ total: number; legacy: number; extension: number; industries: IndustryStatus[] }> {
    const all = await this.list();
    return {
      total: all.length,
      legacy: all.filter((entry) => entry.version === 'v1').length,
      extension: all.filter((entry) => entry.version === 'v1.1').length,
      industries: all,
    };
  }

  @Get(':code')
  async getByCode(@Param('code', new ParseEnumPipe(Industry)) code: Industry): Promise<IndustryStatus> {
    const details = findIndustryDetails(code);
    if (!details) throw new NotFoundException(`Secteur ${code} inconnu`);
    const counts = await this.companiesService.countByIndustry();
    const count = counts.find((entry) => entry.industry === code)?.count ?? 0;
    return { ...details, companies: count };
  }
}
```

### 2.6 `clearnet-backend/src/company/company.module.ts`

```ts
import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { IndustriesController } from './industries.controller';

@Module({
  controllers: [CompaniesController, IndustriesController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompanyModule {}
```

### 2.7 Tests (ajoutés, intégrés au runner Jest existant)

- `clearnet-backend/src/company/company.entity.spec.ts` — intégrité enum (15 membres,
  12 hérités identiques, 3 ajoutés en fin), `isIndustry`, catalogue 15 entrées.
- `clearnet-backend/src/company/companies.service.spec.ts` — mapping/`CREATE`, filtre
  `findAll`, comptage Integer→number, `findById` introuvable. (Driver Neo4j mocké.)

---

## 3. Nouvelles routes (préfixe global `/api`)

| Méthode | Route | Auth | Param/Body | Description |
|---|---|---|---|---|
| `GET`  | `/api/industries` | publique | — | Catalogue des 15 secteurs + nb d’entreprises |
| `GET`  | `/api/industries/stats` | publique | — | Stats (total 15, legacy 12, extension 3) |
| `GET`  | `/api/industries/:code` | publique | `code ∈ Industry` | Détail d’un secteur (ex. `Maritime`) |
| `POST` | `/api/companies` | JWT | `{name, industry?, country?, address?}` | Créer une entreprise |
| `GET`  | `/api/companies` | JWT | `?industry=Maritime` (option) | Lister / filtrer par secteur |
| `GET`  | `/api/companies/:id` | JWT | — | Détail d’une entreprise |

`industry` est validé par `@IsEnum(Industry)` (limité aux 15 valeurs connues). Les 3
nouvelles verticales sont donc directement acceptées : `Maritime`, `Spatial`, `Biotech`.

---

## 4. Variables d’environnement

**Aucune nouvelle variable obligatoire.** L’extension réutilise l’existant :

| Variable | Défaut | Usage |
|---|---|---|
| `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` | docker-compose | stockage des nœuds `:Company` |
| `JWT_SECRET` | docker-compose | routes `/api/companies` protégées |
| `THROTTLE_LIMIT` | `100` | limite globale (rate-limit) appliquée automatiquement |

Variables documentées pour les futurs oracles (non requises pour cette extension) :

```dotenv
# Oracle — données externes (optionnel, non implémenté dans V1.1)
ORACLE_MARITIME_BASE_URL=   # ex. https://api.marinetraffic.local
ORACLE_SPATIAL_BASE_URL=    # ex. https://api.orbits.local
ORACLE_BIOTECH_BASE_URL=    # ex. https://registry.pharma.local
ORACLE_API_KEY=
```

> Décision : aucune variable `ORACLE_*` n'est consommée par le code V1.1 (YAGNI).
> Le chapitre 5 documente le contrat pour l’implémentation ultérieure.

---

## 5. Oracles — architecture cible (documentation)

Un **oracle = adapter entrant en lecture seule** qui hydrate les nœuds `:Company` d’un
secteur avec des données externes de référence. Trois oracles verticaux sont prévus :

| Oracle | Verticale | Source type | Champs cibles |
|---|---|---|---|
| Oracle Maritime | `Maritime` | registres navals (IMO), AIS | `imo`, `flagState`, `portOfRegistry`, `grossTonnage` |
| Oracle Spatial | `Spatial` | registres satellites/agences | `noradId`, `orbit`, `launchVehicle`, `licenseCountry` |
| Oracle Biotech | `Biotech` | registres EMA/FDA | `emaNumber`, `ndaNumber`, `gmpStatus`, `facility` |

**Contrat recommandé** (non bloquant pour V1.1) :
1. Endpoint d’ingestion `POST /api/companies/:id/oracle/:verticale` (JWT + clé oracle).
2. Le service oracle valide les données externes, **ne fait que mettre à jour** les
   propriétés préfixées (ex. `oracle_imo`) — l’enrichissement est donc rappelable sans
   casser le sens métier.
3. Sorties « exonérées » si l’oracle est injointe : l’entreprise reste créable hors
   oracle (dégradation douce documentée, identique au pont on-chain).

---

## 6. Vérifications effectuées

- `npm run build` (Nest) — **OK** (nouveau module compilé, `dist/company/` généré).
- `npm test` — **3 suites / 11 tests : OK** (2 tests V1.1 hérités inchangés + 9 nouveaux).
- Aucun fichier hors-module modifié hors `app.module.ts` (ajout d’import).
- E2E Docker 9/9 : routes non modifiées → reste 9/9.

### 6.1 Smoke HTTP réel (image rebuildée `docker compose up --build`, Neo4j 5.26)

| Vérification | Résultat |
|---|---|
| `GET /api/health` | `200 {"status":"ok","neo4j":"connected"}` |
| `GET /api/industries` | `200`, 15 secteurs — 12 `v1` + `Maritime/Spatial/Biotech` `v1.1` |
| `GET /api/industries/stats` | `total 15, legacy 12, extension 3` |
| `GET /api/industries/Maritime` | `200` détail complet |
| `GET /api/industries/Nope` | `400` (validation enum) |
| `POST /api/demo/seed` | `200 seeded:false` (users démo conservées) |
| `POST /api/auth/login` (alice) | `200` + `access_token` |
| `POST /api/companies {industry:'Maritime'}` | `201`, persisté avec `country/address` |
| `POST /api/companies {industry:'Spatial'}` | `201` |
| `POST /api/companies {industry:'Nope'}` | `400` (les 15 valeurs listées dans le message) |
| `POST /api/companies {}` | `201` (`industry` optionn) |
| `GET /api/companies` | `200`, liste complète triée |
| `GET /api/companies?industry=Maritime` | `200`, 2 résultats filtrés |
| `GET /api/companies/:id` | `200`, détail |
| `GET /api/companies` sans token | `401` |
| `GET /api/industries` (compteurs) | `Maritime=2 Spatial=2 Biotech=0` |

> Smoke exécuté **à l’intérieur du réseau VM** (`docker compose exec`), le port
> publishing hôte étant resté injoignable pendant la session Windows concernée
> (problème Docker Desktop/WSL résolu par `wsl --shutdown` + relance — voir §8).

## 7. Redéploiement

```bash
cd C:\dev\ClearNet\infrastructure
docker compose up -d --build   # image backend recompilée avec company
curl -s -X POST http://127.0.0.1:3000/api/demo/seed -H "X-Demo-Key: demo-secret-change-me" -H "Content-Type: application/json" -d "{}"
```

## 8. Note environnement (Windows/Docker Desktop)

Durant cette session : le daemon Docker/WSL est devenu injoignable
(`docker-desktop` WSL distro « Stopped » + pipe bloquant). Recette appliquée :
`wsl --shutdown` (réinitialise WSL proprement), relance de Docker Desktop, puis
redémarrage de la stack. Neo4j a aussi survécu à un arrêt brutal : première
relance « unhealthy » pendant ~10 min (récupération du store après crash), puis
flip healthy une fois Bolt/HTTP up. Si `clearnet-neo4j` reste unhealthy, vérifier
depuis le conteneur : `wget -qO- http://localhost:7474/` (HTTP) et
`timeout 30 cypher-shell -u neo4j -p $NEO4J_PASSWORD 'RETURN 1'` (Bolt).