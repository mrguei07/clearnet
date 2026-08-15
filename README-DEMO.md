# ClearNet — Guide de démonstration partenaire (30 min)

Ce guide permet de présenter ClearNet à un partenaire industriel de bout en bout :
API de compensation → moteur on-chain → application mobile. Toutes les étapes sont
réversibles et ne nécessitent **aucun fonds réel** (réseaux de test uniquement).

---

## 1. Préparation (5 min)

**Prérequis** : Docker Desktop lancé, Node 20+, git.

```bash
# Depuis la racine du monorepo
cp infrastructure/.env.example infrastructure/.env        # Mac/Linux
# Copy-Item infrastructure\.env.example infrastructure\.env   # Windows
```

## 2. Lancement de la stack (5 min)

```bash
docker compose -f infrastructure/docker-compose.yml up -d --build
```

Attendez le message de santé :

```bash
curl http://localhost:3000/api/health
# => {"status":"ok","neo4j":"connected"}
```

## 3. Seed des données de démo (2 min)

```bash
./scripts/seed-demo.sh
# Windows : Invoke-RestMethod -Uri http://localhost:3000/api/demo/seed -Method Post `
#           -Headers @{ "X-Demo-Key" = "demo-secret-change-me" }
```

Trois comptes sont créés (mot de passe commun : `clearnet-demo`) :

| Compte | Rôle dans le scénario |
|---|---|
| `alice@clearnet.io` | Fournisseur de pièces — facture et compense |
| `bob@clearnet.io` | Client industriel — doit être payé |
| `carol@clearnet.io` | Sous-traitante — prestation et compensation |

Un jeu de 3 transactions initial est inséré (250 / 120 / 80 CLRN).
Le seed est **idempotent** : relancer le script ne duplique rien.

## 4. Scénario de démonstration (15 min)

### 4.1 Le moteur de compensation (API + Neo4j)
- Ouvrez **Neo4j Browser** : http://localhost:7474 (login `neo4j` / mot de passe du `.env`).
- Montrez le graphe : `MATCH (u:User)-[r]-(t:Transaction) RETURN u, r, t LIMIT 50`
- Créez une transaction en direct : `POST /api/transactions` (via Swagger postman ou l'app mobile).
- Rechargez le graphe : la relation `SENT`/`RECEIVED` apparaît en temps réel.

### 4.2 Le pont on-chain (optionnel, 10 min)
Avec le pont activé, chaque transaction hors-chaîne met à jour la position nette
du moteur de compensation sur la blockchain de test :

```bash
# 1. Nœud local + déploiement
cd clearnet-blockchain
npx hardhat node        # terminal 1
npx hardhat run scripts/deploy.ts --network localhost   # terminal 2 — notez les adresses

# 2. Configurer le backend
#    clearnet-backend/.env :
#    BLOCKCHAIN_ENABLED=true
#    BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
#    BLOCKCHAIN_PRIVATE_KEY=0xac0974...(clé n°0 hardhat, dev uniquement)
#    CLRN_TOKEN_ADDRESS=<adresse token>
#    COMPENSATION_ENGINE_ADDRESS=<adresse engine>

# 3. Redémarrer le backend et refaire une transaction :
cd ../clearnet-backend && npm run start:dev
# Les logs affichent : "Position mise à jour 0x… (X CLRN) — tx 0x…"
```

### 4.3 L'application mobile (5 min)
```bash
cd clearnet-mobile
npm install
npx expo start        # « a » pour Android, « i » pour iOS
```
1. Écran de connexion → **Mode démo partenaire**.
2. Touchez **Alice** : connexion en un geste.
3. Envoyez une transaction à `bob@clearnet.io`.
4. Déconnectez-vous, entrez en **Bob** : la transaction apparaît dans l'historique.

### 4.4 Déploiement public (optionnel — réseau de test Sepolia)
```bash
cd clearnet-blockchain
cp .env.example .env    # renseigner SEPOLIA_RPC_URL / SEPOLIA_PRIVATE_KEY (faucet) / ETHERSCAN_API_KEY
npx hardhat run scripts/deploy-sepolia.ts --network sepolia
npx hardhat run scripts/verify-sepolia.ts --network sepolia
# Adresses écrites dans deployments/sepolia.json — montrez la vérification Etherscan.
```

## 5. Points de langage pour le commercial

- **Le problème** : dans l'industrie, chaque entreprise paye/réclame via des virements
  bancaires lents et coûteux, sans compensation multilatérale.
- **La solution ClearNet** : un registre partagé (Neo4j) des créances/dettes + un moteur
  de compensation on-chain (token CLRN + positions nettes) qui ne mobilise que le solde
  net à régler.
- **L'état d'avancement** : MVP fonctionnel (API, mobile, contrats testés), pont on-chain
  démontré sur réseau de test, prêt pour un pilote industriel.

## 6. Nettoyage

```bash
docker compose -f infrastructure/docker-compose.yml down -v   # purge Neo4j (données démo)
```

## Dépannage

| Symptôme | Cause probable | Correctif |
|---|---|---|
| `/api/health` ne passe pas au vert | Neo4j pas prêt | `docker compose ... ps` puis patienter (healthcheck) |
| `seed-demo.sh` échoue | Clé `DEMO_API_KEY` différente | Passer la clé en 2ᵉ argument du script |
| Mode démo mobile : « Connexion impossible » | Backend non lancé ou comptes non seedés | Relancer le seed (étape 3) |
| Logs « Pont on-chain DÉSACTIVÉ » | `BLOCKCHAIN_ENABLED` non défini | Voir section 4.2 |

---

**Sécurité** : l'API de démo (`/api/demo/*`) est protégée par l'en-tête `X-Demo-Key`.
La clé `demo-secret-change-me` est un défaut de développement — la changer dans les
fichiers `.env` avant toute démo en conditions réelles.
