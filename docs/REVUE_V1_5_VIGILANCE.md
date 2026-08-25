# 🔍 REVUE V1.5 — POINTS DE VIGILANCE & PLAN D'EXÉCUTION INTÉGRÉ (S1–S4)

**Rôle** : Lead Architect Full‑Stack — revue croisée des 6 plans V1.5 (i18n/FX, L2, cérémonie, sync, reconciliation, ZK batch).
**Base** : `I18N_CURRENCY_UPGRADE.md`, `RECOMMANDATION_DEPLOIEMENT_L2.md`, `CEREMONIE_TRUSTED_SETUP.md`, `SYNC_ONCHAIN_NEO4J.md`, `RECONCILIATION_WORKER_INTEGRATION.md`, `ZK_BATCH_INTEGRATION.md` + dépôt réel (ZkProofService, CompensationEngine, blockchain.service).
**Objet** : acter les 6 points de vigilance (3.1–3.6), les **corriger précisément** (2 failles relevées), et gouverner l'exécution S1→S4 (gates, tests, Go/No‑Go).

---

## 0. VERDICT GLOBAL

| Point | Verdict | Correction apportée |
|---|---|---|
| 3.1 Keyring non finalisé | **Risque réel — et pire qu'annoncé** | « même dérivation que addressFromEmail » = **faute de sécurité** : cette dérivation est `keccak256(email)`, **publique** (calculable par n'importe qui) → secrets volables. Le keyring doit être dérivé d'un **master secret** (HKDF) §1.1 |
| 3.2 Ternaire invalide en circom | **Validé** | Correctif IsZero fourni en dur §1.2 + gate de compilation J1 |
| 3.3 Réconciliation × batch non testée | **Validé** — la solution existe déjà par conception | Le batch **émet un `Compensated` par paire** (loop `_settle`) : la réconciliation indexe par `transactionHash == onchainHash` du batch → mapping documenté §1.3 + test E2E |
| 3.4 Oracle de taux « non spécifié » | **En partie déjà couvert** (relecture du plan i18n) | Le plan spécifie déjà Chainlink + fallback statique + cache TTL. Le point juste : **agrégation multi‑source + médiane** → extension §1.4 |
| 3.5 Benchmarks gas absents | **Validé** | Matrice de benchmark explicite (10/20/50, batch vs individuel, multisig inclus) §1.5 |
| 3.6 Circuit non gelé avant cérémonie | **Validé** | La cérémonie exige le gel ; ajout : **gate de gel + versionnage** §1.6 |

---

## 1. FICHES POINTS DE VIGILANCE (CONSTAT → CORRECTION → ACTION)

### 1.1 (3.1) Keyring — « secret → commitment → adresse »

**Constat** : `ZkBatchService` (ZK_BATCH_INTEGRATION.md §4.2) expose `participants()/load()` en
placeholders ; le keyring est renvoyé à V1.6. Sans lui, aucun E2E batch réel possible.

**Correction de sécurité (bloquante)** : ne PAS réutiliser `addressFromEmail` (`keccak256(email)`)
pour les secrets — c'est un dérivé **public**. Design retenu :

```
secret_i  = HKDF-SHA256(ikm = ZK_BATCH_KEYRING_MASTER, salt = "clearnet-v1.5", info = "zk-secret:" + email)
commitment_i = Poseidon(secret_i)                       // engagement on-chain (public)
address_i  = keccak256(email)                           // EXISTANT, inchangé (adresse de règlement)
liant V1.6 : commitment_address_i = Poseidon(address_i, secret_i) — supprime la confiance admin §3.3
```

**Conséquences techniques** :
- `ZK_BATCH_KEYRING_MASTER` : **Secret Kubernetes** (jamais ConfigMap), rotation documentée
  (changement de master ⇒ nouveaux commitments ⇒ les anciens engagements deviennent invalides →
  prévoir une **migration de commitments** avant toute activation) ;
- Stockage : engagement calculé **à l'enregistrement** (`User.commitment`) OU à la volée
  (calcul déterministe, coût trivial) — retenu : **à l'enregistrement** (audit + révocabilité) ;
- Le keyring vit dans `src/keyring/` (module dédié, testé) ; `ZkBatchService` le consomme, plus
  aucun placeholder.

**Actions (S1)** : module keyring + `User.commitment` (Neo4j) + spec (dérivation identique entre
processus, test de stabilité inter‑appels) + `.env.example` `ZK_BATCH_KEYRING_MASTER=`.

### 1.2 (3.2) Circuit — ternaire invalide (bloquant compilation)

**Constat** : `txFrom[i] == p ? 1 : 0` n'est pas du circom ; la note du plan le signale, mais le
fichier livré doit être **compilable**.

**Correctif (code final à remplacer dans la boucle §2 du circuit)** :

```circom
// Sélecteurs : sel[p][i] == 1 ⟺ txFrom[i] == p
component sel[N_PARTICIPANTS][BATCH_SIZE];
signal dacc[N_PARTICIPANTS][BATCH_SIZE + 1];
for (var p = 0; p < N_PARTICIPANTS; p++) {
    dacc[p][0] <== 0;
    for (var i = 0; i < BATCH_SIZE; i++) {
        sel[p][i] = IsZero();
        sel[p][i].in <== txFrom[i] - p;          // 0 ⟺ égalité → sel.out = 1
        dacc[p][i + 1] <== dacc[p][i] + amounts[i] * (1 - sel[p][i].out);
    }
    debits[p] <== dacc[p][BATCH_SIZE];
}
```

**Gate S1‑J1 (non négociable)** : `npx circom ClearNetBatchNetting.circom --r1cs --wasm --O2`
doit passer **avant tout artefact** (ptau, zkey, VerifierBatch.sol).

### 1.3 (3.3) Réconciliation × batch — mapping des hashs

**Constat** : aucun E2E ne couvre `settleBatchWithProof` → réconciliation ; risque : statuts
`PENDING_BATCH` « orphelins ».

**Réponse par conception (déjà alignée avec le contrat) :**
- `settleBatchWithProof` boucle `_settle(from, to, amt)` → **un événement `Compensated` par paire**,
  tous portant le **même `transactionHash`** (celui du batch) ;
- `ZkBatchService.markSuccess` pose `onchainHash = <hash du batch>` sur chaque `Transaction` du lot ;
- `ReconciliationService` matche par `onchainHash = event.transactionHash` → **les N transactions
  passent `SUCCESS` ensemble** (ou `REORG_ROLLBACK` ensemble, au même bloc).

**Mapping documenté (à intégrer au README‑ZK‑BATCH)** :

```
batch txHash (settleBatchWithProof) ──► N × Compensated(from,to,amount) @ même txHash
                                        └──► N × Transaction.onchainHash = txHash → SUCCESS/REORG_ROLLBACK
```

**Action (S2)** : test E2E — soumettre un batch (Hardhat node), déclencher le cron réconciliation
(`RECONCILIATION_ENABLED=true`), asserter `SUCCESS` sur les N transactions + métrique
`clearnet_sync_events_processed_total += N`.

### 1.4 (3.4) Oracle de taux — agrégation multi‑source

**Constat relatif** : le plan i18n spécifie **déjà** le fournisseur (Chainlink), le fallback
statique et le cache TTL (`FX_CACHE_TTL_MS`). Le point juste = **point de défaillance unique** et
fallbacks statiques obsolètes.

**Extension retenue (J2 du plan i18n, garde `FX_AGGREGATOR_SOURCES`)** :
- Agrégateur : 3 sources (`FX_SOURCES=chainlink,coingecko,fixer`) → **médiane** sur les devises
  non‑CLRN (CLRN reste ancré par l'oracle Chainlink du plan) ;
- Cache : Redis partagé (`FX_REDIS_CACHE_TTL_MS`, défaut 60 s) — le cache mémoire reste le repli ;
- Dégradation : 2/3 sources OK → médiane ; 1/3 → dernière valeur cache (stale ≤
  `FX_MAX_STALE_MS`) ; 0 → `422 fx_rate_unavailable` (message i18n existant) ;
- **Jamais de fallback statique en prod au-delà de la période de rodage** (le statique reste
  dédié dev/CI).

### 1.5 (3.5) Benchmark gas — matrice obligatoire avant activation

**Constat** : aucun chiffre pour `settleBatchWithProof`. **Matrice à produire en S1** (avant toute
décision de mise en prod) :

| Scénario | Mesure | Comparaison |
|---|---|---|
| `settle` individuel ×N (N = 10/20/50) | gas cumulé | Référence V1.4 |
| `settleBatchWithProof` (B=10) | gas total + gas/tx | Gain = 1 − batch/individuel |
| B=20, B=50 | idem | Taille de lot rentable |
| Via `MultiSigWallet` (2/3) | gas de soumission (batch vs individuel) | Surcharge multisig |
| Vérification seule (`VerifierBatch.verifyProof` view) | gas (call) | Confirme ≪ 0,01 $/tx (zkEVM) |

Outil : `hardhat-gas-reporter` sur Sepolia/fork (plan L2 §5‑J1 déjà prévu) ; sortie : tableau
comparatif + **seuil de rentabilité** (`batchSize ≥ X ⟹ ZK_BATCH rentable`) à joindre au Go/No‑Go.

### 1.6 (3.6) Gel du circuit — gate avant cérémonie

**Règle actée** (complète CEREMONIE_TRUSTED_SETUP §3) :
- **Gate de gel** : checklist 5 points (spéc validée produit · compilation 1.2 OK · tests circuit
  2/2 · revue croisée 2 auditeurs · tag git `circuit-v1.0.0` + sha256) — **zéro cérémonie avant** ;
- **Versionnage** : tout changement post‑gel ⇒ `ClearNetBatchNetting_v2.circom` + **nouvelle
  cérémonie Phase 2** (coût maîtrisé, ~5 jours utiles, jamais de « bricolage » du zkey en place) ;
- Le gel porte sur le **r1cs** (le zkey Phase 2 lui est lié 1‑pour‑1).

---

## 2. ROADMAP INTÉGRÉE S1→S4 (porte les 6 points + i18n/FX + reconciliation)

| Semaine | Livrables | Points couverts | Gate de sortie |
|---|---|---|---|
| **S1 — Verrouillage & benchmarks** | 1.2 circuit corrigé + compilé (J1) · artefacts test (ptau local) · **1.1 keyring** (`src/keyring/` + `User.commitment` + master secret) · **1.5 benchmark gas** (matrice) · gel candidat du circuit | 3.1 · 3.2 · 3.5 · 3.6 | circuit compilable + benchmark < seuil + keyring 4 specs vertes |
| **S2 — Intégration & E2E** | ZkBatchService câblé keyring · `processBatch()` sur lot réel (Hardhat node) · **1.3 E2E réconciliation×batch** (statuts SUCCESS) · worker reconciliation + tests · plans i18n/FX : implémentation backend (module i18n + FX providers + cache Redis 1.4) | 3.1 · 3.3 · 3.4 | suite 38/38 backend + E2E réconciliation vert + `/api/fx/*` OK (staging) |
| **S3 — Cérémonie & testnet** | **Gel final + tag** (1.6) · cérémonie Phase 2 (contributeurs, attestations) · déploiement `VerifierBatch.sol` + `CompensationEngine` (Sepolia puis zkEVM testnet) · i18n : convertisseur mobile (écrans traduits, testIDs intacts) | 3.6 · cérémonie · i18n UI | attestations ≥ 8 contributeurs · contrats vérifiés (blockscout) · flows Maestro verts |
| **S4 — Mise en production** | `ZK_BATCH_ENABLED=true` + `QUEUE_ENABLED=true` (staging) · E2E 50 tx réelles · **gradual roll‑out 10 % → 100 %** (échantillon par `ZK_BATCH_ROLLOUT_RATE`) · activation i18n/FX par flags · alerting (métriques batch + réconciliation) | 3.5 (mesuré en réel) | Go/No‑Go signé : 38/38 + bench prod + rollback documenté |

**Principes d'exécution** : chaque flag reste **indépendant, réversible, off par défaut** ;
aucun point de la revue n'est « fermé » sans test associé dans la matrice §3.

---

## 3. MATRICE DE TRAÇABILITÉ (à compléter au fil de l'eau — source unique de suivi)

| Point | Fichier(s) porteur(s) | Action | Test de fermeture | Owner | Statut |
|---|---|---|---|---|---|
| 3.1 Keyring | `ZK_BATCH_INTEGRATION.md` §5 → `src/keyring/` | Module + master secret + `User.commitment` | 4 specs (dérivation stable, rotation, email ≠ secret, mapping batch) | Backend | ⬜ S1 |
| 3.2 Circuit | `ZK_BATCH_INTEGRATION.md` §2 | Correctif IsZero (1.2) | `circom --r1cs --wasm --O2` 0 erreur (J1) | ZK | ⬜ S1 |
| 3.3 Batch×Reconcil | `ZK_BATCH_INTEGRATION.md` §8 + `RECONCILIATION_WORKER_INTEGRATION.md` §7 | E2E batch → cron → SUCCESS | test E2E vert + mapping documenté README | Backend | ⬜ S2 |
| 3.4 Oracle multi‑source | `I18N_CURRENCY_UPGRADE.md` §2.2 | Agrégation médiane + Redis TTL | 422 si 0 source ; médiane si 2/3 ; stale borné | Backend | ⬜ S2 |
| 3.5 Benchmarks gas | `RECOMMANDATION_DEPLOIEMENT_L2.md` §5 (J1) | Matrice 10/20/50 + multisig | Tableau + seuil de rentabilité au Go/No‑Go | ZK/Blockchain | ⬜ S1 |
| 3.6 Gel du circuit | `CEREMONIE_TRUSTED_SETUP.md` §3 | Gate de gel + versionnage v2 | Checklist 5 points + tag `circuit-v1.0.0` | ZK/Produit | ⬜ S3 |

---

## 4. RISQUES RÉSIDUELS & PARI ASSUMÉ

- **Keyring = nouveau point de compromission** (un master volé révèle tous les secrets) → mitigations :
  HSM/Vault (env), rotation documentée, secrets dérivés **jamais loggés** (règle des logs existante),
  et la faille « secret = keccak256(email) » est évitée par le HKDF (§1.1) ;
- **Coût réel du batch** : si le benchmark (1.5) montre un gain < 15 % à B=10, le lot cible passe
  à 20/50 ou le batch ZK est reporté (le per‑tx `settleWithProof` reste le flux V1.4) — décision
  sans regret, prise en S1 ;
- **Cérémonie à recommencer** : le gate de gel (1.6) et le versionnage v2 limitent l'impact à un
  coût connu (~5 jours utiles) — jamais de dérive silencieuse du circuit.

---

**Conformité** : `ZK_BATCH_KEYRING_MASTER` et les clés d'oracle en Secret Kubernetes (jamais de
ConfigMap) ; aucune donnée cliente hors UE ; engagements publics uniquement (jamais de secrets
on‑chain) — aligné RGPD et règles du dépôt (off par défaut, réversibilité).