# =============================================================
# ClearNet V1.1 — Validation E2E Docker (Windows PowerShell)
# Exécute : build compose -> healthcheck -> registre/login ->
# transaction -> historique -> 401/429 -> teardown.
# Usage : .\infrastructure\test-e2e.ps1
# Mac/Linux : ./infrastructure/test-e2e.sh
# =============================================================
$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BASE_URL = if ($env:E2E_BASE_URL) { $env:E2E_BASE_URL } else { "http://localhost:3000/api" }
$PASS = 0
$FAIL = 0

function Check([string]$name, [bool]$ok) {
  if ($ok) { Write-Host "  [OK] $name" -ForegroundColor Green; $script:PASS++ }
  else { Write-Host "  [KO] $name" -ForegroundColor Red; $script:FAIL++ }
}

function PostJson([string]$path, [hashtable]$body, [string]$token = "") {
  $headers = @{ "Content-Type" = "application/json" }
  if ($token) { $headers["Authorization"] = "Bearer $token" }
  Invoke-RestMethod -Uri "$BASE_URL$path" -Method Post -Headers $headers -Body ($body | ConvertTo-Json)
}

Write-Host "==> [1/7] docker compose up -d --build"
Push-Location $ROOT
$ErrorActionPreference = "Continue"
docker compose -f infrastructure/docker-compose.yml up -d --build 2>&1 | ForEach-Object { if ($_ -is [string]) { Write-Host $_ } }
if ($LASTEXITCODE -ne 0) { throw "docker compose up a echoue (code $LASTEXITCODE)" }
$ErrorActionPreference = "Stop"
Pop-Location

Write-Host "==> [2/7] Attente du healthcheck backend"
$healthy = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $h = Invoke-RestMethod -Uri "$BASE_URL/health" -TimeoutSec 5
    if ($h.status -eq "ok") { $healthy = $true; break }
  } catch { }
  Start-Sleep -Seconds 5
}
Check "backend healthy en 5 min" $healthy

Write-Host "==> [3/7] Inscription de deux utilisateurs E2E"
$alice = PostJson "/auth/register" @{ email = "alice.e2e@clearnet.io"; name = "Alice E2E"; password = "e2e-password" }
Check "register alice" ($null -ne $alice)
$bob = PostJson "/auth/register" @{ email = "bob.e2e@clearnet.io"; name = "Bob E2E"; password = "e2e-password" }
Check "register bob" ($null -ne $bob)

Write-Host "==> [4/7] Login + token"
$login = PostJson "/auth/login" @{ email = "alice.e2e@clearnet.io"; password = "e2e-password" }
Check "login alice (token présent)" (-not [string]::IsNullOrEmpty($login.access_token))

Write-Host "==> [5/7] Transaction alice -> bob"
$tx = PostJson "/transactions" @{ toEmail = "bob.e2e@clearnet.io"; amount = 10.5; note = "E2E" } $login.access_token
Check "création transaction" ($null -ne $tx)

Write-Host "==> [6/7] Historique alice (1 transaction, to=bob)"
$headers = @{ Authorization = "Bearer $($login.access_token)" }
$hist = Invoke-RestMethod -Uri "$BASE_URL/transactions/history" -Headers $headers
Check "historique = 1 transaction" ($hist.Count -eq 1)
Check "destinataire = bob" ($hist[0].toEmail -eq "bob.e2e@clearnet.io")

Write-Host "==> [7/7] Sécurité : 401 (mauvais mot de passe) + 429 (rate-limit login)"
$http401 = $false
try {
  Invoke-RestMethod -Uri "$BASE_URL/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = "alice.e2e@clearnet.io"; password = "wrong-pass" } | ConvertTo-Json) | Out-Null
} catch {
  $http401 = ($_.Exception.Response.StatusCode.value__ -eq 401)
}
Check "login invalide -> 401" $http401

$http429 = $false
for ($i = 0; $i -lt 6; $i++) {
  try {
    Invoke-RestMethod -Uri "$BASE_URL/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = "alice.e2e@clearnet.io"; password = "wrong-pass" } | ConvertTo-Json) | Out-Null
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 429) { $http429 = $true; break }
  }
}
Check "rate-limit login -> 429" $http429

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Résultats E2E : $PASS réussi(s), $FAIL échec(s)" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

Write-Host "==> Nettoyage (docker compose down -v)"
Push-Location $ROOT
$ErrorActionPreference = "Continue"
docker compose -f infrastructure/docker-compose.yml down -v 2>&1 | ForEach-Object { if ($_ -is [string]) { Write-Host $_ } }
if ($LASTEXITCODE -ne 0) { Write-Host "  [KO] docker compose down (code $LASTEXITCODE)" -ForegroundColor Red; $script:FAIL++ }
$ErrorActionPreference = "Stop"
Pop-Location

if ($FAIL -gt 0) { exit 1 } else { exit 0 }
