# ClearNet — Backend HTTPS & migration Expo SDK 57

État au 2026-08-23. Deux chantiers réalisés au niveau code/config ; les
validations *runtime* (stack Docker locale, build APK) nécessitent une machine
provisionnée (voir §Prérequis).

---

## 1. Backend public HTTPS (Caddy + Let's Encrypt)

### Fichiers livrés

| Fichier | Rôle |
|---|---|
| `infrastructure/docker-compose.prod.yml` | Stack prod : neo4j + redis + backend + **caddy**. Seuls les ports 80/443 (Caddy) sont publiés ; Neo4j/Redis/backend restent internes. |
| `infrastructure/caddy/Caddyfile` | Reverse proxy HTTPS. `{$SITE_ADDRESS:localhost}` → `reverse_proxy backend:3000`. |
| `infrastructure/.env.prod.example` | Modèle d'environnement prod (SITE_ADDRESS, ports, secrets). |
| `scripts/deploy-vps.sh` | **Déploiement VPS one-command** : installe Docker, génère JWT_SECRET/NEO4J_PASSWORD (`openssl rand`), lance la stack, attend le healthcheck et vérifie `https://$DOMAIN/api/health`. |

### Validation locale (HTTPS auto-signé via CA interne Caddy)

```powershell
# générer .env.prod (déjà fait en local ; sur un autre poste : copier .env.prod.example)
docker compose --env-file infrastructure/.env.prod -f infrastructure/docker-compose.prod.yml up -d --build

# Récupérer la CA interne Caddy puis tester en HTTPS
docker compose -f infrastructure/docker-compose.prod.yml exec -T caddy cat /data/caddy/pki/authorities/local/root.crt > ca.crt
curl --cacert ca.crt https://localhost:8443/api/health
# -> {"status":"ok","neo4j":"connected"}
```

> `localhost` + `tls internal` = Caddy émet un certificat signé par sa CA
> interne, sans Let's Encrypt. Sur le VPS, un vrai domaine déclenche
> automatiquement Let's Encrypt (aucune action manuelle).

### Mise en ligne (VPS)

```bash
DOMAIN=api.clearnet.fr ./scripts/deploy-vps.sh
```

Prérequis : DNS A/AAAA du domaine pointé sur le VPS + ports 80/443 ouverts.
Puis, côté mobile : `EXPO_PUBLIC_API_URL=https://api.clearnet.fr/api`.

---

## 2. Migration Expo SDK 49 → 57

### Versions finales

| Paquet | Avant | Après |
|---|---|---|
| expo | ~49.0.21 | 57.0.15 |
| react-native | 0.72.10 | 0.86.2 |
| react / react-dom | 18.2.0 | 19.2.3 |
| typescript | 5.3.3 | ~6.0.3 |
| @types/react | ~18.2.45 | ~19.2.4 |
| expo-sqlite | 11.1.1 | ~57.0.1 |
| expo-build-properties | ^0.6.0 | ~57.0.13 |
| react-native-svg | 13.9.0 | 15.15.4 |

### Changements de code / config

1. **`src/db/initDb.ts`** — réécrit sur l'API async d'expo-sqlite
   (`openDatabaseAsync`, `execAsync`, `runAsync`, `getAllAsync`). L'ancienne API
   `openDatabase`+`executeSql` (`expo-sqlite/legacy`) **n'existe plus** en SDK 57.
   Signatures exportées inchangées → aucun impact sur les appelants.
2. **`app.json`** — plugin `expo-build-properties` :
   - supprimé `compileSdkVersion`/`targetSdkVersion: 34` → défauts SDK 57 (36) ;
   - supprimé `hermes: false` → **Hermes réactivé** (RN 0.86 est Hermes-first ;
     le workaround « crash MediaTek » de l'ère SDK 49 est obsolète — à re-tester
     sur l'appareil concerné) ;
   - `ios.deploymentTarget` `13.0` → `16.4` (minimum SDK 57).
3. **`.npmrc`** ajouté (`legacy-peer-deps=true`) pour lisser la résolution npm.

### Validation effectuée (passante)

- `npx tsc --noEmit` → **OK** (TypeScript 6).
- `npx expo-doctor` → **21/21 checks passed**.
- `npx expo prebuild --platform android` → **OK** (génère Gradle 9.3.1,
  New Architecture activée, Hermes activé).

### Build APK (prérequis machine)

RN 0.86 / AGP 8.12.0 impose :

| Composant | Version |
|---|---|
| JDK | 17 ou 21 (⚠️ `JAVA_HOME` actuel = jdk-24, non garanti avec AGP 8.12) |
| Gradle | 9.3.1 (téléchargé par le wrapper) |
| compileSdk / targetSdk | 36 |
| build-tools | 36.0.0 |
| NDK | 27.1.12297006 |
| CMake | requis (New Architecture) |

```powershell
cd clearnet-mobile
$env:EXPO_PUBLIC_API_URL="https://api.clearnet.fr/api"   # URL prod au build
$env:JAVA_HOME="C:\...\jdk-17"
npx expo prebuild --platform android --no-install
.\android\gradlew.bat -p android :app:assembleRelease
# -> android\app\build\outputs\apk\release\app-release.apk
```

> Sur la machine actuelle, l'Android SDK et le JDK 17 (anciennement dans
> `%LOCALAPPDATA%\Temp\opencode\...`) ont été purgés : réinstaller
> cmdline-tools + `sdkmanager "platforms;android-36" "build-tools;36.0.0"
> "ndk;27.1.12297006" "cmake;3.22.1"` avant de builder, ou utiliser la CI
> (`.github/workflows/ci-cd.yml`) qui provisionne déjà ces composants.

---

## 3. Reste à faire avant publication (hors périmètre de ce chantier)

- Retirer `usesCleartextTraffic: true` (app.json + plugin `withClearNetNative.js`) une fois l'API en HTTPS.
- Câbler la signature release (keystore) dans Gradle et produire un **AAB** (`bundleRelease`).
- Build iOS (macOS/EAS) + dossiers `ios/`.
- Endpoint de suppression de compte (requis Play Store / RGPD).
- Comptes Google Play / Apple Developer, fiches store, politiques de confidentialité.
