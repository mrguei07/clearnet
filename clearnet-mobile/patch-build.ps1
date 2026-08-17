<#
  patch-build.ps1 - Applique automatiquement les correctifs de build Android ClearNet V1.4.
  Idempotent : peut etre relance sans risque apres chaque `expo prebuild` ou mise a jour de modules.
  Usage : powershell -ExecutionPolicy Bypass -File patch-build.ps1 [-UseInitGradle]

  -UseInitGradle : mode alternatif NON intrusif - les miroirs sont poses dans un fichier
  init.gradle global (~\.gradle\init.d\clearnet-mirrors.gradle) au lieu d'editer settings.gradle.
#>
param([switch]$UseInitGradle)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$android = Join-Path $root 'android'
$nm = Join-Path $root 'node_modules'
$done = @()

Write-Host "== patch-build ClearNet V1.4 ==" -ForegroundColor Cyan

# ---------- 0. Verification JDK 17 ----------
$ok = $false
if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
  $javaBin = Join-Path $env:JAVA_HOME 'bin\java.exe'
  try { $v = ((& $javaBin -version 2>&1 | Out-String) -split "`n")[0] } catch { $v = '' }
  if ($v -match '"17') { $ok = $true }
}
if (-not $ok) {
  Write-Warning ("JDK 17 requis mais introuvable via JAVA_HOME=" + $env:JAVA_HOME + ".")
  Write-Warning "   Verification : `$env:JAVA_HOME='C:\Users\deral\AppData\Local\Temp\opencode\jdk17\jdk-17.0.20+8'; java -version"
  if ($env:CI) { Write-Warning 'CI : abandon (JDK 17 obligatoire en pipeline)'; exit 1 }
} else { Write-Host "OK: JDK 17 ($v)" -ForegroundColor Green }

# ---------- 0bis. Presence de node_modules (npm install obligatoire avant tout patch) ----------
if (-not (Test-Path (Join-Path $nm 'expo-modules-core'))) {
  Write-Warning "node_modules/expo-modules-core introuvable."
  Write-Warning "   Executez d'abord depuis clearnet-mobile : npm install"
  Write-Warning "   (ou npm ci pour une CI reproductible) puis relancez ce script."
  exit 1
}

# ---------- 1. Miroirs rapides : settings.gradle (defaut) OU init.gradle global (-UseInitGradle) ----------
$sg = Join-Path $android 'settings.gradle'
if ($UseInitGradle) {
  $initDir = Join-Path $HOME '.gradle\init.d'
  $initFile = Join-Path $initDir 'clearnet-mirrors.gradle'
  if (-not (Test-Path $initFile)) {
    $initContent = "// Miroirs ClearNet - cree par patch-build.ps1 (option -UseInitGradle)`n" +
      "// Applique a TOUS les builds Gradle de la machine.`n" +
      "settingsEvaluated { settings ->`n" +
      "    settings.pluginManagement.repositories {`n" +
      "        maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }`n" +
      "        maven { url 'https://maven.aliyun.com/repository/google' }`n" +
      "        maven { url 'https://maven.aliyun.com/repository/central' }`n" +
      "        gradlePluginPortal()`n" +
      "    }`n" +
      "}`n" +
      "`n" +
      "allprojects {`n" +
      "    repositories {`n" +
      "        maven { url 'https://maven.aliyun.com/repository/google' }`n" +
      "        maven { url 'https://maven.aliyun.com/repository/central' }`n" +
      "    }`n" +
      "}`n"
    New-Item -ItemType Directory -Force -Path $initDir | Out-Null
    [System.IO.File]::WriteAllText($initFile, $initContent)
    $done += "init.gradle global cree : $initFile (settings.gradle non modifie)"
  } else { $done += "init.gradle global deja present ($initFile) - skip" }
} elseif (Test-Path $sg) {
  $c = [System.IO.File]::ReadAllText($sg)
  if ($c -notmatch 'maven\.aliyun\.com/repository/gradle-plugin') {
    $block = "pluginManagement {`n" +
      "    repositories {`n" +
      "        maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }`n" +
      "        maven { url 'https://maven.aliyun.com/repository/google' }`n" +
      "        maven { url 'https://maven.aliyun.com/repository/central' }`n" +
      "        gradlePluginPortal()`n" +
      "    }`n" +
      "}`n" +
      "`n"
    [System.IO.File]::WriteAllText($sg, $block + $c)
    $done += 'settings.gradle : pluginManagement Aliyun injecte'
  } else { $done += 'settings.gradle : deja patche (skip)' }
}

# ---------- 2. build.gradle racine : rootProject.ext + subprojects ----------
$bg = Join-Path $android 'build.gradle'
if (Test-Path $bg) {
  $c = [System.IO.File]::ReadAllText($bg)
  $hasAll = [regex]::IsMatch($c, '(?m)^allprojects\s*\{')
  $hasAllExt = [regex]::IsMatch($c, '(?s)allprojects\s*\{\s*ext\s*\{')
  $hasSub = [regex]::IsMatch($c, '(?m)^subprojects\s*\{')
  $subBlock = "`n" +
    "subprojects {`n" +
    "    afterEvaluate { project ->`n" +
    "        if (project.hasProperty('android')) {`n" +
    "            project.android {`n" +
    "                compileSdkVersion 34`n" +
    "                buildToolsVersion '35.0.0'`n" +
    "            }`n" +
    "        }`n" +
    "    }`n" +
    "}`n"
  $changed = $false
  if (-not $hasAll) {
    $c = "allprojects {`n    ext {`n" +
      "        buildToolsVersion = '35.0.0'`n" +
      "        minSdkVersion = 24`n" +
      "        compileSdkVersion = 34`n" +
      "        targetSdkVersion = 34`n" +
      "        kotlinVersion = '1.8.10'`n" +
      "        ndkVersion = '26.3.11579264'`n" +
      "    }`n" +
      "}`n`n" + $c
    $changed = $true
  } elseif (-not $hasAllExt) {
    $c2 = [regex]::Replace($c, '(?m)^allprojects \{ *\r?$',
      "allprojects {`n    ext {`n" +
      "        buildToolsVersion = '35.0.0'`n" +
      "        minSdkVersion = 24`n" +
      "        compileSdkVersion = 34`n" +
      "        targetSdkVersion = 34`n" +
      "        kotlinVersion = '1.8.10'`n" +
      "        ndkVersion = '26.3.11579264'`n" +
      "    }")
    if ($c2 -ne $c) { $c = $c2; $changed = $true }
  }
  if (-not $hasSub) {
    $c = $c + $subBlock
    $changed = $true
  }
  if ($changed) {
    [System.IO.File]::WriteAllText($bg, $c)
    $done += 'build.gradle : ext rootProject(+subprojects) injectes'
  } else { $done += 'build.gradle : deja patche (skip)' }
}

# ---------- 3. Modules Expo : composants.release + classifier ----------
$gradleFiles = Get-ChildItem $nm -Recurse -Filter 'build.gradle' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\expo[^\\]*\\android\\build\.gradle$' }
$nRel = 0; $nCls = 0
foreach ($f in $gradleFiles) {
  $c = [System.IO.File]::ReadAllText($f.FullName)
  $n = [regex]::Replace($c, '(?m)^(\s*)from components\.release\s*$',
    '${1}def _rc = components.findByName(''release'')' + "`n" + '${1}if (_rc != null) { from _rc }')
  if ($n -ne $c) { $nRel++ }
  $n2 = [regex]::Replace($n, '(?m)^(\s*)classifier\s*=\s*[''"]sources[''"]', '${1}archiveClassifier = ''sources''')
  if ($n2 -ne $n) { $nCls++ }
  [System.IO.File]::WriteAllText($f.FullName, $n2)
}
$done += "Modules Expo: $nRel fichier(s) components.release patche(s), $nCls classifier->archiveClassifier"

# ---------- 4. expo-splash-screen : classes legacy + ressources (package npm incomplet) ----------
$splash = Join-Path $nm 'expo-splash-screen\android\src\main'
$ctrl = Join-Path $splash 'java\expo\modules\splashscreen\SplashScreenViewController.kt'
if (-not (Test-Path $ctrl)) {
  New-Item -ItemType Directory -Force -Path (Join-Path $splash 'java\expo\modules\splashscreen\singletons') | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $splash 'res\values'), (Join-Path $splash 'res\drawable') | Out-Null
  $files = @{
    'java\expo\modules\splashscreen\SplashScreenViewProvider.kt' = @'
package expo.modules.splashscreen

import android.content.Context
import android.view.View

interface SplashScreenViewProvider {
  fun createSplashScreenView(context: Context): View
}
'@
    'java\expo\modules\splashscreen\SplashScreenView.kt' = @'
package expo.modules.splashscreen

import android.content.Context
import android.widget.ImageView
import android.widget.LinearLayout

class SplashScreenView(context: Context) : LinearLayout(context) {
  val imageView: ImageView = ImageView(context)
  init {
    orientation = VERTICAL
    addView(imageView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }
  fun configureImageViewResizeMode(resizeMode: SplashScreenImageResizeMode) {
    imageView.scaleType = resizeMode.scaleType
  }
}
'@
    'java\expo\modules\splashscreen\SplashScreenViewController.kt' = @'
package expo.modules.splashscreen

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import expo.modules.splashscreen.exceptions.NoContentViewException

class SplashScreenViewController(
  private val activity: Activity,
  private val rootViewClass: Class<out ViewGroup>,
  private val splashView: View
) {
  fun showSplashScreen(successCallback: () -> Unit) {
    activity.runOnUiThread {
      val contentView = activity.findViewById<ViewGroup>(android.R.id.content)
        ?: throw NoContentViewException()
      contentView.removeAllViews()
      contentView.addView(splashView,
        ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
      successCallback()
    }
  }

  fun preventAutoHide(successCallback: (hasEffect: Boolean) -> Unit, failureCallback: (reason: String) -> Unit) {
    if (rootViewClass == null) {
      failureCallback("No rootViewClass provided. SplashScreen cannot be prevented from autohiding.")
      return
    }
    successCallback(true)
  }

  fun hideSplashScreen(successCallback: (hasEffect: Boolean) -> Unit, failureCallback: (reason: String) -> Unit) {
    activity.runOnUiThread {
      val contentView = activity.findViewById<ViewGroup>(android.R.id.content)
      if (contentView != null && splashView.parent != null) {
        contentView.removeView(splashView)
        successCallback(true)
      } else {
        failureCallback("No native splash screen registered for provided activity.")
      }
    }
  }
}
'@
    'java\expo\modules\splashscreen\singletons\SplashScreenStatusBar.kt' = @'
package expo.modules.splashscreen.singletons

import android.app.Activity
import android.os.Build
import android.view.WindowManager

object SplashScreenStatusBar {
  fun configureTranslucent(activity: Activity, translucent: Boolean) {
    if (!translucent) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      activity.window.setDecorFitsSystemWindows(false)
    } else {
      @Suppress("DEPRECATION")
      activity.window.addFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS)
    }
  }
}
'@
    'res\values\strings.xml' = @'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="expo_splash_screen_resize_mode">contain</string>
    <string name="expo_splash_screen_status_bar_translucent">false</string>
</resources>
'@
    'res\values\colors.xml' = @'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="splashscreen_background">#0b1220</color>
</resources>
'@
    'res\drawable\splashscreen_image.xml' = @'
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@android:color/transparent" />
</shape>
'@
    'res\drawable\splashscreen.xml' = @'
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#38bdf8" />
</shape>
'@
  }
  foreach ($rel in $files.Keys) {
    $target = Join-Path $splash $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    [System.IO.File]::WriteAllText($target, $files[$rel].TrimStart("`n"))
  }
  $done += 'expo-splash-screen : classes legacy + ressources recreees'
} else { $done += 'expo-splash-screen : deja patche (skip)' }

# ---------- 5. apksigner (build-tools;35.0.0) : check + installation si absent ----------
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$apksigner = Join-Path $sdk 'build-tools\35.0.0\apksigner.bat'
if (-not (Test-Path $apksigner)) {
  Write-Host "build-tools;35.0.0 absent - tentative d'installation via sdkmanager..." -ForegroundColor Yellow
  $sdkman = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
  if (Test-Path $sdkman) {
    try { cmd /c "echo y | `"$sdkman`" `"build-tools;35.0.0`"" } catch { }
    if (Test-Path $apksigner) {
      $done += 'build-tools;35.0.0 installe (apksigner OK)'
    } else {
      Write-Warning "sdkmanager a echoue : relancez manuellement la commande d'installation."
      $done += 'build-tools;35.0.0 : installation ECHOUE (voir guide, section Validation)'
    }
  } else {
    Write-Warning "sdkmanager introuvable dans $sdkman"
    $done += 'build-tools;35.0.0 : manquant (installer via Android Studio ou sdkmanager)'
  }
} else { $done += 'build-tools;35.0.0 present (apksigner OK) - skip' }

# ---------- Resume ----------
Write-Host "`n== Resume ==" -ForegroundColor Cyan
if ($UseInitGradle) { Write-Host "  Mode miroirs : init.gradle global (non intrusif)" }
else { Write-Host "  Mode miroirs : settings.gradle (injection)" }
$done | ForEach-Object { Write-Host "  - $_" }
Write-Host "`nTermine. Relancez ensuite : .\build-gradle.cmd" -ForegroundColor Green