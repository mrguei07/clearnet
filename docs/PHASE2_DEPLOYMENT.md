# ClearNet — PHASE 2 : guide de déploiement opérationnel

Base : V1.1 → V1.2 (hardening production). Tous les dispositifs Phase 2 sont **désactivés
par défaut** (règle d'or) : la procédure ci-dessous documente l'activation contrôlée.

---

## 0. Prérequis

| Composant | Requis | ex. version |
|---|---|---|
| Node.js + npm | travaillé (ryth rit) | v20+ |
| Docker Desktop (Windows) | pour la pile locale | v4+ |
| WSL2 (bash) | pour circom/snarkjs | Ubuntu |
| Helm | pour le cluster K8s | v3.15+ |
| kind OU minikube | cluster de démo | kind 0.24+ |

## 1. Variables d'environnement (clearnet-backend/.env)

```dotenv
# --- Phase 2 : flags (OFF par défaut) ---
ITAR_ENABLED=false
OFAC_API_KEY=
OFAC_CSV_PATH=
ORACLES_ENABLED=false
STORMGLASS_API_KEY=
SPACE_TRACK_USER=
SPACE_TRACK_PASSWORD=
ZK_ENABLED=false
VERIFIER_ADDRESS=
BLOCKCHAIN_RPC_URL=http://localhost:8545
ZK_ARTIFACTS_DIR=./zkartifacts
ORACLE_TIMEOUT_MS=2500
```

> Activation : passer le flag correspondant à `true` **après** avoir réalisé la
> sous-étape correspondante (§ 5 ci-dessous). Retour arrière immédiat : flag à `false`.

## 2. Déploiement local (Docker plutôt que k8s)

```bash
cd infrastructure
docker compose up -d --build backend neo4j
# attendre orchestration Neo4j (bolt://localhost:7687)
curl -s http://localhost:3000/api/health
cd ../clearnet-backend && npm run build && npm test -- --runInBand
```

## 3. Déploiement cluster (Helm)

```bash
helm lint infrastructure/helm/clearnet
kind create cluster --name clearnet
helm install clearnet infrastructure/helm/clearnet \
  -n clearnet --create-namespace \
  --set backend.env.NODE_ENV=production \
  --set backend.ingress.host=clearnet.local
helm upgrade clearnet infrastructure/helm/clearnet -n clearnet --reuse-values \
  --set backend.image.tag=v1.2.0
kubectl -n clearnet get pods,svc,hpa,ingress
```

> Neo4j : StatefulSet + PVC (`storage.size=10Gi`), auth `neo4j/<password>` via secret.
> Backend : HPA 2→5 replicas @70% CPU ; probes `/api/health` (startup/ready/liveness, corrigées).
> Devnet blockchain : `--set blockchain.enabled=true` (pod Hardhat, port 8545) — destiné
> uniquement à l'évaluation ; éteint en prod (`enabled: false` par défaut).

## 4. ZK : génération des artefacts (une seule fois)

Sur une machine avec `circom` + `snarkjs` (WSL2 recommandé) :

```bash
cd clearnet-blockchain
npm install                              # circomlib (existant)
bash scripts/generate-zk-keys.sh         # → zkartifacts/** + contracts/Verifier.sol
```

Sorties : `transaction.wasm`, `transaction.zkey`, `verification_key.json`,
`contracts/Verifier.sol` (généré, écrasé à chaque run — ne pas éditer à la main).

Copier les artefacts côté backend :

```bash
mkdir -p clearnet-backend/zkartifacts
cp clearnet-blockchain/zkartifacts/{transaction_js/transaction.wasm,transaction.zkey,verification_key.json} clearnet-backend/zkartifacts/
```

## 5. Activation contrôlée (dans cet ordre)

| Étape | Tâche | Vérification |
|---|---|---|
| a. Préparation clés API | poser STORMGLASS_API_KEY, SPACE_TRACK_*, OFAC_API_KEY | `curl .../api/oracles/demurrage` → `source:"stormglass"` |
| b. Données pays/secteurs | migrer Neo4j : `MATCH (u:User) SET u.country='FR', u.industry='SupplyChain'` | parts de marché cohorte test |
| c. ITAR/OFAC | `ITAR_ENABLED=true` + CSV penel | txs Defense→pays interdit → 400/403 |
| d. ZK | contract : `setZkSettings(verifier, true, 1_000_000)` + `ZK_ENABLED=true` + `VERIFIER_ADDRESS` | `generateProof` + `verifyProof` OK on-chain |
| e. Scale | chart + `backend.autoscaling.enabled` | `kubectl top pods` |

## 6. Tests de non-régression (blocage minimaV)

```bash
# Flags off → comportement V1.1 exact
cd clearnet-backend
npm run test -- --runInBand
npm run build
# Puis flags on et re-run des tests + smoke
```

## R7. Supervision & journal

- Logs modules : `ComplianceService`, `OracleService`, `ZkProofService` loggent leur activation
  ou dégradation (`warn` sur fallback/API KO).
- Écouter le champ `hint` du Graph (urgency) — cames au dossier d'exploitation.

---

*Document destiné à l'opérateur ; chaque activation doit être validée conformité
(OFAC : liste embarquée « ClearNet Sanctioned Corp », « North Supply Line LLC », « Orbis Test Entity »).*