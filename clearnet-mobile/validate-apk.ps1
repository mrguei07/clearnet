<#
  validate-apk.ps1 - Batterie de validation APK ClearNet V1.4 (automate BUILD_FIX_GUIDE section 4).
  Checks : presence/taille, signature (apksigner), install, lancement (pidof/ps),
           absence de crash (logcat), splash screen (screencap), backend joignable.
  Usage   : powershell -ExecutionPolicy Bypass -File .\validate-apk.ps1 [-ApkPath <chemin>] [-SkipInstall] [-SkipDevice]
  Exit    : 0 = toutes les checks OK, 1 = au moins un echec.
#>
param(
  [string]$ApkPath = ".\android\app\build\outputs\apk\release\app-release.apk",
  [switch]$SkipInstall,
  [switch]$SkipDevice
)
$ErrorActionPreference = 'Stop'
$fail = 0
function Check($name, [scriptblock]$test) {
  try { & $test; Write-Host "OK  - $name" -ForegroundColor Green }
  catch { $script:fail++; Write-Host "ECHEC - $name : $($_.Exception.Message)" -ForegroundColor Red }
}
function Assert($cond, $msg) { if (-not $cond) { throw $msg } }

Write-Host "== Validation APK ClearNet V1.4 ==" -ForegroundColor Cyan
$apk = (Resolve-Path $ApkPath -ErrorAction SilentlyContinue)
Assert ($null -ne $apk) "APK introuvable : $ApkPath"

# 1. Taille
Check "Taille >= 60 Mo" { Assert ((Get-Item $apk).Length -ge 60MB) ("APK < 60 Mo : " + [Math]::Round((Get-Item $apk).Length/1MB,1) + " Mo") }

# 2. Signature
$apksigner = "$env:LOCALAPPDATA\Android\Sdk\build-tools\35.0.0\apksigner.bat"
Check "apksigner verify" {
  Assert (Test-Path $apksigner) "build-tools;35.0.0 absent (relancer patch-build.ps1)"
  & $apksigner verify --verbose $apk | Out-Null
  Assert ($LASTEXITCODE -eq 0) "signature invalide (exit $LASTEXITCODE)"
}

# 3. Appareil
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (-not $SkipDevice) {
  Check "Appareil connecte (adb)" {
    Assert (Test-Path $adb) "adb introuvable"
    $dev = (& $adb devices) | Select-String "`tdevice"
    Assert ($null -ne $dev) "aucun appareil/emulateur connecte"
  }
}

# 4. Install + lancement + crash
if (-not $SkipDevice -and -not $SkipInstall) {
  Check "Install APK" { & $adb install -r $apk | Out-Null; Assert ($LASTEXITCODE -eq 0) "echec install" }
}
if (-not $SkipDevice) {
  Check "Lancement (am start)" { & $adb shell am start -n com.clearnet.mobile/.MainActivity | Out-Null; Assert ($LASTEXITCODE -eq 0) "echec am start" }
  Start-Sleep -Seconds 5
  Check "Processus vivant apres 5 s" {
    $procPid = (& $adb shell pidof com.clearnet.mobile).Trim()
    if (-not $procPid) {
      $line = (& $adb shell ps) | Select-String "com.clearnet.mobile"
      Assert ($null -ne $line) "pidof vide ET aucun processus (Android 10+ : `ps` vide aussi)"
    }
  }
  Check "Aucun FATAL EXCEPTION (logcat)" {
    $fatal = (& $adb logcat -d -s AndroidRuntime:E) | Select-String "FATAL EXCEPTION"
    Assert ($null -eq $fatal) "FATAL EXCEPTION detectee dans logcat"
  }
  Check "Splash screen (screencap)" {
    & $adb shell am force-stop com.clearnet.mobile | Out-Null
    & $adb shell am start -n com.clearnet.mobile/.MainActivity | Out-Null
    Start-Sleep -Milliseconds 1500
    & $adb exec-out screencap -p > splash-check.png
    Assert ((Get-Item splash-check.png).Length -gt 1000) "screencap vide - verifier visuellement splash-check.png"
    Write-Host "      -> ouvrir splash-check.png : fond sombre #0b1220 + logo attendus"
  }
}

# 5. Backend (optionnel - ne fait pas echouer si hors LAN)
try {
  $h = (Invoke-WebRequest -Uri "http://10.90.175.247:3000/api/health" -TimeoutSec 5).StatusCode
  Write-Host "OK  - Backend joignable (HTTP $h)" -ForegroundColor Green
} catch { Write-Host "INFO - Backend non joignable (normal hors LAN) : $($_.Exception.Message)" -ForegroundColor Yellow }

Write-Host ("`n== Resultat : " + $(if ($fail -eq 0) { "TOUTES LES CHECKS OK" } else { "$fail ECHEC(S)" }) + " ==") -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
exit $fail