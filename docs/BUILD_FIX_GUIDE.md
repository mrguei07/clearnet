# BUILD_FIX_GUIDE — Résolution du build Android ClearNet V1.4 (< 15 min)

Guide autosuffisant validé sur le poste de dev (Windows) : il documente la **cause racine réelle**, prouvée par stacktrace, du `NullPointerException` qui bloquait le build, ainsi que les étapes de correction avec commandes copier-coller.

---

## 1. Diagnostic rapide (cause racine)

### Symptôme (extrait du log `build-gradle.log`)

```
> Configure project :expo-modules-core
[CXX1300] CMake '3.22.1' was not found in SDK, PATH, or by cmake.dir property.
[CXX1301] - CMake '4.1.0' found in SDK did not satisfy requested version.
...
FAILURE: Build failed with an exception.
    > A problem occurred configuring project ':expo-modules-core'.
       > java.lang.NullPointerException
```

### Stacktrace décisive (ajout `--stacktrace`)

```
Caused by: java.lang.NullPointerException
	at com.android.build.gradle.internal.cxx.settings.CxxAbiModelSettingsRewriterKt.calculateConfigurationHash(CxxAbiModelSettingsRewriter.kt:226)
	at com.android.build.gradle.internal.cxx.configure.CxxCreateGradleTasksKt$createInitialCxxModel$1$1$1.invoke(CxxCreateGradleTasks.kt:358)
	at com.android.build.gradle.internal.cxx.configure.CxxCreateGradleTasksKt.createCxxVariantBuildTask(CxxCreateGradleTasks.kt:91)
	at com.android.build.gradle.internal.LibraryTaskManager.doCreateTasksForVariant(LibraryTaskManager.java:217)
```

### Cause racine

| # | Cause | Conséquence |
|:---|:---|:---|
| **1 (le NPE)** | `expo-modules-core` requiert **CMake 3.22.1** ; seul CMake 4.1.0 était installé dans le SDK. AGP 7.4 (`CxxAbiModelSettingsRewriter`) plante en NPE quand le CMake demandé est introuvable | Build bloqué à la **configuration** de `:expo-modules-core` (le NPE remontait jusqu'à `autolinking_implementation.gradle:356` via `evaluationDependsOn` — c'était un **symptôme**, pas la cause) |
| 2 | `compileSdkVersion` non exposé sur `rootProject.ext` | Erreurs `compileSdkVersion is not specified` sur `:expo` |
| 3 | Publication Maven `from components.release` (modules Expo) | NPE « unknown property 'release' » sous Gradle 8 |
| 4 | Résolution des plugins Gradle via plugins.gradle.org (lent/instable) | Échecs `Plugin [...] was not found` |

> **Leçon** : le message « line 356 » d'autolinking est trompeur. Toujours relancer avec `--stacktrace` avant de patcher ; ici les patches sur autolinking étaient **inutiles** — le vrai coupable était CMake.

---

## 2. Prérequis (vérifier avant de commencer)

| Outil | Version requise | Vérification (PowerShell) |
|:---|:---|:---|
| Node.js | 18+ **dans le PATH** | `node -v` (sinon : repérer `C:\Program Files\nodejs\node.exe` et l'ajouter au PATH du batch de build) |
| JDK | **17 uniquement** (pas 21/24 !) | `& "$env:LOCALAPPDATA\Temp\opencode\jdk17\jdk-17.0.20+8\bin\java.exe" -version` |
| Android SDK | API 34, NDK 26.3, **CMake 3.22.1** | `Get-ChildItem "$env:LOCALAPPDATA\Android\Sdk\cmake"` |
| Gradle | 8.0.1 (distribution locale) | `"$env:LOCALAPPDATA\Temp\opencode\gradle-8.0.1\bin\gradle.bat" --version` |

> **Chemins** : `$env:LOCALAPPDATA` = `C:\Users\<vous>\AppData\Local`. Les chemins de l'exemple sont ceux du poste de dev (JDK/Gradle installés localement dans `Temp\opencode\`) — remplacez par votre installation si le guide est partagé.

> **JDK 17 — pourquoi** : Groovy 3.0.13 (Gradle 8.0.1) refuse JDK ≥ 20 ; JDK 21/24 cassent la compilation des scripts Groovy (init + modules).

> **⚠️ Le JDK 17 est un PRÉREQUIS critique, pas une option** : les machines récentes installent JDK 21/24 par défaut, ce qui cause des `NoClassDefFoundError` (Groovy) silencieuses. Vérification explicite avant tout build :

```powershell
if ((& "$env:LOCALAPPDATA\Temp\opencode\jdk17\jdk-17.0.20+8\bin\java.exe" -version 2>&1 | Select-String 'version "\x2217')) { "OK : JDK 17" } else { "ERREUR : JDK 17 requis (voir ligne ci-dessus)" }
```

> Le script `patch-build.ps1` (étape 4bis) fait cette vérification automatiquement au lancement.

---

## 3. Les 5 étapes de correction

### Étape 1 — Installer CMake 3.22.1 (corrige LE NPE)

```powershell
cmd /c "echo y | %LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat ""cmake;3.22.1"""
# Vérification :
Test-Path "$env:LOCALAPPDATA\Android\Sdk\cmake\3.22.1\bin\cmake.exe"   # -> True
```

> Les avertissements `[CXX5304] package.xml version 4` sont **cosmétiques** (outils CLI plus récents que le parseur d'expo) : les ignorer.

### Étape 2 — Exposer les versions SDK sur `rootProject.ext`

**Fichier** : `clearnet-mobile/android/build.gradle` — le `ext` doit être visible par `safeExtGet` des modules Expo (un `ext` dans `buildscript {}` ne remonte PAS sur `rootProject`).

```groovy
allprojects {
    ext {
        buildToolsVersion = '35.0.0'
        minSdkVersion = 24
        compileSdkVersion = 34
        targetSdkVersion = 34
        kotlinVersion = '1.8.10'
        ndkVersion = "26.3.11579264"
    }
    repositories { /* invarié */ }
}

subprojects {
    afterEvaluate { project ->
        if (project.hasProperty('android')) {
            project.android { compileSdkVersion 34 }
        }
    }
}
```

### Étape 3 — Sécuriser la publication Maven des modules Expo (Gradle 8)

**11 fichiers** (`expo-modules-core`, `expo`, `expo-constants`, `expo-font`, `expo-file-system`, `expo-application`, `expo-keep-awake`, `expo-splash-screen`, `expo-sqlite`, `expo-sharing`, `expo-print` sous `node_modules/**/android/build.gradle`) contiennent `from components.release` qui NPE sous Gradle 8. Remplacer la ligne par un garde (PowerShell, dossiers node_modules) :

```powershell
# Depuis clearnet-mobile :
$f = ".\node_modules\expo-modules-core\android\build.gradle"
$c = [System.IO.File]::ReadAllText($f)
$c = [regex]::Replace($c, '(?m)^(\s*)from components\.release\s*$',
  "`$1def _rc = components.findByName('release')`n`$1if (_rc != null) { from _rc }")
[System.IO.File]::WriteAllText($f, $c)
```

> Le composant `release` n'est pas créé automatiquement en AGP 8+ ; la publication vers mavenLocal n'étant pas nécessaire pour un build APK local, ce garde est sans risque.

### Étape 3bis — `classifier` → `archiveClassifier` (Gradle 8)

Les modules `expo-sqlite`, `expo-sharing`, `expo-print` (`node_modules/**/android/build.gradle:40`) posent `classifier = 'sources'` sur le task `androidSourcesJar` — propriété **supprimée en Gradle 8** (erreur `Could not set unknown property 'classifier'`). Remplacer par `archiveClassifier` :

```powershell
$files = @("expo-sqlite","expo-sharing","expo-print") | % { ".\node_modules\$_\android\build.gradle" }
foreach ($f in $files) {
  $c = [System.IO.File]::ReadAllText($f)
  [System.IO.File]::WriteAllText($f, [regex]::Replace($c, '(?m)^(\s*)classifier\s*=\s*[''"']sources[''"']', "`$1archiveClassifier = 'sources'"))
}
```

### Étape 4 — Router la résolution des plugins via un miroir rapide

**Fichier** : `clearnet-mobile/android/settings.gradle` (le bloc doit être **en tout premier**, avant `rootProject.name` — sinon erreur Gradle) :

```groovy
pluginManagement {
    repositories {
        maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }
        maven { url 'https://maven.aliyun.com/repository/google' }
        maven { url 'https://maven.aliyun.com/repository/central' }
        gradlePluginPortal()
    }
}
```

### Étape 4bis — Patch AUTOMATIQUE après chaque prebuild : `patch-build.ps1` (recommandé)

Les étapes 2-4 (et la recréation des classes legacy expo-splash-screen, étape FAQ) sont des **patchs manuels perdus si `expo prebuild` est ré-exécuté ou si un module est mis à jour**. Un script idempotent applique tout automatiquement :

```powershell
# Depuis clearnet-mobile :
powershell -ExecutionPolicy Bypass -File .\patch-build.ps1          # mode standard
powershell -ExecutionPolicy Bypass -File .\patch-build.ps1 -UseInitGradle   # mode non intrusif
```

Il vérifie au démarrage le **JDK 17** (⚠️ point 3) et la **présence de `node_modules`** (⚠️ npm install obligatoire avant, sinon exit 1), puis applique uniquement ce qui manque (détection par contenu, re-run sans risque) :

1. Miroirs rapides — **2 modes au choix** :
   - **Défaut** : injecte le bloc `pluginManagement` Aliyun **en premier** dans `android/settings.gradle` (⚠️ point 1, intrusif mais local au projet).
   - **`-UseInitGradle`** (recommandé si le guide est partagé / CI) : **aucune modification de `settings.gradle`** ; les miroirs sont posés dans `~\.gradle\init.d\clearnet-mirrors.gradle` (via `settingsEvaluated` → résolution plugins + dépendances). Attention : s'applique à **tous les builds Gradle** de la machine. Pour désactiver : supprimer le fichier.

> **⚠️ `-UseInitGradle` n'a PAS été validé par un build complet sur le poste de dev** (le build de référence passe par le mode défaut). Il est recommandé pour les environnements partagés, mais doit être validé par un build réel (étape 5) avant adoption — typiquement en CI sur une machine propre.
2. `android/build.gradle` → injecte `rootProject.ext` SDK + bloc `subprojects` (⚠️ point 1 bis).
3. **Parcourt automatiquement** `node_modules\expo*\android\build.gradle` → guards `components.release` + `classifier → archiveClassifier` (⚠️ point 2 : plus besoin de lister les 11 fichiers à la main ; nouveau module installé = pris en compte). Regex tolérante aux espaces/guillemets variables (⚠️ point 5).
4. `expo-splash-screen` → recrée les 4 classes legacy + ressources si absentes.

En fin de run : résumé des fichiers patchés. Puis relancer le build : `.\build-gradle.cmd`.

**Alternative au point 1 (si vous ne voulez ni modifier settings.gradle ni passer par le script)** : `init.gradle` global écrit à la main :

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.gradle\init.d"
```

Contenu de `C:\Users\<vous>\.gradle\init.d\clearnet-mirrors.gradle` :

```groovy
settingsEvaluated { settings ->
    settings.pluginManagement.repositories {
        maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }
        maven { url 'https://maven.aliyun.com/repository/google' }
        maven { url 'https://maven.aliyun.com/repository/central' }
        gradlePluginPortal()
    }
}
```

**Alternative au point 2 (reproductibilité garantie)** : fork des modules Expo avec les corrections, référencé par `dependencySubstitution` dans settings.gradle — plus lourd à maintenir au quotidien, à n'envisager qu'en cas de mises à jour fréquentes des modules.

### Étape 5 — Relancer le build

```powershell
# Depuis clearnet-mobile (le script pose JAVA_HOME, ANDROID_HOME, NDK, PATH node et gradle 8.0.1) :
.\build-gradle.cmd          # assembleRelease
Get-Content build-gradle.log -Tail 5   # -> BUILD SUCCESSFUL in …
```

> **`build-gradle.cmd` est versionné dans le monorepo** (`clearnet-mobile/`) et utilise `%LOCALAPPDATA%` (générique). Il appelle **Gradle 8.0.1 en local** (`%LOCALAPPDATA%\Temp\opencode\gradle-8.0.1`) plutôt que `gradlew.bat` : le wrapper pointe vers `services.gradle.org` (lent/instable selon les réseaux). Adaptez `JAVA_HOME`/`GRADLE_HOME_BIN` si vos installations diffèrent.

> ⚠️ **Éviter `expo prebuild --clean` ici** : il régénérerait `android/` et effacerait les patches des étapes 2-4. **Si un prebuild est nécessaire**, ré-appliquer immédiatement : `powershell -ExecutionPolicy Bypass -File .\patch-build.ps1` (étape 4bis) puis `.\build-gradle.cmd`. **Ne pas upgrade `expo-modules-autolinking`** : la version du SDK 49 doit rester verrouillée (API autolinking).

---

## 4. Validation

```powershell
# 1. Log du build
Get-Content ".\build-gradle.log" -Tail 5
#    -> BUILD SUCCESSFUL in Xm Ys
#    -> [date] GRADLE exitcode 0

# 2. APK produit
Get-ChildItem "$PWD\android\app\build\outputs\apk\release\app-release.apk"

# 3. Install sur émulateur/device
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r "$PWD\android\app\build\outputs\apk\release\app-release.apk"

# 5. Intégrité de la signature (⚠️ la taille seule ne prouve rien)
#    Si build-tools;35.0.0 est absent, `patch-build.ps1` (étape 4bis, section 5) tente de l'installer ;
#    sinon, manuellement :
if (-not (Test-Path "$env:LOCALAPPDATA\Android\Sdk\build-tools\35.0.0\apksigner.bat")) {
  cmd /c "echo y | %LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat ""build-tools;35.0.0"""
}
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\35.0.0\apksigner.bat" verify --verbose "$PWD\android\app\build\outputs\apk\release\app-release.apk"
#    -> "Verifies" + signer "Debug" + schémas v1/v2

# 6. Test de lancement minimal (émulateur/périphérique branché — détecte un crash au boot)
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb install -r "$PWD\android\app\build\outputs\apk\release\app-release.apk"
& $adb shell am start -n com.clearnet/.MainActivity
Start-Sleep -Seconds 5
& $adb shell pidof com.clearnet
#    -> un PID = encore vivant = pas de crash
#    NB : sur Android 10+, `pidof` peut être bloqué par les restrictions de sécurité (pas de résultat
#    alors que l'app tourne). Alternative robuste (retourne la ligne de processus) :
& $adb shell ps | Select-String "com.clearnet"
& $adb logcat -d -s AndroidRuntime:E   # -> AUCUNE ligne "FATAL EXCEPTION"

# 6bis. Contrôle visuel du splash screen (⚠️ les classes legacy recréées ne sont pas testées automatiquement)
#    Lancer l'app et capturer l'écran dès les 2-3 premières secondes :
& $adb shell am force-stop com.clearnet
& $adb shell am start -n com.clearnet/.MainActivity
Start-Sleep -Milliseconds 1500
& $adb exec-out screencap -p > splash-check.png
#    Vérifier visuellement splash-check.png : fond #0b1220 + logo, puis l'écran d'accueil arrive.
#    (Le splash ne dure que ~2 s : relancer en augmentant/diminant le sleep si besoin.)

# 7. Sanity backend (API joignable sur le LAN)
(Invoke-WebRequest http://10.90.175.247:3000/api/health).StatusCode   # -> 200
```

Critère de succès : **`GRADLE exitcode 0`** + APK `app-release.apk` ≥ 60 Mo **et** `apksigner verify` OK **et** `pidof com.clearnet` (ou `ps | grep` sur Android 10+) retourne un PID 5 s après `am start` (= l'app ne crash pas au lancement).

---

## 4bis. Intégration CI/CD

`patch-build.ps1` est **idempotent** → il peut s'exécuter après chaque `npm ci`/`npm install` dans un pipeline. Pipeline type (GitHub Actions, runner Windows avec SDK Android + JDK 17) :

```powershell
# 1. Install des dépendances (reproductible)
npm ci
# 2. Régénération du projet Android si besoin (sinon utiliser android/ versionné)
#    npx expo prebuild --platform android
# 3. PATCHS OBLIGATOIRES (étapes 2-4 du guide) — idempotent, sort en exit 1 si node_modules absent :
powershell -ExecutionPolicy Bypass -File .\patch-build.ps1
# 4. Build (JAVA_HOME pointé sur le JDK 17 ; garde-fous SDK/NDK/CMake posés par build-gradle.cmd) :
.\build-gradle.cmd
# 5. Gardes de validation (échec du pipeline si faux) :
$apk = "$PWD\android\app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $apk)) { Write-Error "APK absente"; exit 1 }
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\35.0.0\apksigner.bat" verify --verbose $apk | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error "Signature invalide"; exit 1 }
if ((Get-Item $apk).Length -lt 60MB) { Write-Error "APK < 60 Mo"; exit 1 }
```

Le test de lancement (étape 6) nécessite un émulateur : à réserver aux pipelines avec `sdkmanager` + `avdmanager` ou à une machine de lab (Firebase Test Lab pour une couverture appareils réels).

---

## 5. Problèmes courants et solutions (FAQ)

| Symptôme | Cause | Solution |
|:---|:---|:---|
| `Plugin [org.jetbrains.kotlin.jvm:1.7.22] was not found` | plugins.gradle.org lent/instable ; cache module absent | Étape 4 (miroir Aliyun `gradle-plugin`) ; relancez — le spawn est ensuite UP-TO-DATE |
| `CreateProcess error=2` sur `node` | `node.exe` absent du PATH hérité par le batch | Ajouter `C:\Program Files\nodejs` au PATH (fait dans build-gradle.cmd) |
| `targetSdkVersion() method not found` | Mon DSL invalide sur le chemin `subprojects` d'AGP 7.4 | Ne forcer QUE `compileSdkVersion` dans le bloc `subprojects` (cf. étape 2) |
| `compileSdkVersion is not specified` (sur `:expo`) | `ext` défini seulement dans `buildscript {}` | Étape 2 : passer par `allprojects { ext { … } }` |
| `CxxAbiModelSettingsRewriter NullPointerException` | **CMake 3.22.1 manquant** (le grand méchant de cette session) | Étape 1 (sdkmanager) |
| `Could not set unknown property 'classifier' for task ':expo-print:androidSourcesJar'` | Propriété `classifier` supprimée en Gradle 8 | Étape 3bis (`archiveClassifier`) |
| `Failed to find Build Tools revision 30.0.3` | Build Tools 30.0.3 requis par un module, absent du SDK (le RN gradle-plugin l'injecte par défaut) | `cmd /c "echo y | sdkmanager.bat ""build-tools;30.0.3"""` **et** forcer `buildToolsVersion '35.0.0'` dans le bloc `subprojects` (étape 2) |
| `:expo-splash-screen:compileReleaseKotlin` → `Unresolved reference: SplashScreenViewProvider/SplashScreenView` | **Package npm expo-splash-screen incomplet** : les classes legacy (`SplashScreenView`, `SplashScreenViewProvider`, `SplashScreenViewController`, `SplashScreenStatusBar`) ne sont pas publiées avec le module (expo-modules-core 1.5.13 ne les fournit plus) | Recréer les 4 fichiers dans `node_modules/expo-splash-screen/android/src/main/java/expo/modules/splashscreen/**` (interface `SplashScreenViewProvider`, `SplashScreenView` (LinearLayout + imageView), `SplashScreenViewController` (show/preventAutoHide/hide), `singletons/SplashScreenStatusBar`) — contrat complet basé sur les call sites |
| `Software Components will not be created automatically…` (warning) | AGP 8 latent + Gradle 8 | Warning bénin : ignorable (nos guards évitent la casse) |
| Groovy `java.lang.NoClassDefFoundError` / erreurs étranges de scripts | JDK 21/24 au lieu du 17 | Pointer `JAVA_HOME` sur le JDK 17 local (prérequis) |
| Patches perdus (guard/components.release, pluginManagement, splash legacy…) | `expo prebuild`, mise à jour de `node_modules` ou d'un module expo-* | Relancer `powershell -ExecutionPolicy Bypass -File .\patch-build.ps1` (étape 4bis, idempotent) puis `.\build-gradle.cmd` |
| `node_modules/expo-modules-core introuvable` (sortie du script en erreur) | `npm install` pas encore exécuté | Lancer `npm install` (ou `npm ci`) depuis `clearnet-mobile`, puis relancer `patch-build.ps1` |
| APK installable mais **crash au lancement** | Problème runtime non couvert par le build (ressources, JNI) | Test de lancement minimal : `adb shell am start -n com.clearnet/.MainActivity` puis `pidof com.clearnet` + `logcat -d -s AndroidRuntime:E` (section 4) |
| `BUILD FAILED` après 30+ min sans newlines | Configure phase lente (poste lent) ; pas une erreur | Attendre ; vérifier l'activité CPU de `java` (`Get-Process java`) |
| Gradle ne retrouve pas `gradle-plugin` (includeBuild RN) | Distribution 8.x trop récente (8.14 : API `serviceOf` supprimée) | Rester sur **Gradle 8.0.1** (la stack SDK 49) |
| `[CXX5304] package.xml parsing problem` | SDK tools récents vs parseur expo (XML v4) | Cosmétique : ignorer |
| APK se connecte pas à l'API sur téléphone | Firewall Windows / IP LAN / backend éteint | `netsh advfirewall firewall add rule name="ClearNet API 3000" dir=in action=allow protocol=TCP localport=3000` ; démarrer le backend ; URL cuite `http://10.90.175.247:3000/api` |

---

**Chronologie réelle de résolution** (à garder en référence) : reprise des dépendances (Adoptium → Microsoft CDN) → Gradle 8.0.1 + JDK 17 → miroir Aliyun (plugins) → guards `components.release` → `rootProject.ext` SDK → **CMake 3.22.1 = dernier blocage (NPE)**.