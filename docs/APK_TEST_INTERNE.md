# ClearNet — Préparer une APK Android pour test interne

**Objectif** : générer une APK installable sur un téléphone Android, pointant
vers l'environnement **sandbox** ClearNet, pour un test interne complet.

**Stack du projet (source de vérité)** : Expo SDK 57 / RN 0.86 · **npm** (pas
yarn — `clearnet-mobile/package-lock.json`) · `eas.json` **déjà configuré** avec
un profil `preview` qui produit une APK · la CI (`ci-cd.yml`) construit déjà
l'AAB de production → **EAS `preview` est le chemin le plus simple pour l'APK**.

**Durée estimée** : 30 min (EAS) — le build cloud dure 5-15 min.

---

## 1. Prérequis

- [ ] Node.js 20 LTS (`node -v`).
- [ ] npm (`npm -v`) — le projet utilise npm.
- [ ] `npm install -g eas-cli` + `eas login` (compte Expo gratuit).
- [ ] Un téléphone Android avec « installer des sources inconnues » autorisé.
- [ ] **Sandbox démarré** (voir §2) — sinon l'APK pointera vers une API morte.

## 2. Où l'app lit l'URL de l'API

`clearnet-mobile/src/api/client.ts` → `resolveBaseUrl()` :

1. `process.env.EXPO_PUBLIC_API_URL` si défini (prioritaire) ;
2. sinon `http://10.0.2.2:3000/api` (émulateur Android) ;
3. sinon `http://localhost:3000/api`.

➡️ **Pour viser le sandbox, il suffit de définir `EXPO_PUBLIC_API_URL` au
moment du build** — aucun changement de code.

### 2.1 Options d'URL sandbox (choisir une)

| Cas | URL | Note |
|---|---|---|
| Sandbox public (recommandé) | `https://sandbox.clearnet.io:8444` (ou votre domaine) | HTTPS → aucun réglage |
| Sandbox Docker local, téléphone sur le même Wi-Fi | `http://192.168.1.10:8081` (IP LAN de la machine) | ⚠️ HTTP → voir §2.2 |
| Tunnel HTTPS sur sandbox local | `https://xxx.ngrok.io` (ngrok/Cloudflare Tunnel vers `localhost:8081`) | HTTPS → recommandé si pas de domaine |

### 2.2 ⚠️ HTTP en clair (important)

Le durcissement store a mis **`usesCleartextTraffic=false`** : une URL `http://`
sera bloquée par Android. Deux options pour un test interne uniquement :

- **Recommandé** : tunnel HTTPS (ngrok) — aucune modification de code.
- **Temporaire** : dans `clearnet-mobile/app.json`, passer
  `expo-build-properties → android → usesCleartextTraffic` à `true`, rebuilder,
  puis **repasser à `false` avant tout build store**.

## 3. Définir `EXPO_PUBLIC_API_URL` (2 méthodes)

**Méthode 1 — fichier `.env`** (chargé automatiquement par EAS et par `expo start`) :

```bash
cd clearnet-mobile
# .env est gitignoré — créer :
echo "EXPO_PUBLIC_API_URL=https://sandbox.clearnet.io:8444/api" > .env
```

**Méthode 2 — variables d'environnement EAS** (par environnement) :

```bash
cd clearnet-mobile
eas env:create --environment preview EXPO_PUBLIC_API_URL https://sandbox.clearnet.io:8444/api
```

> Les deux méthodes fonctionnent ; la Méthode 1 est la plus rapide.

## 4. Build de l'APK — Option A : EAS (recommandé)

`clearnet-mobile/eas.json` contient **déjà** le profil `preview` :

```json
"preview": {
  "distribution": "internal",
  "android": { "buildType": "apk" }
}
```

➡️ **L'APK de preview est signée avec un keystore de debug par défaut : aucun
keystore à créer ni mot de passe à gérer.**

```bash
cd clearnet-mobile
eas build -p android --profile preview
```

- Build cloud : **5 à 15 min** (file d'attente Expo).
- À la fin : **lien de téléchargement direct de l'APK** (et notification).
- Version visible : `1.5.0`, `versionCode` géré par EAS (`appVersionSource: remote`).

## 5. Build de l'APK — Option B : local avec Gradle

⚠️ Toolchain locale requise (celle utilisée par la CI) : **JDK 17/21**, Android
SDK (platform 36, build-tools 36.0.0, **NDK 27.1**, cmake). Sur cette machine de
dev, l'Android SDK est présent mais le réseau local est trop lent pour Gradle —
**préférer EAS** ; sinon :

```powershell
cd clearnet-mobile
npx expo prebuild --platform android
cd android
.\gradlew.bat :app:assembleDebug
# → android\app\build\outputs\apk\debug\app-debug.apk (keystore debug, installable)
```

> `assembleRelease` existe aussi (script maison `build-sdk57.ps1` = AAB release).
> Pour une APK release signée en interne : `create-release-keystore.cmd` (keystore
> dans `%USERPROFILE%\.clearnet-keys\`).

## 6. Installation sur le téléphone

```bash
# via USB (débogage activé) :
adb install chemin\vers\app.apk
```

Ou : transférer le fichier (Drive/e-mail/USB) → l'ouvrir → autoriser
l'installation de sources inconnues → l'app apparaît dans le tiroir.

## 7. Checklist de validation (test interne)

- [ ] L'APK s'installe et démarre sans crash.
- [ ] Écran de connexion affiché.
- [ ] Connexion sandbox OK — compte démo : **`armateur-cmr@maritime-demo.fr` / `Sandbox2026!`**.
- [ ] Données seedées visibles : solde, **cycles** (Réseau), **Trésorerie** (immobilisé/libéré/économie).
- [ ] Onglets : Accueil, Transactions, Réseau, Abonnement, Tréso + 🔔/Profil (suppression de compte).
- [ ] Aucune erreur réseau (l'URL sandbox répond en HTTPS).
- [ ] Logs propres (`adb logcat` si besoin).

## 8. Distribution interne sécurisée

| Méthode | Détail |
|---|---|
| **Lien EAS** (défaut) | lien signé expirant fourni par `eas build` — suffisant pour l'équipe |
| **Firebase App Distribution** | liste de testeurs, gestion de versions, recommandé si > 5 testeurs |
| **APK signée en interne** | keystore dédié (`create-release-keystore.cmd`) + mot de passe partagé en interne uniquement |

> L'avertissement « APK non signée par un store » est normal pour un test interne.

## 9. Checklist finale

- [ ] `EXPO_PUBLIC_API_URL` pointe vers le **sandbox** (pas la prod).
- [ ] Build réussi sans erreur (EAS `preview`).
- [ ] Testée sur au moins un **appareil Android réel**.
- [ ] Compte démo fonctionnel.
- [ ] APK distribuée uniquement aux personnes autorisées.
- [ ] Si `usesCleartextTraffic` a été modifié → **repassé à `false`** et commité propre.

---

*Références : `docs/DEPLOIEMENT_HTTPS_ET_SDK57.md` (sandbox), `docs/STORE_SUBMISSION.md` (prod), `docs/RAPPORT_TECHNIQUE_COMPLET.md`.*
