# 🔄 SYNC ON‑CHAIN ➡️ NEO4J — INDEXATION DES CYCLES DE COMPENSATION

**Rôle** : Lead Architect Full‑Stack — script d'indexation `CompensationEngine` (Polygon zkEVM + Sepolia staging) → graphe Neo4j.
**Base** : `CompensationEngine.sol`, `MultiSigWallet.sol` (5/5 contrats ✓), ledger Neo4j, plan L2 (RECOMMANDATION_DEPLOIEMENT_L2.md §4).
**Statut** : architecture + procédure — prête à implémenter dès le gel du contrat de test « Sepolia ».

---

## 1. VERDICT EXÉCUTIF

**La structure proposée est saine (WS + checkpoint + MERGE) ; le mécanisme phare (« fenêtre de
triage 12 blocs ») est retenu comme base, avec 4 corrections obligatoires** : finalité
**chaîne‑dépendante** (et non 12 blocs universels), **WebSocket = signal uniquement** (la vérité
vient d'un appel RPC), **pas de purge destructive** (la piste d'audit l'interdit → statut soft),
et **checkpoint atomique** (même transaction Cypher que les données, avec `blockHash`).

Périmètre cible : le script indexe les **cycles de compensation** (nœuds `CompensationCycle`)
— pas chaque paiement B2B (ceux‑ci restent hors‑chaîne, ledger Neo4j existant inchangé).

---

## 2. CORRECTIONS CRITIQUES DU MESSAGE REÇU

| Affirmation reçue | Correction | Conséquence |
|:---|:---|:---|
| « Fenêtre de 12 blocs » (universelle) | **Faux sur L2.** La finalité dépend de la chaîne : Sepolia/Ethereum → profondeur de réorg (12 blocs ≈ 2,4 min OK pour du test ; en prod prévoir 32+ ou confirme par `safe`/`finalized` du nœud). **Polygon zkEVM** : la vraie finalité = inclusion du batch sur Ethereum L1, pas 12 blocs à 2 s. | `CONFIRMATIONS` **configurable et chaîne‑dépendante** (tableau §5) ; 12 = défaut Sepolia seulement. |
| « WebSockets : écoute continue » | **Un flux WS seul est mortel** (perte de frames = trous silencieux). Pattern correct : WS = **signal de tête** (« un bloc est arrivé ») ; le payload de vérité est **re‑récupéré via RPC REST** (`eth_getBlockByNumber` + `eth_getLogs`), avec **gap‑fill** périodique (reprise depuis `lastProcessedBlock`). | Architecture §3 : WS never sole source. |
| « Le script purge les nœuds PENDING obsolètes » | **Interdit tel quel.** « Purger » = supprimer des traces = **casser la piste d'audit**. Le reorg se traite par transition d'état `PENDING → REORGED` (tombstone horodaté), et la suppression physique n'est autorisée que si le nœud n'a **jamais été référencé** (0 relation entrante/sortante). | Machine à états §4 ; vérification `MERGE` + contrainte de référentiel. |
| Checkpoint `lastProcessedBlock` dans Neo4j **ou** Redis | **Les deux, mais la source de vérité est Neo4j.** Écriture du checkpoint **atomiquement avec le lot de données** (une seule transaction Cypher) — un crash ne peut pas laisser data/checkpoint désynchronisés. Redis = cache de lecture (lag, statuts) uniquement. | §5 atomicité + reprise. |
| Idempotence MERGE + contraintes unicité | **Correct** — et à formaliser : contrainte UNIQUE sur la **clé naturelle** `(chain, eventName, cycleId)` + clé `(chain, txHash, logIndex)` sur l'événement. | §4.1 (MERGE ON CREATE/MATCH, double‑rejeu sûr). |

---

## 3. ARCHITECTURE DE L'INDEXEUR (Node.js/TS — nouveau module `clearnet-backend/src/sync/`)

```
┌──────────────┐    WS (signal)     ┌─────────────────────────────┐
│  RPC L2/L1   │◄━━━━━━━━━┓        │  Indexeur (Worker Node)      │
│  (zkEVM/Sep) │━━━━━━━━━┿► REST ──►│  polls.eth.head (config)     │
└──────────────┘        └─ Topic0   │  ├─ fetch block + logs (REST)│
                                   │  ├─ enrich (parse, ABI vX)    │
                                   │  ├─ apply reorgPolicy (§5.2)  │
                                   │  └─ batch Cypher (1 tx)       │
                                   └──────────────┬────────────────┘
                                        ┌─────────▼─────────┐
                                        │  Neo4j (ledger)   │  ←-- checkpoint ATOMÉ
                                        │  CompensationCycle│
                                        └───────────────────┘
   Observabilité : lag, DLQ (file morte), alerte Slack ≥ 80 % patterns existants
```

**Flux de traitement d'un cycle (batch par bloc)** :

1. WS reçoit `settlementVerified(bytes32 indexed cycleId, uint256 totalCleared)` → **signal**.
2. REST : `eth_getLogs` sur `[fromBlock, toBlock]` (fenêtre traitée) → événements canoniques
   (topic0, `decodedArgs`, `blockHash`, `txHash`, `logIndex`).
3. Reorg check : `reorgPolicy()` (§5.2) — si `parentHash` du nouveau bloc ≠ `lastBlockHash`
   stocké → repli du checkpoint au fork.
4. Une transaction Cypher unique : upsert cycle + checkpoint + (éventuels tombstone REORGED).

### 3.1. Machine à états d'un `CompensationCycle`

```
Event vu (WS+REST) ──► status = PENDING        (blockCreated, firstSeenAt)
   │
   ├── (head − blockCreated ≥ CONFIRMATIONS) ──► status = SETTLED  (settledAt, txHash)
   ├── (bloc sorti de la chaîne canonique) ────► status = REORGED   (reorgedAt, hashObserved)
   └── (latence > ALERT_AFTER_MS sans settle) ─► alerte ops (jamais d'auto‑purge)
```

---

## 4. SPÉCIFICATION NEO4J (Cypher)

### 4.1. Contraintes & modèle de données

```cypher
// Clé naturelle d'un cycle : UNIQUE sur composée (consistency checker en test aussi)
CREATE CONSTRAINT compensation_cycle_unique IF NOT EXISTS
  FOR (c:CompensationCycle) REQUIRE (c.chain, c.cycleId) IS UNIQUE;
CREATE CONSTRAINT sync_event_unique IF NOT EXISTS
  FOR (e:SyncEvent) REQUIRE (e.chain, e.txHash, e.logIndex) IS UNIQUE;

// Nœud cycle (MERGE idempotent — un bloc rejoué = aucun doublon)
MERGE (c:CompensationCycle { chain: $chain, cycleId: $cycleId })
SET    c.totalCleared   = $totalCleared,
       c.blockNumber    = $blockNumber,
       c.blockHash      = $blockHash,
       c.txHash         = $txHash,
       c.status         = 'PENDING',        // ← jamais 'SETTLED' à l'insertion
       c.firstSeenAt    = datetime($firstSeenAt)
```

### 4.2. Passage PENDING → SETTLED (après CONFIRMATIONS blocs)

```cypher
MATCH (c:CompensationCycle { chain: $chain, cycleId: $cycleId })
WHERE c.status = 'PENDING'
  AND $headBlock - c.blockNumber >= $confirmations
SET c.status = 'SETTLED', c.settledAt = datetime(), c.settledAtBlock = $headBlock
// + relation vers les transactions compensées (MERGE, jamais CREATE → idempotent)
MERGE (t:Transaction { id: $txId }) MERGE (t)-[:SETTLED_BY]->(c)
```

### 4.3. Reorg — tombstone (pas de purge)

```cypher
// Bloc B retiré de la chaîne : les cycles PENDING portés par B passent REORGED
MATCH (c:CompensationCycle { chain: $chain })
WHERE c.status = 'PENDING' AND c.blockNumber >= $forkBlock
SET  c.status = 'REORGED', c.reorgedAt = datetime(), c.reorgedAtBlock = $forkBlock
// Purge physique UNIQUEMENT si jamais référencés (sinon la piste d'audit interdit la suppression)
MATCH (c:CompensationCycle { status: 'SETTLED' }) WITH c
OPTIONAL MATCH ()-[r]->(c) WHERE r IS NULL AND c.blockNumber >= $forkBlock
DETACH DELETE c   // garde-fou : requête de vérification exécutée en dry‑run d'abord, en staging
```
> La suppression n'est jamais automatique en prod : elle passe par un job explicite,
> exécuté après vérification en staging, et journalisé (audit des suppressions).

---

## 5. CHECKPOINTING, REPRISE & REORG POLICY

### 5.1. Checkpoint atomique (une seule transaction Cypher)

```
Nœud de métadonnées : (:SyncCheckpoint { chain, lastProcessedBlock, lastBlockHash,
                        updatedAt })
— écrit DANS LA MÊME transaction que le lot de données (Cypher multi‑statement) ;
— après crash : redémarrage → rejouer depuis (lastProcessedBlock + 1) — les MERGE rendent le
  rejeton sûr ; Redis (cache) n'est utilisé que pour exposer le lag.
```

### 5.2. `reorgPolicy()` — détection & profondeur

| Chaîne cible | `CONFIRMATIONS` défaut | Rationale |
|:---|:---|:---|
| Sepolia (staging) | 12 | Réorgs testnet quasi nuls ; la fenêtre sécurise l'intégration |
| Ethereum Mainnet | 32 à 100 (selon montants) | Réorgs rares mais profondes ; 12 blocs insuffisant pour gros règlements |
| Polygon zkEVM (prod cible) | `batch finality` : attendre l'inclusion du batch sur L1 (poll `validateContinuity`/état bridge) ; sinon ≥ 256 blocs défensif | La sécurité vient de la finalité L1, pas d'un compte de blocs arbitraire |

Règle implémentée : `confirmations = max(default_chain, configured)` + **contrôle `safe`
(L2) préféré** quand le nœud l'expose (`eth_syncing` / état `safe` des nœuds Geth récents).

### 5.3. Reprise après incident

- `kill -9` pendant un lot → reprise au checkpoint (idempotence MERGE) ;
- perte prolongée de RPC → file morte (`SYNC_DEAD_LETTER=…`) + gap‑fill ;
- reorg > fenêtre traitée (rare) : politique d'exception — re‑synchro globale
  (`eth_getLogs` du bloc de déploiement, vue `GENESIS_SYNC=true`) ;
- aucun événement jamais « deviné » : `SyncEvent` journalise chaque (txHash, logIndex) avec son état.

---

## 6. OPÉRATIONS & OBSERVABILITÉ

| Métrique | Seuil d'alerte |
|:---|:---|
| `lag = headBlock − lastProcessedBlock` | > 3 blocs (L2) / > 1 min (Sepolia) |
| PENDING de plus de `ALERT_AFTER_MS` (défaut 10 min) | alerte — jamais d'auto‑purge |
| `eth_getLogs` en erreur / DLQ non vide | alerte immédiate (Slack, pattern existant alerte 80 %) |
| Rejeu (reorg) détecté | log d'audit + alerte info ; nombre de cycles `REORGED` suivi |

Traitement de l'historique (genesis) : `SYNC_FROM_BLOCK` (bloc de déploiement du contrat), batch
`eth_getLogs` paginés, état PENDING→SETTLED normal (jamais d'insert en SETTLED direct).

---

## 7. VARIABLES D'ENVIRONNEMENT (`.env.example` + Helm `template/backend-configmap.yaml`)

```dotenv
# ---- V1.6 Sync on-chain → Neo4j ----
SYNC_ENABLED=false                # off = comportement actuel strict (rétrocompat)
SYNC_CHAIN=polygonZkEvmTestnet    # sepolia | mainnet | polygonZkEvm(Main|Test)net
SYNC_RPC_WS=wss://…               # signal de tête (WS)
SYNC_RPC_HTTP=https://…           # vérité (REST) — ⚠️ clé RPC API-payant en secret, jamais en ConfigMap
SYNC_CONFIRMATIONS=12             # chaîne-dépendant, cf. §5.2
SYNC_FROM_BLOCK=0                 # genesis du contrat (déploiement)
SYNC_DEAD_LETTER=redis://…        # file morte (BullMQ/Redis déjà présent côté billing)
SYNC_ALERT_AFTER_MS=600000        # alerte PENDING bloqué
GENESIS_SYNC=false                # resynchronisation globale déclenchable à la demande
```

---

## 8. VALIDATION & PLAN D'EXÉCUTION (3 jours)

| Test | Critère |
|:---|:---|
| Idempotence | Rejouer 2× le même lot → même état, aucun doublon (contrainte UNIQUE + MERGE) |
| Reprise crash | `kill -9` au milieu d'un lot → reprise au checkpoint, état final identique |
| Reorg simulé | Réécrivain staging (fork + réinsertion) → cycles REORGED corrects, aucun SETTLED rétrogradé après coup (si déjà SETTLED → PROCESS_EXCEPTION audité) |
| Fallback WS coupé | WS fermé 30 s → pas de trou : gap‑fill REST reprend `lastProcessedBlock+1` |
| Délai SETTLED | Cycle détecté + 12 confirmations → `PENDING→SETTLED` mesuré < 1 min (Sepolia) |
| Non‑régression | Suite backend 30/30 + 12 i18n/FX ✓ (les flags ne changent rien au flux actuel quand `SYNC_ENABLED=false`) |

**Calendrier** : J1 module `sync/` (client RPC typé, WS signal + gap‑fill, reorgPolicy) ;
J2 specs Cypher + checkpoint atomique + tests (staging Sepolia, contrat de test) ;
J3 observabilité, DLQ, genesis sync, Helm/env, validation §8 → bascule Polygo zkEVM testnet.

---

**Conformité** : aucun événement client hors‑chaîne exposé (`SyncEvent` = hashes + métadonnées
seulement), pas de purge automatique en prod (règle RGPD = droit à l'effacement ≠ purge automatique
de l'audit), aucune clé privée : authentification RPC par token API optionnel en secret Helm.