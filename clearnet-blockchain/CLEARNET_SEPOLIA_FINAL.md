# CLEARNET — DÉPLOIEMENT SEPOLIA & ÉTAT DES LIEUX

> Document exécutable (sauf obtention des clés RPC + wallet de test) pour finaliser le déploiement
> de ClearNet sur le testnet **Sepolia** et préparer la phase early-adopters.
> Tout est ancré dans le code réel (`clearnet-blockchain/`) — les écarts avec d'autres guides sont corrigés.

---

## 1. RAPPEL DE CONTEXTE (synthèse)

1. ClearNet = **moteur de compensation décentralisée inter-entreprises** (dettes 45–90 j, ~2 500 Mds$ bloqués).
2. Stack : algorithme de graphe (cycles) + smart contracts (netting) + preuves ZK (confidentialité).
3. Backend **NestJS 10 + Neo4j 5** : opérationnel (stack native vérifiée cette session, flux API complet OK).
4. Contrats **Solidity 0.8.19** : `ClearNetToken` (ERC20 CLRN) + `CompensationEngine` (netting).
5. Mobile **Expo 49** : APK **universel Hermes-off** livré et validé sur téléphone (toute marque Android).
6. Infra : Docker Compose + Helm (documentés) ; ce guide utilise la stack native (Node.js) pour une exécution locale plus légère et reproductible.
7. Sécurité : JWT, rate-limiting, Multisig 2/3 (script `deploy-multisig.ts`).
8. Feature flags de durcissement : **off par défaut** (`BLOCKCHAIN_ENABLED`, Phase 2, ZK, ITAR…).
9. Objectif immédiat : **Preuve de concept vivante sur Sepolia** (tx réelle visible sur Etherscan) pour investisseurs.
10. État : MVP fonctionnel ; reste à **câbler le pont on-chain côté backend** (non encore implémenté — voir §5).

---

## 2. MISSION PRINCIPALE — DÉPLOIEMENT SEPOLIA

Déployer les deux contrats sur Sepolia et prouver le netting de bout en bout :

| Contrat | Rôle |
|---|---|
| `ClearNetToken` | ERC20 utilitaire **CLRN** (mintable par le déployeur) |
| `CompensationEngine` | Moteur de compensation (positions nettes + `settle`) |

**Résultats attendus :**
- Adresses des 2 contrats dans `clearnet-blockchain/deployments/sepolia.json`.
- `npm run validate:sepolia` → netting bilan **0/0** (Alice +500/−500, règlement, solde nul).
- (Optionnel) Contrats **vérifiés sur Etherscan Sepolia** via `npm run verify:sepolia` (nécessite `ETHERSCAN_API_KEY`).

> ⚠️ Le déploiement exige **≥ 0.05 ETH de test** sur le compte `SEPOLIA_PRIVATE_KEY` (le script lève une erreur sinon).

---

## 3. PROCÉDURE ÉTAPE PAR ÉTAPE (copier-coller)

Ouvrir un terminal **dans `C:\dev\ClearNet\clearnet-blockchain`** (PowerShell).

### 3.1. Prérequis
```powershell
node -v        # v20.x (ou ≥ 18)
npm -v         # 9+
npx hardhat --version
cd C:\dev\ClearNet\clearnet-blockchain
```

### 3.2. Créer et configurer `.env`
Le modèle `.env.example` existe déjà et documente les variables. Générer `.env` puis le remplir :
```powershell
# Windows — script fourni (crée .env depuis .env.example + vérifie les variables)
powershell -ExecutionPolicy Bypass -File setup-env.ps1

# Mac / Linux
# bash setup-env.sh   (le créer si absent, voir DEPLOY_SEPOLIA_FIX.md §3b)

notepad .env   # renseigner les 2 lignes ci-dessous
```
Contenu à saisir (vos vraies valeurs) :
```env
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/<VOTRE_CLE>
SEPOLIA_PRIVATE_KEY=0x<VOTRE_CLE_PRIVEE>
# optionnel (vérif Etherscan) :
ETHERSCAN_API_KEY=<cle_etherscan>
```
Où les obtenir :
- **SEPOLIA_RPC_URL** : projet Sepolia sur [Infura](https://infura.io) ou [Alchemy](https://www.alchemy.com) → URL HTTPS. Alternative publique : `https://ethereum-sepolia-rpc.publicnode.com`.
- **SEPOLIA_PRIVATE_KEY** : MetaMask → Paramètres → Sécurité → **Clé privée d'exportation** (⚠️ compte de **test** uniquement).

### 3.3. Vérifier le solde (ETH de test)
Il n'existe **pas** de tâche `hardhat balance` dans ce projet. Le solde est vérifié automatiquement par `deploy-sepolia.ts` (≥ 0.05 ETH). Pour vérifier manuellement avant de déployer :
```powershell
npx hardhat console --network sepolia
# puis dans la console :
# (await ethers.provider.getBalance((await ethers.getSigners())[0].address)).toString()
# .exit
```
Si le solde est insuffisant → faucet (§4.1). Le déploiement échouera sinon avec `Solde insuffisant…`.

### 3.4. Compiler
```powershell
npx hardhat compile
```
Sortie attendue : compilation réussie, **aucune erreur** (9 fichiers Solidity du projet + dépendances).

### 3.5. Déployer sur Sepolia
```powershell
npm run deploy:sepolia
```
Sortie réelle attendue (exemple) :
```
Déployeur (Sepolia) : 0x…
Solde ETH de test   : 0.5
→ Déploiement ClearNetToken…
  ClearNetToken : 0xTokenAddress…
→ Déploiement CompensationEngine…
  CompensationEngine : 0xEngineAddress…
✔ Contrats déployés — adresses reportées dans deployments/sepolia.json
```
> Pas de message « Minter role granted » dans ce code : le déployeur garde le rôle minter par conception ERC20.
> Les adresses sont dans `deployments/sepolia.json` (`clearNetToken`, `compensationEngine`, `deployer`, `chainId`).
>
> 💡 **Coût de gas (indicatif)** : déployer les 2 contrats ≈ **0.002–0.005 ETH** ; la validation (mint + settle) ≈ **0.001 ETH**. Avec 0.05 ETH de test, vous pouvez refaire plusieurs déploiements/tests sans souci.

### 3.6. Valider le déploiement (E2E)
```powershell
npm run validate:sepolia
```
Ce script (réel) : mint **500 CLRN** à Alice & Bob (adresses dérivées des emails `alice@clearnet.io`/`bob@clearnet.io`), met les positions nettes (+500 / −500), **compense** 500 CLRN Alice→Bob, puis assert `netPositions == 0/0`.
Sortie attendue :
```
→ Mint 500 CLRN à Alice et Bob…
  ✔ mint tx: 0x… | 0x…
→ Positions nettes (Alice +500 CLRN, Bob −500)…
→ Compensation Alice → Bob de 500 CLRN…
  ✔ settlement tx: 0x…
Positions nettes après règlement :
  Alice : 0.0 CLRN
  Bob   : 0.0 CLRN
✔ Validation de bout en bout réussie (netting bilan : 0/0)
```

### 3.7. Vérifier sur Etherscan (optionnel)
- Copier une adresse depuis `deployments/sepolia.json`.
- Coller dans [Sepolia Etherscan](https://sepolia.etherscan.io) → le contrat apparaît (bytecode).
- Vérification du code source (nécessite `ETHERSCAN_API_KEY` dans `.env`) :
```powershell
npm run verify:sepolia
```
> 💡 **Recommandé pour la crédibilité** : créez un compte sur [Etherscan](https://etherscan.io/myapikey), générez une clé API, ajoutez `ETHERSCAN_API_KEY` dans `.env`, puis `npm run verify:sepolia`. Un contrat **vérifié** (code source lisible) rassure investisseurs et early adopters.

### 3.8. Reporter les adresses (pour le futur pont on-chain)
```powershell
cd C:\dev\ClearNet\clearnet-backend
notepad .env
```
Ajouter / mettre à jour :
```env
CLRN_TOKEN_ADDRESS=0xTokenAddress…
COMPENSATION_ENGINE_ADDRESS=0xEngineAddress…
BLOCKCHAIN_ENABLED=true
BLOCKCHAIN_RPC_URL=https://sepolia.infura.io/v3/<VOTRE_CLE>
BLOCKCHAIN_PRIVATE_KEY=0x<VOTRE_CLE_PRIVEE>
```
⚠️ **État réel** : le backend lit ces variables via `ConfigModule`, mais **le pont on-chain n'est pas encore câblé** dans le code (aucun endpoint ne les consomme aujourd'hui). Reporter les adresses prépare la suite ; redémarrer le backend (`npm run start:dev`) ne rendra pas le pont actif tant que le module bridge ne sera pas implémenté. Voir §5.

---

## 4. RÉSOLUTION DES PROBLÈMES COURANTS

### 4.1. Faucet Sepolia (ETH de test)
| Fournisseur | Lien | Quantité | Délai |
|---|---|---|---|
| QuickNode | https://faucet.quicknode.com/drip | 0.5 ETH | immédiat (tweet) |
| Alchemy | https://www.alchemy.com/faucets/ethereum-sepolia | 0.5 ETH | ~24 h |
| Sepolia.dev | https://sepolia.dev | 0.05 ETH | immédiat |

Recommandation : **QuickNode** pour 0.5 ETH rapidement (≥ 0.05 ETH exigés).

### 4.2. Clé privée (erreurs fréquentes)
| Erreur | Cause | Solution |
|---|---|---|
| `Invalid account` / `Expected 32 bytes` | clé sans `0x` ou tronquée | coller la clé complète `0x` + 64 hex, sans espaces/guillemets |
| `Private key not found` | espace/guillemet résiduel | supprimer toute citation dans `.env` |
| `nonce too low` | tx précédente en mempool | attendre 1–2 min, relancer |

### 4.3. RPC URL (403 / timeout)
| Erreur | Cause | Solution |
|---|---|---|
| `403 Forbidden` | clé RPC invalide / projet inexistant | revérifier l'URL + clé Infura/Alchemy |
| `timeout` / `could not detect network` | RPC public saturé | utiliser Infura/Alchemy à jour |
| `Network doesn't support EIP-1559` | RPC obsolète | fournisseur récent (Infura/Alchemy/publicnode) |

### 4.4. Gas
`gas required exceeds allowance` → solde ETH insuffisant → refaucet (≥ 0.05 ETH).

---

## 5. VALIDATION & PROCHAINES ÉTAPES

### 5.1. Vérifications finales
| Vérification | Commande | Résultat attendu |
|---|---|---|
| Contrats déployés | `cat deployments/sepolia.json` | adresses présentes |
| Validation E2E | `npm run validate:sepolia` | `netting bilan : 0/0` |
| Preuve Etherscan | coller l'adresse sur sepolia.etherscan.io | contrat visible (tx de mint/settle) |

> ❗ Le endpoint `GET /api/blockchain/status` et l'activation auto du pont **n'existent pas encore** côté backend.
> Ne pas attendre `enabled: true` depuis l'API : le bridge reste à implémenter (§6).

### 5.2. Backup des adresses (IMPORTANT)
`deployments/sepolia.json` est la **seule source** des adresses. Conservez-en une copie hors du poste
(ex. note chiffrée) — un wipe de `clearnet-blockchain/` les perdrait. `.env` (clé privée) reste local et non commité.

### 5.3. Prochaines étapes (roadmap post-déploiement)
1. **Câblage backend** : module bridge lisant `CLRN_TOKEN_ADDRESS`/`COMPENSATION_ENGINE_ADDRESS`/`BLOCKCHAIN_RPC_URL` et exposant un endpoint (ex. `/api/blockchain/status` + déclenchement de `settle` depuis les transactions Neo4j).
2. **Business plan & early adopters** : la PoC Sepolia (tx Etherscan) sert de preuve vivante en rendez-vous.
3. **Sécurité pré-prod** : changer `JWT_SECRET`/`NEO4J_PASSWORD`, `PRIVATE_KEY` de test uniquement, Multisig 2/3 pour les fonds.
4. **CI/CD** : `docker compose build` instable sur ce réseau → privilégier le mode natif ou un runner CI externe.

### 5.4. Préparation pour le câblage du pont
Une fois les adresses reportées dans `clearnet-backend/.env`, le backend est prêt à consommer ces variables
(`CLRN_TOKEN_ADDRESS`, `COMPENSATION_ENGINE_ADDRESS`, `BLOCKCHAIN_RPC_URL`, `BLOCKCHAIN_PRIVATE_KEY`).
Le pont on-chain sera implémenté en **V1.5** : un module bridge exposera un endpoint (ex. `/api/blockchain/status`)
et déclenchera `settle` à partir des transactions Neo4j. En attendant, les données métier résident dans **Neo4j**
et la preuve on-chain (hash de tx) est consultable sur **Etherscan** ; la cohérence entre les deux sources sera
assurée par le **worker de réconciliation** (prévu V1.5).

---

## 6. CONCLUSIONS & ÉTAT D'AVANCEMENT

**ClearNet V1.4 (MVP industrialisé) — où en est-on ?**

| Domaine | État | Détail (vérifié cette session) |
|---|---|---|
| Backend NestJS + Neo4j | ✅ Opérationnel | Stack native (Redis+Neo4j+Node) ; flux API complet validé (login, balance −170 CLRN, egonet 3 nœuds/4 liens) ; 2 bugs 500 corrigés |
| Smart contracts | ✅ Prêts | `ClearNetToken` + `CompensationEngine` (Solidity 0.8.19) ; déploiement Sepolia documenté et exécutable |
| Mobile Expo | ✅ Livré | APK **universel Hermes-off** (4 ABI) validé sur téléphone ; compatible tout Android |
| Infra | ✅ Documentée | Docker Compose + override local + Helm ; mode natif recommandé ici |
| Sécurité | ✅ Présente | JWT, rate-limiting, Multisig 2/3 (script) ; flags durcis off par défaut |
| Pont on-chain (backend) | ⚠️ À faire | Variables d'env prêtes, mais **code bridge non implémenté** |

**Bilan** : la partie « métier » (graphe de compensation + mobile + backend) est fonctionnelle et démontrée ;
la partie « on-chain » est à un script de déploiement de la PoC. Le déploiement Sepolia décrit ici clôt la
preuve de concept technique et ouvre la phase **early adopters / business plan** avec une tx réelle auditable.

**Livrables de cette session** : `DEPLOY_SEPOLIA_FIX.md` (correction `.env`) + `CLEARNET_SEPOLIA_FINAL.md` (ce guide).
Le déploiement effectif nécessite de fournir RPC Sepolia + clé privée de test — alors `npm run deploy:sepolia` suffit.
