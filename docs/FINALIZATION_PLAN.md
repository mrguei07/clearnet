# FINALIZATION_PLAN — Industrialisation & Mise en production ClearNet V1.4

Version : 1.0 — 17/08/2026 — Statut : **PRÊT À EXÉCUTER**
Rôle : Lead DevOps & Product Owner — Périmètre : monorepo ClearNet (backend, mobile, blockchain, infrastructure).

> Objectif : verrouiller les 6 axes opérationnels pour livraison aux early adopters, présentation investisseurs et intégration CI/CD pérenne. Toutes les actions sont reproductibles et automatisables ; les scripts et workflows de ce plan sont **déjà créés dans le repo** (voir Annexe A).

---

## 0. Constats réels relevés lors de l'audit (à corriger dans ce plan)

| # | Constat | Impact | Action |
|:--|:---|:---|:---|
| C1 | `patch-build.ps1`, `build-gradle.cmd`, `build-apk.cmd`, `clearnet-v1.4.apk` **non versionnés** (untracked) | Scripts perdus au clone/CI | `git add` + commit initial du socle (section 1.4) |
| C2 | `android/` **non versionné** | Tout build CI doit refaire `expo prebuild` + patch | CI pipeline le gère (1.1) ; option versionner `android/` versionné = discussion (1.4) |
| C3 | `mobile-ci.yml` (existant) lance `gradlew` **sans `patch-build.ps1`** → échouera sur Gradle 8 (guards `components.release`) | Faux positifs/negatifs sur PR | Aligner mobile-ci.yml (1.3, action 1) |
| C4 | `app.json` version **1.3.0** alors que le build est « V1.4 » | Artefacts mal identifiés | Bump `version: "1.4.0"` (action 3) |
| C5 | `app.json` `package: com.clearnet.mobile` (applicationId réel `com.clearnet.mobile` — prébuild génère le build.gradle depuis app.json) | Tests `adb`/store : utiliser `com.clearnet.mobile` | **✔ Résolu** : `validate-apk.ps1` aligné sur `com.clearnet.mobile` (am start, pidof, force-stop) — validé émulateur |
| C6 | `usesCleartextTraffic: true` (app.json) | HTTP en clair en release | Décision consciente pour la phase pilote (LAN) ; à verrouiller en production (4.3) |
| C7 | `SYSTEM_ALERT_WINDOW` dans le manifest | Permission sensible (overlay) | Vérifier l'usage réel et la retirer si non requise (4.3) |
| C8 | JDK 24 dans `JAVA_HOME` système ; le build passe par un JDK 17 local | Risque régression machine/CI | Garde systématique du JDK 17 dans CI + docs (fait) |
| C9 | Workflows existants (`ci-validation.yml`) couvrent helm+backend ; aucune release automatique | Pas d'artefact livrable automatisé | Nouveau `ci-cd.yml` (1.1) |
| C10 | Sondes Helm sur `/health` (route réelle `/api/health`) | K8s : rollout/boot bouclés (probes KO) | **✔ Corrigé** : `backend-deployment.yaml` startup/readiness/liveness → `/api/health` (aligné docker-compose, docs) |

---

## 1. CHAÎNE CI/CD (AUTOMATISATION COMPLÈTE)

### 1.1. Pipeline livré : `.github/workflows/ci-cd.yml`

Créé dans ce plan (rétrocompatible : les workflows existants restent actifs). Jobs :

| Job | Description | Déclencheur | Détails livrés |
|:---|:---|:---|:---|
| `lint-backend` | ESLint + Prettier `clearnet-backend` | push/PR | cache npm (package-lock) |
| `test-backend` | Build NestJS + Jest (unitaires + intégration BullMQ avec service Redis) | push/PR | service `redis:7-alpine` |
| `lint-mobile` | `tsc --noEmit` + `expo lint` | push/PR | cache npm |
| `build-android` | SDK components → `expo prebuild` → **`patch-build.ps1`** → **`build-gradle.cmd`** (`assembleRelease`) | push main/manuel | **windows-latest**, cache Gradle, upload APK+logs |
| `verify-apk` | Taille ≥ 60 Mo + `apksigner verify` + **extraction (tar) + vérif des ressources** (classes.dex, index.android.bundle, libhermes ×3 ABI) + `aapt2 badging` | après build | artifact `app-release` |
| `notify` | Slack webhook (statut global) | toujours | `secrets.SLACK_WEBHOOK_URL` (skip si vide) |
| `release` | Tag `v*` → GitHub Release avec APK en pièce jointe | tags `v*` | `gh release create` |

Points clés d'implémentation (dans le YAML) :
- **`android/` non versionné (C2)** → étape `npx expo prebuild --platform android --no-install` AVANT le patch.
- **Composants SDK idempotents** : installation conditionnelle de `platforms;android-34`, `build-tools;30.0.3` (exigé par RN, cf. FAQ du guide), `build-tools;35.0.0` (apksigner), `ndk;26.3.11579264`, `cmake;3.22.1` (**le NPE historique**), `platform-tools`.
- **Patch obligatoire** : `powershell -ExecutionPolicy Bypass -File .\patch-build.ps1` (vérifie JDK 17 + node_modules, idempotent — portabilité PS 5.1/pwsh validée).
- **Build via `build-gradle.cmd`** (conforme à la spec) : le batch a été rétrofit pour être utilisable en CI ET en local — il **honore les variables déjà définies** (JAVA_HOME de `setup-java`, ANDROID_HOME, NDK, EXPO_PUBLIC_API_URL), pose des **gardes** (JDK 17 / SDK / NDK présents), **fallback `gradlew.bat`** (wrapper) si la distribution locale est absente, et **propage l'exit code de Gradle** (correction d'un bug : exit 0 même en cas d'échec).
- **URL API** : `EXPO_PUBLIC_API_URL` injectée au build via `vars` GitHub (défaut émulateur `10.0.2.2`) — sinon l'IP LAN de dev serait cuite dans les artefacts.
- **Cache Gradle** : `actions/cache` keyé sur `gradle-wrapper.properties` (distribution 8.0.1 téléchargée une fois).
- **verify-apk « extrait et vérifie »** : `tar -tf` (liste des entrées) + présence de `classes.dex`, `assets/index.android.bundle` et `lib/{arm64-v8a,armeabi-v7a,x86_64}/libhermes.so` (JNI compilé — échec = ABI manquante).

> **Leçon batch Windows** (retrofit `build-gradle.cmd`) : cmd.exe exige un fichier **100 % ASCII** (pas d'accents/UTF-8), des fins de ligne **CRLF**, et **aucune parenthèse dans les blocs `if (...)`** (`(cf. …)` = bloc imbriqué → erreur de parsing « était inattendu »).

### 1.2. Secrets & variables à configurer (Settings → Actions)

| Variable/Secret | Type | Usage |
|:---|:---|:---|
| `EXPO_PUBLIC_API_URL` | Variable | URL API cuite dans l'APK (défaut `http://10.0.2.2:3000/api`) |
| `SLACK_WEBHOOK_URL` | Secret | Notifications (job `notify`) |
| `ANDROID_SIGNING_KEYSTORE` + `ANDROID_SIGNING_PASSWORD` | Secrets | À ajouter quand la signature dédiée remplace le debug keystore (3.1) |

### 1.3. Alignements des workflows existants (actions)

| # | Action | Fichier | État |
|:--|:---|:---|:---|
| 1 | Ajouter `patch-build.ps1` avant `gradlew` dans `build-apk` (C3) | `.github/workflows/mobile-ci.yml` | À faire |
| 2 | Bump version `1.4.0` (C4) | `clearnet-mobile/app.json` + `package.json` | À faire |
| 5 | **Rétablir le toolchain local documenté** (JDK 17 extrait de `jdk17-ms.zip`, Gradle 8.0.1 téléchargé via services.gradle.org — les chemins Temp/opencode étaient vides) + gardes de version JDK dans `build-gradle.cmd` et `patch-build.ps1` (exit 1 en CI) | `clearnet-mobile/build-gradle.cmd` + `patch-build.ps1` | ✅ fait |
| 3 | Unifier le package `com.clearnet` (C5) | `clearnet-mobile/app.json` | À faire |
| 4 | Cache Gradle dans `mobile-ci.yml` (réutiliser le pattern de 1.1) | `.github/workflows/mobile-ci.yml` | À faire |

### 1.4. Versionnage initial (C1) — commande de socle

```powershell
git add clearnet-mobile/patch-build.ps1 clearnet-mobile/build-gradle.cmd clearnet-mobile/build-apk.cmd clearnet-mobile/validate-apk.ps1 .github/workflows/ci-cd.yml FINALIZATION_PLAN.md
git commit -m "chore(ci): industrialisation build Android (patch idempotent, pipeline release, validation APK)"
```

> **Décision à trancher** (C2) : versionner `clearnet-mobile/android/` (reproductibilité maximale, patchs « gelés », prebuild rare) vs générer en CI (état de l'art Expo). Recommandation pilote : **versionner** `android/` patché + garder prebuild en CI comme contrôles. Si versionné, retirer du `.gitignore` et vérifier que `npx expo prebuild` n'écrase pas de modifs (il refuse en cas de conflit → comportement sûr).

### 1.5. Déclencheurs & rétrocompatibilité

- `ci-validation.yml` (helm + backend) : inchangé — garde-fou PR.
- `mobile-ci.yml` (APK debug + Maestro) : inchangé sauf action 1/4.
- `ci-cd.yml` : le pipeline de livraison (release uniquement sur tags `v*`).
- Le build reste possible localement : `build-gradle.cmd` (dev) / CI (wrapper Gradle) — mêmes patches, deux chemins documentés.

---

## 2. VALIDATION FONCTIONNELLE APPROFONDIE (APK RÉEL)

### 2.1. Batterie automatisée livrée : `clearnet-mobile/validate-apk.ps1`

Reprend la section 4 de `BUILD_FIX_GUIDE.md` + splash (screencap) + backend, en checks indépendants, exit code 0/1 :

```powershell
# Depuis clearnet-mobile (émulateur ou device branché) :
powershell -ExecutionPolicy Bypass -File .\validate-apk.ps1
# Variantes : -SkipInstall (APK déjà installée), -SkipDevice (build-only), -ApkPath <autre chemin>
```

Checks : taille ≥ 60 Mo · `apksigner verify` · appareil adb · install · `am start com.clearnet.mobile/.MainActivity` · processus vivant 5 s (pidof, repli `ps`) · **aucun** `FATAL EXCEPTION` (logcat) · splash capturé (`splash-check.png`, fond `#0b1220` + logo) · backend `/api/health` (info, non bloquant). **Testé : TOUTES LES CHECKS OK** — d'abord build-only, puis **APK signée prod sur émulateur Pixel_7a (headless)** : install, launch, processus vivant, splash, zéro FATAL EXCEPTION. Bugs corrigés au passage dans validate-apk.ps1 : package réel `com.clearnet.mobile` (au lieu de `com.clearnet`) + variable `$pid` renommée `$procPid` (read-only PS).

### 2.2. Matrice E2E métier (manuel — 20 min, émulateur + backend local)

| # | Flux | Procédure | Critère de succès |
|:--|:---|:---|:---|
| E1 | Inscription + login | Registre → login → profil | JWT reçu, profil affiché |
| E2 | Compensation (moteur) | Transaction A→B, vérif Neo4j + solde | `GET /api/transactions/history` cohérent |
| E3 | Pont on-chain (optionnel) | Backend avec `BLOCKCHAIN_ENABLED=true` + hardhat node | Logs « Position mise à jour 0x… » (cf. README-DEMO 4.2) |
| E4 | **Offline-first** | Mode avion (2.3) → 2 transactions → rétablir → sync | Transactions en file, rejouées au retour réseau, zéro perte |
| E5 | **WebSocket temps réel** | Backend UP → transaction via API → écran mobile | Mise à jour pushée < 3 s sans refresh |
| E6 | Splash + navigation | Relances froides ×3, tabs | Splash ~2 s, pas de flash blanc, pas de crash |
| E7 | Export rapport (PDF) | Écran export → partage | Fichier généré, écrit en stockage (permission WRITE) |
| E8 | Ergonomie sombre | Parcours complet en thème dark | Contraste lisible, pas de texte tronqué |

### 2.3. Procédures réseau reproductibles (offline / latence)

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
# Mode avion logiciel (émulateur/device) :
& $adb shell cmd connectivity airplane-mode enable
# Rétablir :
& $adb shell cmd connectivity airplane-mode disable
# Réseau instable (émulateur) : latence + pertes de paquets
#   Android Studio AVD Manager → Edit config → Advanced → Network speed/latency
#   ou proxy de faute (ex : Clumsy/NetLimiter sur le LAN)
# Assertion du test offline (E4) :
& $adb logcat -d -s ReactNativeJS:V | Select-String "offline|queue|sync"
```

### 2.4. Extension Maestro (flows versionnés)

Existant : `.maestro/login.yaml`, `.maestro/offline-sync.yaml` (exécutés en CI par `mobile-ci.yml`). **Créés dans ce plan** (basés sur les testIDs réels du code) :

| Fichier | Flux | Points de contrôle |
|:---|:---|:---|
| `.maestro/compensation.yaml` | Inscription → paiement → historique | `tx-history-first` visible après `tx-submit` |
| `.maestro/websocket.yaml` | Inscription → injection d'une transaction par l'API → historique mis à jour | `runScript` `scripts/trigger-transaction.js` (Maestro ≥ 3.5, API `maestro.http`) |

> ⚠️ **appId** : les flows utilisent `com.clearnet` (l'`applicationId` réel du build) — l'existant `.maestro/login.yaml` utilise `com.clearnet.mobile` (C5). L'alignement C5 rendra le deux cohérents. Les flows EXIGENT un backend joignable depuis l'émulateur (`10.0.2.2:3000`) : le job CI `maestro-e2e` actuel n'y a pas de service backend — alignment (job `maestro-e2e` : services neo4j+redis+backend) prévu en P1.

### 2.5. Checklist finale avant livraison early adopters

- [ ] `validate-apk.ps1` : TOUTES LES CHECKS OK sur émulateur API 33 et un device Android 10+ réel
- [ ] Matrice E2E E1→E8 complétée (tableau 2.2) sur les 2 cibles
- [ ] `pidof` bloqué sur Android 10+ → vérifié via `ps` (alternative du guide)
- [ ] Aucun `FATAL EXCEPTION` sur 10 relances
- [ ] Test offline avec 5 transactions en file, sync complète < 30 s
- [ ] WebSocket : 3 mises à jour temps réel < 3 s

---

## 3. PRÉPARATION DES ARTEFACTS DE DÉMONSTRATION

### 3.1. APK signé (release)

| Étape | Commande | Statut |
|:---|:---|:---|
| Build | `.\build-gradle.cmd` (local) ou CI `ci-cd.yml` | Fait (clearnet-v1.4.apk — dernière : build `-UseInitGradle` validé, 64,4 Mo) |
| Renommage artefact | `app-release.apk` → `clearnet-v1.4.apk` | Fait (build-apk.cmd) |
| **Vérif signature** | `validate-apk.ps1` (apksigner) | Fait — signé **debug keystore** |
| **Keystore de production** | `clearnet-mobile\create-release-keystore.cmd` (idempotent, retry) → `%USERPROFILE%\.clearnet-keys\clearnet-release.jks` + `keystore-password.txt` | ✅ **GÉNÉRÉ dans ce plan** (RSA 2048, 10 000 j) — **à copier dans un gestionnaire de secrets** (emplacement : `C:\Users\deral\.clearnet-keys\`) |
| **Signer en production** | `zipalign -p 4` + `apksigner sign --ks clearnet-release.jks` (+ `--ks-pass file:keystore-password.txt` — jamais le mot de passe en clair dans la commande) | ✅ **FAIT** → `clearnet-mobile\clearnet-v1.4-release-signed.apk` (65,98 Mo, cert `CN=ClearNet, OU=DevOps`) — **validée sur émulateur Pixel_7a : TOUTES LES CHECKS OK** |
| Backup | Keystore + mots de passe dans un gestionnaire de secrets (1Password/Keepass), jamais dans le repo | P0 (fichiers déjà hors repo, `.gitignore` renforcé : `*.jks`, `*.apk`) |

> **✅ À jour** : l'APK distribuée aux early adopters est désormais **signée avec le keystore de production** (`clearnet-v1.4-release-signed.apk`) ; le keystore original (`%USERPROFILE%\.clearnet-keys\`) reste la seule source de vérité — à sauvegarder dans un gestionnaire de secrets AVANT toute distribution publique.

### 3.2. Documentation commerciale (checklist de production)

| Document | Contenu | Source | Responsable |
|:---|:---|:---|:---|
| One-pager produit | Problème/solution, moteur de compensation, 3 chiffres clés | README + pitch | PO |
| Fiche technique | Stack (NestJS 10, Neo4j 5, RN 0.72/Expo 49, Solidity 0.8.19, BullMQ), architecture, sécurité | README-PROD.md + BUILD_FIX_GUIDE.md | DevOps |
| Note de crédibilité engineering | BUILD_FIX_GUIDE.md (cause racine CMake, patch idempotent, CI/CD) — « preuve de maturité » | BUILD_FIX_GUIDE.md | DevOps |
| Cartes démo | 3 scénarios de 5 min (compensation, offline, on-chain) | README-DEMO.md | PO |
| FAQ investisseurs | 10 questions/réponses (tokenomics, sécurité, roadmap) | — | PO |

### 3.3. Vidéo de démonstration (3-5 min)

Storyboard (outil : OBS Studio, enregistrement 1080p/60 fps, + écran téléphone via adb `screencap`/scrcpy) :

| Scène | Durée | Contenu | Capture |
|:--|:--|:---|:---|
| 1. Hook | 15 s | Problème : compensation manuelle/opaque | Splash + voix off |
| 2. Moteur | 60 s | Transaction A→B, graphe Neo4j, liquidation | API + Neo4j Browser |
| 3. Mobile | 60 s | Login, solde, transaction, historique | scrcpy + zoom |
| 4. Offline | 45 s | Mode avion → transactions → sync au retour | scrcpy + logcat |
| 5. On-chain | 45 s | Hardhat/Sepolia, tx Etherscan | Browser + deploy script |
| 6. Pitch final | 30 s | Équipe, roadmap, CTA | Overlay texte |

Checklist : script voix off écrit · légendes FR · logo ClearNet en intro/outro (`Logo/ClearNet Logo 1.png`) · pas d'IP locale visible (masquer l'URL de l'API) · durée ≤ 5 min · export MP4 1080p.

### 3.4. Jeu de données de test

- **Seed existant** : `POST /api/demo/seed` (header `X-Demo-Key: demo-secret-change-me` — à changer en pilote, cf. 4.2) — 20 utilisateurs + transactions, réinitialisable.
- **Dataset on-chain** : `deployments/sepolia.json` (adresses CLRN + CompensationEngine, vérifiables Etherscan) — 4.4 du README-DEMO.
- **À créer (P2)** : fixture JSON versionnée (`infrastructure/testdata/demo-seed.json`) pour régénérer les données à l'identique (importable via script npm dédié) + script d'anonymisation (noms fictifs, pas d'emails réels).
- **Purge** : commande de reset du seed (éviter les données de démo en production).

---

## 4. SÉCURITÉ & CONFORMITÉ FINALE

### 4.1. Audit des secrets (P0 — avant tout partage)

**Résultat de l'audit exécuté (17/08/2026)** :
- ✅ **Aucun `.env` commité** (seuls `.env.example` versionnés) ; `.gitignore` couvre `.env` + désormais `*.apk`, `*.jks`, `keystore-password.txt`.
- ⚠️ **Défauts dev dans le source** (à remplacer en prod — rotation) : `JWT_SECRET` défaut `clearnet-dev-secret` (`auth.module.ts`, `jwt.strategy.ts`), `DEMO_API_KEY` défaut `demo-secret-change-me` (`demo-api-key.guard.ts`), `NEO4J_PASSWORD` défaut `clearnet123` (`neo4j.module.ts`).
- ⚠️ Texts documentaires exposent ces défauts (README-DEMO, CLEARNET-V1.1-REMEDIATION.md…) : acceptable en doc, aucune clé réelle.
- 🔜 **Gitleaks ajouté au pipeline** (job `secrets-scan` dans `ci-cd.yml`) — scan de l'historique à chaque push/PR.

Commandes de rotation (une fois les secrets de prod choisis — P1) :

```powershell
# 1. Fichiers .env jamais commités (gitignore OK) — vérif :
git ls-files | Select-String "\.env$"
# 2. Recherche de secrets dans l'historique git (JWT_SECRET, PRIVATE_KEY, mots de passe…) :
git log --all -p -- . | Select-String -Pattern "PRIVATE_KEY=|JWT_SECRET|NEO4J_PASSWORD|demo-secret"
# 3. Scan automatisé (ajouté au CI) :
#    job secrets-scan (gitleaks) dans .github/workflows/ci-cd.yml
# 4. Rotation des secrets exposés : changer JWT_SECRET, NEO4J_PASSWORD, X-Demo-Key
#    (le seed demo "demo-secret-change-me" est RÉSERVÉ au dev ; en pilote : valeur dédiée + rotate)
```

### 4.2. Audit des dépendances (P1)

```powershell
# Backend + mobile + blockchain (niveau CI : ajouter à lint-backend/lint-mobile) :
cd clearnet-backend; npm audit --omit=dev
cd clearnet-mobile; npm audit --omit=dev; npx expo-doctor   # santé du projet Expo
cd clearnet-blockchain; npm audit --omit=dev
# Gradle (post-build CI, P2) : plugin OWASP dependency-check sur android/ + rapport HTML
```

### 4.3. Durcissement ciblé (actions avec décision PO)

| # | Point | État | Décision | Réf |
|:--|:---|:---|:---|:---|
| S1 | `usesCleartextTraffic: true` | Release actuelle | **Pilote LAN : accepté, documenté**. Production : HTTPS obligatoire + `false` | C6 |
| S2 | `SYSTEM_ALERT_WINDOW` (manifest) | Présente | Vérifier l'usage réel (overlay react-native ?) ; retirer si non requis | C7 |
| S3 | `READ/WRITE_EXTERNAL_STORAGE` | Présentes | Legacy Android ≤ 12 — documenter ; supprimer si export PDF passe par le partage (scoped storage) | — |
| S4 | `EXPO_PUBLIC_API_URL` en clair | Oui | URL publique sans secret — acceptable ; ne jamais y mettre de credentials | — |
| S5 | Bundler release | RN 0.72 | minify activé par défaut (`enableMinify` build.gradle) — vérifier absence de clés d'API dans le JS bundle : `strings.exe`/`grep -a` sur l'APK | — |
| S6 | Keystore | debug | Keystore dédié P1 (3.1) | — |
| S7 | FaceID (`NSFaceIDUsageDescription`) | iOS | Usage réel à documenter (futur) | — |

### 4.4. Conformité (pilote FR — minimum RGPD)

- [ ] Données stockées en local (SQLite/AsyncStorage) : déclarer le traitement ; le chiffrement au repos est P2
- [ ] Consentement explicite à l'inscription (case à cocher + lien politique de confidentialité)
- [ ] Droit d'export (le PDF de rapport = support d'export) + suppression de compte (endpoint ou procédure manuelle documentée)
- [ ] Rétention : définir et documenter (ex : 12 mois de transactions, historique on-chain conservé)
- [ ] Pas de données personnelles réelles dans les jeux de test (3.4, anonymisation)

---

## 5. DÉPLOIEMENT & MONITORING (PHASE PILOTE)

### 5.1. Topologie pilote

| Composant | Mode | Notes |
|:---|:---|:---|
| Backend + Neo4j + Redis | VM/cloud : `infrastructure/docker-compose.yml` (healthchecks inclus) | ou Helm sur k8s (chart existant, README-PROD) |
| Métriques | **Prometheus + Grafana** — dashboard existant : `infrastructure/grafana/dashboard-clearnet.json` (import : datasource Prometheus, namespace clearnet) | exporter cAdvisor ou node-exporter en P2 |
| Logs | Fichiers + `docker logs` (pilote) ; Loki/ELK en P2 | rétention 30 j |
| URLs | Reverse-proxy HTTPS (traefik/caddy) + cert Let's Encrypt en P2 | S1 |
| BullMQ | File Redis visible via Grafana (compteurs) + `QUEUE_ENABLED` toggle (README-PROD 2.5) | DLQ 3.3 |

### 5.2. Alertes (règles proposées — P1)

```yaml
# infrastructure/grafana/prometheus-alerts.yml (à créer) — seuils pilote
groups:
  - name: clearnet-pilot
    rules:
      - alert: BackendDown
        expr: probe_success{job="clearnet-http"} == 0
        for: 2m
        annotations: { summary: "Backend injoignable (healthcheck)" }
      - alert: Backend5xx
        expr: sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m])) > 0.05
        for: 5m
      - alert: QueueBacklog
        expr: sum(bullmq_job_count{status="waiting"}) > 50
        for: 10m
      - alert: Neo4jDown
        expr: neo4j_up == 0
        for: 2m
      - alert: DiskHigh
        expr: node_filesystem_avail_bytes{fstype!="tmpfs"} < 5e9
        for: 15m
```

### 5.3. SLI/SLO pilote + dashboard

| SLI | Définition | Cible pilote | Surveillance |
|:---|:---|:---|:---|
| Disponibilité API | `probe_success` / 5 min | ≥ 99 % | Blackbox exporter (healthcheck `/api/health`) |
| Latence p95 transactions | Métrique http | < 800 ms | Prometheus/Grafana |
| Sync offline | Délai file→rejoué | < 30 s | Logs + compteurs BullMQ |
| Crash mobile | `FATAL EXCEPTION` / session | 0 | logcat device ; Sentry en P2 |
| Couverture compensation | Tx compensées / total | > 95 % | Requête Neo4j + dashboard dédié |

### 5.4. Runbook pilote (1 page — à compléter)

1. Backend down → `docker compose -f infrastructure/docker-compose.yml restart backend` ; si échec : logs `docker logs clearnet-backend` ; rollback image précédente.
2. File bloquée → désactiver `QUEUE_ENABLED=false`, inspecter la DLQ (README-PROD 2.5/2.6), rejouer après fix.
3. Neo4j down → restart + vérifier `NEO4J_AUTH` et volume `neo4j-data`.
4. APK défectueux → re-build tag `v*`, re-diffusion (3.1) ; process de support section 6.

---

## 6. PLAN DE COMMUNICATION & DE SUIVI

### 6.1. Template présentation early adopters (15 min)

1. **Positionnement (2 min)** : problème, valeur du moteur de compensation, marché.
2. **Démo live (5 min)** : scénarios 1-2 du README-DEMO (compensation + mobile).
3. **Technique (3 min)** : 1 slide stack + 1 slide sécurité (chiffres : tests CI, couverture, build reproductible — s'appuyer sur BUILD_FIX_GUIDE).
4. **Pilote (3 min)** : ce qu'ils testent, périmètre, limites (LAN, données de test).
5. **Feedback (2 min)** : formulaire + rendez-vous de suivi.

### 6.2. Formulaire de feedback (champs — Typeform/Google Forms, anonymisé)

- Fréquence d'utilisation attendue · 3 points bloquants rencontrés · facilité (1-5) · valeur du moteur de compensation (1-5) · acceptez-vous les mises à jour bimensuelles ? · email de contact (optionnel) · commentaire libre.

### 6.3. Planning support pilote

| Canal | Créneau | SLA cible | Référence |
|:---|:---|:---|:---|
| Slack/Teams dédié early adopters | Lu J+0 | < 4 h ouvrées | — |
| Email support | — | < 24 h | — |
| Correctifs critiques (crash/sécurité) | Prioritaire | hotfix tag + diffusion < 48 h | pipeline release (1.1) |
| Release cadence | Bimensuel | Notes de version publiques | tags `v*` |

### 6.4. KPIs pilote (revue hebdomadaire)

Activation (inscriptions/graines) · rétention D7 · transactions/jour · incidents (MTTR/MTBF) · feedback reçu · NPS à J+30. Cible de sortie de pilote : ≥ 10 early adopters actifs, 0 crash, NPS ≥ 40 → validation production.

---

## Annexe A — Livrables créés par ce plan

| Fichier | Type | État |
|:---|:---|:---|
| `FINALIZATION_PLAN.md` | Plan (ce document) | ✅ créé |
| `.github/workflows/ci-cd.yml` | Pipeline release complet (7 jobs) | ✅ créé |
| `clearnet-mobile/validate-apk.ps1` | Batterie de validation APK | ✅ créé + testé OK |
| `clearnet-mobile/patch-build.ps1` | Patch idempotent (portabilité CI ajoutée) | ✅ durci (pwsh/PS 5.1) |
| `clearnet-mobile/build-gradle.cmd` | Build dev + CI (`%LOCALAPPDATA%` générique, env-override, fallback wrapper, exit code) | ✅ rétrofit + tests gardes OK |
| `.github/workflows/mobile-ci.yml` | Alignement patch-build.ps1 + cache | 🔜 action 1.3 |
| `infrastructure/grafana/prometheus-alerts.yml` | Règles d'alerte pilote | 🔜 P1 (5.2) |
| `infrastructure/testdata/demo-seed.json` | Fixture versionnée | 🔜 P2 (3.4) |
| `clearnet-mobile/.maestro/{compensation,websocket}.yaml` | Flows E2E | 🔜 P1 (2.4) |

## Annexe B — Priorisation

| Priorité | Actions |
|:---|:---|
| **P0 (avant diffusion)** | Versionnage socle (1.4) · rotation secrets démo (4.1) · validation APK complète (2.5) · artefact nommé `clearnet-v1.4.apk` signé debug |
| **P1 (semaine 1-2 pilote)** | Keystore dédié (3.1) · alignement mobile-ci (1.3) · alertes Prometheus (5.2) · flows Maestro supplémentaires (2.4) · npm audit + expo-doctor en CI (4.2) · formulaire feedback (6.2) |
| **P2 (semaine 3-4)** | Fixture seed versionnée (3.4) · Loki/ELK + reverse-proxy HTTPS (5.1, S1) · Sentry mobile (5.3) · gitleaks en CI (4.1) · suppression compte RGPD (4.4) |

## Annexe C — Risques & mitigations

| Risque | Prob. | Impact | Mitigation |
|:---|:---|:---|:---|
| Patch perdus en CI (mauvais ordre prebuild/patch) | M | Élevé | Pipeline ordonné + `patch-build.ps1` idempotent + garde node_modules |
| `-UseInitGradle` non validé en build réel | M | Faible | Note au guide ; CI utilise le mode par défaut ; validation en CI P1 |
| Gradle 8.0.1 à télécharger en CI (services.gradle.org) | M | Moyen | Cache Gradle keyé wrapper ; fallback : miroir local `GRADLE_HOME_BIN` sur runner auto-hébergé |
| Keystore debug utilisé en production | H | Critique | Keystore dédié P1 + règle de review (S6) |
| Données de démo dans la base pilote | M | Moyen | Purge documentée (3.4) + dataset séparé |
| JDK 21/24 système casse un build | M | Élevé | Garde JDK 17 dans patch-build.ps1 + setup-java piné en CI (C8) |

---

**Prochaine étape immédiate (P0)** : valider le plan avec l'équipe, puis exécuter « Versionnage socle » (1.4) et produire l'APK de démonstration via `build-gradle.cmd` + `validate-apk.ps1`.
