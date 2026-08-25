# ClearNet — Guide d'exploitation (poste Windows local)

Ce document décrit comment faire tourner ClearNet sur le poste de développement
sans dépendre de Docker (mode natif rapide) et comment utiliser Docker en secours.

## État de la stack (août 2026)

La stack **natif** est la stack opérationnelle du poste :

| Service | Version | Port | URL / contrôle |
|---|---|---|---|
| Redis | 5.0.14 (Windows) | 6379 | `redis-cli -p 6379 ping` |
| Neo4j | 5.26.7 (JBR Java 21) | 7474 (HTTP), 7687 (Bolt) | http://localhost:7474 — `neo4j` / `clearnet123` |
| Backend NestJS | node 20, `dist/main.js` | 3000 | http://localhost:3000/api/health → `{"status":"ok","neo4j":"connected"}` |

IP LAN du poste (Wi-Fi) : **10.103.250.247** → l'application mobile pointe vers
`http://10.103.250.247:3000/api` (peut changer si le sous-réseau change ; re-vérifier
avec `Get-NetIPAddress -AddressFamily IPv4 | ? InterfaceAlias -eq "Wi-Fi"`).

## Démarrage / arrêt

Lanceurs prêts à l'emploi (dossier `C:\Users\deral\AppData\Local\clearnet-services\bin`) :

- `start-redis.cmd` — Redis (appendonly + noeviction)
- `start-neo4j.cmd` — Neo4j en console (utilise Java de l'Android Studio : `JBR`)
- `start-backend.cmd` — `node dist\main.js` (log : `..\backend.out.log`)

Ordre : redis → neo4j → backend. Arrêt : tuer les processus sur 3000/6379/7474/7687.

## Données

- Base Neo4j native : `C:\Users\deral\AppData\Local\clearnet-services\neo4j\neo4j-community-5.26.7\data`
  (contient le seed démo : `alice@clearnet.io`, `bob@clearnet.io`, `carol@clearnet.io`
  / mot de passe `clearnet-demo` ; seed reproductible via `POST /api/demo/seed`
  avec header `x-demo-key: demo-secret-change-me`).
- Sauvegarde du volume Neo4j Docker (vierge, à titre d'archive) :
  `C:\Users\deral\AppData\Local\clearnet-services\docker-neo4j-backup\neo4j-data.tgz`.

## Mode Docker (déploiement)

- `infrastructure/docker-compose.yml` = stack complète (neo4j + redis + backend).
- `infrastructure/docker-compose.override.yml` = monte `dist/` + `node_modules/` locaux
  dans le conteneur backend → **pas de `docker compose build` nécessaire** (npm ci à
  l'intérieur est lent/instable sur ce réseau). Image locale de base :
  `infrastructure-backend:latest`.
- ⚠️ Ne pas démarrer la stack Docker en même temps que la stack native (mêmes ports).
- `docker compose up -d` depuis `infrastructure/` ; vérifier `docker compose ps` (healthy).

## Build APK Android

- **JDK 17 obligatoire** (AGP 8.0) : `C:\Users\deral\AppData\Local\Programs\jdk17\jdk-17.0.20+8`.
- **Hermes off** : `clearnet-mobile/app.json` → `expo-build-properties` → `"hermes": false`
  (unique source de vérité ; `expo prebuild` la propage à `android/gradle.properties`).
- `android/` est **généré** et gitignoré : un clone frais doit lancer
  `npx expo prebuild --platform android` avant Gradle.
- Résultat livré : APK universel 4 ABI (arm64-v8a, armeabi-v7a, x86, x86_64) —
  compatible avec tous les Android (ex. `clearnet-v1.3-hermes-off.apk`).

## Secrets & configuration backend

Defaults alignés compose/natif (pas de `.env` nécessaire) :
`NEO4J_URI=bolt://localhost:7687`, `NEO4J_USER=neo4j`, `NEO4J_PASSWORD=clearnet123`,
`JWT_SECRET=clearnet-dev-secret`, `DEMO_API_KEY=demo-secret-change-me`.
Blocage on-chain / Phase 2 / files : désactivés par défaut (`*_ENABLED=false`).

## Points de vigilance

- Le moteur Docker Desktop (WSL2) est instable sur ce poste (gel/redémarrage) :
  préférer le mode natif pour la journée courante.
- `metro`/`expo start` peut se bloquer sur ce poste ; l'APK empaqueté reste la voie fiable.
- Après modification du backend (`src/`), relancer `npm run build` puis `start-backend.cmd`.