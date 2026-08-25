# Déploiement du pont on‑chain ClearNet sur Sepolia

> V1.2 — procédure opérationnelle : déploiement des contrats, activation du pont backend,
> validation de bout en bout. Toute activation est **réversible** (`ONCHAIN_ENABLED=false`).

## 1. Prérequis

- Node.js 20+
- Hardhat installé (`npm install -g hardhat`)
- Un compte Alchemy ou Infura pour l'accès Sepolia
- Un wallet Sepolia avec des ETH de test ([faucet](https://sepolia-faucet.pk910.de/))
- Une clé API Etherscan (pour la vérification des contrats)

## 2. Déploiement des contrats

```bash
cd clearnet-blockchain
cp .env.example .env
# Remplir SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY
# (le script accepte aussi SEPOLIA_PRIVATE_KEY, nom de clé de notre .env.example)

npx hardhat run scripts/deploy-sepolia.ts --network sepolia
# équivalent : npm run deploy:sepolia
```

Le script :
1. vérifie `SEPOLIA_RPC_URL` + clé privée présents, et un solde de gas ≥ 0.05 ETH (rejet sinon) ;
2. déploie `ClearNetToken` puis `CompensationEngine` ;
3. écrit `clearnet-blockchain/deployments/sepolia.json` (adresses → à reporter dans le backend).

## 3. Vérification Etherscan (optionnel mais recommandé)

```bash
npm run verify:sepolia
```

→ confirme que le bytecode publié correspond au source (auditabilité).

## 4. Activation du pont backend

Report dans `clearnet-backend/.env` :

```dotenv
ONCHAIN_ENABLED=true            # ou BLOCKCHAIN_ENABLED=true (alias)
BLOCKCHAIN_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/…
BLOCKCHAIN_PRIVATE_KEY=0x…      # clé de l'opérateur (== admin du CompensationEngine)
CLRN_TOKEN_ADDRESS=0x…          # depuis deployments/sepolia.json
COMPENSATION_ENGINE_ADDRESS=0x… # depuis deployments/sepolia.json
```

Puis : `npm run build && npm run start:dev` (Docker : `docker compose ... up -d --build backend`).

Diagnostic : `GET http://localhost:3000/api/blockchain/status` →
`{ enabled: true, network: { chainId: "11155111", name: "sepolia" }, signerAddress, engineAddress, tokenAddress, zk: {...} }`.

> Le signer back est **l'admin** du CompensationEngine : utilisez la **même clé** que le
> déploiement pour pouvoir appeler `settle` / `settleWithProof` / `setZkSettings`.

## 5. Validation de bout en bout

```bash
cd clearnet-blockchain
npm run validate:sepolia
```

Le script (cohérent avec la dérivation d'adresses du backend) :
1. mint `500 CLRN` → Alice & Bob (adresses dérivées des emails)
2. positions nettes : Alice `+500`, Bob `−500`
3. `settle(Alice → Bob, 500)`
4. vérifie `netPositions == 0` — clôture nette 0/0 ✔

Depuis l'API du backend, en parallèle :
```bash
curl -s http://localhost:3000/api/blockchain/status | jq
curl -s -X POST http://localhost:3000/api/transactions \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer <jwt>' \
  -d '{"toEmail":"bob@clearnet.io","amount":12,"note":"bout-en-bout"}'
# le backend rejoue le règlement on-chain (settleCompensation) si le pont est actif,
# puis écrit onchainHash / onchainStatus sur le nœud Transaction.
```

## 6. Gate ZK optionnel (settleWithProof)

1. Générer les artefacts : `bash scripts/generate-zk-keys.sh` (WSL2, circom+snarkjs)
   → produit `contracts/Verifier.sol` + `zkartifacts/`.
2. Déployer le vérificateur : `npx hardhat run scripts/deploy-verifier-sepolia`
   (todo — actuellement à faire manuellement : compilation + déploiement du Verifier).
3. Activer sur l'engine (clé publique admin) — via console hardhat ou via le backend :
   `configureZk(verifierAddress, true, maxAmountCLRN)` (`BlockchainService.configureZk`).
4. Les règlements passeront par `settleWithProof` (le pont génère la preuve via
   `ZkProofService` si `ZK_ENABLED=true`, artefacts présents).

**Caveat d'échelle (documenté)** : le circuit travaille en micro-CLRN (×1e6) tandis que le
ledger on-chain est en wei (×1e18). Le verrou ZK valide l'affirmation de la preuve (montant ≤
plafond, engagement) ; l'exacte égalité micro/wei (montant exécuté) est un raffinement noté
phase suivante — le réseau Sepolia de test est suffisant pour valider la mécanique.

## 7. Retour arrière / sécurité

| Action | Commande |
|---|---|
| Désactiver le pont | `ONCHAIN_ENABLED=false` + restart backend (reste 100 % hors-chaîne) |
| Révoquer l'accès admin | Rien à faire : la clé privée n'est jamais exposée ; tournez-la dans le secret manager |
| Erreur gas | le script rejette avant deploy si solde < 0.05 ETH |

## 8. Registre opérationnel (à compléter lors du déploiement réel)

| Élément | Valeur (exemple) |
|---|---|
| ClearNetToken | `0x…` (deployments/sepolia.json) |
| CompensationEngine | `0x…` (deployments/sepolia.json) |
| Transaction de règlement | `0x…` (validate-sepolia) |
| Statut pont API | `GET /api/blockchain/status` → enabled: true |