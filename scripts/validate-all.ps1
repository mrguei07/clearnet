# =============================================================
# ClearNet V1.1 — Validation globale (Windows PowerShell)
# Étape 1 : backend (build + tests) -> Étape 2 : blockchain
# (compile + tests) -> Étape 3 : mobile (typecheck) ->
# Étape 4 (optionnelle) : E2E Docker.
# Usage : .\scripts\validate-all.ps1 [-SkipDocker] [-SkipMobile]
# Mac/Linux : ./scripts/validate-all.sh
# =============================================================
param([switch]$SkipDocker, [switch]$SkipMobile)
$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$FAILURES = $false

function Step([string]$title) {
  Write-Host ""
  Write-Host "============================================" -ForegroundColor Cyan
  Write-Host "  $title" -ForegroundColor Cyan
  Write-Host "============================================" -ForegroundColor Cyan
}
function Check([string]$name, [bool]$ok) {
  if ($ok) { Write-Host "  [OK] $name" -ForegroundColor Green }
  else { Write-Host "  [KO] $name" -ForegroundColor Red; $script:FAILURES = $true }
}
function RunCmd([string]$name, [scriptblock]$block) {
  try { & $block | Out-Null; Check $name $true }
  catch { Check $name $false; Write-Host "      $($_.Exception.Message)" -ForegroundColor DarkGray }
}

Step "Étape 1/4 — Backend (npm ci, build, tests)"
RunCmd "backend: npm ci" { Push-Location "$ROOT\clearnet-backend"; npm ci --no-audit --no-fund; Pop-Location }
RunCmd "backend: build" { Push-Location "$ROOT\clearnet-backend"; npm run build; Pop-Location }
RunCmd "backend: tests jest" { Push-Location "$ROOT\clearnet-backend"; npm test; Pop-Location }

Step "Étape 2/4 — Blockchain (compile + tests)"
RunCmd "blockchain: npm ci" { Push-Location "$ROOT\clearnet-blockchain"; npm ci --no-audit --no-fund; Pop-Location }
RunCmd "blockchain: compile" { Push-Location "$ROOT\clearnet-blockchain"; npx hardhat compile; Pop-Location }
RunCmd "blockchain: tests" { Push-Location "$ROOT\clearnet-blockchain"; npx hardhat test; Pop-Location }

if (-not $SkipMobile) {
  Step "Étape 3/4 — Mobile (typecheck TypeScript)"
  RunCmd "mobile: npm ci" { Push-Location "$ROOT\clearnet-mobile"; npm ci --no-audit --no-fund; Pop-Location }
  RunCmd "mobile: tsc --noEmit" { Push-Location "$ROOT\clearnet-mobile"; npx tsc --noEmit; Pop-Location }
} else {
  Step "Étape 3/4 — Mobile (SKIPPÉ : -SkipMobile)"
}

if (-not $SkipDocker) {
  Step "Étape 4/4 — E2E Docker (test-e2e.ps1)"
  RunCmd "E2E Docker" { & "$ROOT\infrastructure\test-e2e.ps1" }
} else {
  Step "Étape 4/4 — E2E Docker (SKIPPÉ : -SkipDocker — lancer infrastructure\test-e2e.ps1 manuellement)"
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
if ($FAILURES) {
  Write-Host "  VALIDATION GLOBALE : ÉCHECS DÉTECTÉS" -ForegroundColor Red
} else {
  Write-Host "  VALIDATION GLOBALE : TOUT EST OK" -ForegroundColor Green
}
Write-Host "============================================" -ForegroundColor Cyan
if ($FAILURES) { exit 1 } else { exit 0 }
