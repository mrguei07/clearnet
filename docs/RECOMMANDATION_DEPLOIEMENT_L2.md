# 💡 RECOMMANDATION UNIQUE — DÉPLOIEMENT ZK SUR L2 (Polygon zkEVM)

**Rôle** : Lead Architect Full‑Stack — recommandation de déploiement du socle ZK/clearing ClearNet.
**Base** : ClearNet V1.4 (backend 30/30, contrats 5/5) + plans V1.5 (i18n, multi-devises, facturation).
**Statut** : recommandation — décision produit requise avant implémentation.

---

## 1. VERDICT EXÉCUTIF

**Oui, sortir le socle ZK/compensation du Mainnet Ethereum — mais sur Polygon zkEVM,
pas « Arbitrum ou Arbitrum Orbit ». Et surtout : mesurer le coût par *cycle de compensation*
(pas par transaction), en déployant une vérification Groth16 **par lot** (batch proof).**

Le message reçu contient 3 inexactitudes à corriger avant toute décision (cf. §3). Une fois
corrigées, la conclusion tient : la vérification Groth16 est ~10 à 100× moins chère sur L2
qu'en L1, et le vrai levier de coût est le **batch proof** (une preuve par lot de N compensations),
qui rend le « moins de 0,01 $/transaction » systématiquement atteignable.

---

## 2. CONTEXTE — CE QUE CLEARNET FAIT RÉELLEMENT ON‑CHAIN

| Contrat (5/5 tests ✓) | Rôle | Pertinence L2 |
|:---|:---|:---|
| `CompensationEngine.sol` | Compensation/netting périodique multi‑parties | **Cœur** — s'exécute en lot, pas par transaction |
| `IZkVerifier.sol` | Interface de vérification de preuve ZK (Groth16) | **Cœur** — coût = appels `ecpairing`/`ecrecover` |
| `MultiSigWallet.sol` | Gouvernance des paramètres (fees, oracles, admins) | Administre le paramétrage du moteur |
| `ClearNetToken.sol` | Jetons CLRN (ledger on‑chain) | Mint/burn aux frontières des lots |
| `ChainlinkPriceFeed.sol` | Taux CLRN/EUR/USD (oracle FX — cf. plan i18n §2.2) | Dépend de la couverture des feeds par L2 |

**Faits structurants** :
- Le ledger courant est **Neo4j** (transactions B2B fréquentes, hors chaîne) ; l'on‑chain ne
  reçoit que les **résultats de compensation** (netting) — pas chaque paiement.
- Le coût pertinent est donc `coût d'un lot / nombre de transactions compensées`, et non
  « une vérification Groth16 par transaction ».
- `ChainlinkPriceFeed.sol` est déjà déclaré — sa disponibilité dépend de la couverture
  Chainlink du réseau cible.

---

## 3. ANALYSE CRITIQUE DE LA RECOMMANDATION REÇUE

| Affirmation | Correction | Impact |
|:---|:---|:---|
| « Arbitrum ou Arbitrum Orbit » (qualifiés de ZK) | **Inexact.** Arbitrum (Arbitrum One) et Arbitrum Orbit (chaînes custom AnyTrust) sont des rollups **optimistiques**/frais, pas ZK. Les vrais L2 ZK EVM : Polygon zkEVM (équivalent Ethereum), zkSync Era, Linea, Scroll. | Choix de réseau corrigé → §4 |
| « opérations alt_bn128 bénéficient de subventions de gaz massives » | **Inexact dans le terme.** Il n'y a pas de « subvention » : les précompilations BN254 (`ecpairing`, `ecrecover`) sont simplement tarifées comme des opcodes courants sur les L2 EVM-compatibles (pas de coût « L1 », prix du gaz ~0,02–0,5 gwei). | Framing honnête du gain (prix du gaz L2, pas subvention) |
| « coût de vérification d'un cycle complet < 0,01 $/transaction » | **Ordre de grandeur plausible mais non garanti.** Voir le calcul réel §4.1 : ~0,01–0,04 $ par *vérification* sur zkEVM aux prix 2026, et ≪ 0,01 $ par *transaction* dès que l'on vérifie par lot (N ≥ 10). | Règle d'ingénierie : toujane mesurer, jamais annoncer un prix fixe |

---

## 4. RECOMMANDATION FINALE — POLYGON zkEVM (Mainnet), staging sur Sepolia

### 4.1. Le calcul de coût honnête (à rejouer au déploiement)

Groth16 verify ≈ **250–350 k gas** (≈ 6 appels `ecpairing` + `ecrecover`) :

| Cible | Gas price (ordre, 2026) | Coût / vérification | Coût / tx (lot de 20 tx, 1 proof) |
|:---|:---|:---|:---|
| Ethereum L1 | 2–10 gwei | 2–8 $ | 0,10–0,40 $ |
| **Polygon zkEVM (L2)** | **0,02–0,5 gwei** | **0,002–0,05 $** | **0,0001–0,0025 $** |
| Arbitrum One (si feeds exigés) | 0,01–0,1 gwei | 0,001–0,01 $ | 0,00005–0,0005 $ |

→ « Moins de 0,01 $/transaction » : **vrai** avec batch proof sur n'importe lequel de ces L2 ;
le gain L1→L2 est réel (x10 à x100), la formulation « subvention » était seule à retirer.

### 4.2. Décisions d'architecture

1. **Batch proof (obligatoire)** : `CompensationEngine` agrège N compensations du cycle, une
   seule preuve Groth16 est générée off‑chain et vérifiée on‑chain par `IZkVerifier` →
   coût/tx = `verification / N`.
2. **Vérification paresseuse (option, à trancher)** : la preuve est vérifiée **off‑chain** par
   les parties ; on‑chain uniquement en cas de litige (fenêtre de contestation + MultiSig). C'est
   le pattern « optimistic ZK » : coût ~0 hors litige, sécurité ZK conservée. **Recommandé pour
   le lancement** : vérification on‑chain de chaque lot dès J+1 ; lazy verification en V1.6.
3. **Oracle FX** : sur zkEVM, la couverture Chainlink est partielle (fiable sur EUR/USD, USD/EUR ;
   à confirmer pour CLRN). Fallback : paire via `MultiSigWallet` (taux administré), cohérent
   avec `FX_STATIC_RATES` du plan i18n (§2.4) en cas de réseau non couvert.
4. **Sécurité héritée** : zkEVM est un rollup ZK validé sur Ethereum → même finalité L1,
   atomicité des transitions d'état, résistance à la censure du L1. ⚠️ Ne pas confondre avec
   un L1 alternatif : on **hérite** de la sécurité d'Ethereum, on ne la remplace pas.

### 4.3. Ce qui ne change pas (non‑périmètre)

- Ledger Neo4j, API NestJS, mobile Expo, billing Stripe : **inchangés** (le contrat L2 est un
  composant du flux de compensation, pas un remplacement du backend).
- `MULTI_CURRENCY_ENABLED=false` par défaut : la chaîne L2 n'ajoute aucune dépendance de runtime
  au système i18n/FX (règle d'or « off par défaut » préservée).

---

## 5. PLAN D'EXÉCUTION (4 ½ journées)

| Jour | Action | Sortie |
|:---|:---|:---|
| **J1** | Config réseau Hardhat : `polygonZkEvmMainnet` + `polygonZkEvmTestnet` (RPC, gas, blockscout) ; rejouer `npx hardhat test` sur le testnet ; rapport de gaz (`hardhat-gas-reporter`) avec scénario « lot de 20 tx » | Config + rapport de coût réel |
| **J2** | Scripts de déploiement : ordre `ClearNetToken` → `CompensationEngine` (+`IZkVerifier`) → `MultiSigWallet` → `ChainlinkPriceFeed` (ou feed administré) ; vérification des sources (blockscout) | Déploiement staging zkEVM testnet |
| **J3** | Intégration backend : endpoints `POST /api/compensation/commit` (lot + proof) et `GET /api/compensation/status` ; webhook frontières CLRN (mint/burn) ; tests e2e (staging) | Flux batch proof bout‑en‑bout ✓ |
| **J4** | Gouvernance : MultiSig, seuils de litige, fenêtre de contestation ; doc runbook ; seuil d'activation (nombre de parties, volume mensuel) décidé avec le produit | Runbook + décision d'activation |
| **J4½** | Rejouer le calcul de coût §4.1 avec les prix réels ; tableau de bord coût/cycle ; rédaction des KPIs | Chiffres définitifs + KPI board |

**Si le volume de clearing est faible** (< 100 compensations/mois) : la recommandation devient
« vérification paresseuse immédiate » (lazy verification, zéro coût on‑chain) — à trancher avec
le produit au plus tard fin J1.

---

## 6. POUR ALLER PLUS LOIN (hors périmètre actuel)

- Lazy verification + preuve de litige (V1.6) ;
- Multi‑chaînes : arbitrage entre coût (zkEVM) et couverture Chainlink (Arbitrum) via relais CCIP ;
- Audit externe du flux de preuve avant toute valeur on‑chain significative.

---

**Conformité** : aucune clé privée en clair (keystores encodés, variables d'environnement ou
HashiCorp Vault), contrats vérifiés sur blockscout, RGPD intact (données clients jamais on‑chain).