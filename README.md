# ClearNet — Moteur de compensation décentralisée

Monorepo Full-Stack DeFi (MVP) :

| Dossier | Stack |
|---|---|
| `clearnet-backend` | NestJS 10 + Neo4j 5 (API REST) |
| `clearnet-blockchain` | Hardhat + Solidity 0.8.19 (token ERC20 + moteur de compensation) |
| `clearnet-mobile` | React Native 0.72 + Expo 49 |
| `infrastructure` | Docker Compose (Neo4j + backend) |

## Prérequis (identiques Mac et Windows)

- **Node.js 20 LTS** (18+ suffit) — https://nodejs.org
- **Docker Desktop** — https://www.docker.com/products/docker-desktop
- **Git**
- *Mobile uniquement* : Xcode (Mac/iOS) ou Android Studio + émulateur (Windows/Mac)

> **Windows** : tous les exemples ci-dessous utilisent `npm` (PowerShell). Aucune commande
> bash spécifique n'est requise. Si PowerShell bloque l'exécution de scripts, lancez
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
> **Mac** : les mêmes commandes fonctionnent dans Terminal (zsh).

## 1. Infrastructure (Neo4j + backend en Docker)

```powershell
# Depuis la racine du projet
Copy-Item infrastructure\.env.example infrastructure\.env   # PowerShell
# ou sur Mac : cp infrastructure/.env.example infrastructure/.env

docker compose -f infrastructure/docker-compose.yml up -d --build
```

Vérification :
- Neo4j Browser : http://localhost:7474 (login `neo4j` / `clearnet123`)
- API : http://localhost:3000/api/health → `{"status":"ok","neo4j":"connected"}`

Arrêt : `docker compose -f infrastructure/docker-compose.yml down`

## 2. Backend (sans Docker, mode développement)

```powershell
cd clearnet-backend
Copy-Item .env.example .env                    # Mac : cp .env.example .env
npm install
npm run start:dev                              # http://localhost:3000/api
npm test                                       # tests unitaires (jest)
```

> Si Neo4j n'est pas démarré, lancez d'abord : `docker compose -f infrastructure/docker-compose.yml up -d neo4j`

Endpoints :
- `POST /api/auth/register` — `{ "email", "name", "password" }`
- `POST /api/auth/login` — `{ "email", "password" }` → `{ access_token, user }`
- `GET /api/auth/profile` — protégé (header `Authorization: Bearer <token>`)
- `POST /api/transactions` — `{ "toEmail", "amount", "note?" }` (protégé)
- `GET /api/transactions/history?limit=50` (protégé)

## 3. Blockchain (Hardhat)

```powershell
cd clearnet-blockchain
npm install
npx hardhat test          # tests des contrats
npx hardhat node          # nœud local (terminal à garder ouvert)
# Dans un second terminal :
npx hardhat run scripts/deploy.ts --network localhost
```

Résultat attendu : adresses de `ClearNetToken` (CLRN) et `CompensationEngine` loggées.

## 4. Mobile (Expo)

```powershell
cd clearnet-mobile
npm install
npx expo start            # puis appuyez sur a (Android) ou i (iOS)
```

- **Émulateur Android** : l'API est automatiquement jointe via `10.0.2.2` (aucune config).
- **Simulateur iOS** : `localhost` fonctionne directement.
- **Appareil physique** : créez `.env` avec votre IP LAN :
  `EXPO_PUBLIC_API_URL=http://192.168.x.x:3000/api` (backend lancé en local, port 3000 exposé).

### Build APK Android (release)

> ⚠️ **Obligatoire après CHAQUE `npm install`/`npm ci` et après tout `expo prebuild`** :
> `patch-build.ps1` applique les correctifs Gradle 8 requis par la stack SDK 49 (miroir de plugins, guards `components.release`, `archiveClassifier`, classes legacy expo-splash-screen). Sans lui, le build échoue.

```powershell
cd clearnet-mobile
npm install
powershell -ExecutionPolicy Bypass -File .\patch-build.ps1   # correctifs obligatoires (idempotent)
.\build-gradle.cmd                                          # assembleRelease -> android\app\build\outputs\apk\release\app-release.apk
```

Détails, FAQ et validation complète : voir `BUILD_FIX_GUIDE.md` (racine du repo).

## Dépannage rapide

| Problème | Solution |
|---|---|
| `npm install` échoue sur le backend | Le projet utilise `bcryptjs` (pur JS) : aucune compilation native requise sur Mac/Windows |
| Neo4j non joignable | `docker compose ... up -d neo4j` puis attendre le healthcheck (`docker compose ... ps`) |
| Erreur CORS sur mobile physique | L'API active CORS globalement (`enableCors` dans `src/main.ts`) |
| Port 3000 occupé | Changer `PORT` dans `clearnet-backend/.env` (et dans `.env` mobile si utilisé) |
| `hardhat node` lève "port already in use" | Tuer le processus utilisant 8545 ou changer `localhost.url` dans `hardhat.config.ts` |

## Sécurité (avant toute mise en production)

- Changer `JWT_SECRET` et `NEO4J_PASSWORD` (fichiers `.env`, jamais commités).
- `PRIVATE_KEY` dans `clearnet-blockchain/.env` ne doit jamais contenir une clé réelle.
- Le ValidationPipe actif (`whitelist`, `forbidNonWhitelisted`) rejette les champs inconnus.
