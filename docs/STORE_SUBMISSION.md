# ClearNet — Guide de soumission Play Store & App Store

Checklist opérationnelle pour publier ClearNet. Prérequis : backend public en
HTTPS (voir `docs/DEPLOIEMENT_HTTPS_ET_SDK57.md`) et compte développeur.

---

## 0. Prérequis comptes & paiement

| Élément | Coût | Notes |
|---|---|---|
| Google Play Console | 25 $ (une fois) | Vérification d'identité + KYC entreprise |
| Apple Developer Program | 99 $/an | D-U-N-S requis pour les comptes organisation |

---

## 1. Build des binaires (EAS Build — recommandé)

EAS Build compile en cloud (aucun Mac / SDK local requis) et produit les
binaires attendus par les stores.

```bash
cd clearnet-mobile
npm install -g eas-cli
eas login                          # compte Expo
eas init                           # 1re fois : crée le projet EAS + projectId

# Variable d'environnement : URL de l'API de prod (obligatoire)
eas env:create --environment production EXPO_PUBLIC_API_URL https://api.clearnet.fr/api

# Android : AAB (requis par Play)
eas build -p android --profile production      # -> .aab

# iOS : IPA (requis par l'App Store)
eas build -p ios --profile production          # -> .ipa (gère certifs/provisioning)
```

- `eas.json` (déjà en place) : `production.android.buildType = "app-bundle"`,
  `autoIncrement = true`, `cli.appVersionSource = "remote"` (versionCode/
  buildNumber incrémentés automatiquement par EAS).
- Soumission directe possible : `eas submit -p android --profile production`
  (et `-p ios` après configuration App Store Connect).

### Build local (alternative, si outillage présent)

Voir `docs/DEPLOIEMENT_HTTPS_ET_SDK57.md` §2 — JDK 17, Android SDK
(platform 36, build-tools 36, NDK 27.1, cmake) puis :
`.\clearnet-mobile\build-sdk57.ps1` (APK) ou `gradlew bundleRelease` (AAB).

---

## 2. Signature & versions

| Sujet | Android | iOS |
|---|---|---|
| Signature | EAS gère l'upload key + Play App Signing | EAS gère certificats + provisioning |
| Keystore local existant | `%USERPROFILE%\.clearnet-keys\clearnet-release.jks` | — |
| versionName | `1.5.0` (`app.json`) | `1.5.0` |
| versionCode / buildNumber | `1` (auto-incrémenté par EAS) | `1` (auto-incrémenté) |

⚠️ Sauvegarder le keystore release : le perdre interdit toute mise à jour de
l'app déjà publiée (Play App Signing atténue ce risque côté Android).

---

## 3. Conformité déjà intégrée au code

- **HTTPS only** : `usesCleartextTraffic: false`, aucune exception ATS iOS.
- **Permissions minimales** : `INTERNET`, `ACCESS_NETWORK_STATE` uniquement
  (les permissions de stockage legacy sont supprimées via `tools:node="remove"`).
- **Suppression de compte** : endpoint `DELETE /api/auth/account` (anonymisation
  RGPD) + bouton « Supprimer mon compte » dans l'app (Accueil).
- **Politique de confidentialité** : `docs/privacy-policy.md` (à héberger en URL publique).
- **Versioning** : `1.5.0`, `versionCode 1`, `buildNumber 1`.

---

## 4. Google Play Console — checklist

1. **Créer l'app** (nom, langue par défaut FR).
2. **Fiche store** : description courte/complète, catégorie **Finance**,
   captures d'écran téléphone (≥ 2, 1080×1920) et tablette 7" (si `supportsTablet`),
   icône 512×512, *feature graphic* 1024×500.
3. **Contenu de l'app** :
   - **Politique de confidentialité** : URL publique (héberger `privacy-policy.md`).
   - **Suppression de compte** : URL (ou « via l'app ») — l'option in-app est déjà en place.
   - **Data safety** : déclarer — adresse e-mail (collectée), nom, informations
     financières (transactions), données de facturation. Voir tableau §7.
   - **Fonctionnalités financières** : déclarer l'activité (transferts / monnaie).
     ⚠️ L'activité de compensation + token CLRN peut relever des politiques
     « Digital assets » — valider avec un conseil juridique avant soumission.
   - **Classement** : répondre au questionnaire IARC/PEGI (catégorie Finance).
   - **Public cible** : 18+ recommandé.
4. **Mise en prod** : uploader l'**AAB**, *Internal testing* → *Closed testing*
   (12+ testeurs / 14 jours pour les comptes perso) → *Production*.

---

## 5. App Store Connect — checklist

1. **Créer l'app** (bundle id `com.clearnet.mobile`).
2. **App Information** : catégorie **Finance**, politique de confidentialité (URL).
3. **Version** : captures 6,7" (obligatoires) + 5,5", icône **1024×1024 sans alpha**,
   notes de review avec **compte de démonstration** (e-mail/mot de passe de test).
4. **App Privacy** (nutrition labels) : voir tableau §7.
5. **Déclaration crypto** : depuis 2024, Apple exige de déclarer toute app liée
   aux actifs numériques — la compensation CLRN est concernée.
6. **TestFlight** puis soumission. Prévoir justificatifs : licences, politique
   de confidentialité, démo fonctionnelle.

---

## 6. Assets de marque disponibles

| Asset | Exigence | Source |
|---|---|---|
| Icône | 1024×1024 PNG **sans alpha** (Apple) / 512×512 (Play) | `docs/logo/Logo ClearNet.png` (à redimensionner, **aplatir l'alpha**) |
| Feature graphic | 1024×500 | à créer |
| Captures | 1080×1920 (Play) / 6,7" (Apple) | à capturer depuis l'app |

⚠️ Les PNG du dossier `docs/logo/` peuvent contenir de la transparence :
l'icône App Store **refuse l'alpha** (aplatir sur fond opaque avant export).

---

## 7. Déclarations de données (Data safety / App Privacy)

| Donnée | Collectée ? | Partagée ? | Finalité |
|---|---|---|---|
| E-mail | Oui | Non (sauf Stripe si abonnement) | Authentification |
| Nom | Oui | Non | Profil |
| Mot de passe | Oui (haché) | Non | Authentification |
| Transactions / solde | Oui | Non | Service |
| Identifiant d'appareil | Non | — | — |
| Localisation | Non | — | — |

---

## 8. Points de vigilance réglementaire (avant soumission)

1. **Qualification juridique** : compensation + token CLRN peut constituer un
   « service de paiement » ou relever de la réglementation des crypto-actifs
   (MiCA en UE). À valider avec un conseil — les deux stores peuvent rejeter
   sans licence.
2. **OFAC/ITAR** : activer les contrôles (`ITAR_ENABLED`, clé OFAC) si le
   périmètre inclut des entités/pays sous sanctions.
3. **RGPD** : registre de traitement, DPO, hébergement UE, droit à l'effacement
   (implémenté via `DELETE /api/auth/account`).
4. **IAP** : la facturation Stripe hors-app (abonnements web) n'est pas soumise
   au Play/App billing ; tout achat de bien numérique **dans** l'app le serait.
