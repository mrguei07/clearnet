# DÉPLOIEMENT SEPOLIA — Résolution de l'erreur `.env` (Guide autosuffisant)

> But : corriger `Error: SEPOLIA_RPC_URL et SEPOLIA_PRIVATE_KEY (ou PRIVATE_KEY) sont requis dans le fichier .env`
> et déployer les contrats ClearNet (**ClearNetToken** + **CompensationEngine**) sur le testnet Sepolia.
> Tout se passe dans `clearnet-blockchain/`. Aucune autre ressource requise hormis un fournisseur RPC et un wallet de test.

---

## 1. DIAGNOSTIC (cause racine)

`hardhat.config.ts` appelle `dotenv.config()` au chargement → Hardhat lit `clearnet-blockchain/.env`.
Le réseau `sepolia` y puise `SEPOLIA_RPC_URL` et `SEPOLIA_PRIVATE_KEY` (`scripts/deploy-sepolia.ts`) :

```ts
const privateKey = process.env.SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!process.env.SEPOLIA_RPC_URL || !privateKey) {
  throw new Error('SEPOLIA_RPC_URL et SEPOLIA_PRIVATE_KEY (ou PRIVATE_KEY) sont requis dans le fichier .env');
}
```

**L'erreur signifie donc une seule chose** : le fichier `.env` est absent, ou ces deux variables y sont vides.
Rien d'autre n'est en cause (pas de bug de code). Le script « échoue volontairement » pour éviter un déploiement aveugle.

> `.env.example` existe déjà dans `clearnet-blockchain/` et documente **exactement** les variables attendues.
> On va donc générer `.env` à partir de ce modèle, puis le remplir.

---

## 2. PRÉREQUIS

| Outil | Vérification | Note |
|---|---|---|
| Node.js 20 LTS | `node -v` | ≥ 18 acceptable |
| npm | `npm -v` | |
| Hardhat (projet) | `npx hardhat --version` | déjà installé via `npm install` |
| Wallet Sepolia | adresse `0x…` + clé privée | depuis MetaMask |
| ETH Sepolia (test) | ≥ **0.05 ETH** | faucet (voir §6) |
| RPC Sepolia | URL `https://…` | Infura / Alchemy / nœud public |

**Obtenir les deux valeurs :**
- **SEPOLIA_RPC_URL** : créez un projet Sepolia sur [Infura](https://infura.io) ou [Alchemy](https://www.alchemy.com) → copiez l'URL (`https://sepolia.infura.io/v3/<clé>`). Alternative publique (sans compte) : `https://ethereum-sepolia-rpc.publicnode.com`.
- **SEPOLIA_PRIVATE_KEY** : MetaMask → Paramètres → Sécurité et confidentialité → **Clé privée d'exportation** du compte de test. ⚠️ Compte de test uniquement, jamais une clé réelle.

---

## 3. SCRIPTS DE CORRECTION AUTOMATIQUE

### 3a. Windows — `setup-env.ps1` (à placer dans `clearnet-blockchain/`)

```powershell
# setup-env.ps1 — crée .env depuis .env.example et vérifie les variables Sepolia
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile  = Join-Path $root ".env"
$example  = Join-Path $root ".env.example"

if (Test-Path $envFile) {
  Write-Host "✅ .env existe déjà ($(Resolve-Path $envFile))" -ForegroundColor Green
} else {
  if (-not (Test-Path $example)) { Write-Host "❌ .env.example introuvable" -ForegroundColor Red; exit 1 }
  Copy-Item $example $envFile
  Write-Host "📝 .env créé depuis .env.example. Renseignez SEPOLIA_RPC_URL et SEPOLIA_PRIVATE_KEY." -ForegroundColor Yellow
}

$content = Get-Content $envFile -Raw
if ($content -match "(?m)^SEPOLIA_RPC_URL=($|`r?`n)") {
  Write-Host "❌ SEPOLIA_RPC_URL vide — éditez .env" -ForegroundColor Red; exit 1
}
if ($content -match "(?m)^SEPOLIA_PRIVATE_KEY=($|`r?`n)") {
  Write-Host "❌ SEPOLIA_PRIVATE_KEY vide — éditez .env" -ForegroundColor Red; exit 1
}
Write-Host "✅ .env correctement configuré." -ForegroundColor Green
```

Lancer : `powershell -ExecutionPolicy Bypass -File setup-env.ps1` depuis `clearnet-blockchain/`.

### 3b. Mac / Linux — `setup-env.sh`

```bash
#!/usr/bin/env bash
# setup-env.sh — crée .env depuis .env.example et vérifie les variables Sepolia
cd "$(dirname "$0")"

if [ -f .env ]; then
  echo "✅ .env existe déjà"
else
  if [ ! -f .env.example ]; then echo "❌ .env.example introuvable"; exit 1; fi
  cp .env.example .env
  echo "📝 .env créé depuis .env.example. Renseignez SEPOLIA_RPC_URL et SEPOLIA_PRIVATE_KEY."
fi

grep -Eq '^SEPOLIA_RPC_URL=$' .env && { echo "❌ SEPOLIA_RPC_URL vide — éditez .env"; exit 1; }
grep -Eq '^SEPOLIA_PRIVATE_KEY=$' .env && { echo "❌ SEPOLIA_PRIVATE_KEY vide — éditez .env"; exit 1; }
echo "✅ .env correctement configuré."
```

Lancer : `bash setup-env.sh`.

> Ces scripts ne font que **garantir la présence** des variables. La **valeur réelle** (RPC + clé) doit être saisie à la main dans `.env` (voir §4).

---

## 4. PROCÉDURE ÉTAPE PAR ÉTAPE (copier-coller)

Ouvrez un terminal **dans `clearnet-blockchain/`**.

```powershell
# 0. (si première fois) installer les dépendances
npm install

# 1. Générer .env depuis le modèle
powershell -ExecutionPolicy Bypass -File setup-env.ps1

# 2. Ouvrir .env et RENSEIGNER les deux lignes (éditeur de votre choix)
#    SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/<VOTRE_CLE>
#    SEPOLIA_PRIVATE_KEY=0x<VOTRE_CLE_PRIVEE>
#    (optionnel pour la vérif Etherscan) ETHERSCAN_API_KEY=<cle>
notepad .env
```

Après avoir enregistré `.env` :

```powershell
# 3. Relancer le script de vérif (doit afficher ✅ .env correctement configuré)
powershell -ExecutionPolicy Bypass -File setup-env.ps1

# 4. Compiler les contrats (requis avant déploiement)
npx hardhat compile

# 5. Déployer sur Sepolia
npm run deploy:sepolia
```

`deploy-sepolia.ts` :
- vérifie le solde (≥ 0.05 ETH) et lève une erreur sinon,
- déploie `ClearNetToken` puis `CompensationEngine`,
- écrit `deployments/sepolia.json` (adresses + chainId + deployer).

Sortie attendue (exemple) :
```
Déployeur (Sepolia) : 0xABCD…
Solde ETH de test   : 0.5
→ Déploiement ClearNetToken…
  ClearNetToken : 0xTokenAddress…
→ Déploiement CompensationEngine…
  CompensationEngine : 0xEngineAddress…
✔ Contrats déployés — adresses reportées dans deployments/sepolia.json
```

---

## 5. VALIDATION

```powershell
# Vérifier que deployments/sepolia.json a bien été écrit
cat deployments/sepolia.json

# Valider le déploiement (appels en lecture sur les contrats déployés)
npm run validate:sepolia

# (Optionnel) Vérification Etherscan — nécessite ETHERSCAN_API_KEY dans .env
npm run verify:sepolia
```

**Câblage côté backend** (pour activer le pont on-chain) : reporter les adresses dans
`clearnet-backend/.env` puis redémarrer le backend :
```
CLRN_TOKEN_ADDRESS=0xTokenAddress…
COMPENSATION_ENGINE_ADDRESS=0xEngineAddress…
BLOCKCHAIN_ENABLED=true
BLOCKCHAIN_RPC_URL=<même SEPOLIA_RPC_URL>
BLOCKCHAIN_PRIVATE_KEY=<même SEPOLIA_PRIVATE_KEY>
```

---

## 6. TROUBLESHOOTING

| Symptôme | Cause | Solution |
|---|---|---|
| `SEPOLIA_RPC_URL et SEPOLIA_PRIVATE_KEY … requis` | `.env` absent ou variables vides | §3–§4 : générer `.env` et remplir les 2 lignes |
| `Solde insuffisant … ≥ 0.05 ETH` | compte sans ETH de test | Faucet Sepolia : [sepolia.dev faucet](https://sepolia.dev), [Alchemy](https://www.alchemy.com/faucets/ethereum-sepolia), ou [QuickNode](https://faucet.quicknode.com/drip) |
| `Invalid account: privatekey` / `Expected 32 bytes` | clé tronquée / sans `0x` / espaces | coller la clé complète `0x` + 64 hex ; pas de guillemets |
| `could not detect network` / `403 Forbidden` | RPC URL invalide ou quota dépassé | vérifier l'URL ; changer de fournisseur (Infura/Alchemy/publicnode) |
| `nonce too low` / `already known` | transaction encore en mempool | attendre ou changer de clé de test |
| `gas required exceeds allowance` | solde insuffisant pour le gas | refaucet (≥ 0.05 ETH conseillé) |
| `ETHERSCAN_API_KEY manquant` (verify) | non renseigné | ignorer `verify:sepolia` ou ajouter la clé Etherscan |

**Sécurité** : `.env` contient une clé privée → déjà dans `.gitignore` du projet, **ne jamais la commiter**. Utilisez exclusivement un compte de test (faucet), jamais un compte principal.

---

## RÉSUMÉ EN 4 LIGNES
1. `npm install` (1ʳᵉ fois)
2. `setup-env.ps1` → remplir `SEPOLIA_RPC_URL` + `SEPOLIA_PRIVATE_KEY` dans `.env`
3. `npx hardhat compile` puis `npm run deploy:sepolia`
4. `deployments/sepolia.json` contient les adresses → reporter dans le backend `.env`
