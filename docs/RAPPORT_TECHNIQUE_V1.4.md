# CLEARNET V1.3 → V1.4 — RAPPORT TECHNIQUE

> Version : V1.4 (lots J1–J13 écrits et validés) · Date : 15/08/2026
> Documents de référence : `RAPPORT_TECHNIQUE.md` (V1.3) · `V1.4_UPGRADE_PLAN.md` (plan complet, 5 axes + 6 angles morts)

---

## Sommaire

1. [Synthèse](#1-synthèse)
2. [Périmètre V1.4](#2-périmètre-v14)
3. [État d'implémentation — lot J1–J2](#3-état-dimplémentation--lot-j1j2)
4. [Fichiers livrés](#4-fichiers-livrés)
5. [Validation & qualité](#5-validation--qualité)
6. [Rétrocompatibilité V1.3](#6-rétrocompatibilité-v13)
7. [Prochaines étapes](#7-prochaines-étapes)
8. [V1.5 — Planification livrée](#8-v15--planification-livrée)

### Annexes du jour (lots J3–J13)

- **§3a** : lot J3–J5 — Facturation Stripe (`#lot-j3j5--facturation-stripe-axe-2-32-35-36`)
- **§3b** : lot J6–J8 — E2E mobile Maestro (`#lot-j6j8--e2e-mobile-maestro-axe-3`)
- **§3c** : lot J9–J10 — Multisig 2/3 (`#lot-j9j10--multisig-23-axe-4-d1d6`)
- **§3d** : lot J11–J13 — Helm (`#lot-j11j13--helm-axe-5-e1e6-f1`)

---

## 1. Synthèse

ClearNet V1.3 livrait un moteur de compensation robuste (BullMQ + Neo4j + pont Sepolia + chart Helm + Grafana).
La campagne V1.4 cible les 5 verrous commerciaux (admin DLQ, facturation Stripe, E2E mobile, multisig 2/3, métriques)
+ 6 angles morts issus de l'audit (gouvernance des clés, quota FREE, reporting, monitoring on-chain, webhooks Stripe, early adopters).

**État au jour du rapport** :
- ✅ Plan d'exécution complet : `V1.4_UPGRADE_PLAN.md` (~2 100 lignes, code et diffs intégrés)
- ✅ **Lot J1–J2** (Axe 1 admin + Axe 5 métriques + angles morts 3.1/3.4) : `nest build` **PASS**, tests **PASS 6/6 — 25/25**
- ✅ **Lot J3–J5** (Axe 2 Stripe + quota FREE + webhooks + early adopters) : module billing écrit, spec 4/4 **PASS** — backend complet **7/7 suites — 29/29 tests**
- ✅ **Lot J6–J8** (Axe 3 E2E mobile) : testIDs + flows Maestro (`login`, `offline-sync`) + CI mobile écrits (exécution en CI émulateur)
- ✅ **Lot J9–J10** (Axe 4 multisig 2/3 + Ansatz D) : `MultiSigWallet.sol` + pont backend (PENDING_MULTISIG) + signatures 2FA + scripts ops — `hardhat compile` **PASS**, tests blockchain **5/5**
- ✅ **Lot J11–J13** (Axe 5 Helm) : chart complet (configmap, deployment, service, ServiceMonitor, PrometheusRule) + values V1.4 — contre-preuve `helm lint/template` par la CI existante (`ci-validation.yml`)
- ⬜ V1.4.1 (hors périmètre actuel) : reporting PDF, jauges quota `clearnet_free_quota_used/max` (nécessaires à l'alerte FreeQuotaNearLimit), `test:e2e` avec Redis provisionné

---

## 2. Périmètre V1.4

| Axe | Contenu | Statut implémentation |
|---|---|---|
| **Axe 1** — Admin DLQ & Retry | `GET /api/admin/queue/failed` · `POST /api/admin/queue/retry/:jobId` · `DELETE /api/admin/queue/clean/:queue` + audit Neo4j | ✅ **Implémenté** |
| **Axe 2** — Facturation Stripe | Checkout hébergé, webhook signé, `subscriptionTier` (FREE/PRO/ENTERPRISE) sur le nœud User, quota FREE | ✅ **Implémenté** (J3–J5) |
| **Axe 3** — E2E mobile Maestro | Flows login/offline-sync, CI émulateur Android | ✅ **Écrit** (J6–J8) — exécution en CI |
| **Axe 4** — Multisig 2/3 | `MultiSigWallet.sol` (neuf), `CompensationEngine.sol` **modifié additivement** (`transferAdmin`), submission depuis le backend, approve/execute ops | ✅ **Implémenté** (J9–J10) — monitoring (3.1) déjà livré en J1–J2 |
| **Axe 5** — Métriques & alerting | `/metrics` prom-client, séries BullMQ, gauge solde multisig, alertes Prometheus | ✅ **Implémenté** (backend J1–J2 + Helm J11–J13) |
| **3.1** — Gouvernance clés | Monitor PENDING > 4 h → Slack + gauge | ✅ **Implémenté** |
| **3.2** — Quota FREE | Alerte 80 % (J11–J13) + doc mois civil UTC | ✅ **Implémenté** (J3–J5/J11–J13) — jauges d'appui V1.4.1 |
| **3.3** — Reporting | Export PDF mobile (expo-print branché), `ReportingModule` V1.4.1 | ⬜ V1.4.1 |
| **3.4** — Métriques on-chain | `clearnet_multisig_eth_balance` (poll 5 min) | ✅ **Implémenté** |
| **3.5** — Webhook Stripe | IP allowlist officielle + fail-closed | ✅ **Implémenté** (J3–J5) |
| **3.6** — Early adopters | Exemption quota via `isEarlyAdopter` | ✅ **Implémenté** (J3–J5) |

---

## 3. État d'implémentation — lot J1–J2

### Axe 1 : `AdminModule` (DLQ & Retry)

- **`roles.guard.ts`** : garde `@Roles('admin')` — vérification faite : ce fichier n'existait pas dans `src/common/guards/`.
  Le payload JWT V1.3 (`{sub, email}`) n'est **pas modifié** : le rôle est dérivé de l'env `ADMIN_EMAILS` (CSV).
  Liste vide → `ForbiddenException('admin feature disabled')` (**off par défaut**).
- **`admin.service.ts`** : suit exactement le pattern V1.3 de `TransactionsService`
  (`@Optional() @InjectQueue(ONCHAIN_QUEUE)` + `@Inject(NEO4J_DRIVER)`) :
  - `listFailed` : `queue.getJobs(['failed'])` + `getJobCountByTypes('failed')` (pagination),
    `failedReason` tronqué à 500 car., dernier stacktrace, `finishedOn` ;
  - `listFailedAudit` : nœuds `FailedJob` V1.3 (Neo4j) — **fonctionne même file désactivée** ;
  - `retryJob` : `job.retry()` (retries conservés) — 404 si inconnu ;
  - `cleanQueue` : `obliterate({force:true})`, **whitelist dure** `onchain-settlement`.
- **`admin.controller.ts`** : 4 routes JWT+admin (`/api/admin/queue/failed|failed-audit|retry/:jobId|clean/:queue`).
- **`admin.module.ts`** : contrôleur monté **uniquement** si `ADMIN_EMAILS` non vide ; BullModule conditionnel à `QUEUE_ENABLED`.

### Axe 5 : Métriques Prometheus

- **`metrics.module.ts`** : `PrometheusModule.register({ path: '/metrics', defaultMetrics })` conditionnel à
  `METRICS_ENABLED` (**off par défaut**) ; fournit le token `METRICS_REGISTRY` = **registre par défaut prom-client**
  (vérifié dans le code de `@willsoto/nestjs-prometheus` v6.1.0 : `PrometheusController` sert `client.register` →
  nos métriques custom apparaissent sur le même `/metrics`).
- **`queue.metrics.ts`** — 6 séries prom-client sur la file `onchain-settlement` :
  `bull_queue_jobs_completed_total` / `bull_queue_jobs_failed_total` (Counter),
  `bull_queue_jobs_active` / `bull_queue_jobs_waiting` / `bull_queue_jobs_failed` (Gauge),
  `bull_queue_job_duration_seconds` (Histogram, buckets 0,1→30 s) + polling d'état `getJobCounts()` 15 s.
- **`transaction.processor.ts`** : hooks `completed`/`failed` (compteurs + durée via `processedOn`), poller démarré
  dans `onApplicationBootstrap` si `METRICS_ENABLED=true`, **`clearInterval` dans `onApplicationShutdown`**
  (pas de fuite au redémarrage du pod).

### Angles morts on-chain

- **`onchain.metrics.ts`** (3.4) : gauge `clearnet_multisig_eth_balance` — poll `getBalance(MULTISIG_ADDRESS)`
  toutes les `METRICS_POLL_BALANCE_MS` (défaut 300 000 ms = 5 min). Inactif sans `MULTISIG_ADDRESS` ou RPC.
- **`multisig.monitor.ts`** (3.1) : cron interne 15 min — scan `transactionCount()` + `transactions(i)`
  (ABI minimale de lecture seule), toute soumission non exécutée au-delà de `MULTISIG_PENDING_MAX_MS`
  (défaut 14 400 000 ms = **4 h**) → gauge `clearnet_multisig_pending_tx_seconds` + **notification Slack**
  (réutilise `SLACK_WEBHOOK_URL` V1.3, non bloquante).
- **`blockchain.constants.ts`** : `MULTISIG_ABI` ajoutée, `CONTRACT_ABIS.MultiSig` exposé.
- **`blockchain.module.ts`** : fournit `OnchainMetrics` + `MultisigMonitor` (imports `MetricsModule`).

---

## Lot J3–J5 : Facturation Stripe (Axe 2, 3.2, 3.5, 3.6)

### `BillingModule` (conditionnel à `BILLING_ENABLED`)

- **`pricing.ts`** (V1.5 Pricing) : grille 4 niveaux centralisée — Free (15 tx/mois, 2,0 %),
  Essentiel (50, 1,5 %, 99 €), Pro (500, 1,2 %, 499 €), Enterprise (illimité, 0,9 %, 1 999 €) ;
  quotas, commissions, Price IDs (`STRIPE_PRICE_ESSENTIAL/PRO/ENTERPRISE`) et mapping webhook.
- **`billing.service.ts`** : `assertEnabled()` → 503 hors flag (**off par défaut**, règle d'or) ; quota via
  `countMonth` (transactions **SENT du mois civil UTC** uniquement, Cypher Neo4j) — compté pour tout niveau
  à quota fini ; `applySubscription` écrit `subscriptionTier` + `stripeCustomer` sur le nœud User
  (**idempotent**) ; `createCheckout(email, tier='PRO')` (Price ID du niveau).
- **`billing.controller.ts`** : `POST /api/billing/create-checkout` (body optionnel `{tier}`,
  défaut PRO, 400 si invalide/FREE) + `GET /api/billing/status` (`quotaMax: null` = illimité).
- **`webhooks/stripe.webhook.controller.ts`** : `constructEvent` signé (`STRIPE_WEBHOOK_SECRET`), garde
  `StripeIpGuard` (allowlist officielle `STRIPE_WEBHOOK_IPS`, **fail-closed**) ; tier résolu par
  **Price ID configuré** → repli `metadata.tier` → défaut PRO ; `deleted` → FREE.
- **Règle d'or V1.5** : au-delà de 15 tx/mois (Free), l'API renvoie
  **`402 Payment Required`** (`BILLING_QUOTA_EXCEEDED`, message d'upgrade) ; Essentiel/Pro plafonnés
  pareillement. Commission du niveau timbrée en `feeRate` sur chaque `Transaction` (prélèvement : P2).

### Adaptation majeure : `stripe@22.5.0` et la chaîne CJS/ts-jest

Le plan supposait l'ancien layout du paquet ; **v22 a changé** :
1. **Types** : plus de champ top-level `types` — uniquement une condition `types` dans l'`exports` map (ciblée ESM,
   `esm/stripe.esm.node.d.ts`) → **invisibles en résolution node10** (`module: commonjs`, pas de `moduleResolution`)
   → TS7016. Le sous-chemin `stripe/cjs/...` n'est **pas exporté** par l'exports map → `tsc` (node10, ignore exports)
   le résolvait mais **jest le bloquait** (`Cannot find module`).
2. **Runtime CJS** : le build CJS fait `module.exports = StripeConstructor` (aucun `.default`) ; or le backend
   n'avait pas `esModuleInterop` (seul `allowSyntheticDefaultImports`) → l'import default émis `.default` était
   `undefined` → `TypeError: … is not a constructor` (spec billing en échec).

**Solution retenue** : `esModuleInterop: true` dans `tsconfig.json` (vérifié : **aucun autre import default**
dans tout `src/`) → `import Stripe from 'stripe'` est maintenant émis avec `__importDefault` (sûr en CJS à
l'exécution **et** sous ts-jest), types résolues via `main` → d.ts frère (`export = StripeConstructor`).
Aucun shim ni helper conservé. → build PASS + billing.service.spec **4/4 PASS**.

---

## Lot J6–J8 : E2E mobile Maestro (Axe 3)

- **testIDs posés** sur les 4 écrans : `login-*`/`go-register` (Login), `register-*` dont `register-industry-<code>`
  (Register — **secteur obligatoire** à l'inscription, découvert en écrivant le flow), `home-screen`/`logout`/
  `go-transactions`/`toast-network-restored` (Home), `new-payment`/`tx-queued-local`/`tx-history-first`/
  `tx-to/amount/note`/`tx-submit` (Transactions).
- **`TransactionsScreen.submit()` réécrit** (offline-first write-ahead) : enregistrement **local**
  (`LocalTransactionService.saveLocal` + `localId` généré côté client) **avant** le POST ; `markSynced` au succès ;
  hors-ligne → la transaction reste `LOCAL_PENDING`, `Alert` + fermeture de la modale (aucune perte) ;
  erreur non-réseau → `markFailed` ; `refreshPending()` après enfilement. `useBackgroundSync` expose désormais
  `refreshPending`.
- **Deep link** : `app.json` `scheme: "clearnet"` + onglet « Abonnement » (`App.tsx`) + gestion
  `clearnet://billing` (`Linking.getInitialURL` + `addEventListener('url')` → bascule d'onglet, cleanup).
- **Flows** : `.maestro/login.yaml` (s'inscrit avec la chip `register-industry-Technology`), `.maestro/offline-sync.yaml`
  (mode avion, `extendedWaitUntil` sur `tx-history-first`, `assertNotVisible tx-queued-local` après re-sync).
  **appId confirmé : `com.clearnet.mobile`**.
- **CI** : `.github/workflows/mobile-ci.yml` (job `build-apk` + job `maestro-e2e`, artifacts APK + rapport JUnit) ;
  script local `scripts/maestro-local.ps1`. Exécution réelle : émulateur Android en CI.

---

## Lot J9–J10 : Multisig 2/3 (Axe 4, D.1–D.6)

### Contrats (Solidity 0.8, Hardhat — `test/multisig.test.ts` 3 tests)

- **`MultiSigWallet.sol`** (neuf) : `submitTransaction/confirmTransaction/executeTransaction/revoke`,
  threshold 2/3, `m_required = ceil(2/3 * n)`, events.
  - **Adaptation 1** : pas d'héritage OZ `Ownable` — en OZ 4.9.3 `onlyOwner` est **non-virtual** → collision
    de modifier (`Trying to override non-virtual modifier`) ; le contrat gère son propre jeu d'owners.
  - **Adaptation 2** : l'exécution après N confirmations passe par un appel **interne** `_execute(txId)` —
    un appel externe (`this.executeTransaction`) inscrit `msg.sender = contrat` → revert `not an owner`
    (2 tests en échec, corrigés).
- **`CompensationEngine.sol` — unique diff V1.4 sur les contrats** : l'ancre D.2/D.3 du plan (transfert d'ownership
  OZ) était **inapplicable** — `admin` était **immutable**, le moteur n'était pas `Ownable`. Ajout **additif** :
  `admin` mutable + `transferAdmin` (`onlyAdmin`) + event `AdminTransferred` (rétrocompatible : valeur initiale
  inchangée). `ClearNetToken` (qui, lui, est `Ownable` OZ) reste **intouché**.

### Pont backend (D.4) + signatures ledger (D.5)

- `blockchain.service.ts` : lecture `MULTISIG_ADDRESS` ; en `settleCompensation`, si multisig armé →
  `encodeFunctionData('settle')` → `submitTransaction(engine, 0, data)` → `SettlementResult.status =
  'PENDING_MULTISIG'` (nouveau membre du type, propagé jusqu'au gateway/websocket mobile
  `TransactionStatusEvent.status`). `markOnchainSuccess(txId, hash, status)` : statut interpolé dans le `SET`
  (préserve les assertions littérales `'SUCCESS'` de `queue.integration.spec`).
- **`SignaturesModule`** (2FA ledger) : HMAC-SHA256, code 6 caractères ; `POST /signatures/request`,
  `POST /signatures/:id/approve`, `GET /signatures/pending` — JWT + `@Roles('admin')` ; conditionnel à
  `MULTISIG_ENABLED`. Adaptation : `@Inject(NEO4J_DRIVER)` (pas de décorateur `InjectNeo4j` en V1.3).
- **Ops** : `scripts/deploy-multisig.ts` (env `MULTISIG_OWNERS` CSV → `transferOwnership` token +
  `transferAdmin` engine + MAJ `deployments/sepolia.json`) ; `scripts/multisig-approve.ts` + `.sh`/`.ps1`
  (`TX_ID` + clés 2/3, **clé jamais logguée**). Résultat : `hardhat compile` **PASS**, tests blockchain **5/5**
  (ClearNetToken 1 + CompensationEngine 1 + MultiSigWallet 3).

---

## Lot J11–J13 : Helm (Axe 5, E.1–E.6, F.1)

- **Découverte** : l'Axe 5 backend (`metrics.module.ts` `METRICS_REGISTRY`, `queue.metrics.ts`, hooks processor,
  `onchain.metrics.ts`, `multisig.monitor.ts`) **était déjà livré dans l'arbre** au lot J1–J2 ; seule l'intégration
  Helm manquait — livrée ici (E.3–E.6, F.1).
- **`values.yaml` (base, tout OFF)** : `metrics.enabled false` (port 3001, `pollBalanceMs` 300 000),
  `billing.enabled false` (`pricePro`, `freeQuota` 10, URLs `clearnet://billing`, `webhookIps`), `multisig.enabled
  false` (`address`, `pendingMaxMs` 14 400 000), `earlyAdopter.enabled false`, `adminEmails ""`,
  `prometheus.enabled false` (+ `alerts.enabled false`).
- **`values-production.yaml`** : tag `v1.4.0`, `metrics`/`billing` **true**, `prometheus` + alertes **true**,
  multisig/earlyAdopter off (progressive roll-out).
- **`backend-configmap.yaml`** : +12 variables (`ADMIN_EMAILS`, `METRICS_ENABLED/PORT/POLL_BALANCE_MS`,
  `BILLING_ENABLED/PRICE_PRO/FREE_QUOTA/SUCCESS_URL/CANCEL_URL`, `STRIPE_WEBHOOK_IPS`, `EARLY_ADOPTER_ENABLED`,
  `MULTISIG_ENABLED/ADDRESS/PENDING_MAX_MS`) — booléens rendus `"true"/"false"` (ternaires go-template).
- **`backend-deployment.yaml`** : port `metrics` gardé par flag ; 3 env **optionnels** via `existingSecret`
  (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SIGNATURE_2FA_SECRET` — `optional: true`, aucun secret dans le chart,
  aucun conteneur supplémentaire). `backend-service.yaml` : port metrics gardé.
- **Nouveaux templates** : `backend-servicemonitor.yaml` (collector 3001, gardé par flag) ;
  `backend-prometheusrule.yaml` — **5 alertes** : `HighJobFailureRate`, `QueueBacklogHigh`,
  `MultiSigStuckPending`, `MultiSigEthLow`, `FreeQuotaNearLimit`.
- **Note** : `FreeQuotaNearLimit` s'appuie sur des jauges `clearnet_free_quota_used/max` **non implémentées**
  (reporting V1.4.1) → règle livrée mais garantie d'activation documentée au V1.4.1.
- **Contre-preuve F.2** (`helm lint` + template prod) : job helm de la CI `ci-validation.yml` existante
  (helm non installé sur le poste de dev).

---

## 4. Fichiers livrés

### Nouveaux (9)

| Fichier | Rôle |
|---|---|
| `src/common/guards/roles.guard.ts` | Garde `@Roles` + décorateur |
| `src/admin/admin.module.ts` | Module admin conditionnel (ADMIN_EMAILS / QUEUE_ENABLED) |
| `src/admin/admin.controller.ts` | 4 routes DLQ/Retry JWT+admin |
| `src/admin/admin.service.ts` | Logique queue + audit Neo4j |
| `src/metrics/metrics.constants.ts` | Token `METRICS_REGISTRY` |
| `src/metrics/metrics.module.ts` | `/metrics` (PrometheusModule) + registre partagé |
| `src/transactions/queue.metrics.ts` | Métriques BullMQ + polling |
| `src/blockchain/onchain.metrics.ts` | Gauge solde ETH multisig (3.4) |
| `src/blockchain/multisig.monitor.ts` | Monitor PENDING > 4 h → Slack (3.1) |

### Modifiés (8)

| Fichier | Changement |
|---|---|
| `package.json` | + `@willsoto/nestjs-prometheus ^6.1.0`, `prom-client ^15.1.3`, `@opentelemetry/api ^1.9.1` (peer requis par prom-client v15) |
| `src/app.module.ts` | Import `AdminModule` + `MetricsModule` |
| `src/transactions/transaction.processor.ts` | Hooks métriques + poller + shutdown |
| `src/transactions/transactions.module.ts` | Import `MetricsModule` |
| `src/blockchain/blockchain.module.ts` | Fournit `OnchainMetrics` + `MultisigMonitor` |
| `src/blockchain/blockchain.constants.ts` | `MULTISIG_ABI` + `CONTRACT_ABIS.MultiSig` |
| `.env.example` | Bloc V1.4 : `ADMIN_EMAILS`, `METRICS_ENABLED/PATH/PORT`, `MULTISIG_ENABLED/ADDRESS`, `MULTISIG_PENDING_MAX_MS`, `METRICS_POLL_BALANCE_MS` (UTF-8 corrigé) |
| `jest.config.js` | — inchangé — |

### Specs livrées (2 nouveaux fichiers — 12 nouveaux tests)

| Spec | Tests |
|---|---|
| `src/common/guards/roles.guard.spec.ts` | 7 (décorateur, routes publiques, feature désactivée sans ADMIN_EMAILS, refus email hors liste / sans email, acceptation case-insensitive, résolution DI) |
| `src/admin/admin.controller.spec.ts` | 5 (pagination, audit Neo4j, retry + 404, refus purge hors whitelist, purge OK) — `ConfigModule.forRoot` ajouté au module de test (le `@UseGuards(RolesGuard)` du contrôleur requiert `ConfigService` au compile) |

Notes de validation live (incidents résolus en cours de session) :
- **Peer `@opentelemetry/api` manquant** (`prom-client@15` l'exige pour ses métriques process) : suite en échec `Cannot find module '@opentelemetry/api'` → ajouté en dépendance, résolu.
- Suites initialement très lentes (~10 min) : un process `npm run test` orphelin (tué par timeout) tournait encore et saturait la machine → tué, retour à ~4-5 min.
- `queue.integration.spec.ts` : Redis injoignable sur le poste → SKIP propre (2 tests verts passifs, design V1.3) ; les assertions réelles s'exécuteront en CI avec un service Redis provisionné.

### Lots J3–J5 (Stripe) — nouveaux + modifiés

| Fichier | Rôle |
|---|---|
| `src/billing/billing.module.ts` | Module conditionnel `BILLING_ENABLED` |
| `src/billing/pricing.ts` | **V1.5** : grille 4 niveaux (quotas, commissions, Price IDs, mapping webhook) |
| `src/billing/billing.controller.ts` | `POST /billing/create-checkout {tier}` + `GET /billing/status` |
| `src/billing/billing.service.ts` | Quota (mois civil UTC), tiers, applySubscription idempotent, checkout par niveau |
| `src/billing/webhooks/stripe.webhook.controller.ts` | `constructEvent` signé + `StripeIpGuard` fail-closed ; tier par Price ID |
| `src/common/guards/stripe-ip.guard.ts` | Allowlist officielle des IP webhooks Stripe |
| `src/billing/billing.service.spec.ts` | 6 tests (503 sans flag, countMonth UTC, applySubscription idempotent, mapping 4 niveaux, grille quotas/prix, messages) |
| `src/transactions/transactions.service.ts` | **V1.5** : quota 402 multi-niveaux + `feeRate` (commission) à la création |
| `clearnet-mobile/src/screens/BillingScreen.tsx` | **V1.5** : 4 niveaux, `quotaMax: null` = illimité, barre pour tout quota fini |
| `tsconfig.json` | `+ esModuleInterop: true` (interop CJS Stripe — aucun autre import default touché) |
| `package.json` | `+ stripe ^22.5.0` (runtime dev, pas monté en prod sans clé) |

### Lots J6–J8 (Mobile) — nouveaux

| Fichier | Rôle |
|---|---|
| `clearnet-mobile/.maestro/login.yaml`, `offline-sync.yaml` | Flows E2E (chips secteur, mode avion, re-sync) |
| `clearnet-mobile/scripts/maestro-local.ps1` | Lancement Maestro local |
| `.github/workflows/mobile-ci.yml` | build-apk + maestro-e2e (JUnit) |
| `clearnet-mobile/app.json` (`scheme`), `App.tsx` (onglet Abonnement + deep link) | billing mobile |
| `clearnet-mobile/src/screens/{Login,Register,Home,Transactions}.tsx` | testIDs + submit offline-first |
| `clearnet-mobile/src/hooks/useBackgroundSync.ts` | export `refreshPending` |

### Lots J9–J10 (Multisig) — nouveaux + modifiés

| Fichier | Rôle |
|---|---|
| `contracts/MultiSigWallet.sol` | Portefeuille 2/3 (new) |
| `contracts/CompensationEngine.sol` | `admin` mutable + `transferAdmin` + event (diff additif unique en Solidity) |
| `scripts/deploy-multisig.ts`, `multisig-approve.ts/.sh/.ps1` | Ops (clés 2/3, jamais logguées) |
| `test/multisig.test.ts` | 3 tests (refus <2 conf, exécution à la 2e, backup 3e) |
| `src/signatures/{module,service,controller}.ts` | Ledger 2FA HMAC (request/approve/pending, admin) |
| `src/blockchain/blockchain.service.ts` | `submitTransaction` → `PENDING_MULTISIG` |
| `src/blockchain/{types,constants}.ts`, `src/transactions/{transactions.service,transaction.processor}.ts`, `src/transactions/transactions.gateway.ts` | Propagation du statut PENDING_MULTISIG |
| `src/app.module.ts`, `.env.example` | `SignaturesModule` + bloc Axe 4 (`SIGNATURE_2FA_SECRET`) |

### Lots J11–J13 (Helm) — nouveaux + modifiés

| Fichier | Rôle |
|---|---|
| `infrastructure/helm/clearnet/values.yaml` | Base V1.4 tout OFF (+ bloc prometheus) |
| `infrastructure/helm/clearnet/values-production.yaml` | tag v1.4.0, metrics/billing/prometheus ON |
| `templates/backend-configmap.yaml` | +12 variables V1.4 (booléens `"true"/"false"`) |
| `templates/backend-deployment.yaml` | port metrics gardé + 3 secretKeyRef optionnels (`existingSecret`) |
| `templates/backend-service.yaml` | port metrics gardé |
| `templates/backend-servicemonitor.yaml` | Collector 3001 (new, gardé par flag) |
| `templates/backend-prometheusrule.yaml` | 5 alertes (new, gardé par flag) |

---

## 5. Validation & qualité

| Étape (procédure V1.4 §3) | Résultat |
|---|---|
| Backend `nest build` (J1–J2) | ✅ **PASS** (0 erreur — 3 erreurs TS trouvées puis corrigées : paramètre optionnel avant paramètre requis, signature `getJobCountByTypes('failed')` bullmq 5, helper `int()` de neo4j-driver) |
| Backend tests J1–J2 (6 suites / 25 tests) | ✅ **PASS 6/6 suites — 25/25** (274 s, `--runInBand`) — admin.controller 5/5, roles.guard 7/7, queue.integration 2/2 (SKIP Redis local, vert), app.controller 2/2, companies.service 4/4, company.entity 5/5 |
| Backend `nest build` (J3–J10, esModuleInterop) | ✅ **PASS** (0 erreur TS) |
| Backend tests J3–J10 (7 suites / 29 tests) | ✅ **PASS 7/7 suites — 29/29** (67 s `--runInBand` ; +billing.service 4/4) — 2 incidents Stripe résolus en session : résolution types v22 + interop CJS (`esModuleInterop`) |
| Backend tests (V1.5 Pricing) | ✅ **PASS — 30/30** (billing.service 6/6 dont mapping 4 niveaux par Price ID + grille quotas/prix) — `npm run build` 0 erreur, mobile `tsc --noEmit` ✅ |
| Blockchain `npx hardhat compile` | ✅ **PASS** (après retrait héritage OZ Ownable sur `MultiSigWallet`) |
| Blockchain tests (5) | ✅ **PASS 5/5** — ClearNetToken 1, CompensationEngine 1, MultiSigWallet 3 (refus sans 2 conf, exécution 2/3, backup 3e) |
| `npm run test:e2e` (Redis réel) | ⏳ À exécuter avec Redis/emulator provisionné (étape signature CI, non bloquante localement) |
| Helm `lint` + `template` prod | ⏳ Contre-preuve CI (`ci-validation.yml` job helm) — helm non installé sur le poste |
| Mobile Maestro E2E | ⏳ CI émulateur Android (flows écrits + CI livrés) |

Vérifications manuelles supplémentaires (serveur lancé, flags V1.4 activés) :
```bash
# 1. Admin DLQ (QUEUE_ENABLED=true, ADMIN_EMAILS=ops@x.fr)
curl -s -H "Authorization: Bearer $JWT" "http://localhost:3000/api/admin/queue/failed?page=1&limit=20"
curl -s -X POST -H "Authorization: Bearer $JWT" "http://localhost:3000/api/admin/queue/retry/<jobId>"
# 2. Métriques (METRICS_ENABLED=true)
curl -s http://localhost:3000/metrics | findstr bull_
# 3. Monitor multisig (MULTISIG_ENABLED=true, MULTISIG_ADDRESS=<adresse>, METRICS_ENABLED=true)
curl -s http://localhost:3000/metrics | findstr clearnet_multisig
# 4. Billing (BILLING_ENABLED=true, STRIPE_SECRET_KEY=…, STRIPE_WEBHOOK_SECRET=…)
curl -s -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d "{\"tier\":\"ESSENTIAL\"}" http://localhost:3000/api/billing/create-checkout
curl -s -H "Authorization: Bearer $JWT" http://localhost:3000/api/billing/status
# 5. Ledger 2FA (MULTISIG_ENABLED=true)
curl -s -X POST -H "Authorization: Bearer $JWT" -d "{\"txId\":\"<tx>\"}" http://localhost:3000/api/signatures/request
```

---

## 6. Rétrocompatibilité V1.3

| Principe | Garantie |
|---|---|
| Flags off par défaut | `ADMIN_EMAILS` vide → routes admin absentes ; `METRICS_ENABLED≠true` → aucun serveur `/metrics` ni série custom ; `MULTISIG_ENABLED≠true` et pas d'adresse → monitors/multisig inactifs (no-op au bootstrap) ; `BILLING_ENABLED≠true` → 503 (`assertEnabled`) ; `EARLY_ADOPTER_ENABLED≠true` → quota brut ; Helm : toutes les features off dans `values.yaml` de base |
| Contrats | `ClearNetToken.sol` **intouché** ; `CompensationEngine.sol` **1 modification additive** (`admin` mutable + `transferAdmin`, valeur initiale identique au déploiement) — soumis au diff/addenda du rapport V1.4, pas de breaking change ABI (ajout de `transferAdmin`/`AdminTransferred`, aucune fonction existante modifiée) |
| Payload JWT inchangé | Rôle dérivé d'`ADMIN_EMAILS`, aucun changement du flux `auth` |
| Pattern DI V1.3 conservé | `@Optional() @InjectQueue` (même sémantique que `TransactionsService`) |
| Comportement file | Sans `QUEUE_ENABLED`, `AdminService` répond 503 explicite (jamais de queue fictive) ; l'audit `FailedJob` reste disponible |
| Dépendances | `@willsoto/nestjs-prometheus`, `prom-client`, `@opentelemetry/api` (peer), `stripe` — toutes peer-compatibles Nest 10, aucun effet sans clé/flag |

---

## 7. Prochaines étapes

1. **Validation en environnement réel** : `test:e2e` (Redis), CI helm (`ci-validation.yml`), CI mobile (émulateur Android, flows Maestro), déploiement réel du multisig sur Sepolia (`scripts/deploy-multisig.ts` + `multisig-approve.*`) puis transfert effectif de l'ownership.
2. **V1.4.1 (reporting)** : `ReportingModule` + export PDF mobile (`ExportButton.tsx` — expo-print déjà disponible) ; jauges `clearnet_free_quota_used/max` (nécessaires à l'activation de l'alerte `FreeQuotaNearLimit` livrée J11–J13).
3. **Durcissement ops** : examen post-merge de la 2FA ledger (verrouillage par tentative, TTL), restauration des clés multisig (secours) si le socle part en prod.

---

## 8. V1.5 — Planification livrée

En continuité de V1.4, **six plans exécutables** ont été livrés (prêts à soumettre, tous **off par
défaut** — aucun impact sur V1.4 tant que les flags restent inactifs) :

| Livrable V1.5 | Périmètre | Flag |
|---|---|---|
| `I18N_CURRENCY_UPGRADE.md` | i18n 4 langues (backend + mobile, détection expo-localization), multi-devises EUR/USD/GBP/CHF (oracles Chainlink + statique), **convertisseur temps réel** (REST `/api/fx/*` + WebSocket `/fx`), écrans traduits (testIDs préservés → flows Maestro intacts) | `I18N_ENABLED` · `MULTI_CURRENCY_ENABLED` |
| `RECOMMANDATION_DEPLOIEMENT_L2.md` | Socle ZK sorti du mainnet : **Polygon zkEVM** (batch proofs, coût ≪ 0,01 $/tx) — corrections apportées (Arbitrum Orbit ≠ ZK, pas de « subvention » alt_bn128) | — (déploiement) |
| `CEREMONIE_TRUSTED_SETUP.md` | Cérémonie Phase 2 publique : Perpetual Powers of Tau + snarkjs web (SRI/air-gap), 8–12 contributeurs, un seul honnête suffit, destruction des déchets toxiques (Tails) | circuit `clearing.circom` (prérequis : gel) |
| `SYNC_ONCHAIN_NEO4J.md` | Indexation on-chain → Neo4j : finalité chaîne-dépendante (12 blocs ≠ universel), reorgs traitées en statuts (jamais de purge — piste d'audit), checkpoint atomique | `SYNC_ENABLED` |
| `RECONCILIATION_WORKER_INTEGRATION.md` | Worker BullMQ réconciliation (cron 5 min) : corrélation par hash (le dépôt n'émet ni `cycleId` ni `SettlementExecuted` réels — événement `Compensated`), statuts `PENDING/SUCCESS/REORG_ROLLBACK`, métriques | `RECONCILIATION_ENABLED` |
| `ZK_BATCH_INTEGRATION.md` | Circuit `ClearNetBatchNetting.circom` (Poseidon — math du netting corrigée), `VerifierBatch.sol`, `ZkBatchService` (collect → preuve → soumission, multisig-aware), `settleBatchWithProof` + `IZkBatchVerifier` (additif) | `ZK_BATCH_ENABLED` |

**Suite de tests cible V1.5** : 30 (V1.4) + 4 (reconciliation) + 4 (zkbatch) = **38 backend** ;
contrats 5/5 existants intacts + `VerifierBatch.sol` (tests 2+3+4) ; flows Maestro inchangés
(pas de testID modifié). Chaque flag est indépendant, réversible et provisionné via
`.env.example`/Helm.
**Revue croisée des plans** : `REVUE_V1_5_VIGILANCE.md` — 6 points de vigilance (keyring HKDF,
correctif circom, mapping batch×réconciliation, oracle multi-source médiane, benchmarks gas
10/20/50, gate de gel du circuit) + roadmap S1→S4 et matrice de traçabilité.