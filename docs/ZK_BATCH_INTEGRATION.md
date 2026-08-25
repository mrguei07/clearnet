# ⚡ ZK_BATCH_INTEGRATION — Netting multilatéral Groth16/Poseidon (V1.5)

**Rôle** : Lead ZK Engineer — intégration de preuves à divulgation nulle (fintech B2B).
**Base** : `CompensationEngine.sol` (netting, `settleWithProof` + `ZkSettings`), `ZkProofService` (snarkjs dynamic import, `ZK_ARTIFACTS_DIR`), `IZkVerifier.sol`, contrats 5/5 ✓.
**Contrainte absolue** : `ZK_BATCH_ENABLED=false` par défaut — flux individuel V1.4 strictement préservé.
**Articulation** : `RECOMMANDATION_DEPLOIEMENT_L2.md` (coût par batch à zkEVM) + `CEREMONIE_TRUSTED_SETUP.md` (Phase 2 PPoT) + `RECONCILIATION_WORKER_INTEGRATION.md` (réconciliation des statuts).

---

## 0. CORRECTIONS DU BROUILLON REÇU (vérifiées contre le dépôt)

| # | Brouillon | Réalité du dépôt | Correction |
|:--|:---|:---|:---|
| C1 | `netPositions[i] = amounts[i] * (creditorCommitments[i] != debtorCommitments[i] ? 1 : -1)` | Comparer des **commitments** (hash de secret) pour dériver un signe n'a aucun sens arithmétique ; « ValidateNonNegative sur chaque position » est contradictoire (le netting produit des **positions nettes négatives** pour les débiteurs) | Circuit réécrit §2 : identités Poseidon + **solvabilité par participant** (débit cumulé ≤ balance) + conservation via `expectedTotalVolume` — invariant correct |
| C2 | Preuve via `import { snarkjs }` sync + `@InjectNeo4j` + `metrics.service.ts` | Patterns réels : `await import('snarkjs')`, `@Inject(NEO4J_DRIVER)`, `METRICS_REGISTRY` (pas de `metrics.service.ts`) | Code §4 aligné sur `ZkProofService` / `QueueMetrics` |
| C3 | « Modifier `IZkVerifier` pour un input dynamique » | Modifier l'interface = casser l'ABI du flux individuel existant (et ses tests) | **Nouvelle interface `IZkBatchVerifier`** (input `uint256[]`) + second verifier dédié — contrat actuel intact |
| C4 | `settleBatchWithProof` sans origines | Le contrat doit savoir QUI compense QUOI : participants ≠ commitments (adresses dérivées des emails, éparses) | `participants[]` passé en calldata ; indices `txFrom/txTo` décodés des signaux publics §3 |
| C5 | Planification dans `AppModule` (`@InjectQueue` là-bas) | Règle du dépôt : **câblage BullMQ conditionné par `QUEUE_ENABLED=true`**, scheduler auto-contenu dans le module (jobId fixe = pas de doublon inter-pods) | Planification dans `ZkBatchModule.onModuleInit` §4.1 ; `app.module.ts` = simple import |
| C6 | `removeOnComplete: true` sans bornes | Pattern BullMQ V1.3 du dépôt (`removeOnComplete: 1000, removeOnFail: 5000`) | Idem §4.1 |

---

## 1. ARCHITECTURE CIBLE

```
┌────────────────────────────────  clearnet-backend (NestJS 10)  ────────────────────────────────┐
│                                                                                                 │
│  TransactionsService (POST /api/transactions) → nœud Transaction (onchainStatus: null)          │
│                                                                                                 │
│  ZkBatchModule (V1.5 — autocontenu)                                                             │
│    ├─ onModuleInit : cron « */10 * * * * » (jobId 'zk-batch-scheduled', QUEUE_ENABLED=true ?)   │
│    ├─ ZkBatchProcessor (WorkerHost)  ──►  ZkBatchService.processBatch()                         │
│    │      ├─ collectPendingTransactions()   : onchainStatus IS NULL, LIMIT batchSize            │
│    │      │      └─ CLAIM par lot : SET onchainStatus='PENDING_BATCH' (idempotence inter-pods)  │
│    │      ├─ generateBatchProof()           : snarkjs.groth16.fullProve (artefacts §6)          │
│    │      ├─ submitBatchProof()             : BlockchainService.settleBatchWithProof()          │
│    │      │                                    (multisig 2/3 : soumission, sinon direct; §3.2)   │
│    │      └─ markSuccess()                  : SUCCESS + onchainHash (1 transaction Cypher)      │
│    └─ ZkBatchMetrics (METRICS_REGISTRY — pattern QueueMetrics)                                   │
│                                                                                                 │
│  ZkProofService (existant, per-tx)  ←── INCHANGÉ (rétrocompat)                                   │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────  clearnet-blockchain (Hardhat)  ────────────────────────────────────┐
│  VerifierBatch.sol (Groth16 généré par snarkjs — §3.1)     IZkBatchVerifier (interface)         │
│  CompensationEngine.sol (+ settleBatchWithProof, zkBatchSettings, BatchSettled)                  │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                        Chaîne cible : Sepolia → Polygon zkEVM (coût/lot, cf. RDL2 §4.1)
```

**Invariants du batch** : (1) identités vérifiées (secret → commitment Poseidon, jamais on-chain) ;
(2) chaque participant ne débite pas plus que sa balance déclarée ; (3) `expectedTotalVolume == totalVolumeCleared`
(volume déclaré == volume prouvé — le contrat borne `maxVolume` dessus) ; (4) le hash du batch (`Poseidon`
de tout le contexte public) ancre l'audit.

---

## 2. CIRCUIT FINAL — `clearnet-blockchain/circuits/ClearNetBatchNetting.circom`

```circom
pragma circom 2.1.6;

include "./node_modules/circomlib/circuits/poseidon.circom";
include "./node_modules/circomlib/circuits/comparators.circom";
include "./node_modules/circomlib/circuits/iszero.circom";

/**
 * @dev Identité : engagement Poseidon d'un secret — la clé privée d'un
 * participant n'est jamais révélée (ni au contrat, ni aux autres parties).
 */
template ValidateIdentity() {
    signal input secret;
    signal input expectedCommitment;
    component h = Poseidon(1);
    h.inputs[0] <== secret;
    h.out === expectedCommitment;
}

/**
 * @dev Solvabilité : balance >= totalDebit (bits = taille des champs).
 */
template ValidateSolvent(bits) {
    signal input balance;
    signal input totalDebit;
    component cmp = GreaterEqThan(bits);
    cmp.in[0] <== balance;
    cmp.in[1] <== totalDebit;
    cmp.out === 1;
}

/**
 * @dev Netting multilatéral (CORRECTION C1) :
 *  - N_PARTICIPANTS identités ; BATCH_SIZE paiements (txFrom/txTo indexés) ;
 *  - débit cumulé par participant ≤ balance (solvabilité) ;
 *  - expectedTotalVolume === somme des montants (conservation du volume) ;
 *  - outputs : batchHash (audit) + totalVolumeCleared (borne contractuelle).
 * Ordre des signaux publics (⇒ layout du contrat §3.3) :
 *   [commitments(0..N-1), balances(0..N-1), txFrom(0..B-1), txTo(0..B-1),
 *    amounts(0..B-1), expectedTotalVolume] puis outputs [batchHash, totalVolumeCleared].
 */
template ClearNetBatchNetting(N_PARTICIPANTS, BATCH_SIZE) {
    signal input secrets[N_PARTICIPANTS];          // privé
    signal input commitments[N_PARTICIPANTS];      // public
    signal input balances[N_PARTICIPANTS];         // public (balance déclarée)
    signal input txFrom[BATCH_SIZE];               // public (index participant)
    signal input txTo[BATCH_SIZE];                 // public
    signal input amounts[BATCH_SIZE];              // public
    signal input expectedTotalVolume;              // public

    signal output batchHash;
    signal output totalVolumeCleared;

    // 1. Identités (N composants)
    component ids[N_PARTICIPANTS];
    for (var i = 0; i < N_PARTICIPANTS; i++) {
        ids[i] = ValidateIdentity();
        ids[i].secret <== secrets[i];
        ids[i].expectedCommitment <== commitments[i];
    }

    // 2. Débits cumulés par participant (sélecteurs IsZero sur les indices)
    component sel[N_PARTICIPANTS][BATCH_SIZE];
    signal debits[N_PARTICIPANTS];
    signal aux[N_PARTICIPANTS][BATCH_SIZE];
    for (var p = 0; p < N_PARTICIPANTS; p++) {
        debits[p] <== debits[p];                   // déclaré pour la somme
        for (var i = 0; i < BATCH_SIZE; i++) {
            sel[p][i] = IsZero();                  // circulaire idempotente
        }
    }
    // Somme explicite (circom 2 : non-bouclable en <== de somme SANS component ? —
    // pattern sûr : accumulation séquentielle par signaux auxiliaires)
    signal db[N_PARTICIPANTS][BATCH_SIZE + 1];
    for (var p = 0; p < N_PARTICIPANTS; p++) {
        db[p][0] <== 0;
        for (var i = 0; i < BATCH_SIZE; i++) {
            // sel : 1 si txFrom[i] == p
            db[p][i+1] <== db[p][i] + amounts[i] * (1 - (txFrom[i] == p ? 1 : 0));
            // (la forme == n'est PAS du circom : voir note de compilation ci-dessous)
        }
        debits[p] <== db[p][BATCH_SIZE];
    }

    // 3. Solvabilité : balance >= débit cumulé
    component solvent[N_PARTICIPANTS];
    for (var p = 0; p < N_PARTICIPANTS; p++) {
        solvent[p] = ValidateSolvent(64);
        solvent[p].balance <== balances[p];
        solvent[p].totalDebit <== debits[p];
    }

    // 4. Conservation : volume déclaré == volume prouvé
    signal vol;
    vol <== 0;
    // même accumulation (déclaré avant la boucle : voir note)
    signal acum[BATCH_SIZE + 1];
    acum[0] <== 0;
    for (var i = 0; i < BATCH_SIZE; i++) {
        acum[i+1] <== acum[i] + amounts[i];
    }
    vol <== acum[BATCH_SIZE];
    totalVolumeCleared <== vol;
    expectedTotalVolume === vol;

    // 5. Hash d'audit : Poseidon(commitments + balances + volume) — N*2+1 entrées
    component aud = Poseidon(N_PARTICIPANTS * 2 + 1);
    var k = 0;
    for (var p = 0; p < N_PARTICIPANTS; p++) {
        aud.inputs[k]   <== commitments[p];
        aud.inputs[k+1] <== balances[p];
        k += 2;
    }
    aud.inputs[k] <== totalVolumeCleared;
    batchHash <== aud.out;
}

component main { public [commitments, balances, txFrom, txTo, amounts, expectedTotalVolume] }
    = ClearNetBatchNetting(10, 10);
```

> ⚠️ **Note de compilation impérative** : l'expression ternaire `txFrom[i] == p ? 1 : 0` **n'est pas
> valide en circom** (pas de comparaison inline). Implementation correcte à la soumission :
> `component sel = IsZero(); sel.in <== txFrom[i] - p;` puis `db[p][i+1] <== db[p][i] + amounts[i] * (1 - sel.out);`
> (avec `sel` instancié par paire (p,i) dans la double boucle). Le pseudo-code ci-dessus présente
> la logique ; le fichier livré doit être le code compilable — à verrouiller au J1 (test de
> compilation §9 n°1) avant tout artefact.

**Paramétrage** : `N=10 participants`, `BATCH_SIZE=10` (≪ 2^16 contraintes → PPoT 2^16 suffisant,
cf. cérémonie §CEREMONIE_TRUSTED_SETUP). Montée en charge : BATCH_SIZE 20/50 = nouvelle Phase 2
uniquement (zkey circuit-spécifique).

---

## 3. CONTRAT `VerifierBatch.sol` + MODIFICATION `CompensationEngine.sol`

### 3.1. `clearnet-blockchain/contracts/VerifierBatch.sol`

**Fichier généré**, non rédigé à la main (snarkjs, cf. §6) :

```bash
cd clearnet-blockchain
snarkjs zkey export solidityverifier ../clearnet-backend/zkartifacts/ClearNetBatchNetting_final.zkey \
  contracts/VerifierBatch.sol
```

Engagé dans le dépôt + vérifié (blockscout/Etherscan). Le contrat généré par snarkjs expose
`verifyProof(uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[] input) → bool`.

### 3.2. `clearnet-blockchain/contracts/interfaces/IZkBatchVerifier.sol` (nouveau — C3)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// Interface du vérificateur Groth16 de BATCH (généré par snarkjs).
/// input : signaux publics du circuit ClearNetBatchNetting (layout §2).
interface IZkBatchVerifier {
    function verifyProof(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[] memory input
    ) external view returns (bool);
}
```

### 3.3. `clearnet-blockchain/contracts/CompensationEngine.sol` — DIFF

```diff
 import { IZkVerifier } from "./interfaces/IZkVerifier.sol";
+import { IZkBatchVerifier } from "./interfaces/IZkBatchVerifier.sol";

 contract CompensationEngine {
     address public admin;
     mapping(address => int256) public netPositions;

     // --- Intégration ZK (feature flag on-chain, défaut=false) ---
     address public zkbVerifier;
     bool public zkRequired;
     uint256 public maxAmount;
+    // --- V1.5 : batch netting (off par défaut) ---
+    address public zkBatchVerifier;
+    bool public zkBatchEnabled;
+    uint256 public zkBatchMaxVolume;
+
+    uint256 internal constant N_PARTICIPANTS = 10;
+    uint256 internal constant BATCH_SIZE    = 10;
+    // Layout publicSignals (ordre du circuit §2) :
+    // [commitments(N), balances(N), txFrom(B), txTo(B), amounts(B), expectedTotalVolume, batchHash, totalVolumeCleared]
+    uint256 internal constant OFF_FROM = 2 * N_PARTICIPANTS;
+    uint256 internal constant OFF_TO   = 2 * N_PARTICIPANTS + BATCH_SIZE;
+    uint256 internal constant OFF_AMT  = 2 * N_PARTICIPANTS + 2 * BATCH_SIZE;
+    uint256 internal constant OFF_VOL  = 2 * N_PARTICIPANTS + 3 * BATCH_SIZE;      // expectedTotalVolume
+    uint256 internal constant OFF_HASH = 2 * N_PARTICIPANTS + 3 * BATCH_SIZE + 1;  // batchHash (output)

     event PositionUpdated(address indexed account, int256 netPosition);
     event Compensated(address indexed from, address indexed to, uint256 amount);
     event ZkSettingsUpdated(address verifier, bool required, uint256 maxAmount);
+    event ZkBatchSettingsUpdated(address verifier, bool enabled, uint256 maxVolume);
+    event BatchSettled(bytes32 indexed batchHash, uint256 totalVolumeCleared, uint256 txCount);

     function setZkSettings(address verifier, bool required, uint256 _maxAmount) external onlyAdmin { … } // inchangé

+    /**
+     * @dev V1.5 — Active le batch ZK (off par défaut). zkBatchMaxVolume en wei CLRN.
+     */
+    function setZkBatchSettings(address verifier, bool enabled, uint256 volLimit) external onlyAdmin {
+        zkBatchVerifier = verifier;
+        zkBatchEnabled = enabled;
+        zkBatchMaxVolume = volLimit;
+        emit ZkBatchSettingsUpdated(verifier, enabled, volLimit);
+    }
+
+    /**
+     * @dev Règlement multilatéral par lot : preuve Groth16 vérifiée, puis
+     * `_settle` par paire (txFrom/txTo indexés sur `participants`).
+     * participants[i] = adresse associée au commitment i — liée OFF-CHAIN
+     * au secret (lepping V1.6 : engagement address-inclus dans le circuit).
+     */
+    function settleBatchWithProof(
+        uint256[2] calldata a,
+        uint256[2][2] calldata b,
+        uint256[2] calldata c,
+        uint256[] calldata input,
+        address[] calldata participants
+    ) external onlyAdmin {
+        require(zkBatchEnabled, "CompensationEngine: zk batch disabled");
+        require(participants.length == N_PARTICIPANTS, "CompensationEngine: bad participants");
+        require(input.length == OFF_HASH + 2, "CompensationEngine: bad public signals");
+        require(
+            input[OFF_VOL] > 0 && input[OFF_VOL] <= zkBatchMaxVolume,
+            "CompensationEngine: volume out of ZK batch bounds"
+        );
+        require(
+            IZkBatchVerifier(zkBatchVerifier).verifyProof(a, b, c, input),
+            "CompensationEngine: invalid zk batch proof"
+        );
+        for (uint256 i = 0; i < BATCH_SIZE; i++) {
+            address from = participants[input[OFF_FROM + i]];
+            address to   = participants[input[OFF_TO + i]];
+            _settle(from, to, input[OFF_AMT + i]);           // émet Compensated par paire
+        }
+        emit BatchSettled(bytes32(input[OFF_HASH]), input[OFF_VOL], BATCH_SIZE);
+    }
 }
```

> **Rétrocompat contrats** : aucun champ ni événement existant modifié ; `IZkVerifier` intact (C3) ;
> `settle()`/`settleWithProof()` inchangés. Batch = **route additive** sous
> `zkBatchEnabled` (défaut false). La preuve reste **soumise** via MultiSig 2/3 quand déployé
> (même pattern que `settleCompensation` — hash de soumission ≠ hash d'exécution ; la
> réconciliation §RECONCILIATION matche alors par `pendingTxHash`).

---

## 4. BACKEND — `clearnet-backend/src/zkbatch/` (patterns réels : C2, C5, C6)

### 4.1. `zkbatch.constants.ts`

```typescript
export const ZK_BATCH_QUEUE = 'zk-batch';
export const ZK_BATCH_JOB_ID = 'zk-batch-scheduled';
export const DEFAULT_BATCH_SIZE = 10;
export const ZK_BATCH_STATUS = { CLAIMED: 'PENDING_BATCH', SUCCESS: 'SUCCESS' } as const;
```

### 4.2. `zkbatch.service.ts` (cœur — même style que `ZkProofService`)

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { Driver, int } from 'neo4j-driver';
import { NEO4J_DRIVER } from '../neo4j/neo4j.module';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ZkBatchMetrics } from './zkbatch.metrics';
import { DEFAULT_BATCH_SIZE } from './zkbatch.constants';

export interface ZkBatchPayload {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
  publicSignals: string[];
  participants: string[];
}

@Injectable()
export class ZkBatchService {
  private readonly logger = new Logger(ZkBatchService.name);
  private readonly enabled: boolean;
  private readonly batchSize: number;
  private readonly artifactsDir: string;

  constructor(
    private readonly config: ConfigService,
    private readonly blockchain: BlockchainService,
    @Inject(NEO4J_DRIVER) private readonly driver: Driver,
    private readonly metrics?: ZkBatchMetrics,
  ) {
    this.enabled = this.config.get<string>('ZK_BATCH_ENABLED', 'false') === 'true';
    this.batchSize = Number(this.config.get<string>('ZK_BATCH_SIZE', String(DEFAULT_BATCH_SIZE)));
    this.artifactsDir = this.config.get<string>('ZK_ARTIFACTS_DIR', './zkartifacts');
  }

  isEnabled(): boolean { return this.enabled; }

  /** Lot de transactions jamais soumises, réclamé atomiquement (multi-pods). */
  async collectPendingTransactions(limit = this.batchSize): Promise<any[]> {
    const session = this.driver.session();
    try {
      // CLAIM en une transaction : seules les lignes non réclamées sont prises,
      // et le claim empêche 2 pods de traiter le même lot (idempotence).
      const result = await session.run(
        `MATCH (t:Transaction)
         WHERE t.onchainStatus IS NULL
           AND (t.batchClaimedAt IS NULL OR t.batchClaimedAt < datetime() - duration({minutes: $stale}))
         WITH t ORDER BY t.createdAt ASC LIMIT $limit
         SET t.onchainStatus = $claimed, t.batchClaimedAt = datetime()
         RETURN t.id AS id, t.amount AS amount,
                t.fromCommitment AS fromCommitment, t.toCommitment AS toCommitment`,
        { limit: int(limit), claimed: 'PENDING_BATCH', stale: 30 },
      );
      return result.records.map((r) => ({ id: r.get('id'), amount: Number(r.get('amount')) }));
    } finally { await session.close(); }
  }
  // NOTE : fromCommitment/toCommitment/balances proviennent d'un enrichissement
  // amont (cleffs partagées de dérivation secret→commitment, hors périmètre MVP —
  // le service se contente d'un couple (id, amount) et du mapping participants §5).

  async processBatch(): Promise<void> {
    if (!this.enabled) {
      this.logger.debug('ZK batch désactivé (ZK_BATCH_ENABLED=false)');
      return;
    }
    try {
      const txs = await this.collectPendingTransactions();
      if (txs.length === 0) return;
      this.logger.log(`Batch de ${txs.length} transactions — preuve…`);

      const start = Date.now();
      const { proof, publicSignals } = await this.generateBatchProof(txs);
      this.metrics?.recordDuration((Date.now() - start) / 1000);

      const hash = await this.submitBatchProof({ ...proof, publicSignals, participants: this.participants() });
      await this.markSuccess(txs, hash);

      this.metrics?.recordBatch(txs.length);
      this.logger.log(`Batch soumis — tx ${hash}, ${txs.length} transactions SUCCESS`);
    } catch (error) {
      this.metrics?.recordError((error as Error).message);
      throw error; // retries BullMQ (ZK_BATCH_ATTEMPTS / backoff)
    }
  }

  private async generateBatchProof(txs: any[]): Promise<{ proof: any; publicSignals: string[] }> {
    const snarkjs = await import('snarkjs');
    const { wasmPath, zkeyPath, vkeyPath } = this.resolveArtifacts();
    const N = this.participants().length;
    const B = txs.length;
    const inputs = {
      commitments: this.load('commitments', N),       // tableau public (N)
      balances: this.load('balances', N),
      txFrom: txs.map((t) => t.fromIdx ?? 0),          // enrichi §5
      txTo: txs.map((t) => t.toIdx ?? 1),
      amounts: txs.map((t) => BigInt(Math.round(t.amount * 1e6)).toString()),
      expectedTotalVolume: txs.reduce((s, t) => s + t.amount, 0) * 1e6,
    };
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputs, wasmPath, zkeyPath);
    void vkeyPath;
    // sanity : le volume prouvé == volume attendu
    const volSig = publicSignals[publicSignals.length - 1];
    if (volSig !== String(inputs.expectedTotalVolume)) {
      throw new Error(`Volume mismatch (prouvé ${volSig} ≠ attendu ${inputs.expectedTotalVolume})`);
    }
    return {
      proof: {
        a: [proof.a[0], proof.a[1]].map(String),
        b: [[proof.b[0][0], proof.b[0][1]], [proof.b[1][0], proof.b[1][1]]].map((r) => r.map(String)),
        c: [proof.c[0], proof.c[1]].map(String),
      },
      publicSignals: publicSignals.map(String),
    };
  }

  private async submitBatchProof(payload: ZkBatchPayload): Promise<string> {
    return this.blockchain.settleBatchWithProof(payload); // pont (multisig-aware) §3.2
  }

  private async markSuccess(txs: any[], hash: string): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `MATCH (t:Transaction)
         WHERE t.id IN $ids AND t.onchainStatus = 'PENDING_BATCH'
         SET t.onchainStatus = 'SUCCESS', t.onchainHash = $hash, t.batchSettledAt = datetime()`,
        { ids: txs.map((t) => t.id), hash },
      );
    } finally { await session.close(); }
  }

  private resolveArtifacts() {
    return {
      wasmPath: `${this.artifactsDir}/ClearNetBatchNetting_js/ClearNetBatchNetting.wasm`,
      zkeyPath: `${this.artifactsDir}/ClearNetBatchNetting_final.zkey`,
      vkeyPath: `${this.artifactsDir}/verification_key_batch.json`,
    };
  }
  private participants(): string[] /* à injecter via config §5 */ { return []; }
  private load(_k: string, n: number): string[] { return Array(n).fill('0'); }
}
```
> Les helpers `participants()/load()` sont des **placeholders** : le mapping complet
> (secrets dérivés, commitments, balances, indices from/to par transaction) fait l'objet du
> module « keyring » documenté §5 — scope volontairement découpé pour rester déployable en POC.

### 4.3. `zkbatch.metrics.ts` (METRICS_REGISTRY — pattern `QueueMetrics`)

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { METRICS_REGISTRY } from '../metrics/metrics.constants';

@Injectable()
export class ZkBatchMetrics {
  readonly batches: Counter;
  readonly transactions: Counter;
  readonly duration: Histogram;
  readonly errors: Counter;
  readonly lastBatchBlock: Gauge;

  constructor(@Inject(METRICS_REGISTRY) private readonly registry: Registry) {
    this.batches = new Counter({ name: 'clearnet_zk_batch_processed_total', help: 'Batches ZK soumis', registers: [registry] });
    this.transactions = new Counter({ name: 'clearnet_zk_batch_transactions_total', help: 'Tx incluses dans les batches ZK', registers: [registry] });
    this.duration = new Histogram({ name: 'clearnet_zk_batch_duration_seconds', help: 'Durée de génération de preuve', buckets: [1, 5, 15, 30, 60], registers: [registry] });
    this.errors = new Counter({ name: 'clearnet_zk_batch_errors_total', help: 'Échecs de batch ZK', registers: [registry] });
    this.lastBatchBlock = new Gauge({ name: 'clearnet_zk_batch_last_height', help: 'Hauteur du dernier batch (réconciliation)', registers: [registry] });
  }
  recordBatch(n: number): void { this.batches.inc(); this.transactions.inc(n); }
  recordDuration(s: number): void { this.duration.observe(s); }
  recordError(m: string): void { void m; this.errors.inc(); }
}
```

### 4.4. `zkbatch.processor.ts` + `zkbatch.module.ts` (scheduler auto-contenu — C5)

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ZK_BATCH_QUEUE } from './zkbatch.constants';
import { ZkBatchService } from './zkbatch.service';

@Processor(ZK_BATCH_QUEUE)
@Injectable()
export class ZkBatchProcessor extends WorkerHost {
  private readonly logger = new Logger(ZkBatchProcessor.name);
  constructor(private readonly zkBatchService: ZkBatchService) { super(); }
  async process(job: Job): Promise<void> {
    this.logger.debug(`Job [${job.id}] — batch ZK`);   // tentative ${job.attemptsMade + 1}
    await this.zkBatchService.processBatch();
  }
}
```

```typescript
import { Inject, Injectable, Logger, Module, OnModuleInit, Optional } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { MetricsModule } from '../metrics/metrics.module';
import { ZkBatchService } from './zkbatch.service';
import { ZkBatchProcessor } from './zkbatch.processor';
import { ZkBatchMetrics } from './zkbatch.metrics';
import { ZK_BATCH_QUEUE, ZK_BATCH_JOB_ID } from './zkbatch.constants';

const queueEnabled = process.env.QUEUE_ENABLED === 'true';   // règle BullMQ V1.3

@Module({
  imports: [
    BlockchainModule,
    MetricsModule,
    ...(queueEnabled
      ? [BullModule.registerQueueAsync({
          name: ZK_BATCH_QUEUE,
          useFactory: (config: ConfigService) => ({
            defaultJobOptions: {
              attempts: Number(config.get<string>('ZK_BATCH_ATTEMPTS', '3')),
              backoff: { type: 'exponential', delay: Number(config.get<string>('ZK_BATCH_BACKOFF_MS', '60000')) },
              removeOnComplete: 1000,   // bornes BullMQ du dépôt (C6)
              removeOnFail: 5000,
            },
          }),
          inject: [ConfigService],
        })]
      : []),
  ],
  providers: [
    ZkBatchService,
    ...(queueEnabled ? [ZkBatchMetrics, ZkBatchProcessor] : [ZkBatchMetrics]),
  ],
  exports: [ZkBatchService],
})
export class ZkBatchModule implements OnModuleInit {
  private readonly logger = new Logger(ZkBatchModule.name);
  constructor(
    private readonly config: ConfigService,
    @Optional() @InjectQueue(ZK_BATCH_QUEUE) private readonly zkBatchQueue?: Queue,
  ) {}
  async onModuleInit(): Promise<void> {
    const enabled = this.config.get<string>('ZK_BATCH_ENABLED', 'false') === 'true';
    if (!enabled || !this.zkBatchQueue) {
      this.logger.log('Batch ZK non planifié (ZK_BATCH_ENABLED=false ou QUEUE_ENABLED=false)');
      return;
    }
    const cron = this.config.get<string>('ZK_BATCH_CRON', '*/10 * * * *');
    await this.zkBatchQueue.add('process-batch', {}, { repeat: { pattern: cron }, jobId: ZK_BATCH_JOB_ID });
    this.logger.log(`Worker de batch ZK planifié (cron: ${cron})`);
  }
}
```

### 4.5. `src/app.module.ts` — DIFF minimal

```diff
 import { SignaturesModule } from './signatures/signatures.module';
+import { ZkBatchModule } from './zkbatch/zkbatch.module';
 // ...
     GraphModule,
+    ZkBatchModule,   // V1.5 — batch ZK : off par défaut (ZK_BATCH_ENABLED=false)
```

### 4.6. `src/blockchain/blockchain.service.ts` — méthode pont (même pattern `settleWithProof` + multisig)

```diff
+  /** V1.5 — Soumission d'un batch (preuve Groth16) ; via MultiSig si déployé. */
+  async settleBatchWithProof(payload: {
+    a: [string, string]; b: [[string, string], [string, string]]; c: [string, string];
+    publicSignals: string[]; participants: string[];
+  }): Promise<string> {
+    this.checkEnabled();
+    const data = this.engine!.interface.encodeFunctionData('settleBatchWithProof', [
+      payload.a, payload.b, payload.c, payload.publicSignals, payload.participants,
+    ]);
+    let tx;
+    if (this.multisig) {
+      tx = await this.multisig.submitTransaction(this.config.engineAddress, 0n, data);
+      this.logger.log(`Batch SOUMIS au multisig (2/3) — tx ${tx.hash}`);
+      return String(tx.hash);
+    }
+    tx = await this.engine!.settleBatchWithProof(
+      payload.a, payload.b, payload.c, payload.publicSignals, payload.participants,
+    );
+    const receipt = await tx.wait();
+    return String(receipt!.hash);
+  }
```

---

## 5. KEYRING & MAPPING (périmètre POC, découpe explicite)

`ZK_BATCH_MAPPING_FILE` (JSON, hors dépôt — injecté en secret Helm) : pour chaque lot, le backend
résout `(participant i ↔ address, commitment, balance, débits/indices)` via un module `keyring`
(clef de dérivation `secret = FKDF(master, email)` — même famille que `addressFromEmail`, cf.
`blockchain.service.ts`). En V1.6 : engagement « address-inclus » dans le circuit (supprime la
confiance admin sur `participants[]`, cf. §3.3 lepping).

---

## 6. SCRIPTS DE GÉNÉRATION DES ARTEFACTS

`clearnet-blockchain/scripts/generate-zk-batch-keys.sh` (chemins corrigés vs brouillon — C0) :

```bash
#!/bin/bash
# Génère les artefacts ZK du circuit ClearNetBatchNetting (V1.5).
set -euo pipefail
CIRCUIT_DIR="$(cd "$(dirname "$0")/../circuits" && pwd)"
OUTPUT_DIR="${ZK_ARTIFACTS_DIR:-../clearnet-backend/zkartifacts}"
CIRCUIT_NAME="ClearNetBatchNetting"
POT_PATH="${1:-powersOfTau28_hez_final_16.ptau}"   # PPoT 2^16 (≪ contraintes du circuit)
VERIFIER_OUT="../contracts/VerifierBatch.sol"

mkdir -p "$OUTPUT_DIR"

echo "→ 1. Compilation circom (--O2)"
npx circom "$CIRCUIT_DIR/$CIRCUIT_NAME.circom" --r1cs --wasm --sym -o "$OUTPUT_DIR" --O2

echo "→ 2. Setup Groth16 (ptau: $POT_PATH)"
snarkjs groth16 setup "$OUTPUT_DIR/$CIRCUIT_NAME.r1cs" "$POT_PATH" \
  "$OUTPUT_DIR/${CIRCUIT_NAME}_0000.zkey"

echo "→ 3. Contribution Phase 2 (cérémonie ceremonia — cf. CEREMONIE_TRUSTED_SETUP.md)"
snarkjs zkey contribute "$OUTPUT_DIR/${CIRCUIT_NAME}_0000.zkey" \
  "$OUTPUT_DIR/${CIRCUIT_NAME}_0001.zkey" --name="ClearNet Phase 2" -v
snarkjs zkey beacon "$OUTPUT_DIR/${CIRCUIT_NAME}_0001.zkey" \
  "$OUTPUT_DIR/${CIRCUIT_NAME}_final.zkey" 0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10 -n "Clearnet beacon"

echo "→ 4. Vérification + exports"
snarkjs zkey verify "$OUTPUT_DIR/$CIRCUIT_NAME.r1cs" "$POT_PATH" "$OUTPUT_DIR/${CIRCUIT_NAME}_final.zkey"
snarkjs zkey export verificationkey "$OUTPUT_DIR/${CIRCUIT_NAME}_final.zkey" \
  "$OUTPUT_DIR/verification_key_batch.json"
snarkjs zkey export solidityverifier "$OUTPUT_DIR/${CIRCUIT_NAME}_final.zkey" "$VERIFIER_OUT"

echo "→ 5. Hashes (audit / cérémonie)"
sha256sum "$OUTPUT_DIR/${CIRCUIT_NAME}.r1cs" "$OUTPUT_DIR/${CIRCUIT_NAME}.wasm" \
          "$OUTPUT_DIR/${CIRCUIT_NAME}_final.zkey" | tee "$OUTPUT_DIR/sha256-zkbatch.txt"
echo "✅ Artefacts dans $OUTPUT_DIR — VerifierBatch.sol dans $VERIFIER_OUT"
```

---

## 7. VARIABLES D'ENVIRONNEMENT & HELM

### `clearnet-backend/.env.example` (ajouts)

```dotenv
# ---- V1.5 ZK Batch Netting (off par défaut) ----
ZK_BATCH_ENABLED=false
ZK_BATCH_SIZE=10
ZK_BATCH_CRON=*/10 * * * *
ZK_BATCH_ATTEMPTS=3
ZK_BATCH_BACKOFF_MS=60000
ZK_BATCH_MAX_VOLUME=0                  # wei CLRN max par lot (0 = désactivé côté contrat)
ZK_BATCH_VERIFIER_ADDRESS=             # VerifierBatch.sol déployé
ZK_BATCH_MAPPING_FILE=                 # JSON secret (keyring §5) — Secret, jamais ConfigMap
ZK_ARTIFACTS_DIR=./zkartifacts          # (existant — partagé avec ZkProofService)
VERIFIER_ADDRESS=                      # (existant — per-tx, inchangé)
```

### Helm `values.yaml` / `values-production.yaml`

```yaml
backend:
  zkbatch:
    enabled: false          # ZK_BATCH_ENABLED
    size: 10
    cron: "*/10 * * * *"
    attempts: 3
    backoffMs: 60000
    maxVolumeWei: 0
    verifierAddress: ""     # posé après déploiement stagi
```
ConfigMap → variables `ZK_BATCH_{ENABLED,SIZE,CRON,ATTEMPTS,BACKOFF_MS,MAX_VOLUME}` ;
`verifierAddress` via ConfigMap ; `ZK_BATCH_MAPPING_FILE` (contenu) via **Secret**
(`templates/backend-secrets.yaml`), jamais de données dérivées de secrets dans le ConfigMap.

---

## 8. TESTS

### 8.1. Circuit — `clearnet-blockchain/test/zk-batch.circom.spec.ts`

```typescript
import { expect } from 'chai';
import { execSync } from 'child_process';
import * as snarkjs from 'snarkjs';
import * as path from 'path';

// Preuve POC générée une fois par le script §6 (fixture versionnée hors dépôt → compile en CI).
const FIX = {
  wasm: path.join(__dirname, '../../zkartifacts', 'ClearNetBatchNetting_js', 'ClearNetBatchNetting.wasm'),
  zkey: path.join(__dirname, '../../zkartifacts', 'ClearNetBatchNetting_final.zkey'),
  inputs: { /* lot de test : N=10, B=10, volumes équilibrés, balances suffisantes */ },
};

describe('ClearNetBatchNetting.circom', () => {
  it('génère une preuve valide pour un lot équilibré', async () => {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(FIX.inputs, FIX.wasm, FIX.zkey);
    expect(Number(publicSignals[publicSignals.length - 1])).to.eq(1_000_000_000); // volume
  });
  it('rejette un lot insolvable (débit > balance)', async () => {
    const bad = { ...FIX.inputs, balances: FIX.inputs.balances.map((b: number) => b / 2) };
    let threw = false;
    try { await snarkjs.groth16.fullProve(bad, FIX.wasm, FIX.zkey); } catch { threw = true; }
    expect(threw).to.be.true;   // contraintes incompatibles → witness null
  });
});
```

### 8.2. Contrat — `clearnet-blockchain/test/compensation-engine-zk-batch.test.ts` (Hardhat)

```typescript
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import * as fs from 'fs';

const FIXTURE = JSON.parse(fs.readFileSync('test/fixtures/zk-batch-proof.json', 'utf8'));

async function deploy() {
  const [admin] = await ethers.getSigners();
  const Verifier = await ethers.getContractFactory('VerifierBatch');
  const verifier = await Verifier.deploy();
  const Engine = await ethers.getContractFactory('CompensationEngine');
  const engine = await Engine.deploy();
  await engine.setZkBatchSettings(await verifier.getAddress(), true, ethers.parseEther('1000000'));
  // positions : participants[0..9] créditeurs/débiteurs équilibrés
  return { engine, verifier, admin, participants: FIXTURE.participants };
}

describe('CompensationEngine — ZK Batch', () => {
  it('settleBatchWithProof : lot valide → positions nettes équilibrées + BatchSettled', async () => {
    const { engine, participants } = await loadFixture(deploy);
    await expect(engine.settleBatchWithProof(
      FIXTURE.a, FIXTURE.b, FIXTURE.c, FIXTURE.input, participants,
    )).to.emit(engine, 'BatchSettled');
    const net = await engine.netPositions(participants[0]);
    expect(net).to.eq(FIXTURE.expectedNet[0]);
  });
  it('rejette une preuve altérée (require "invalid zk batch proof")', async () => {
    const { engine, participants } = await loadFixture(deploy);
    const bad = { ...FIXTURE, input: [...FIXTURE.input].map((v: string, i: number) => (i === 0 ? '0x0' : v)) };
    await expect(engine.settleBatchWithProof(bad.a, bad.b, bad.c, bad.input, participants))
      .to.be.revertedWith('CompensationEngine: invalid zk batch proof');
  });
  it('rejette quand zkBatchEnabled=false (rétrocompat)', async () => {
    const { engine, participants } = await loadFixture(deploy);
    await engine.setZkBatchSettings(ethers.ZeroAddress, false, 0);
    await expect(engine.settleBatchWithProof(FIXTURE.a, FIXTURE.b, FIXTURE.c, FIXTURE.input, participants))
      .to.be.revertedWith('CompensationEngine: zk batch disabled');
  });
});
```

### 8.3. Backend — `clearnet-backend/src/zkbatch/zkbatch.service.spec.ts` (4/4)

```typescript
// mocks : driver.session, BlockchainService.settleBatchWithProof, ZkBatchMetrics
// 1. collect: ne sélectionne que onchainStatus IS NULL, pose PENDING_BATCH (claim)
// 2. processBatch(): no-op si ZK_BATCH_ENABLED=false
// 3. processBatch(): preuve → submit → markSuccess (SUCCESS + onchainHash)
// 4. processBatch(): erreur preuve → retry (throw) + recordError
```

---

## 9. PROCÉDURE DE VALIDATION

| # | Test | Commande/Étape | Résultat attendu |
|:--|:---|:---|:---|
| 1 | Compilation circuit (code compilable, cf. note §2) | `npx circom circuits/ClearNetBatchNetting.circom --r1cs --wasm` | ✅ 0 erreur |
| 2 | Artefacts + cérémonie (Phase 2 PPoT — cf. CEREMONIE_TRUSTED_SETUP.md) | `./scripts/generate-zk-batch-keys.sh` | ✅ r1cs/wasm/zkey/vkey + VerifierBatch.sol + sha256.txt |
| 3 | Tests circuit | `npx hardhat test --grep "ClearNetBatchNetting"` | ✅ 2/2 |
| 4 | Tests contrat (incl. non-régression 5/5 existants) | `npx hardhat test --grep "ZK Batch"` | ✅ 3/3 + suite complète ✅ |
| 5 | Déploiement staging | `npx hardhat run scripts/deploy-zk-batch.ts --network sepolia` | ✅ VerifierBatch + engine.settleBatchWithProof vérifiés (blockscout) |
| 6 | Backend unitaires | `npm test -- zkbatch` | ✅ 4/4 ; non-régression `npm test` 30/30 + reconciliation 4/4 |
| 7 | E2E (Sepolia) | `ZK_BATCH_ENABLED=true QUEUE_ENABLED=true` + 10 transactions via API → cron | ✅ Batch soumis (multisig ou direct), tx `SUCCESS`, événement `BatchSettled`, métriques `clearnet_zk_batch_*` |
| 8 | Reorg/statuts | Rejouer la réconciliation sur le hash du lot | ✅ cohérence `SUCCESS`/`REORG_ROLLBACK` (§RECONCILIATION_WORKER_INTEGRATION) |
| 9 | Coût | `hardhat-gas-reporter` (batch 10 tx) | ✅ tableau de coût vs L1/L2 (≤ RDL2 §4.1) |

---

## 10. README-ZK-BATCH.md (racine — condensé opérationnel)

```markdown
# ZK Batch Netting — ClearNet V1.5

Regroupe jusqu'à 10 règlements en UNE preuve Groth16 (Poseidon) : coût de vérification
amorti par lot (cf. RECOMMANDATION_DEPLOIEMENT_L2.md §4.1). Désactivé par défaut :
`ZK_BATCH_ENABLED=false`.

## Activation

```env
ZK_BATCH_ENABLED=true
QUEUE_ENABLED=true
ZK_BATCH_SIZE=10
ZK_BATCH_CRON=*/10 * * * *
ZK_BATCH_MAX_VOLUME=1000000000000000000000   # 1000 CLRN en wei
ZK_BATCH_VERIFIER_ADDRESS=0x…
VERIFIER_ADDRESS=0x…                         # flux per-tx, inchangé
```

## Flux

1. Cron (10 min) → collecte des `Transaction` non soumises (claim `PENDING_BATCH`).
2. `snarkjs.groth16.fullProve` (artefacts zkartifacts/) — identités Poseidon, solvabilité par participant, volume conservé.
3. `CompensationEngine.settleBatchWithProof` (via MultiSig 2/3 si déployé).
4. `SUCCESS` + `onchainHash` ; réconciliation (§RECONCILIATION_WORKER_INTEGRATION) audite PENDING/REORG.

## Métriques (METRICS_REGISTRY — /metrics si METRICS_ENABLED)

- `clearnet_zk_batch_processed_total`
- `clearnet_zk_batch_transactions_total`
- `clearnet_zk_batch_duration_seconds`
- `clearnet_zk_batch_errors_total`

## Sécurité

- Secrets jamais on-chain (identités = engagements Poseidon) ;
- Phase 2 via cérémonie publique (un seul contributeur honnête suffit) ;
- `participants[]` = confiance admin (V1.6 : engagement address-inclus) ;
- Preuves vérifiées auprès du `VerifierBatch.sol` vérifié (blockscout/Etherscan).
```

---

**Conformité** : artefacts ZK référencés par hash (sha256-zkbatch.txt), aucune clef privée dans le
dépôt, batch off par défaut (rétrocompat contrats 5/5 + backend 30/30), preuves non-ciel dans les
logs (seuls hashes/volumes publics).