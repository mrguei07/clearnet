# CLEARNET — Rapport technique approfondi (V1.3)

> Version : 1.3.0 · Date : 11/08/2026 · Statut : **validé (build + tests + helm lint/template PASS)**
> Actualisé : 17/08/2026 — planification V1.5 livrée (§15).
> Version anglaise du rapport HTML : `RAPPORT_TECHNIQUE.html` (synthèse visuelle).

---

## Sommaire

1. [Synthèse & périmètre](#1-synthèse--périmètre)
2. [Architecture globale](#2-architecture-globale)
3. [Backend NestJS — modules & flux](#3-backend-nestjs--modules--flux)
4. [Persistance Neo4j](#4-persistance-neo4j)
5. [Contrats on-chain & pont Sepolia](#5-contrats-on-chain--pont-sepolia)
6. [Industrialisation V1.3](#6-industrialisation-v13)
7. [API — tableau des endpoints](#7-api--tableau-des-endpoints)
8. [Registre de configuration](#8-registre-de-configuration)
9. [Sécurité & durcissement](#9-sécurité--durcissement)
10. [Points de vigilance traités (3.1–3.5)](#10-points-de-vigilance-traités-31–35)
11. [Qualité, tests & CI](#11-qualité-tests--ci)
12. [Stratégie de déploiement & early adopters](#12-stratégie-de-déploiement--early-adopters)
13. [Facturation & Pricing (V1.4 → V1.5)](#13-facturation--pricing-v14--v15)
14. [Limites & perspectives](#14-limites--perspectives)
15. [V1.5 — Préparation internationale & industrialisation ZK (planification livrée)](#15-v15--préparation-internationale--industrialisation-zk-planification-livrée)

---

## 1. Synthèse & périmètre

**ClearNet** est un moteur de **compensation décentralisée de créances/dettes inter-entreprises** :
chaque transaction est enregistrée dans un graphe Neo4j (piste d'audit), et les règlements
sont exécutés de manière **auditable et traçable** sur un réseau on-chain (Sepolia en test),
avec une extension de **preuves à divulgation nulle (Groth16)** pour ne pas révéler les
montants ni les identités.

Périmètre livré (V1.3) :

| Domaine | Contenu |
|---|---|
| **Backend** | NestJS 10, TypeScript strict, Neo4j 5.26, socket.io, BullMQ, ethers 6 |
| **File de règlements** | BullMQ + Redis : job `onchain-settlement`, retries exponentielles, DLQ légère (audit + Slack) |
| **Contrats** | Hardhat 2.19 : `ClearNetToken` (CLRN, ERC20) + `CompensationEngine` (netting, extension ZK optionnelle) |
| **Déploiement** | Chart Helm (backend 3 réplicas + HPA, Neo4j, ingress, alerting), scripts `clearner-prod.sh`/`.ps1` avec `--dry-run`, auto-install Helm |
| **Monitoring** | Dashboard Grafana (disponibilité, ingress, ressources, Redis/BullMQ, Neo4j) |
| **Validation** | Tests unitaires (11) + test d'intégration BullMQ (2, Redis réel) + CI GitHub Actions (helm lint/template, build, tests) |
| **Livrables docs** | `README-PROD.md`, `DEPLOYMENT_STRATEGY_AND_EARLY_ADOPTERS.md` (stratégie, scripts E2E Sepolia, programme early adopters), ce rapport |

**Règle d'or respectée** : tous les dispositifs de durcissement (ITAR/OFAC, oracles, ZK,
file BullMQ, pont on-chain) sont **off par défaut** — l'activation exige un provisionnement
explicite (clés, adresses de contrats, approbation conformité).

---

## 2. Architecture globale

```
┌────────────────────────────┐        ┌──────────────────────────────┐
│  clearnet-mobile (React    │        │  Scripts ops (scripts/)      │
│  Native, Expo)             │        │  clearner-prod[.sh/.ps1]     │
│  écrans : accueil, réseau, │        │  validate-kind, e2e-sepolia, │
│  transactions, profil      │        │  early-adopters              │
└──────────────┬─────────────┘        └──────────────┬───────────────┘
               │ REST + socket.io                    │ kubectl / helm / curl
               ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        clearnet-backend (NestJS 10)                  │
│  auth · users · companies · industries · transactions · compliance  │
│  oracles · blockchain (pont) · zkproof · graph · demo · gateway WS   │
│                                                                      │
│  File BullMQ (onchain-settlement)  ───────┐   ├────────┐            │
└──────┬─────────────────────────────────────┼───┼───────┼────────────┘
       ▼                                     ▼   ▼       ▼
┌─────────────┐  bolt   ┌──────────────────────────────────┐
│  Neo4j 5.26 │◄────────┤  Redis 7 (file BullMQ, BullMQ     │
│  (graphe)   │         │  stocke les jobs + états)         │
└─────────────┘         └──────────────────────────────────┘
       ▲
       │ JSON-RPC (Sepolia / hardhat local)
┌──────┴──────────────────────────────────────────┐
│  clearnet-blockchain (Hardhat)                  │
│  ClearNetToken (CLRN ERC20) · CompensationEngine │
│  (netting + extension ZK) · ChainlinkPriceFeed   │
└─────────────────────────────────────────────────┘

Kubernetes (production) : chart helm/clearnet
  backend (3 réplicas, HPA 3→8) · neo4j (StatefulSet) · ingress nginx TLS
  HPA · ConfigMap (env) · Secret (JWT/Neo4j — generated OU existingSecret)
```

**Flux de règlement on-chain (V1.3)** :

```
POST /api/transactions (JWT)
   │  1. validations : auto-transfert interdit, conformité ITAR/OFAC
   │  2. persistance nœud Transaction (Neo4j) + relations SENT/RECEIVED
   │  3. événement WebSocket transaction:status = PENDING
   ▼
si ONCHAIN_ENABLED=true :
   ├─ si QUEUE_ENABLED=true (évaluation DYNAMIQUE, 3.1) ─► job BullMQ
   │     onchain-settlement (attempts=5, backoff exp. 5 s)
   │     └─ processor : settleCompensation(from,to,amount)
   │          ├─ succès ─► onchainHash + SUCCESS (Neo4j) + WS SUCCESS
   │          └─ échec  ─► onchainError + FAILED (Neo4j) + WS FAILED
   │                        └─ rethrow → retries ; épuisées → événement
   │                           `failed` (worker) → audit FailedJob (Neo4j)
   │                           + notification Slack (3.3)
   └─ sinon ─► fire-and-forget V1.2 (dégradation douce préservée)
```

---

## 3. Backend NestJS — modules & flux

### 3.1 Vue des modules (`clearnet-backend/src/`)

| Module | Rôle | Dépendances |
|---|---|---|
| `app` | Bootstrap, `GET /` et `GET /health` (status + Neo4j up/down) | — |
| `auth` | Register (bcrypt), login (JWT, passport-jwt), profile | Users |
| `users` | `GET /users/me`, `GET /users/roi` (ROI sectoriel) | Neo4j |
| `company` | CRUD entreprises, entité métier, statistiques par secteur | Neo4j |
| `industries` | 15 secteurs (12 V1 + 3 V1.1) avec compteurs | Neo4j |
| `transactions` | CRUD transactions, balance, history paginé, file BullMQ, processor, gateway WS | Users, Compliance, Blockchain |
| `compliance` | Screening ITAR/OFAC 3 niveaux (liste → CSV → API), pays liste blanche | — |
| `oracles` | Stormglass (demeurage), Space-Track (fenêtre lancement), ClinicalTrials.gov (jalon) | — |
| `blockchain` | Pont : dérivation d'adresses, mint, positions, settle, ZK, diagnostic | Neo4j (adresses), ZkProof |
| `zkproof` | Preuves Groth16 (snarkjs), téléchargement d'une preuve par tx | — |
| `graph` | `GET /graph/egonet` : réseau egocentré pour le mobile | Neo4j |
| `demo` | Seed alice/bob/carol (+ industry optionnel) + compteurs — verrouillé X-Demo-Key | Users, Transactions |
| `neo4j` | Provider du driver Neo4j (token, config) | — |

### 3.2 TransactionsService — flux critique (`transactions.service.ts`)

- **Garde** : `fromEmail === toEmail` → 400 ; conformité avant persistance.
- **Persistance** : nœud `Transaction {id, amount, note, createdAt}` + relations
  `(:User)-[:SENT]->(t)` / `(:User)-[:RECEIVED]->(t)` (Cypher unique, `randomUUID()`).
- **Règlement** : `ONCHAIN_ENABLED` évalué au constructeur (config statique du pont) ;
  **`QUEUE_ENABLED` évalué dynamiquement** à chaque transaction (3.1) via `isQueueEnabled()`.
- **Statuts** : `markOnchainSuccess(txId, hash)` / `markOnchainFailed(txId, errorMessage)`
  — requêtes `MATCH (t:Transaction {id}) SET t.onchainHash…, t.onchainStatus='SUCCESS'`.
- **Échecs définitifs** (3.3) : `recordFailedJob(job, error)` — nœud
  `FailedJob {jobId, queue, txId, error, attemptsMade, failedAt}` + POST Slack
  (`SLACK_WEBHOOK_URL`, fetch non bloquant, optionnel).

### 3.3 TransactionProcessor — worker BullMQ (`transaction.processor.ts`)

| Événement | Comportement |
|---|---|
| `process(job)` | `settleCompensation(fromEmail, toEmail, amount)` → `markOnchainSuccess` + WS `SUCCESS {txId, hash}` |
| échec | `markOnchainFailed` + WS `FAILED {txId, error}` + **rethrow** (retries BullMQ : `QUEUE_ATTEMPTS`=5, backoff exp. `QUEUE_BACKOFF_MS`=5000) |
| `onApplicationBootstrap` | souscription worker `failed` → `recordFailedJob` (audit + Slack) |

Options de file : `removeOnComplete: 1000`, `removeOnFail: 5000`.

### 3.4 Temps réel — `transactions.gateway.ts`

Gateway socket.io namespace **`/transactions`**, handshake authentifié JWT
(`auth.token` ou `query.token`), room **`user:<email>`**, événement
**`transaction:status`** `{txId, status: PENDING\|SUCCESS\|FAILED, hash?, error?, at}`.

### 3.5 Compliance (ITAR/OFAC)

- `isEnabled()` = `ITAR_ENABLED === 'true'` ; no-op strict sinon.
- Screening OFAC 3 niveaux : liste embarquée → CSV (`OFAC_CSV_PATH`) → API (`OFAC_API_KEY`) ;
  source rapportée dans le résultat.
- ITAR : secteurs Défense/Spatial autorisés uniquement pour pays liste blanche
  (`US, FR, UK, DE, IT, JP, AU`).

### 3.6 Oracles

| Endpoint | Source | Fallback |
|---|---|---|
| `/oracles/demurrage?port&lat&lng` | Stormglass (niveau de mer → 1/3/5 j de demeurage) | 3 j |
| `/oracles/launch-window?satellite` | Space-Track | 60 j |
| `/oracles/milestone?nct` | ClinicalTrials.gov | valide |

Bornés par `ORACLE_TIMEOUT_MS` (2500 ms).

---

## 4. Persistance Neo4j

```
(:User {email, name, passwordHash, industry?, country?})
  -[:SENT]->   (:Transaction {id, amount, note, createdAt,
                              onchainHash?, onchainStatus?, onchainError?})
  -[:RECEIVED]->…
(:FailedJob {jobId, queue, txId, error, attemptsMade, failedAt})   ← V1.3 (3.3)
(:Company {…}) / (:Industry {code, label, group, version})         ← secteurs
```

Requêtes notables :
- `balance` : agrégats `RECEIVED`/`SENT` séparés (`COALESCE(SUM(amount),0)`) — pas de
  cross-product ; dernière transaction via `history(email, 1)`.
- `list` paginé : `COUNT(DISTINCT t)` + `SKIP/LIMIT` (page ≥ 1, limit ≤ 100).
- `egonet` : réseau egocentré `depth=2` avec labels, soldes, urgences, arêtes orientées
  débiteur → créancier.

---

## 5. Contrats on-chain & pont Sepolia

### 5.1 Contrats (`clearnet-blockchain/contracts/`)

**ClearNetToken.sol** — ERC20 (OpenZeppelin) + Ownable :
- `mint(to, amount)` (onlyOwner), `burn(amount)` (self).
- Symbol **CLRN**, 18 décimales.

**CompensationEngine.sol** — netting de positions :
- `mapping(address => int256) public netPositions` ;
- `updatePosition(account, delta)` (onlyAdmin) — position nette (+ crédit / − dette) ;
- `_settle(from, to, amount)` **invariants** :
  - `netPositions[from] >= amount` (crédit suffisant) — sinon *"insufficient credit"* ;
  - `netPositions[to] <= 0` (contrepartie en dette) — sinon *"counterparty has no debt"* ;
  - puis `from -= amount`, `to += amount` (aucun transfert ERC20 : **netting pur**) ;
- **Extension ZK** (défaut off) : `setZkSettings(verifier, required, maxAmount)` ;
  si `zkRequired`, seul `settleWithProof(a,b,c,input)` exécute (vérification Groth16,
  `amount ≤ maxAmount`) ;
- événements : `PositionUpdated`, `Compensated`, `ZkSettingsUpdated`.

**ChainlinkPriceFeed.sol** — module de prix (démonstratif, off).

### 5.2 Pont backend (`blockchain.service.ts`)

| Élément | Détail |
|---|---|
| Activation | `ONCHAIN_ENABLED=true` (alias `BLOCKCHAIN_ENABLED` compose V1.1) |
| Init | `OnModuleInit` : provider JSON-RPC, wallet, balance ETH (warning si 0), instanciation des contrats ; échec doux → `warnings` dans `getStatus()` |
| Identités | **adresses dérivées des emails** : `0x + keccak256(email.lower).slice(-40)` — identiques backend/scripts, aucune donnée wallet à stocker |
| Méthodes | `mintTo`, `getTokenInfo`, `approve`, `getAllowance`, `getTokenBalance` (ERC20) · `recordPositionChange`, `getNetPosition`, `settleCompensation` (netting) · `settleCompensationWithProof`, `configureZk` (ZK) |
| Garde | pont désactivé → écritures : `OnchainBridgeError('disabled')` ; lectures : valeurs vides |

### 5.3 Déploiement Sepolia

- `npm run deploy:sepolia` (hardhat) : prérequis `SEPOLIA_RPC_URL` +
  `SEPOLIA_PRIVATE_KEY` (≥ 0.05 ETH de test) ; écrit `deployments/sepolia.json`
  `{chainId, network, clearNetToken, compensationEngine, deployer, deployedAt}`.
- Vérification (optionnel) : `npm run verify:sepolia`.
- **Règles** : pont désactivé tant que les adresses vérifiées (etherscan) ne sont pas
  configurées (Go/No-Go #8).

---

## 6. Industrialisation V1.3

### 6.1 Chart Helm (`infrastructure/helm/clearnet`)

| Ressource | Détail |
|---|---|
| `backend-deployment` | 3 réplicas (prod), probes startup/readiness/liveness `/health`, envFrom ConfigMap, JWT_SECRET (value **ou** `existingSecret`), NEO4J_PASSWORD (Secret généré **ou** `existingSecret`) |
| `backend-hpa` | HPA 3 → 8 (CPU 65 %) |
| `backend-configmap` | NODE_ENV, PORT, NEO4J_URI, ITAR/ORACLES/ZK, THROTTLE, QUEUE_* (REDIS_HOST/PORT/PASSWORD), DEMO_API_KEY, **SLACK_WEBHOOK_URL** (3.3) |
| `backend-ingress` | nginx, host `api.clearnet.example.com`, TLS `clearnet-tls` |
| `neo4j-statefulset` | Neo4j 5.26-community, `NEO4J_AUTH` (composé **ou** `existingSecret`/`auth`), PVC 20Gi (prod) |
| `neo4j-secret` | **non généré** si `neo4j.existingSecret` est défini (3.4) |
| `blockchain-*` | nœud Hardhat intégré, `enabled: false` en production |

**Secrets (3.4)** : `backend.existingSecret` + `neo4j.existingSecret` → clés
`jwt-secret`, `password`, `auth` ; README-PROD §5 (option B `kubectl create secret`,
option C SealedSecrets/ExternalSecrets).

### 6.2 Scripts (`scripts/`)

| Script | Rôle | Flag |
|---|---|---|
| `clearner-prod.sh` / `.ps1` | Déploiement prod : prérequis (auto-install helm) → build → lint+template → upgrade → rollout → health → smoke e2e | **`--dry-run` / `-DryRun`** : lint + rendu manifests `/tmp/clearnet-manifests.yaml`, aucun changement |
| `validate-kind.sh` / `.ps1` | Validation pipeline sur kind/minikube (Action 1) : image → `clearner-prod --dry-run` → Redis kind + helm upgrade → smoke → rapport | — |
| `e2e-sepolia.sh` / `.ps1` | E2E on-chain (Action 2) : contrats → compose (pont ON) → mint 500 → tx 100 → poll SUCCESS+hash ≤ 60 s → positions 400/100 → cas d'échec (crédit insuffisant) → FAILED+retries → rapport | — |
| `early-adopters-script.sh` / `.ps1` | Comptes démo 3 secteurs (Maritime/Aviation/Biotech) + tx de démo + CSV de suivi (Action 3) | — |

### 6.3 Monitoring

`infrastructure/grafana/dashboard-clearnet.json` (schemaVersion 39) : 12 panneaux —
disponibilité backend, QPS/5xx/p95 ingress, CPU/mémoire, Redis (clients/mémoire/ops),
Neo4j, panneau explicatif file BullMQ (jobs failed = règlements en dette).

### 6.4 Docker Compose (`infrastructure/docker-compose.yml`)

Services : `neo4j` (5.26, healthcheck), `redis` (7-alpine, healthcheck), `backend`
(`BLOCKCHAIN_ENABLED`/`BLOCKCHAIN_RPC_URL`/`CLRN_TOKEN_ADDRESS`/
`COMPENSATION_ENGINE_ADDRESS`/`QUEUE_ENABLED`/`REDIS_HOST` passées par environnement).

---

## 7. API — tableau des endpoints

| Méthode | Route | Garde | Description |
|---|---|---|---|
| GET | `/` | public | Accueil |
| GET | `/health` | public | `{status, neo4j}` |
| POST | `/auth/register` | public | `{email, name, password, industry?}` → 201 |
| POST | `/auth/login` | public | → `{access_token, email}` |
| GET | `/auth/profile` | JWT | Profil courant |
| GET | `/users/me` | JWT | Données utilisateur |
| GET | `/users/roi` | JWT | ROI sectoriel |
| POST | `/transactions` | JWT | `{toEmail, amount, note?}` — file BullMQ si activée |
| GET | `/transactions` | JWT | Liste paginée `{items, total, page, limit}` |
| GET | `/transactions/balance` | JWT | `{balance, currency: CLRN, lastTransaction}` |
| GET | `/transactions/history` | JWT | Historique (limit ≤ 50) |
| POST | `/companies` | JWT | Création entreprise |
| GET | `/companies?industry=` | JWT | Liste, filtre sectoriel |
| GET | `/companies/:id` | JWT | Détail |
| GET | `/industries` | public | 15 secteurs + compteurs |
| GET | `/industries/stats` | public | Totaux v1 (12) / v1.1 (3) |
| GET | `/industries/:code` | public | Détail secteur (400 si inconnu) |
| GET | `/oracles/demurrage?port&lat&lng` | public | Jours de demeurage |
| GET | `/oracles/launch-window?satellite` | public | Fenêtre de lancement |
| GET | `/oracles/milestone?nct` | public | Validité jalon clinique |
| GET | `/blockchain/status` | public | Diagnostic pont (aucun secret) |
| POST | `/blockchain/mint` | **X-Demo-Key** | Testnet : mint ERC20 + position nette (V1.3, 3.1 E2E) |
| GET | `/blockchain/position/:email` | **X-Demo-Key** | Position nette (wei + CLRN) (V1.3) |
| GET | `/graph/egonet?depth=2&lat=&lng=` | JWT | Réseau egocentré (V1.3) |
| POST | `/demo/seed` | **X-Demo-Key** | alice/bob/carol + 3 tx si vide ; `{industry?}` (V1.3) |
| GET | `/demo/status` | **X-Demo-Key** | Compteurs users/transactions |
| GET | `/zkproof/download/:txId` | JWT | Preuve Groth16 d'une tx |
| POST | `/billing/create-checkout` | JWT | Stripe : session abonnement `{tier}` (Essentiel/Pro/Enterprise, défaut Pro) |
| GET | `/billing/status` | JWT | `{tier, customerId, quotaUsed, quotaMax}` (null = illimité) |
| POST | `/webhooks/stripe` | IP+signature | `customer.subscription.*` → tier (Price ID → metadata → défaut PRO) |

**Temps réel** : namespace socket.io `/transactions`, événement `transaction:status`.

---

## 8. Registre de configuration

| Variable | Défaut | Usage |
|---|---|---|
| `PORT` | 3000 | Port HTTP |
| `NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD` | bolt://localhost:7687 · neo4j · clearnet123 | Connexion graphe |
| `JWT_SECRET` | change-me (dev) | Signature JWT |
| `THROTTLE_TTL / THROTTLE_LIMIT` | 60000 · 100 (prod : 300) | Rate-limit global |
| `DEMO_API_KEY` | demo-secret-change-me (prod : **vide = 401**) | Routes /demo + utilitaires testnet |
| `ONCHAIN_ENABLED` (alias `BLOCKCHAIN_ENABLED`) | false | Pont on-chain |
| `BLOCKCHAIN_RPC_URL` (repli `RPC_URL_SEPOLIA`) | — | RPC du réseau |
| `BLOCKCHAIN_PRIVATE_KEY` (repli `PRIVATE_KEY`) | clé dev hardhat | Signer admin (⚠️ secret) |
| `CLRN_TOKEN_ADDRESS` / `COMPENSATION_ENGINE_ADDRESS` | — | Adresses déployées (Sepolia) |
| `ITAR_ENABLED` · `OFAC_API_KEY` · `OFAC_CSV_PATH` | false · vide · vide | Conformité |
| `ORACLES_ENABLED` · `STORMGLASS_API_KEY` · `SPACE_TRACK_USER/PASSWORD` · `ORACLE_TIMEOUT_MS` | false · vide · 2500 | Oracles |
| `ZK_ENABLED` · `VERIFIER_ADDRESS` · `ZK_ARTIFACTS_DIR` | false · vide · ./zkartifacts | Preuves ZK |
| `QUEUE_ENABLED` · `REDIS_HOST` · `REDIS_PORT` · `REDIS_PASSWORD` | false · redis · 6379 · vide | File BullMQ (3.1 : décision dynamique) |
| `QUEUE_ATTEMPTS` · `QUEUE_BACKOFF_MS` | 5 · 5000 | Retries exponentielles |
| `SLACK_WEBHOOK_URL` | vide | Échecs définitifs → Slack (3.3) |
| `BILLING_ENABLED` | false | Facturation Stripe (off par défaut) |
| `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET` | vide | Clés Stripe (⚠️ secrets, `existingSecret` en prod) |
| `STRIPE_PRICE_ESSENTIAL/PRO/ENTERPRISE` | price_*_default | Price IDs des 3 niveaux payants |
| `BILLING_FREE_QUOTA` | 15 | Plafond Free (mois civil UTC) → 402 au-delà |
| `BILLING_SUCCESS_URL` · `BILLING_CANCEL_URL` | clearnet://billing(?ok=1) | Retour checkout mobile |
| `STRIPE_WEBHOOK_IPS` | vide | Repli CSV allowlist webhooks (fail-closed) |
| `EARLY_ADOPTER_ENABLED` | false | Exemption quota des early adopters |

---

## 9. Sécurité & durcissement

1. **Secrets jamais commités** : `JWT_SECRET`, `NEO4J_PASSWORD`, `REDIS_PASSWORD` via env
   du runner ou Secret Kubernetes ; en production `existingSecret` / SealedSecrets /
   ExternalSecrets (3.4) — jamais en `--set`.
2. **Démo verrouillée** : `DEMO_API_KEY` vide en production → 401 systématique sur
   `/demo/*`, `/blockchain/mint`, `/blockchain/position/:email`.
3. **Durcissement off par défaut** : ITAR/OFAC, oracles, ZK, file BullMQ, pont on-chain —
   activation explicite (voir `PHASE2_DEPLOYMENT.md`).
4. **Rate-limit** : throttler global (TTL 60 s ; dev 100 req/min, prod 300 req/min/pod).
5. **Réversibilité** : file optionnelle (défaut off), pont réversible
   (`ONCHAIN_ENABLED=false`), rollback `helm rollback clearnet -n clearnet`, aucune
   migration irréversible.
6. **Règlement ne déplace aucun ERC20** (netting de positions) — l'allowance n'est pas
   un prérequis ; le hash de la transaction `settle` est la preuve d'audit.
7. **Échecs définitifs** tracés (nœuds `FailedJob`) + notifiés (Slack) (3.3).

---

## 10. Points de vigilance traités (3.1–3.5)

| # | Constat | Correction | Preuve |
|---|---|---|---|
| 3.1 | `QUEUE_ENABLED` évalué une seule fois à l'import | Décision **dynamique** par transaction (`isQueueEnabled()`, ConfigService) ; câblage module documenté (redémarrage requis) | `transactions.service.ts:43`, build+tests verts |
| 3.2 | Aucun test E2E de la file | **`queue.integration.spec.ts`** : Redis réel (sonde TCP 2 s, suite verte sans Redis), flux create → job → processor → **SUCCESS/FAILED écrit en Neo4j** + **événement WebSocket** + job `failed` | 4 suites / 13 tests PASS |
| 3.3 | Pas de DLQ / handler d'échec | Événement worker `failed` → **audit `FailedJob` (Neo4j)** + **notification Slack** (`SLACK_WEBHOOK_URL`) | `transaction.processor.ts:47`, `transactions.service.ts:49` |
| 3.4 | Secrets en `--set` | Chart : **`backend.existingSecret` / `neo4j.existingSecret`** (clés `jwt-secret`, `password`, `auth`) ; README-PROD §5 (kubectl create secret, SealedSecrets, ExternalSecrets) | `helm template` : 7 ressources, 3 refs externe, Secret généré absent |
| 3.5 | helm lint non exécuté | **Auto-install Helm** dans `clearner-prod.sh`/`.ps1` + **CI** `.github/workflows/ci-validation.yml` (helm lint/template avant tout déploiement, bash -n, build, tests) | helm lint local PASS, rendu 8/7 ressources |

**Bugs pré-existants corrigés au passage** (le chart ne rendait jamais) : `Chart.yaml`
(description non quotée), `_helpers.tpl` (`clearnet.name` manquant), `backend-deployment.yaml`
(label `matchLabels` sans clé).

---

## 11. Qualité, tests & CI

### 11.1 Tests

| Suite | Contenu | Statut |
|---|---|---|
| `app.controller.spec.ts` | Health + index | PASS |
| `company/companies.service.spec.ts` | Services entreprises, entités | PASS |
| `company/company.entity.spec.ts` | Validation d'entité | PASS |
| `transactions/queue.integration.spec.ts` | **Intégration BullMQ** (Redis réel) : SUCCESS + FAILED + WebSocket + Neo4j | PASS (vert sans Redis, assertions réelles en CI) |

**Total : 13 tests, 4 suites.** `npm run build` : PASS.

### 11.2 CI (`ci-validation.yml`)

- **Job helm** : `helm lint` (values prod + base) + `helm template` (rendu prod) +
  `bash -n scripts/*.sh` — exécuté à chaque push/PR **avant tout déploiement**.
- **Job backend** : `npm ci` → build → tests avec **service Redis** provisionné
  (les 2 tests d'intégration s'exécutent réellement).

### 11.3 Validation statique

`bash -n` sur tous les scripts shell · parse PowerShell (UTF-8) · `helm lint` local 0 failed
· `helm template` 8 ressources (prod) / 7 (existingSecret).

---

## 12. Stratégie de déploiement & early adopters

Cf. `DEPLOYMENT_STRATEGY_AND_EARLY_ADOPTERS.md` :

| Phase | Fenêtre | Contenu | Sortie |
|---|---|---|---|
| 0. Préparation | — | Environnements, clés, adresses Sepolia, domaines | Checklist verte |
| 1. Validation pipeline | J1–J2 | `validate-kind.sh` + `clearner-prod --dry-run` + smoke | `validation-kind-report.md` PASS |
| 2. E2E on-chain Sepolia | J3–J5 | `e2e-sepolia.sh` : mint, règlements succès/échec, positions, retries | `e2e-sepolia-report.md` PASS |
| 3. Early adopters | J4–J8 | Comptes 3 secteurs, e-mail type, tracking CSV, kit | ≥ 3 candidatures, ≥ 1 actif |
| 4. Production | J8–J10 | `clearner-prod.sh` (secrets externalisés), validation finale, annonce | Go/No-Go signé |

**Checklist Go/No-Go (16 critères)** : helm lint/template · pipeline kind PASS · E2E
Sepolia PASS · secrets (Vault/SealedSecrets/existingSecret) · alerting Grafana · rollback
documenté/testé · `DEMO_API_KEY` vide · pont off par défaut · k6 sans régression ·
`verify:sepolia` · docs à jour · Go/No-Go signé · CI verte · **test d'intégration BullMQ
actif** · **audit FailedJob + Slack opérationnel** · **secrets jamais en `--set`**.

---

## 13. Facturation & Pricing (V1.4 → V1.5)

**V1.4** a introduit Stripe (checkout hébergé, webhook signé + IP allowlist fail-closed,
quota freemium, alerte Slack 80 %) ; **V1.5 Pricing** remplace le « Pro unique » par une
**grille 4 niveaux** — implémentée, build ✅, tests 30/30 ✅ (`TARIFICATION_V1_5.md`).

| Niveau | Opérations / mois | Commission | Prix mensuel | Stripe Price ID |
|---|---|---|---|---|
| **Free** | 15 (limité) | 2,0 % | 0 € | — (pas de paiement) |
| **Essentiel** | 50 | 1,5 % | 99 € | `price_essential_xxx` |
| **Pro** | 500 | 1,2 % | 499 € | `price_pro_xxx` |
| **Enterprise** | Illimité | 0,9 % | 1 999 € | `price_enterprise_xxx` |

- **Règle d'or** : au-delà de 15 tx/mois (mois civil UTC), l'API renvoie
  `402 Payment Required` (`BILLING_QUOTA_EXCEEDED`) invitant à passer à l'offre Essentiel ;
  Essentiel (50) et Pro (500) plafonnés pareillement, Enterprise illimité.
- **Source de vérité** : `clearnet-backend/src/billing/pricing.ts` (quotas, commissions,
  Price IDs, `tierFromPrice`). Checkout : `POST /api/billing/create-checkout {tier}`
  (défaut PRO) ; statut : `GET /api/billing/status` (`quotaMax: null` = illimité) ;
  webhook : tier par Price ID configuré → repli `metadata.tier` → défaut PRO.
- **Commission** : `feeRate` du niveau timbré sur chaque nœud `Transaction` (prélèvement automatisé : P2).
- **Config** : `STRIPE_PRICE_ESSENTIAL/PRO/ENTERPRISE`, `BILLING_FREE_QUOTA=15` (cf. §8) ;
  Helm `values*.yaml` + configmap à jour. Mobile : écran Abonnement (4 niveaux, barre de quota
  pour tout quota fini, `∞` Enterprise).

---

## 14. Limites & perspectives

- **Métriques BullMQ** : l'exposition `/metrics` prom-client (jobs, latences) est l'étape
  suivante d'industrialisation (dashboard Grafana documente les keys Redis en attendant).
- **Caveat ZK documenté** : le circuit raisonne en micro-CLRN (×1e6), le ledger on-chain
  en wei (×1e18) — le gate valide la mécanique de preuve ; l'égalité exacte d'échelle est
  un raffinement de phase suivante (acceptable sur testnet).
- **Multi-secteurs** : 3 secteurs v1.1 ajoutés ; le mécanisme d'extension est générique.
- **Échecs de règlement** : la transaction reste valide hors-chaîne (dette traçable via
  `FAILED` + `FailedJob`) — un mécanisme de reprise automatique des dettes est une
  perspective produit.

---

## 15. V1.5 — Préparation internationale & industrialisation ZK (planification livrée)

**Focus V1.5** : internationalisation (i18n 4 langues, multi-devises EUR/USD/GBP/CHF, convertisseur
temps réel), socle ZK industrialisé (batch netting Poseidon, cérémonie Phase 2, déploiement L2) et
synchronisation on-chain → Neo4j. Les six plans sont **livrés, prêts à exécuter, off par défaut** —
aucun changement de comportement V1.4 tant que les flags ne sont pas activés.

| Document | Périmètre | Flag d'activation | État |
|---|---|---|---|
| `I18N_CURRENCY_UPGRADE.md` | i18n backend 4 langues (fr/en/es/de), multi-devises via oracles (Chainlink + fallback statique), **convertisseur temps réel** (REST `/api/fx/*` + WS `/fx` `fx:rate`), écran mobile Convertisseur + paiement pré-rempli | `I18N_ENABLED` · `MULTI_CURRENCY_ENABLED` | ✅ Plan exécutable (3 j) |
| `RECOMMANDATION_DEPLOIEMENT_L2.md` | Déploiement du socle ZK sur **Polygon zkEVM** (batch proofs → ≪ 0,01 $/tx ; Arbitrum Orbit ≠ ZK — corrigé) | — (déploiement) | ✅ Reco validée |
| `CEREMONIE_TRUSTED_SETUP.md` | Cérémonie Phase 2 (Perpetual Powers of Tau + snarkjs web SRI/air-gap Tails, 8–12 contributeurs, destruction des déchets toxiques) | circuit `clearing.circom` (à geler) | ✅ Procédure 3 sem. |
| `SYNC_ONCHAIN_NEO4J.md` | Indexeur on-chain → Neo4j : finalité **chaîne-dépendante**, reorgs** soft** (statuts, pas de purge), checkpoint atomique | `SYNC_ENABLED` | ✅ Architecture + reorgPolicy |
| `RECONCILIATION_WORKER_INTEGRATION.md` | Worker BullMQ `reconciliation` (cron 5 min) : corrélation par `onchainHash`/`pendingTxHash`, `PENDING → SUCCESS / REORG_ROLLBACK`, métriques prom-client | `RECONCILIATION_ENABLED` | ✅ Code + diffs + spec (4 tests) |
| `ZK_BATCH_INTEGRATION.md` | Circuit `ClearNetBatchNetting.circom` (Poseidon), `VerifierBatch.sol` (snarkjs), `ZkBatchService` (collect → proof → submit), `CompensationEngine.settleBatchWithProof`, `IZkBatchVerifier` (interface additive) | `ZK_BATCH_ENABLED` | ✅ Code + tests (2 circuit + 3 contrat + 4 backend) |

**Coordination** : l'ordre d'exécution s'enchaîne — gel du circuit → cérémonie Phase 2 → déploiement
zkEVM (staging Sepolia) → batch ZK + réconciliation (cohérence des statuts) → i18n/FX (convertisseur,
`displayCurrency`/`displayAmount` additifs). Suite de tests cible V1.5 : **30 + 4 (reconciliation) +
4 (zkbatch) = 38 backend** + contrats 5/5 existants + `VerifierBatch.sol` — à verrouiller à
l'implémentation (chaque flag reste indépendant et réversible).
**Revue croisée** : `REVUE_V1_5_VIGILANCE.md` — 6 points de vigilance (keyring sécurisé HKDF,
correction circom, mapping batch×réconciliation, oracle multi-source, benchmarks gas, gate de gel)
+ roadmap S1→S4 et matrice de suivi.
