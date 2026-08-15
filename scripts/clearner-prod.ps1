# =============================================================================
# ClearNet V1.3 - Déploiement PRODUCTION (Windows PowerShell 5.1+)
# Copier-coller exécutable : .\scripts\clearner-prod.ps1
#
# Périmètre : build image backend -> push (optionnel) -> helm lint ->
# helm upgrade -f values-production.yaml -> rollout -> health -> smoke e2e.
# Secrets passés en variables d'environnement (jamais en clair dans le script).
#
# Mode -DryRun (validation pipeline) : prérequis + lint + rendu des manifests
# (écrit dans $DryRunManifests) puis arrêt propre, sans build, sans upgrade ni
# smoke. Exit 0 si tout est valide.
#
# Prérequis : Docker Desktop (cluster Docker ou kubeconfig externe), helm,
# kubectl. Pour l'activation BullMQ, le Redis du cluster doit être joignable
# (REDIS_HOST dans values-production.yaml).
# =============================================================================
[CmdletBinding()]
param(
  [string]$Registry = "ghcr.io/clearnet/backend",
  [string]$Tag = "v1.3.0",
  [string]$Namespace = "clearnet",
  [string]$Release = "clearnet",
  [string]$DryRunManifests = "$env:TEMP\clearnet-manifests.yaml",
  [switch]$PushImage,
  [switch]$PullIfPresent,
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ChartDir = (Resolve-Path "$Root\..\infrastructure\helm\clearnet").Path
$ValuesFile = Join-Path $ChartDir "values-production.yaml"
$BuildContext = (Resolve-Path "$Root\..\clearnet-backend").Path
$Image = "$Registry`:$Tag"

$Secrets = @{
  JwtSecret      = $env:JWT_SECRET
  Neo4jPassword  = $env:NEO4J_PASSWORD
  RedisPassword  = $env:REDIS_PASSWORD
}

function Step([string]$title) {
  Write-Host ""
  Write-Host "====================================================" -ForegroundColor Cyan
  Write-Host "  $title" -ForegroundColor Cyan
  Write-Host "====================================================" -ForegroundColor Cyan
}
function Ok([string]$msg)  { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Warn([string]$msg){ Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Fail([string]$msg){ Write-Host "  [KO] $msg" -ForegroundColor Red; exit 1 }

# ------------------------- Prérequis -------------------------
Step "1/6 - Prérequis (docker, helm, kubectl, cluster)"
foreach ($cmd in "docker", "kubectl") {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Fail "$cmd introuvable" }
}
if (-not (Get-Command helm -ErrorAction SilentlyContinue)) {
  Warn "helm absent — téléchargement de l'archive Windows"
  $zip = Join-Path $env:TEMP "helm.zip"
  Invoke-WebRequest -Uri "https://get.helm.sh/helm-v3.16.0-windows-amd64.zip" -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $env:TEMP -Force
  $env:PATH = "$env:TEMP\windows-amd64;" + $env:PATH
}
helm version | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "helm indisponible - installer https://helm.sh" }
kubectl cluster-info | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "cluster Kubernetes injoignable (kubectl cluster-info)" }
Ok "Outils présents + cluster joignable"

# ------------------------- Build / push -------------------------
if ($DryRun) {
  Step "2/6 - Build de l'image backend ($Image) [IGNORÉ en -DryRun]"
  Warn "Mode -DryRun : pas de build ni de push"
} else {
  Step "2/6 - Build de l'image backend ($Image)"
  docker build -t $Image $BuildContext
  if ($LASTEXITCODE -ne 0) { Fail "docker build échoué" }
  Ok "Image construite"
  if ($PushImage) {
    docker push $Image
    if ($LASTEXITCODE -ne 0) { Fail "docker push échoué" }
    Ok "Image poussée"
  } else {
    Warn "PushImage non demandé : image locale (kind load / k3s ctr images import)"
  }
}

# ------------------------- Helm -------------------------
Step "3/6 - Lint du chart + rendu production"
helm lint $ChartDir -f $ValuesFile
if ($LASTEXITCODE -ne 0) { Fail "helm lint échoué" }
if ($DryRun) {
  helm template $Release $ChartDir -f $ValuesFile --namespace $Namespace | Set-Content -Path $DryRunManifests
  if ($LASTEXITCODE -ne 0) { Fail "helm template échoué" }
  Write-Host ""
  Write-Host "====================================================" -ForegroundColor Green
  Write-Host "  VALIDATION DRY-RUN TERMINÉE (PASS)" -ForegroundColor Green
  Write-Host "  Manifests rendus : $DryRunManifests" -ForegroundColor Green
  Write-Host "  Aucun changement appliqué au cluster." -ForegroundColor Green
  Write-Host "====================================================" -ForegroundColor Green
  exit 0
}
helm template $Release $ChartDir -f $ValuesFile --namespace $Namespace | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "helm template échoué" }
Ok "Chart valide"

$SetArgs = @()
if ($Secrets.JwtSecret)     { $SetArgs += @("--set", "backend.jwtSecret=$($Secrets.JwtSecret)") }
if ($Secrets.Neo4jPassword) { $SetArgs += @("--set", "neo4j.authPassword=$($Secrets.Neo4jPassword)") }
if ($Secrets.RedisPassword) { $SetArgs += @("--set", "backend.env.REDIS_PASSWORD=$($Secrets.RedisPassword)") }
if ($PullIfPresent)         { $SetArgs += @("--set", "backend.image.pullPolicy=Always") }

Step "4/6 - helm upgrade --install (release=$Release, namespace=$Namespace)"
helm upgrade --install $Release $ChartDir `
  -f $ValuesFile `
  --namespace $Namespace --create-namespace `
  --wait --timeout 5m `
  @SetArgs
if ($LASTEXITCODE -ne 0) { Fail "helm upgrade échoué" }
Ok "Helm appliqué"

# ------------------------- Rollout -------------------------
Step "5/6 - Attente du rollout backend"
kubectl rollout status "deployment/$Release-backend" --namespace $Namespace --timeout=300s
if ($LASTEXITCODE -ne 0) { Fail "rollout échoué - kubectl describe pods / logs" }
kubectl get pods -n $Namespace -l app=backend -o wide

# ------------------------- Vérification -------------------------
Step "6/6 - Health + smoke test e2e (port-forward 3000)"
$pf = Start-Process kubectl -ArgumentList @(
  "port-forward", "deployment/$Release-backend", "3000:3000", "-n", $Namespace
) -PassThru -WindowStyle Hidden
try {
  $healthy = $false
  for ($i = 0; $i -lt 30; $i++) {
    try { $null = Invoke-RestMethod -Uri "http://localhost:3000/api/health" -TimeoutSec 3; $healthy = $true; break }
    catch { Start-Sleep -Seconds 2 }
  }
  if (-not $healthy) { Fail "Health KO après 60 s" }
  Ok "GET /api/health -> 200"

  $suffix = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $email = "prod-smoke-$suffix@clearnet.io"
  $registerBody = @{ email = $email; name = "Smoke Prod"; password = "Sm0ke!Pass"; industry = "Technology" } | ConvertTo-Json
  $null = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/register" -Method Post `
    -ContentType "application/json" -Body $registerBody

  $login = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/login" -Method Post `
    -ContentType "application/json" `
    -Body (@{ email = $email; password = "Sm0ke!Pass" } | ConvertTo-Json)
  $token = $login.access_token
  if (-not $token) { Fail "Login échoué (token vide)" }

  $null = Invoke-RestMethod -Uri "http://localhost:3000/api/transactions/balance" `
    -Headers @{ Authorization = "Bearer $token" }
  Ok "Smoke e2e : register -> login -> /transactions/balance -> 200"
} finally {
  if ($pf -and -not $pf.HasExited) { Stop-Process -Id $pf.Id -Force -ErrorAction SilentlyContinue }
}

Write-Host ""
Write-Host "====================================================" -ForegroundColor Green
Write-Host "  DÉPLOIEMENT PRODUCTION TERMINÉ" -ForegroundColor Green
Write-Host "  URL d'accès : voir l'ingress (host dans values-production.yaml)" -ForegroundColor Green
Write-Host "  Rollback    : helm rollback $Release -n $Namespace" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green
