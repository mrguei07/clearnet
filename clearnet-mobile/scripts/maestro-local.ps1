# V1.4 Axe 3 (J8) — Build APK debug + run des flows Maestro en local Windows.
# Prérequis : émulateur Android démarré (API 33+), backend de test lancé.
$ErrorActionPreference = 'Stop'
$maestro = "$env:USERPROFILE\.maestro\bin\maestro.exe"
if (-not (Test-Path $maestro)) {
  Write-Host "[maestro-local] Installation de Maestro..."
  & curl.exe -Ls "https://get.maestro.mobile.dev" | Out-Null
}
Set-Location (Join-Path $PSScriptRoot "..")
npm ci
if (-not (Test-Path "android")) { npx expo prebuild --platform android --no-install }
Set-Location "android"
& .\gradlew.bat :app:assembleDebug -x lint
Set-Location ..
& $maestro test .maestro/login.yaml
& $maestro test .maestro/offline-sync.yaml
Write-Host "[maestro-local] Tous les flows sont verts."