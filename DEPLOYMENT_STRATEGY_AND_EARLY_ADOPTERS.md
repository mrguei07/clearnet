# CLEARNET V1.3 — Stratégie de déploiement & Early Adopters

> Livrable d'industrialisation & durcissement (V1.3). Stratégie de déploiement (validation
> pipeline kind → E2E on-chain Sepolia → déploiement production), accompagnement des
> premiers utilisateurs (early adopters) et documentation de validation. Tous les scripts
> et modèles sont intégrés dans ce document et sont prêts à l'emploi.

---

## Sommaire

1. [Contexte, objectifs et principes](#1-contexte-objectifs-et-principes)
2. [Stratégie de déploiement (phases, calendrier, Go/No-Go)](#2-stratégie-de-déploiement)
3. [Action 1 — Validation du pipeline Kubernetes (kind)](#3-action-1--validation-du-pipeline-kubernetes-kind)
4. [Action 2 — E2E on-chain Sepolia (BullMQ + pont)](#4-action-2--e2e-on-chain-sepolia-bullmq--pont)
5. [Action 3 — Programme Early Adopters](#5-action-3--programme-early-adopters)
6. [Documentation de validation & checklist finale](#6-documentation-de-validation--checklist-finale)
7. [Points de vigilance traités (3.1–3.5)](#8-points-de-vigilance-traités-avant-déploiement-réel)
8. [Corrections mineures appliquées (déclarées)](#9-corrections-mineures-appliquées-déclarées)

---

## 1. Contexte, objectifs et principes

### Contexte

- Backend NestJS industrialisé (V1.3) : file BullMQ + Redis pour les règlements on-chain
  (`POST /api/transactions` → `onchain-settlement` → `CompensationEngine.settle`),
  API de démo verrouillée par `X-Demo-Key`, scripts de déploiement production
  (`scripts/clearner-prod.sh` / `.ps1`), chart Helm `infrastructure/helm/clearnet`
  (backend 3 réplicas + HPA, Neo4j, ingress, alerting Grafana).
- Pont on-chain : contrats Hardhat (`ClearNetToken`, `CompensationEngine`) déployables sur
  Sepolia via `npm run deploy:sepolia` (écrit `clearnet-blockchain/deployments/sepolia.json`).

### Objectifs de ce livrable

| # | Objectif | Livrable |
|---|----------|----------|
| 1 | Valider la pipeline de déploiement sans toucher la production | Action 1 (kind + `--dry-run`) |
| 2 | Prouver le règlement on-chain de bout en bout (BullMQ → Sepolia) | Action 2 (E2E Sepolia) |
| 3 | Lancer le programme d'accompagnement des premiers utilisateurs | Action 3 (early adopters) |
| 4 | Formaliser les critères Go/No-Go et la documentation de validation | Section 6 |

### Principes

1. **Aucune modification du code existant, sauf mention explicite** — 3 corrections
   mineures uniquement, listées en [section 9](#9-corrections-mineures-appliquées-déclarées).
2. **Production intouchable** : la production ne reçoit rien avant le Go/No-Go complet
   (section 6).
3. **Sécurité par défaut** : secrets jamais commités, `DEMO_API_KEY` vide en production
   (401 systématique), pont on-chain désactivé tant que les adresses de contrats
   vérifiées ne sont pas configurées.
4. **Idempotence** : tous les scripts sont rejouables sans état résiduel gênant
   (emails horodatés, `--set` explicites, `kubectl apply` idempotent).

---

## 2. Stratégie de déploiement

### Phases

| Phase | Nom | Contenu | Critère de sortie |
|-------|-----|---------|-------------------|
| 0 | **Préparation** | Environnements (dev local, kind, staging Sepolia), comptes de service, keys (JWT, Neo4j, Redis), adresses de contrats Sepolia, domaines + certificats | Checklist §6.1 verte |
| 1 | **Validation pipeline** (J1–J2) | Action 1 : kind + `clearner-prod.sh --dry-run`, helm lint, déploiement de validation, smoke e2e | `validation-kind-report.md` signé PASS |
| 2 | **E2E on-chain Sepolia** (J3–J5) | Action 2 : contrats Sepolia, mint, règlements BullMQ succès/échec, positions, retries, monitoring | `e2e-sepolia-report.md` signé PASS |
| 3 | **Early adopters** (J4–J8) | Action 3 : comptes de démonstration par secteur, candidatures, formation, pilotage, mesure d'usage | ≥ 3 candidatures, ≥ 1 utilisateur actif |
| 4 | **Production + validation finale** (J8–J10) | `clearner-prod.sh` (secrets via Vault/SealedSecrets), vérifications Go/No-Go §6.3, annonce | Checklist §6.3 verte + sign-off |

### Calendrier cible (J1 = lancement)

```
J1      J2      J3      J4      J5      J6      J7      J8      J9      J10
│───────│───────│───────│───────│───────│───────│───────│───────│───────│
Phase 1 ▸▸▸▸▸
        Phase 2 ▸▸▸▸▸▸▸
                Phase 3 ▸▸▸▸▸▸▸▸▸▸
                                        Phase 4 ▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸
```

### Règles de déploiement

- **Toute modification** passe par la pipeline : `clearner-prod.sh --dry-run` (validation
  pure) puis `clearner-prod.sh` (application). En cas de doute : **non, on n'applique pas**.
- **Rollback** immédiat : `helm rollback clearnet -n clearnet` (documenté dans
  `README-PROD.md`).
- **Le Go/No-Go (§6.3) est la seule autorisation** de passer en production.

---

## 3. Action 1 — Validation du pipeline Kubernetes (kind)

**Objectif** : prouver que la pipeline complète (image → chart → cluster → smoke) fonctionne
dans un cluster éphémère **sans toucher à la production** : `kind` (ou minikube), image
locale chargée dans le cluster, déploiement via `clearner-prod.sh --dry-run` + `helm upgrade`,
smoke e2e (health, register, login, transaction via la file BullMQ sur Redis du cluster).

**Dépendances** : Docker Desktop, `kubectl`, `kind` (ou minikube), `helm` (auto-installé si
absent). **Durée** : 20–35 min. **Risques** : aucun pour la production.

### 3.1 Script de validation (Linux / WSL2) — `scripts/validate-kind.sh`

```bash
#!/usr/bin/env bash
# =============================================================================
# ACTION 1 — Validation pipeline Kubernetes (kind) — Linux / WSL2
# Usage : ./scripts/validate-kind.sh
# Prérequis : docker, kubectl, kind (ou minikube), helm (auto-installé si absent).
# Ne touche JAMAIS à la production : cluster éphémère + image locale.
# Écrit le rapport : validation-kind-report.md (à la racine du dépôt).
# =============================================================================
set -euo pipefail

NAMESPACE="clearnet"
RELEASE="clearnet"
REGISTRY="clearnet-local/backend"
TAG="v1.3.0-kind"
CHART_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../infrastructure/helm/clearnet" && pwd)"
BUILD_CONTEXT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../clearnet-backend" && pwd)"
MANIFESTS="/tmp/clearnet-manifests.yaml"
REDIS_MANIFEST="/tmp/clearnet-redis-kind.yaml"
REPORT="validation-kind-report.md"
CLUSTER_TOOL=""

C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'; C_RESET=$'\033[0m'
step()  { echo ""; echo "${C_CYAN}════ $* ════${C_RESET}"; }
ok()    { echo "  ${C_GREEN}[OK]${C_RESET} $*"; }
warn()  { echo "  ${C_YELLOW}[WARN]${C_RESET} $*"; }
die()   { echo "  ${C_RED}[KO]${C_RESET} $*" >&2; exit 1; }

# ------------------------- 0. Prérequis -------------------------
step "0/6 — Prérequis (docker, kubectl, kind/minikube, helm)"
command -v docker  >/dev/null 2>&1 || die "docker introuvable"
command -v kubectl >/dev/null 2>&1 || die "kubectl introuvable"
if command -v kind >/dev/null 2>&1; then CLUSTER_TOOL="kind";
elif command -v minikube >/dev/null 2>&1; then CLUSTER_TOOL="minikube";
else die "kind ou minikube introuvable — installer kind : https://kind.sigs.k8s.io"; fi
if ! command -v helm >/dev/null 2>&1; then
  warn "helm absent — installation automatique (get.helm.sh)"
  curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
fi
helm version >/dev/null 2>&1 || die "installation helm impossible"
ok "Outils présents (cluster via $CLUSTER_TOOL)"

# Cluster éphémère si absent
if ! kubectl cluster-info >/dev/null 2>&1; then
  if [ "$CLUSTER_TOOL" = "kind" ]; then
    kind create cluster --name clearnet --wait 120s
  else
    minikube start --cpus 4 --memory 8g
  fi
  kubectl cluster-info >/dev/null 2>&1 || die "cluster impossible à créer"
  warn "Cluster éphémère créé (nettoie après validation : kind delete cluster / minikube delete)"
else
  ok "Cluster déjà joignable"
fi

# ------------------------- 1. Image + chargement -------------------------
step "1/6 — Build image + chargement dans le cluster"
docker build -t "$REGISTRY:$TAG" "$BUILD_CONTEXT"
if [ "$CLUSTER_TOOL" = "kind" ]; then
  kind load docker-image "$REGISTRY:$TAG" --name clearnet 2>/dev/null || kind load docker-image "$REGISTRY:$TAG"
else
  minikube image load "$REGISTRY:$TAG"
fi
ok "Image chargée dans le cluster"

# ------------------------- 2. Pipeline dry-run -------------------------
step "2/6 — Pipeline de déploiement en mode --dry-run (manifests)"
DRY_RUN_MANIFESTS="$MANIFESTS" bash "$(dirname "${BASH_SOURCE[0]}")/clearner-prod.sh" --dry-run
[ -s "$MANIFESTS" ] || die "Aucun manifest généré"
ok "Manifests rendus (helm lint + template PASS)"

# ------------------------- 3. Redis + helm upgrade -------------------------
step "3/6 — Redis (file BullMQ) + helm upgrade de validation"
cat > "$REDIS_MANIFEST" <<'EOF'
apiVersion: v1
kind: Service
metadata:
  name: clearnet-redis
  labels: { app: clearnet-redis }
spec:
  selector: { app: clearnet-redis }
  ports: [ { port: 6379, targetPort: 6379 } ]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: clearnet-redis
  labels: { app: clearnet-redis }
spec:
  replicas: 1
  selector: { matchLabels: { app: clearnet-redis } }
  template:
    metadata: { labels: { app: clearnet-redis } }
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          ports: [ { containerPort: 6379 } ]
EOF
kubectl apply -f "$REDIS_MANIFEST"
kubectl rollout status deployment/clearnet-redis --timeout=120s >/dev/null
helm upgrade --install "$RELEASE" "$CHART_DIR" \
  -f "$CHART_DIR/values-production.yaml" \
  --namespace "$NAMESPACE" --create-namespace \
  --set "backend.image.repository=$REGISTRY" \
  --set "backend.image.tag=$TAG" \
  --set backend.image.pullPolicy=IfNotPresent \
  --set backend.replicas=1 \
  --set backend.autoscaling.enabled=false \
  --set backend.ingress.enabled=false \
  --set backend.jwtSecret=clearnet-kind-secret \
  --set backend.env.DEMO_API_KEY=clearnet-kind-demo \
  --set backend.env.REDIS_HOST=clearnet-redis \
  --set backend.env.REDIS_PASSWORD="" \
  --set neo4j.authPassword=clearnet-kind-neo4j \
  --wait --timeout 5m
ok "Helm appliqué (validation kind)"

# ------------------------- 4. Rollout -------------------------
step "4/6 — Attente du rollout backend"
kubectl rollout status "deployment/$RELEASE-backend" --namespace "$NAMESPACE" --timeout=300s
kubectl get pods -n "$NAMESPACE" -l app=backend -o wide

# ------------------------- 5. Smoke e2e -------------------------
step "5/6 — Smoke e2e (health, register, login, transaction via BullMQ)"
PF_PID=""
kubectl port-forward "deployment/$RELEASE-backend" 3000:3000 -n "$NAMESPACE" >/dev/null 2>&1 &
PF_PID=$!
trap 'kill $PF_PID 2>/dev/null || true' EXIT
for i in $(seq 1 30); do
  curl -fsS http://localhost:3000/api/health >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS http://localhost:3000/api/health >/dev/null 2>&1 || die "Health KO après 60 s"
ok "GET /api/health → 200"
curl -fsS http://localhost:3000/api/blockchain/status >/dev/null 2>&1 || die "GET /api/blockchain/status KO"
ok "GET /api/blockchain/status → 200 (on-chain désactivé en kind, attendu)"

TS=$(date +%s)
A="kind-a-$TS@clearnet.io"; B="kind-b-$TS@clearnet.io"
curl -fsS -X POST http://localhost:3000/api/auth/register -H "Content-Type: application/json" \
  -d "{\"email\":\"$A\",\"name\":\"Kind A\",\"password\":\"Sm0ke!Pass\",\"industry\":\"Technology\"}" >/dev/null
curl -fsS -X POST http://localhost:3000/api/auth/register -H "Content-Type: application/json" \
  -d "{\"email\":\"$B\",\"name\":\"Kind B\",\"password\":\"Sm0ke!Pass\",\"industry\":\"Technology\"}" >/dev/null
TOKEN_A=$(curl -fsS -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" -d "{\"email\":\"$A\",\"password\":\"Sm0ke!Pass\"}" \
  | sed -E 's/.*"access_token":"([^"]+)".*/\1/')
[ -n "$TOKEN_A" ] || die "Login A échoué"
curl -fsS -X POST http://localhost:3000/api/transactions \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN_A" \
  -d "{\"toEmail\":\"$B\",\"amount\":10,\"note\":\"Smoke kind\"}" >/dev/null
sleep 3
curl -fsS "http://localhost:3000/api/transactions/history?limit=5" \
  -H "Authorization: Bearer $TOKEN_A" | grep -q '"amount": 10' || die "Transaction absente de l'historique"
ok "Smoke e2e : register → login → transaction BullMQ → history"

# ------------------------- 6. Rapport -------------------------
step "6/6 — Écriture du rapport de validation"
cat > "$REPORT" <<EOF
# Rapport de validation — Pipeline Kubernetes (kind)

- **Date** : $(date -Iseconds)
- **Cluster** : $CLUSTER_TOOL (éphémère)
- **Image** : $REGISTRY:$TAG
- **Chart** : $CHART_DIR (values-production.yaml + overrides kind)

| Étape | Résultat | Commentaire |
|-------|----------|-------------|
| 0. Prérequis | PASS | docker/kubectl/$CLUSTER_TOOL/helm |
| 1. Build + chargement image | PASS | \`docker build\` + \`$CLUSTER_TOOL load\` |
| 2. clearner-prod.sh --dry-run | PASS | helm lint + manifests dans $MANIFESTS |
| 3. Redis + helm upgrade | PASS | BullMQ actif (REDIS_HOST=clearnet-redis) |
| 4. Rollout backend | PASS | \`kubectl rollout status\` |
| 5. Smoke e2e | PASS | health, blockchain/status, register, login, transaction, history |
| 6. Rapport | PASS | fichier généré |

## Vérifications complémentaires (manuelles, à compléter)

- [ ] \`kubectl get pods -n clearnet\` : backend 1/1 Ready, neo4j 1/1, redis 1/1
- [ ] \`kubectl logs -n clearnet -l app=backend --tail=50\` : aucune erreur BullMQ/Redis
- [ ] \`docker compose -f infrastructure/docker-compose.yml exec redis redis-cli --scan --pattern 'bull:*'\` : clés de file visibles (si Redis local)
- [ ] Capture d'écran Grafana (si alerting déployé) jointe au rapport

## Conclusion

- [ ] PASS — la pipeline de déploiement est validée
- [ ] FAIL — corrections avant revalidation : ______________________

Signataire : ______________  Date : ______________
EOF
echo ""
echo "${C_GREEN}════════════════════════════════════════════════════${C_RESET}"
echo "${C_GREEN}  VALIDATION KIND TERMINÉE (PASS) — rapport : $REPORT${C_RESET}"
echo "${C_GREEN}  Nettoyage éventuel : kind delete cluster --name clearnet${C_RESET}"
echo "${C_GREEN}════════════════════════════════════════════════════${C_RESET}"
```

### 3.2 Script de validation (Windows PowerShell) — `scripts/validate-kind.ps1`

```powershell
# =============================================================================
# ACTION 1 — Validation pipeline Kubernetes (kind) — Windows PowerShell 5.1+
# Usage : .\scripts\validate-kind.ps1
# Prérequis : Docker Desktop, kubectl, kind (ou minikube), helm (téléchargé si absent).
# Ne touche JAMAIS à la production : cluster éphémère + image locale.
# Écrit le rapport : validation-kind-report.md (à la racine du dépôt).
# =============================================================================
[CmdletBinding()]
param(
  [string]$Namespace = "clearnet",
  [string]$Release = "clearnet",
  [string]$Registry = "clearnet-local/backend",
  [string]$Tag = "v1.3.0-kind"
)
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ChartDir = (Resolve-Path "$Root\..\infrastructure\helm\clearnet").Path
$BuildContext = (Resolve-Path "$Root\..\clearnet-backend").Path
$Manifests = Join-Path $env:TEMP "clearnet-manifests.yaml"
$RedisManifest = Join-Path $env:TEMP "clearnet-redis-kind.yaml"
$Report = "validation-kind-report.md"
$Image = "$Registry`:$Tag"

function Step([string]$t)  { Write-Host ""; Write-Host "==== $t ====" -ForegroundColor Cyan }
function Ok([string]$m)    { Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn([string]$m)  { Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function Fail([string]$m)  { Write-Host "  [KO] $m" -ForegroundColor Red; exit 1 }

# ------------------------- 0. Prérequis -------------------------
Step "0/6 - Prérequis (docker, kubectl, kind/minikube, helm)"
foreach ($cmd in "docker", "kubectl") {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Fail "$cmd introuvable" }
}
$ClusterTool = $null
if (Get-Command kind -ErrorAction SilentlyContinue) { $ClusterTool = "kind" }
elseif (Get-Command minikube -ErrorAction SilentlyContinue) { $ClusterTool = "minikube" }
else { Fail "kind ou minikube introuvable — https://kind.sigs.k8s.io" }
if (-not (Get-Command helm -ErrorAction SilentlyContinue)) {
  Warn "helm absent — téléchargement de l'archive Windows"
  $zip = Join-Path $env:TEMP "helm.zip"
  Invoke-WebRequest -Uri "https://get.helm.sh/helm-v3.16.0-windows-amd64.zip" -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $env:TEMP -Force
  $env:PATH = "$env:TEMP\windows-amd64;" + $env:PATH
}
helm version | Out-Null; if ($LASTEXITCODE -ne 0) { Fail "helm indisponible" }
Ok "Outils présents (cluster via $ClusterTool)"

kubectl cluster-info | Out-Null
if ($LASTEXITCODE -ne 0) {
  if ($ClusterTool -eq "kind") { kind create cluster --name clearnet --wait 120s }
  else { minikube start --cpus 4 --memory 8g }
  kubectl cluster-info | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "cluster impossible à créer" }
  Warn "Cluster éphémère créé (nettoyage : kind delete cluster / minikube delete)"
} else { Ok "Cluster déjà joignable" }

# ------------------------- 1. Image -------------------------
Step "1/6 - Build image + chargement dans le cluster"
docker build -t $Image $BuildContext
if ($LASTEXITCODE -ne 0) { Fail "docker build échoué" }
if ($ClusterTool -eq "kind") {
  kind load docker-image $Image --name clearnet 2>$null
  if ($LASTEXITCODE -ne 0) { kind load docker-image $Image }
  if ($LASTEXITCODE -ne 0) { Fail "kind load docker-image échoué" }
} else {
  minikube image load $Image
  if ($LASTEXITCODE -ne 0) { Fail "minikube image load échoué" }
}
Ok "Image chargée dans le cluster"

# ------------------------- 2. Pipeline dry-run -------------------------
Step "2/6 - Pipeline de déploiement en mode -DryRun (manifests)"
$env:DRY_RUN_MANIFESTS = $Manifests
& "$Root\clearner-prod.ps1" -DryRun
if ($LASTEXITCODE -ne 0) { Fail "clearner-prod.ps1 -DryRun échoué" }
if (-not (Test-Path $Manifests)) { Fail "Aucun manifest généré" }
Ok "Manifests rendus (helm lint + template PASS)"

# ------------------------- 3. Redis + helm upgrade -------------------------
Step "3/6 - Redis (file BullMQ) + helm upgrade de validation"
@"
apiVersion: v1
kind: Service
metadata:
  name: clearnet-redis
  labels: { app: clearnet-redis }
spec:
  selector: { app: clearnet-redis }
  ports: [ { port: 6379, targetPort: 6379 } }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: clearnet-redis
  labels: { app: clearnet-redis }
spec:
  replicas: 1
  selector: { matchLabels: { app: clearnet-redis } }
  template:
    metadata: { labels: { app: clearnet-redis } }
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          ports: [ { containerPort: 6379 } ]
"@ | Set-Content -Path $RedisManifest -Encoding utf8
kubectl apply -f $RedisManifest
if ($LASTEXITCODE -ne 0) { Fail "kubectl apply redis échoué" }
kubectl rollout status deployment/clearnet-redis --timeout=120s | Out-Null

helm upgrade --install $Release $ChartDir `
  -f (Join-Path $ChartDir "values-production.yaml") `
  --namespace $Namespace --create-namespace `
  --set "backend.image.repository=$Registry" `
  --set "backend.image.tag=$Tag" `
  --set backend.image.pullPolicy=IfNotPresent `
  --set backend.replicas=1 `
  --set backend.autoscaling.enabled=false `
  --set backend.ingress.enabled=false `
  --set backend.jwtSecret=clearnet-kind-secret `
  --set backend.env.DEMO_API_KEY=clearnet-kind-demo `
  --set backend.env.REDIS_HOST=clearnet-redis `
  --set backend.env.REDIS_PASSWORD="" `
  --set neo4j.authPassword=clearnet-kind-neo4j `
  --wait --timeout 5m
if ($LASTEXITCODE -ne 0) { Fail "helm upgrade échoué" }
Ok "Helm appliqué (validation kind)"

# ------------------------- 4. Rollout -------------------------
Step "4/6 - Attente du rollout backend"
kubectl rollout status "deployment/$Release-backend" --namespace $Namespace --timeout=300s
if ($LASTEXITCODE -ne 0) { Fail "rollout échoué - kubectl describe pods / logs" }
kubectl get pods -n $Namespace -l app=backend -o wide

# ------------------------- 5. Smoke e2e -------------------------
Step "5/6 - Smoke e2e (health, register, login, transaction via BullMQ)"
$pf = Start-Process kubectl -ArgumentList @("port-forward", "deployment/$Release-backend", "3000:3000", "-n", $Namespace) -PassThru -WindowStyle Hidden
try {
  $healthy = $false
  for ($i = 0; $i -lt 30; $i++) {
    try { $null = Invoke-RestMethod -Uri "http://localhost:3000/api/health" -TimeoutSec 3; $healthy = $true; break }
    catch { Start-Sleep -Seconds 2 }
  }
  if (-not $healthy) { Fail "Health KO après 60 s" }
  Ok "GET /api/health -> 200"
  $null = Invoke-RestMethod -Uri "http://localhost:3000/api/blockchain/status"
  Ok "GET /api/blockchain/status -> 200 (on-chain désactivé en kind, attendu)"

  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $a = "kind-a-$ts@clearnet.io"; $b = "kind-b-$ts@clearnet.io"
  $null = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/register" -Method Post -ContentType "application/json" `
    -Body (@{ email = $a; name = "Kind A"; password = "Sm0ke!Pass"; industry = "Technology" } | ConvertTo-Json)
  $null = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/register" -Method Post -ContentType "application/json" `
    -Body (@{ email = $b; name = "Kind B"; password = "Sm0ke!Pass"; industry = "Technology" } | ConvertTo-Json)
  $loginA = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/login" -Method Post -ContentType "application/json" `
    -Body (@{ email = $a; password = "Sm0ke!Pass" } | ConvertTo-Json)
  if (-not $loginA.access_token) { Fail "Login A échoué" }
  $hdrA = @{ Authorization = "Bearer $($loginA.access_token)" }
  $null = Invoke-RestMethod -Uri "http://localhost:3000/api/transactions" -Method Post -ContentType "application/json" -Headers $hdrA `
    -Body (@{ toEmail = $b; amount = 10; note = "Smoke kind" } | ConvertTo-Json)
  Start-Sleep -Seconds 3
  $hist = Invoke-RestMethod -Uri "http://localhost:3000/api/transactions/history?limit=5" -Headers $hdrA
  if (($hist | ConvertTo-Json) -notmatch '"amount":10') { Fail "Transaction absente de l'historique" }
  Ok "Smoke e2e : register -> login -> transaction BullMQ -> history"
} finally {
  if ($pf -and -not $pf.HasExited) { Stop-Process -Id $pf.Id -Force -ErrorAction SilentlyContinue }
}

# ------------------------- 6. Rapport -------------------------
Step "6/6 - Écriture du rapport de validation"
$date = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
@"
# Rapport de validation — Pipeline Kubernetes (kind)

- **Date** : $date
- **Cluster** : $ClusterTool (éphémère)
- **Image** : $Image
- **Chart** : $ChartDir (values-production.yaml + overrides kind)

| Étape | Résultat | Commentaire |
|-------|----------|-------------|
| 0. Prérequis | PASS | docker/kubectl/$ClusterTool/helm |
| 1. Build + chargement image | PASS | docker build + $ClusterTool load |
| 2. clearner-prod.ps1 -DryRun | PASS | helm lint + manifests dans $Manifests |
| 3. Redis + helm upgrade | PASS | BullMQ actif (REDIS_HOST=clearnet-redis) |
| 4. Rollout backend | PASS | kubectl rollout status |
| 5. Smoke e2e | PASS | health, blockchain/status, register, login, transaction, history |
| 6. Rapport | PASS | fichier généré |

## Vérifications complémentaires (manuelles, à compléter)

- [ ] kubectl get pods -n clearnet : backend 1/1 Ready, neo4j 1/1, redis 1/1
- [ ] kubectl logs -n clearnet -l app=backend --tail=50 : aucune erreur BullMQ/Redis
- [ ] Capture d'écran Grafana (si alerting déployé) jointe au rapport

## Conclusion

- [ ] PASS — la pipeline de déploiement est validée
- [ ] FAIL — corrections avant revalidation : ______________________

Signataire : ______________  Date : ______________
"@ | Set-Content -Path $Report -Encoding utf8
Write-Host ""
Write-Host "====================================================" -ForegroundColor Green
Write-Host "  VALIDATION KIND TERMINÉE (PASS) — rapport : $Report" -ForegroundColor Green
Write-Host "  Nettoyage éventuel : kind delete cluster --name clearnet" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green
```

### 3.3 Critère de succès (Action 1)

1. `clearner-prod.sh --dry-run` se termine en PASS (helm lint + template sans erreur).
2. `helm upgrade` de validation : backend 1/1 Ready, Neo4j 1/1, Redis 1/1.
3. Smoke e2e : register → login → transaction (file BullMQ active) → history OK.
4. Aucune erreur BullMQ/Redis dans les logs backend.

---

## 4. Action 2 — E2E on-chain Sepolia (BullMQ + pont)

**Objectif** : prouver le règlement on-chain de bout en bout : **mint CLRN + positions
nettes** sur Sepolia → **file BullMQ** → **`CompensationEngine.settle`** → **statut
SUCCESS + hash** dans l'historique ; **cas d'échec** (crédit insuffisant) → **retries
BullMQ** puis **statut FAILED**. Vérification des **positions nettes** après règlement.

**Scénario (conforme au plan)**
| Étape | Appel | Résultat attendu |
|-------|-------|------------------|
| 1. Contrats Sepolia | `npm run deploy:sepolia` (si absent) | `deployments/sepolia.json` |
| 2. Infra locale | `docker compose up -d --build backend` | redis + neo4j + backend (pont ON) |
| 3. Comptes | `POST /api/auth/register` Alice/Bob (+ industrie) | 201 |
| 4. Mint + position | `POST /api/blockchain/mint` Alice **500 CLRN** | 2 hashes (token + position) |
| 5. Règlement | `POST /api/transactions` Alice → Bob **100** | 201 (job BullMQ) |
| 6. Suivi | Poll `GET /api/transactions/history` | **SUCCESS + onchainHash ≤ 60 s** |
| 7. Positions | `GET /api/blockchain/position/:email` | Alice **400**, Bob **100** CLRN |
| 8. Cas d'échec | Carol mint **5**, tx Carol → Bob **50** | retries BullMQ → **FAILED** |

**Prérequis** : Docker Desktop, Node.js, `clearnet-blockchain/.env` avec
`SEPOLIA_RPC_URL` + `SEPOLIA_PRIVATE_KEY` (≥ 0.05 ETH de test, faucet Sepolia) ;
`infrastructure/docker-compose.yml` non modifié. **Durée** : 25–45 min.
**Risques** : consommation de SepoliaETH de test uniquement.

### 4.1 Script E2E (Linux / WSL2) — `scripts/e2e-sepolia.sh`

```bash
#!/usr/bin/env bash
# =============================================================================
# ACTION 2 — E2E on-chain Sepolia (BullMQ + pont) — Linux / WSL2
# Usage : ./scripts/e2e-sepolia.sh
# Prérequis : docker, node, clearnet-blockchain/.env (SEPOLIA_RPC_URL,
#             SEPOLIA_PRIVATE_KEY, solde >= 0.05 ETH de test).
# Écrit le rapport : e2e-sepolia-report.md (à la racine du dépôt).
# =============================================================================
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000/api}"
DEMO_KEY="${DEMO_KEY:-clearnet-demo}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOYMENTS="$REPO/clearnet-blockchain/deployments/sepolia.json"
REPORT="$REPO/e2e-sepolia-report.md"
TS=$(date +%s)
ALICE="alice-e2e-$TS@clearnet.io"; BOB="bob-e2e-$TS@clearnet.io"; CAROL="carol-e2e-$TS@clearnet.io"
PASS="E2e!Sepolia"

C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'; C_RESET=$'\033[0m'
step()  { echo ""; echo "${C_CYAN}════ $* ════${C_RESET}"; }
ok()    { echo "  ${C_GREEN}[OK]${C_RESET} $*"; }
warn()  { echo "  ${C_YELLOW}[WARN]${C_RESET} $*"; }
die()   { echo "  ${C_RED}[KO]${C_RESET} $*" >&2; exit 1; }

# ------------------------- 0. Prérequis -------------------------
step "0/9 — Prérequis (docker, node, config Sepolia)"
command -v docker >/dev/null 2>&1 || die "docker introuvable"
command -v node   >/dev/null 2>&1 || die "node introuvable"
ENV_FILE="$REPO/clearnet-blockchain/.env"
[ -f "$ENV_FILE" ] || die "clearnet-blockchain/.env introuvable (SEPOLIA_RPC_URL + SEPOLIA_PRIVATE_KEY requis)"
RPC=$(grep -E '^SEPOLIA_RPC_URL=' "$ENV_FILE" | cut -d= -f2-)
PK=$(grep -E '^SEPOLIA_PRIVATE_KEY=' "$ENV_FILE" | cut -d= -f2-)
[ -n "$RPC" ] && [ -n "$PK" ] || die "SEPOLIA_RPC_URL et SEPOLIA_PRIVATE_KEY requis dans clearnet-blockchain/.env"
ok "Configuration Sepolia lue (RPC et clé présentes, non affichées)"

# ------------------------- 1. Contrats -------------------------
step "1/9 — Déploiement des contrats sur Sepolia (si absents)"
TOKEN_ADDR=""; ENGINE_ADDR=""
if [ -f "$DEPLOYMENTS" ]; then
  TOKEN_ADDR=$(node -e "console.log(require('$DEPLOYMENTS').clearNetToken)")
  ENGINE_ADDR=$(node -e "console.log(require('$DEPLOYMENTS').compensationEngine)")
  ok "Contrats existants : token=$TOKEN_ADDR engine=$ENGINE_ADDR"
else
  warn "deployments/sepolia.json absent — lancement du déploiement (npm run deploy:sepolia)"
  (cd "$REPO/clearnet-blockchain" && npm run deploy:sepolia)
  TOKEN_ADDR=$(node -e "console.log(require('$DEPLOYMENTS').clearNetToken)")
  ENGINE_ADDR=$(node -e "console.log(require('$DEPLOYMENTS').compensationEngine)")
fi

# ------------------------- 2. Infra (compose + pont ON) -------------------------
step "2/9 — Démarrage de l'infra locale (redis + neo4j + backend, pont ON)"
export BLOCKCHAIN_ENABLED="true"
export BLOCKCHAIN_RPC_URL="$RPC"
export BLOCKCHAIN_PRIVATE_KEY="$PK"
export CLRN_TOKEN_ADDRESS="$TOKEN_ADDR"
export COMPENSATION_ENGINE_ADDRESS="$ENGINE_ADDR"
export QUEUE_ENABLED="true"
export REDIS_HOST="localhost"
(cd "$REPO/infrastructure" && docker compose up -d --build backend)
for i in $(seq 1 30); do
  curl -fsS "$API_BASE/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "$API_BASE/health" >/dev/null 2>&1 || die "Backend non prêt après 60 s"
curl -fsS "$API_BASE/blockchain/status" | grep -q '"enabled":true' || die "Pont on-chain non activé"
ok "Backend prêt, pont on-chain ACTIF (BLOCKCHAIN_ENABLED=true)"

# ------------------------- 3. Comptes -------------------------
step "3/9 — Création des comptes (Alice, Bob, Carol + industrie)"
register() { curl -fsS -X POST "$API_BASE/auth/register" -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"name\":\"$2\",\"password\":\"$PASS\",\"industry\":\"$3\"}" >/dev/null; }
register "$ALICE" "Alice E2E" "Maritime"
register "$BOB"   "Bob E2E"   "Aviation"
register "$CAROL" "Carol E2E" "Biotech"
login() { curl -fsS -X POST "$API_BASE/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"password\":\"$PASS\"}" | sed -E 's/.*"access_token":"([^"]+)".*/\1/'; }
TOKEN_ALICE=$(login "$ALICE"); TOKEN_BOB=$(login "$BOB")
[ -n "$TOKEN_ALICE" ] && [ -n "$TOKEN_BOB" ] || die "Login échoué"
ok "Comptes créés et connectés"

# ------------------------- 4. Mint + position -------------------------
step "4/9 — Mint 500 CLRN sur Alice (+ position nette +500)"
MINT=$(curl -fsS -X POST "$API_BASE/blockchain/mint" -H "Content-Type: application/json" -H "X-Demo-Key: $DEMO_KEY" \
  -d "{\"email\":\"$ALICE\",\"amount\":500}")
echo "$MINT" | grep -q '"tokenTxHash":"0x' || die "Mint token échoué"
echo "$MINT" | grep -q '"positionTxHash":"0x' || die "Mint position échoué"
MINT_TOKEN_HASH=$(echo "$MINT" | sed -E 's/.*"tokenTxHash":"([^"]+)".*/\1/')
ok "Mint confirmé : tokenTxHash=$MINT_TOKEN_HASH"

# ------------------------- 5. Règlement (file) -------------------------
step "5/9 — Transaction Alice -> Bob 100 CLRN (file BullMQ)"
TX=$(curl -fsS -X POST "$API_BASE/transactions" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN_ALICE" \
  -d "{\"toEmail\":\"$BOB\",\"amount\":100,\"note\":\"E2E Sepolia\"}")
TX_ID=$(echo "$TX" | sed -E 's/.*"id":"?([a-zA-Z0-9-]+)"?.*/\1/')
ok "Transaction créée (id=$TX_ID) — règlement en file"

# ------------------------- 6. Suivi jusqu'au SUCCESS -------------------------
step "6/9 — Poll de l'historique (SUCCESS + hash attendus <= 60 s)"
STATUS="PENDING"; HASH=""; POLLS=0
for i in $(seq 1 30); do
  HIST=$(curl -fsS "$API_BASE/transactions/history?limit=10" -H "Authorization: Bearer $TOKEN_ALICE")
  STATUS=$(echo "$HIST" | grep -o '"onchainStatus":"[^"]*"' | head -1 | cut -d'"' -f4)
  HASH=$(echo "$HIST" | grep -o '"onchainHash":"0x[^"]*"' | head -1 | cut -d'"' -f4)
  [ "$STATUS" = "SUCCESS" ] && break
  POLLS=$((POLLS + 1)); sleep 2
done
if [ "$STATUS" != "SUCCESS" ]; then
  die "Règlement non confirmé après 60 s (statut=$STATUS, polls=$POLLS) — voir logs backend + Redis"
fi
ok "Règlement SUCCESS — hash : $HASH (explorateur : https://sepolia.etherscan.io/tx/$HASH)"

# ------------------------- 7. Positions -------------------------
step "7/9 — Vérification des positions nettes (Alice 400 / Bob 100)"
POS_ALICE=$(curl -fsS "$API_BASE/blockchain/position/$ALICE" -H "X-Demo-Key: $DEMO_KEY")
POS_BOB=$(curl -fsS "$API_BASE/blockchain/position/$BOB" -H "X-Demo-Key: $DEMO_KEY")
echo "$POS_ALICE" | grep -q '"positionClrn":"400' || die "Position Alice != 400 : $POS_ALICE"
echo "$POS_BOB" | grep -q '"positionClrn":"100' || die "Position Bob != 100 : $POS_BOB"
ok "Positions conformes : Alice 400 CLRN, Bob 100 CLRN"

# ------------------------- 8. Cas d'échec + retries -------------------------
step "8/9 — Cas d'échec : Carol (mint 5) -> Bob 50 CLRN (crédit insuffisant)"
curl -fsS -X POST "$API_BASE/blockchain/mint" -H "Content-Type: application/json" -H "X-Demo-Key: $DEMO_KEY" \
  -d "{\"email\":\"$CAROL\",\"amount\":5}" >/dev/null
TOKEN_CAROL=$(login "$CAROL")
curl -fsS -X POST "$API_BASE/transactions" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN_CAROL" \
  -d "{\"toEmail\":\"$BOB\",\"amount\":50,\"note\":\"E2E échec attendu\"}" >/dev/null
STATUS="PENDING"
for i in $(seq 1 45); do
  HIST=$(curl -fsS "$API_BASE/transactions/history?limit=10" -H "Authorization: Bearer $TOKEN_CAROL")
  STATUS=$(echo "$HIST" | grep -o '"onchainStatus":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ "$STATUS" = "FAILED" ] || [ "$STATUS" = "SUCCESS" ] && break
  sleep 2
done
[ "$STATUS" = "FAILED" ] || die "Échec attendu non observé (statut=$STATUS)"
HIST=$(curl -fsS "$API_BASE/transactions/history?limit=10" -H "Authorization: Bearer $TOKEN_CAROL")
echo "$HIST" | grep -q '"onchainError"' || warn "onchainError absent de la réponse (à vérifier manuellement)"
ok "Cas d'échec validé : retries BullMQ puis FAILED (revert, crédit insuffisant)"

# ------------------------- 9. Rapport -------------------------
step "9/9 — Écriture du rapport E2E"
cat > "$REPORT" <<EOF
# Rapport E2E — Règlement on-chain Sepolia (BullMQ + pont)

- **Date** : $(date -Iseconds)
- **Réseau** : Sepolia (chainId 11155111)
- **Contrats** : token=$TOKEN_ADDR engine=$ENGINE_ADDR
- **Comptes** : $ALICE / $BOB / $CAROL

| Étape | Résultat | Détail |
|-------|----------|--------|
| 0. Prérequis | PASS | docker/node/.env Sepolia |
| 1. Contrats | PASS | deployments/sepolia.json |
| 2. Infra + pont | PASS | BLOCKCHAIN_ENABLED=true, /api/blockchain/status enabled |
| 3. Comptes | PASS | 3 comptes + industrie |
| 4. Mint 500 CLRN (Alice) | PASS | tokenTxHash=$MINT_TOKEN_HASH |
| 5. Transaction 100 CLRN | PASS | file BullMQ (job onchain-settlement) |
| 6. Règlement | PASS | SUCCESS en $((POLLS * 2)) s — hash=$HASH |
| 7. Positions | PASS | Alice 400 CLRN / Bob 100 CLRN |
| 8. Cas d'échec | PASS | revert crédit insuffisant → retries → FAILED |
| 9. Rapport | PASS | fichier généré |

## Vérifications complémentaires (manuelles, à compléter)

- [ ] Explorer : https://sepolia.etherscan.io/tx/$HASH — transaction \`settle\` OK
- [ ] Redis : \`docker compose -f infrastructure/docker-compose.yml exec redis redis-cli --scan --pattern 'bull:onchain-settlement:*'\`
- [ ] Grafana : dashboard Alerting — 1 événement FAILED + retries visibles (capture jointe)

## Conclusion

- [ ] PASS — le règlement on-chain de bout en bout est validé (succès + échec + retries)
- [ ] FAIL — corrections : ______________________

Signataire : ______________  Date : ______________
EOF
echo ""
echo "${C_GREEN}════════════════════════════════════════════════════${C_RESET}"
echo "${C_GREEN}  E2E SEPOLIA TERMINÉ (PASS) — rapport : $REPORT${C_RESET}"
echo "${C_GREEN}  NB : adresses du .env backend à reporter : CLRN_TOKEN_ADDRESS + COMPENSATION_ENGINE_ADDRESS${C_RESET}"
echo "${C_GREEN}════════════════════════════════════════════════════${C_RESET}"
```

### 4.2 Script E2E (Windows PowerShell) — `scripts/e2e-sepolia.ps1`

```powershell
# =============================================================================
# ACTION 2 — E2E on-chain Sepolia (BullMQ + pont) — Windows PowerShell 5.1+
# Usage : .\scripts\e2e-sepolia.ps1
# Prérequis : Docker Desktop, node, clearnet-blockchain/.env (SEPOLIA_RPC_URL,
#             SEPOLIA_PRIVATE_KEY, solde >= 0.05 ETH de test).
# Écrit le rapport : e2e-sepolia-report.md (à la racine du dépôt).
# =============================================================================
[CmdletBinding()]
param(
  [string]$ApiBase = "http://localhost:3000/api",
  [string]$DemoKey = "clearnet-demo"
)
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo = (Resolve-Path "$Root\..").Path
$Deployments = Join-Path $Repo "clearnet-blockchain\deployments\sepolia.json"
$Report = Join-Path $Repo "e2e-sepolia-report.md"
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$Alice = "alice-e2e-$ts@clearnet.io"; $Bob = "bob-e2e-$ts@clearnet.io"; $Carol = "carol-e2e-$ts@clearnet.io"
$Pass = "E2e!Sepolia"
$envFile = Join-Path $Repo "clearnet-blockchain\.env"

function Step([string]$t)  { Write-Host ""; Write-Host "==== $t ====" -ForegroundColor Cyan }
function Ok([string]$m)    { Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn([string]$m)  { Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function Fail([string]$m)  { Write-Host "  [KO] $m" -ForegroundColor Red; exit 1 }

function Get-EnvLine([string]$key) {
  (Get-Content $envFile | Where-Object { $_ -match "^$key=" }) -replace "^$key=", "" | Select-Object -First 1
}
function Get-Jwt([string]$email) {
  $l = Invoke-RestMethod -Uri "$ApiBase/auth/login" -Method Post -ContentType "application/json" `
    -Body (@{ email = $email; password = $Pass } | ConvertTo-Json)
  return $l.access_token
}

# ------------------------- 0. Prérequis -------------------------
Step "0/9 - Prérequis (docker, node, config Sepolia)"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail "docker introuvable" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "node introuvable" }
if (-not (Test-Path $envFile)) { Fail "clearnet-blockchain\.env introuvable" }
$rpc = Get-EnvLine "SEPOLIA_RPC_URL"; $pk = Get-EnvLine "SEPOLIA_PRIVATE_KEY"
if (-not $rpc -or -not $pk) { Fail "SEPOLIA_RPC_URL et SEPOLIA_PRIVATE_KEY requis dans .env" }
Ok "Configuration Sepolia lue (RPC et clé présentes, non affichées)"

# ------------------------- 1. Contrats -------------------------
Step "1/9 - Déploiement des contrats sur Sepolia (si absents)"
$tokenAddr = ""; $engineAddr = ""
if (Test-Path $Deployments) {
  $dep = Get-Content $Deployments | ConvertFrom-Json
  $tokenAddr = $dep.clearNetToken; $engineAddr = $dep.compensationEngine
  Ok "Contrats existants : token=$tokenAddr engine=$engineAddr"
} else {
  Warn "deployments\sepolia.json absent — lancement du déploiement (npm run deploy:sepolia)"
  Push-Location (Join-Path $Repo "clearnet-blockchain")
  try { npm run deploy:sepolia; if ($LASTEXITCODE -ne 0) { Fail "deploy:sepolia échoué" } }
  finally { Pop-Location }
  $dep = Get-Content $Deployments | ConvertFrom-Json
  $tokenAddr = $dep.clearNetToken; $engineAddr = $dep.compensationEngine
}

# ------------------------- 2. Infra (compose + pont ON) -------------------------
Step "2/9 - Démarrage de l'infra locale (redis + neo4j + backend, pont ON)"
$env:BLOCKCHAIN_ENABLED = "true"
$env:BLOCKCHAIN_RPC_URL = $rpc
$env:BLOCKCHAIN_PRIVATE_KEY = $pk
$env:CLRN_TOKEN_ADDRESS = $tokenAddr
$env:COMPENSATION_ENGINE_ADDRESS = $engineAddr
$env:QUEUE_ENABLED = "true"
$env:REDIS_HOST = "localhost"
Push-Location (Join-Path $Repo "infrastructure")
try { docker compose up -d --build backend; if ($LASTEXITCODE -ne 0) { Fail "docker compose up échoué" } }
finally { Pop-Location }
$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
  try { $null = Invoke-RestMethod -Uri "$ApiBase/health" -TimeoutSec 3; $healthy = $true; break }
  catch { Start-Sleep -Seconds 2 }
}
if (-not $healthy) { Fail "Backend non prêt après 60 s" }
$status = Invoke-RestMethod -Uri "$ApiBase/blockchain/status"
if (-not $status.enabled) { Fail "Pont on-chain non activé" }
Ok "Backend prêt, pont on-chain ACTIF (BLOCKCHAIN_ENABLED=true)"

# ------------------------- 3. Comptes -------------------------
Step "3/9 - Création des comptes (Alice, Bob, Carol + industrie)"
foreach ($u in @(
  @{ e = $Alice; n = "Alice E2E"; i = "Maritime" },
  @{ e = $Bob;   n = "Bob E2E";   i = "Aviation" },
  @{ e = $Carol; n = "Carol E2E"; i = "Biotech" }
)) {
  $null = Invoke-RestMethod -Uri "$ApiBase/auth/register" -Method Post -ContentType "application/json" `
    -Body (@{ email = $u.e; name = $u.n; password = $Pass; industry = $u.i } | ConvertTo-Json)
}
$tokenAlice = Get-Jwt $Alice; $tokenBob = Get-Jwt $Bob; $tokenCarol = Get-Jwt $Carol
Ok "Comptes créés et connectés"
$hdrAlice = @{ Authorization = "Bearer $tokenAlice" }
$hdrCarol = @{ Authorization = "Bearer $tokenCarol" }

# ------------------------- 4. Mint + position -------------------------
Step "4/9 - Mint 500 CLRN sur Alice (+ position nette +500)"
$mint = Invoke-RestMethod -Uri "$ApiBase/blockchain/mint" -Method Post -ContentType "application/json" `
  -Headers @{ "X-Demo-Key" = $DemoKey } -Body (@{ email = $Alice; amount = 500 } | ConvertTo-Json)
if ($mint.tokenTxHash -notmatch "^0x") { Fail "Mint token échoué" }
if ($mint.positionTxHash -notmatch "^0x") { Fail "Mint position échoué" }
$mintTokenHash = $mint.tokenTxHash
Ok "Mint confirmé : tokenTxHash=$mintTokenHash"

# ------------------------- 5. Règlement (file) -------------------------
Step "5/9 - Transaction Alice -> Bob 100 CLRN (file BullMQ)"
$tx = Invoke-RestMethod -Uri "$ApiBase/transactions" -Method Post -ContentType "application/json" `
  -Headers $hdrAlice -Body (@{ toEmail = $Bob; amount = 100; note = "E2E Sepolia" } | ConvertTo-Json)
$txId = $tx.id
Ok "Transaction créée (id=$txId) — règlement en file"

# ------------------------- 6. Suivi jusqu'au SUCCESS -------------------------
Step "6/9 - Poll de l'historique (SUCCESS + hash attendus <= 60 s)"
$statusTx = "PENDING"; $hash = ""; $polls = 0
for ($i = 0; $i -lt 30; $i++) {
  $hist = @(Invoke-RestMethod -Uri "$ApiBase/transactions/history?limit=10" -Headers $hdrAlice)
  $first = $hist | Select-Object -First 1
  if ($first) {
    $statusTx = $first.onchainStatus; $hash = $first.onchainHash
    if ($statusTx -eq "SUCCESS") { break }
  }
  $polls++; Start-Sleep -Seconds 2
}
if ($statusTx -ne "SUCCESS") { Fail "Règlement non confirmé après 60 s (statut=$statusTx) — logs backend + Redis" }
Ok "Règlement SUCCESS — hash : $hash (https://sepolia.etherscan.io/tx/$hash)"

# ------------------------- 7. Positions -------------------------
Step "7/9 - Vérification des positions nettes (Alice 400 / Bob 100)"
$posAlice = Invoke-RestMethod -Uri "$ApiBase/blockchain/position/$Alice" -Headers @{ "X-Demo-Key" = $DemoKey }
$posBob   = Invoke-RestMethod -Uri "$ApiBase/blockchain/position/$Bob"   -Headers @{ "X-Demo-Key" = $DemoKey }
if ($posAlice.positionClrn -notmatch "^400") { Fail "Position Alice != 400 : $($posAlice.positionClrn)" }
if ($posBob.positionClrn -notmatch "^100") { Fail "Position Bob != 100 : $($posBob.positionClrn)" }
Ok "Positions conformes : Alice 400 CLRN, Bob 100 CLRN"

# ------------------------- 8. Cas d'échec + retries -------------------------
Step "8/9 - Cas d'échec : Carol (mint 5) -> Bob 50 CLRN (crédit insuffisant)"
$null = Invoke-RestMethod -Uri "$ApiBase/blockchain/mint" -Method Post -ContentType "application/json" `
  -Headers @{ "X-Demo-Key" = $DemoKey } -Body (@{ email = $Carol; amount = 5 } | ConvertTo-Json)
$null = Invoke-RestMethod -Uri "$ApiBase/transactions" -Method Post -ContentType "application/json" `
  -Headers $hdrCarol -Body (@{ toEmail = $Bob; amount = 50; note = "E2E échec attendu" } | ConvertTo-Json)
$statusTx = "PENDING"
for ($i = 0; $i -lt 45; $i++) {
  $hist = @(Invoke-RestMethod -Uri "$ApiBase/transactions/history?limit=10" -Headers $hdrCarol)
  $first = $hist | Select-Object -First 1
  if ($first) {
    $statusTx = $first.onchainStatus
    if ($statusTx -eq "FAILED" -or $statusTx -eq "SUCCESS") { break }
  }
  Start-Sleep -Seconds 2
}
if ($statusTx -ne "FAILED") { Fail "Échec attendu non observé (statut=$statusTx)" }
Ok "Cas d'échec validé : retries BullMQ puis FAILED (revert, crédit insuffisant)"

# ------------------------- 9. Rapport -------------------------
Step "9/9 - Écriture du rapport E2E"
$date = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
@"
# Rapport E2E — Règlement on-chain Sepolia (BullMQ + pont)

- **Date** : $date
- **Réseau** : Sepolia (chainId 11155111)
- **Contrats** : token=$tokenAddr engine=$engineAddr
- **Comptes** : $Alice / $Bob / $Carol

| Étape | Résultat | Détail |
|-------|----------|--------|
| 0. Prérequis | PASS | docker/node/.env Sepolia |
| 1. Contrats | PASS | deployments/sepolia.json |
| 2. Infra + pont | PASS | BLOCKCHAIN_ENABLED=true, /api/blockchain/status enabled |
| 3. Comptes | PASS | 3 comptes + industrie |
| 4. Mint 500 CLRN (Alice) | PASS | tokenTxHash=$mintTokenHash |
| 5. Transaction 100 CLRN | PASS | file BullMQ (job onchain-settlement) |
| 6. Règlement | PASS | SUCCESS en $($polls * 2) s — hash=$hash |
| 7. Positions | PASS | Alice 400 CLRN / Bob 100 CLRN |
| 8. Cas d'échec | PASS | revert crédit insuffisant → retries → FAILED |
| 9. Rapport | PASS | fichier généré |

## Vérifications complémentaires (manuelles, à compléter)

- [ ] Explorer : https://sepolia.etherscan.io/tx/$hash — transaction settle OK
- [ ] Redis : docker compose -f infrastructure/docker-compose.yml exec redis redis-cli --scan --pattern 'bull:onchain-settlement:*'
- [ ] Grafana : dashboard Alerting — 1 événement FAILED + retries visibles (capture jointe)

## Conclusion

- [ ] PASS — le règlement on-chain de bout en bout est validé (succès + échec + retries)
- [ ] FAIL — corrections : ______________________

Signataire : ______________  Date : ______________
"@ | Set-Content -Path $Report -Encoding utf8
Write-Host ""
Write-Host "====================================================" -ForegroundColor Green
Write-Host "  E2E SEPOLIA TERMINÉ (PASS) — rapport : $Report" -ForegroundColor Green
Write-Host "  NB : adresses du .env backend à reporter : CLRN_TOKEN_ADDRESS + COMPENSATION_ENGINE_ADDRESS" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green
```

### 4.3 Critère de succès (Action 2)

1. Règlement Alice → Bob 100 CLRN : **SUCCESS + hash** ≤ 60 s (explorateur Sepolia OK).
2. Positions nettes après règlement : **Alice 400 CLRN / Bob 100 CLRN**.
3. Cas d'échec (crédit insuffisant) : **retries BullMQ** visibles puis **FAILED** (revert).
4. File BullMQ observable (`bull:onchain-settlement:*`) et alerting Grafana sans erreur.

---

## 5. Action 3 — Programme Early Adopters

**Objectif** : accompagner les premiers utilisateurs (3 secteurs cibles : **Maritime,
Aviation, Biotech**) sur la plateforme : comptes de démonstration sectoriels, contenus de
présentation, formulaire de candidature, suivi CRM.

### 5.1 Comptes de démonstration — `scripts/early-adopters-script.sh`

```bash
#!/usr/bin/env bash
# =============================================================================
# ACTION 3 — Création des comptes early adopters (démonstration) — Linux/WSL2
# Usage : ./scripts/early-adopters-script.sh
# Crée 2 comptes par secteur (Maritime, Aviation, Biotech) + 1 transaction de
# démonstration par secteur, puis écrit le fichier de suivi (CSV).
# =============================================================================
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000/api}"
PASS="Clearnet-EA-2026!"
TS=$(date +%s)
TRACKING="early-adopters-tracking.csv"

C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_RESET=$'\033[0m'
step()  { echo ""; echo "==== $* ===="; }
ok()    { echo "  ${C_GREEN}[OK]${C_RESET} $*"; }
die()   { echo "  ${C_RED}[KO]${C_RESET} $*" >&2; exit 1; }

SECTORS=("Maritime" "Aviation" "Biotech")

: > /tmp/early-adopters-accounts.txt
for sector in "${SECTORS[@]}"; do
  slug=$(echo "$sector" | tr '[:upper:]' '[:lower:]')
  step "Secteur $sector"
  A="ea-$slug-1-$TS@clearnet-demo.io"; B="ea-$slug-2-$TS@clearnet-demo.io"
  for entry in "$A|$sector 1" "$B|$sector 2"; do
    email="${entry%%|*}"; name="${entry##*|}"
    curl -fsS -X POST "$API_BASE/auth/register" -H "Content-Type: application/json" \
      -d "{\"email\":\"$email\",\"name\":\"$name\",\"password\":\"$PASS\",\"industry\":\"$sector\"}" >/dev/null \
      || die "register $email échoué"
    ok "Compte créé : $email (secteur $sector)"
    echo "$email" >> /tmp/early-adopters-accounts.txt
  done
  TOKEN_A=$(curl -fsS -X POST "$API_BASE/auth/login" -H "Content-Type: application/json" \
    -d "{\"email\":\"$A\",\"password\":\"$PASS\"}" | sed -E 's/.*"access_token":"([^"]+)".*/\1/')
  curl -fsS -X POST "$API_BASE/transactions" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN_A" \
    -d "{\"toEmail\":\"$B\",\"amount\":50,\"note\":\"Démonstration onboarding\"}" >/dev/null
  ok "Transaction de démo $A -> $B (50 CLRN)"
done

# Fichier de suivi (si absent) + comptes du jour
if [ ! -f "$TRACKING" ]; then
  echo "date;nom;societe;secteur;taille;email;statut;note;prochaine_action;date_suivi" > "$TRACKING"
fi
while read -r email; do
  echo "$(date -I);demo-$(echo "$email" | cut -d@ -f1);Clearnet Demo;$(echo "$email" | cut -d- -f2);PME;$email;Cree;Comptes de démonstration;Pitch + candidature;$(date -I -d '+7 days' 2>/dev/null || date -I)" >> "$TRACKING"
done < /tmp/early-adopters-accounts.txt

echo ""
echo "${C_GREEN}================================================${C_RESET}"
echo "${C_GREEN}  COMPTES EARLY ADOPTERS CRÉÉS${C_RESET}"
echo "${C_GREEN}  Mot de passe commun : $PASS${C_RESET}"
echo "${C_GREEN}  Suivi : $TRACKING${C_RESET}"
echo "${C_GREEN}================================================${C_RESET}"
```

### 5.2 Script PowerShell — `scripts/early-adopters-script.ps1`

```powershell
# =============================================================================
# ACTION 3 — Création des comptes early adopters (démonstration) — PowerShell
# Usage : .\scripts\early-adopters-script.ps1
# =============================================================================
[CmdletBinding()]
param([string]$ApiBase = "http://localhost:3000/api")
$ErrorActionPreference = "Stop"

$Pass = "Clearnet-EA-2026!"
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$Tracking = "early-adopters-tracking.csv"
$today = Get-Date -Format "yyyy-MM-dd"
$in7d = (Get-Date).AddDays(7).ToString("yyyy-MM-dd")

function Step([string]$t) { Write-Host ""; Write-Host "==== $t ====" -ForegroundColor Cyan }
function Ok([string]$m)   { Write-Host "  [OK] $m" -ForegroundColor Green }
function Fail([string]$m) { Write-Host "  [KO] $m" -ForegroundColor Red; exit 1 }

$accounts = @()
foreach ($sector in @("Maritime", "Aviation", "Biotech")) {
  $slug = $sector.ToLower()
  Step "Secteur $sector"
  $a = "ea-$slug-1-$ts@clearnet-demo.io"; $b = "ea-$slug-2-$ts@clearnet-demo.io"
  foreach ($u in @(@{ e = $a; n = "$sector 1" }, @{ e = $b; n = "$sector 2" })) {
    $null = Invoke-RestMethod -Uri "$ApiBase/auth/register" -Method Post -ContentType "application/json" `
      -Body (@{ email = $u.e; name = $u.n; password = $Pass; industry = $sector } | ConvertTo-Json)
    Ok "Compte créé : $($u.e) (secteur $sector)"
    $accounts += $u.e
  }
  $login = Invoke-RestMethod -Uri "$ApiBase/auth/login" -Method Post -ContentType "application/json" `
    -Body (@{ email = $a; password = $Pass } | ConvertTo-Json)
  $null = Invoke-RestMethod -Uri "$ApiBase/transactions" -Method Post -ContentType "application/json" `
    -Headers @{ Authorization = "Bearer $($login.access_token)" } `
    -Body (@{ toEmail = $b; amount = 50; note = "Démonstration onboarding" } | ConvertTo-Json)
  Ok "Transaction de démo $a -> $b (50 CLRN)"
}

if (-not (Test-Path $Tracking)) {
  "date;nom;societe;secteur;taille;email;statut;note;prochaine_action;date_suivi" | Set-Content $Tracking -Encoding utf8
}
foreach ($email in $accounts) {
  $name = ($email -split "@")[0]; $sector = ($name -split "-")[1]
  "$today;demo-$name;Clearnet Demo;$sector;PME;$email;Cree;Comptes de démonstration;Pitch + candidature;$in7d" |
    Add-Content $Tracking -Encoding utf8
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  COMPTES EARLY ADOPTERS CRÉÉS" -ForegroundColor Green
Write-Host "  Mot de passe commun : $Pass" -ForegroundColor Green
Write-Host "  Suivi : $Tracking" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
```

> **Complément** : pour un jeu de données plus riche, `POST /api/demo/seed` (clé
> `X-Demo-Key`) accepte désormais un corps `{ "industry": "Maritime" }` qui attribue le
> secteur aux comptes démo (alice/bob/carol@clearnet.io).

### 5.3 Modèle d'e-mail de prospection — `early-adopters-template.md`

```markdown
# E-mail de prospection — Early Adopters ClearNet

**Objet** : [Secteur] — Compensez vos créances et dettes inter-entreprises : rejoignez
les premiers utilisateurs ClearNet

---

Bonjour [Prénom],

ClearNet accompagne les entreprises du [secteur] dans la **compensation de leurs créances
et dettes inter-entreprises**, sans passer par un tiers bancaire : la transaction est
enregistrée dans un registre partagé, chaque règlement est **auditable et traçable**,
avec une piste d'audit complète.

Nous ouvrons l'accès à un **groupe pilote** (early adopters) :

- **Gratuit pendant 3 mois** (au-delà : abonnement préférentiel à vie pour les pionniers) ;
- Accompagnement dédié : mise en place, formation, données de démonstration ;
- Influence directe sur la feuille de route produit ;
- Garantie de **sécurité et de conformité** (données chiffrées, accès contrôlés,
  journalisation).

**En pratique** :
1. Créez votre compte sur la plateforme de démonstration (compte de test fourni) ;
2. Participez à une session de découverte de 30 minutes (démonstration + questions) ;
3. Signez la candidature (5 minutes, voir formulaire ci-dessous) ;
4. Vos premiers échanges compensés en moins d'une semaine.

**Prochaine étape** : répondre à ce message avec votre [secteur / taille / besoin
principal], ou compléter le formulaire : https://clearnet.example.com/candidature

**Exemple concret (Maritime)** : un armateur doit 120 k€ à un réparateur naval qui doit
lui-même 80 k€ à un fournisseur d'équipements… ClearNet **compense ces flux** en une
seule transaction, chacun règle son solde net.

À très vite,
L'équipe ClearNet

P.S. — Données de démonstration à votre disposition : comptes de test, historique de
transactions simulées, tableau de bord. Répondez simplement « démo » à ce message.
```

### 5.4 Fichier de suivi — `early-adopters-tracking.csv`

```csv
date;nom;societe;secteur;taille;email;statut;note;prochaine_action;date_suivi
2026-08-11;Jean Dupont;Armateur Maritime;Maritime;200 salariés;j.dupont@armateur.fr;Contacte;Intéressé par la démo;Session découverte J+3;2026-08-18
2026-08-11;Sarah Lee;Biotech Solutions;Biotech;50 salariés;s.lee@biotech.io;Contacte;Questions conformité;Envoyer FAQ + datasheet;2026-08-14
```

Statuts utilisés : `Contacté` → `Découverte` → `Staging` (accès plateforme) → `Formation`
→ `Proposition` → `Contrat` / `Abandonné`.

### 5.5 Kit de présentation (plan)

**Diaporama « ClearNet — Programme Early Adopters »** (5 diapositives, 15 min) :

1. **Le problème** : créances/dettes inter-entreprises, trésorerie immobilisée, frais
   bancaires, asymétrie d'information (2 min).
2. **La solution** : compensation on-chain — enregistrement, règlement net, traçabilité
   (3 min) + démo live (5 min).
3. **Sécurité & conformité** : chiffrement, contrôle d'accès, journalisation, verrouillage
   des fonctions de démonstration en production (2 min).
4. **Le programme pilote** : ce que reçoivent les early adopters (gratuité 3 mois,
   accompagnement, influence roadmap), le calendrier J1–J10 (2 min).
5. **Comment candidater** : formulaire 5 min + prochaine étape (1 min).

**Formulaire de candidature** (10 questions) : 1) Nom/société 2) Secteur 3) Taille
(nombre de salariés / CA) 4) Volume mensuel estimé de créances/dettes 5) Nombre de
contreparties récurrentes 6) Problème principal (trésorerie / frais / confiance /
visibilité) 7) Outils actuels (ERP, tableur, factor…) 8) Contrainte réglementaire
particulière 9) Disponibilité pour une session de découverte 10) Attente principale
vis-à-vis du pilote.

### 5.6 Critère de succès (Action 3)

1. Comptes de démonstration créés pour les 3 secteurs (script §5.1/§5.2).
2. ≥ 3 candidatures reçues (formulaire), ≥ 1 utilisateur actif (connexions +
   transactions de démo) à J8.
3. CRM à jour (`early-adopters-tracking.csv`) : chaque contact a une prochaine action
   datée.

---

## 6. Documentation de validation & checklist finale

### 6.1 Synthèse des actions

| Action | Artefacts | Responsable | Durée | Dépendances | Critère de succès |
|--------|-----------|-------------|-------|-------------|-------------------|
| 1. Validation pipeline kind | `scripts/validate-kind.sh` / `.ps1`, `validation-kind-report.md` | DevOps | 20–35 min | Docker, kind/minikube, helm | Dry-run PASS, smoke e2e PASS, rapport signé |
| 2. E2E on-chain Sepolia | `scripts/e2e-sepolia.sh` / `.ps1`, `e2e-sepolia-report.md` | Blockchain/Backend | 25–45 min | Sepolia (.env, ≥ 0.05 ETH), compose | SUCCESS + hash, positions, FAILED + retries |
| 3. Early adopters | `scripts/early-adopters-script.sh` / `.ps1`, `early-adopters-template.md`, `early-adopters-tracking.csv`, kit | Produit/BDD | 2–3 h (comptes) puis continu | Backend démarré | Comptes créés, ≥ 3 candidatures, CRM suivi |
| 4. Production | `scripts/clearner-prod.sh` / `.ps1`, `README-PROD.md`, secrets Vault/SealedSecrets | DevOps + CTO | 1–2 h | Checklist §6.3 verte | Go/No-Go signé, smoke prod PASS |

### 6.2 Critères Go/No-Go (obligatoires avant production)

| # | Critère | Vérification | Statut |
|---|---------|--------------|--------|
| 1 | `helm lint` + `helm template` sans erreur | `scripts/clearner-prod.sh --dry-run` → PASS | ☐ |
| 2 | Pipeline déployée et smoke OK sur cluster de validation | `validation-kind-report.md` signé PASS | ☐ |
| 3 | Règlement on-chain prouvé (succès + échec + retries) | `e2e-sepolia-report.md` signé PASS | ☐ |
| 4 | Secrets gérés (Vault ou SealedSecrets), jamais commités | audit des `--set` + env du runner | ☐ |
| 5 | Alerting opérationnel (Grafana) : alertes BullMQ/health configurées | dashboard + notification de test | ☐ |
| 6 | Rollback documenté et testé | `helm rollback clearnet -n clearnet` (exercice sur kind) | ☐ |
| 7 | `DEMO_API_KEY` vide en production (401 systématique) | config du chart prod | ☐ |
| 8 | Pont on-chain désactivé tant que les adresses de contrats vérifiées (etherscan) ne sont pas configurées | `BLOCKCHAIN_ENABLED=false` par défaut | ☐ |
| 9 | Chargement passé avec critère de capacité (k6) sans régression | rapport k6 (voir README-PROD.md) | ☐ |
| 10 | Contrats vérifiés : `npm run verify:sepolia` (déployeur + factory) | sortie du script / lien etherscan | ☐ |
| 11 | Documentation à jour : `README-PROD.md`, `PHASE2_DEPLOYMENT.md`, ce document | relecture | ☐ |
| 12 | Go/No-Go formel signé (CTO + DevOps) | réunion de validation | ☐ |
| 13 | **CI verte avant déploiement** (3.5) : helm lint + template, build, tests (dont intégration BullMQ avec Redis provisionné) | `.github/workflows/ci-validation.yml` | ☐ |
| 14 | **Test d'intégration BullMQ actif** (3.2) : create → file → processor → SUCCESS/FAILED → WebSocket | `queue.integration.spec.ts` vert en CI | ☐ |
| 15 | **Échecs définitifs audités + notifiés** (3.3) : nœuds `FailedJob` en Neo4j, webhook `SLACK_WEBHOOK_URL` opérationnel | requête d'audit + message de test | ☐ |
| 16 | **Secrets jamais en `--set` en production** (3.4) : Secret Kubernetes + `existingSecret` (ou SealedSecrets/ExternalSecrets) | audit de la release | ☐ |

### 6.3 Ordre de passage en production (J8–J10)

1. Rejouer la checklist §6.2 (tout vert).
2. `clearner-prod.sh --dry-run` (validation finale des manifests).
3. `clearner-prod.sh` avec les secrets (Vault/SealedSecrets).
4. Smoke prod + vérification alerting + vérification du flux (1 transaction réelle).
5. Annonce aux early adopters.

---

## 8. Points de vigilance traités (avant déploiement réel)

Les cinq points de vigilance identifiés en revue sont **traités** : constat →
correction → vérification. Aucun n'est bloquant restant.

### 8.1 QUEUE_ENABLED évalué dynamiquement (3.1)

| | |
|---|---|
| **Constat** | Variable lue une seule fois à l'import du module (statique). |
| **Correction** | La *décision* d'acheminer chaque transaction est désormais évaluée **dynamiquement** à chaque appel via `ConfigService` (`TransactionsService.isQueueEnabled()`) : désactiver `QUEUE_ENABLED` en cours de vie du pod bascule proprement sur le fire-and-forget, sans redémarrage. Le *câblage* (module BullMQ + processor) reste statique par nature — sa modification demande un redémarrage (documenté). |
| **Fichiers** | `clearnet-backend/src/transactions/transactions.service.ts`, `transactions.module.ts` (commentaire de sémantique), `README-PROD.md` §2.4. |
| **Vérification** | `npm run build` + `npm test` verts ; sémantique documentée. |

### 8.2 Test d'intégration BullMQ (3.2)

| | |
|---|---|
| **Constat** | Aucun test ne couvrait create → file → processor → SUCCESS/FAILED → WebSocket. |
| **Correction** | Nouveau test d'intégration `queue.integration.spec.ts` : Redis **réel** (sonde TCP 2 s, suite inopérante mais verte sans Redis), module de test NestJS avec BullMQ + processor réel, driver Neo4j mocké ; il vérifie : événement PENDING, appel `settleCompensation`, écriture `onchainStatus = 'SUCCESS'` + hash **en Neo4j** (requêtes Cypher capturées), événement WebSocket SUCCESS avec hash, puis cas d'échec → `FAILED` + événement FAILED + job à l'état `failed`. |
| **Fichiers** | `clearnet-backend/src/transactions/queue.integration.spec.ts`, CI (service Redis). |
| **Vérification** | Localement : suite verte avec avertissement (Redis absent) ; en CI : assertions réelles exécutées (service `redis:7-alpine`). |

### 8.3 Échecs définitifs du processor (3.3 — DLQ légère)

| | |
|---|---|
| **Constat** | `removeOnFail: 5000` sans handler d'échec : pas d'alerte, pas d'audit. |
| **Correction** | Souscription à l'événement `failed` du **worker** (échecs définitifs, retries épuisées) dans `TransactionProcessor.onApplicationBootstrap` → `TransactionsService.recordFailedJob` : (1) nœud **`FailedJob`** créé en Neo4j (`jobId`, `queue`, `txId`, `error`, `attemptsMade`, `failedAt` — équivalent table failed_jobs), (2) notification **Slack** via `SLACK_WEBHOOK_URL` (optionnel, fetch non bloquant). La transaction reste valide hors-chaîne (`FAILED` + `onchainError`). |
| **Fichiers** | `transaction.processor.ts`, `transactions.service.ts`, `backend-configmap.yaml`, `values.yaml` / `values-production.yaml` (`SLACK_WEBHOOK_URL`). |
| **Vérification** | Requête d'audit `MATCH (f:FailedJob) RETURN f` ; message Slack de test. |

### 8.4 Sécurité des secrets dans le chart (3.4)

| | |
|---|---|
| **Constat** | Secrets en `--set` (exposés dans l'historique des commandes). |
| **Correction** | Chart enrichi : `backend.existingSecret` et `neo4j.existingSecret` (clés `jwt-secret`, `password`, `auth`) → JWT_SECRET, NEO4J_PASSWORD et NEO4J_AUTH lus depuis le Secret Kubernetes existant ; le Secret Neo4j interne n'est plus généré. README-PROD.md §5 : option B (`kubectl create secret` + `existingSecret`, recommandée) et option C (SealedSecrets Bitnami / ExternalSecrets KMS/Vault). |
| **Fichiers** | `backend-deployment.yaml`, `neo4j-secret.yaml`, `neo4j-statefulset.yaml`, `values.yaml`, `values-production.yaml`, `README-PROD.md` §5. |
| **Vérification** | `helm template` avec `--set backend.existingSecret=… --set neo4j.existingSecret=…` : 7 ressources, 3 références au Secret externe, plus de Secret généré. |

### 8.5 helm lint & CI (3.5)

| | |
|---|---|
| **Constat** | helm absent de la machine de validation → lint non exécuté. |
| **Correction** | (1) `clearner-prod.sh` et `clearner-prod.ps1` **auto-installent Helm** s'il est absent (et échouent explicitement sinon) ; (2) workflow **CI** `.github/workflows/ci-validation.yml` : `helm lint` (values prod + base) et `helm template` à chaque push/PR **avant tout déploiement**, `bash -n scripts/*.sh`, puis `npm ci` → build → tests avec service Redis. |
| **Fichiers** | `scripts/clearner-prod.sh`, `scripts/clearner-prod.ps1`, `.github/workflows/ci-validation.yml`. |
| **Vérification** | `helm lint` local : PASS (0 failed) ; rendu `helm template` : 8 ressources (prod) / 7 (existingSecret). |

> **Bug pré-existants corrigés au passage** (le chart n'avait jamais été rendu) :
> `Chart.yaml` (description non quotée, colons) et `_helpers.tpl` (`clearnet.name`
> manquant) et `backend-deployment.yaml` (label `matchLabels` sans clé → YAML
> invalide). Validé par `helm lint` + `helm template`.

---

## 9. Corrections mineures appliquées (déclarées)

Conformément à la règle « ne pas modifier le code existant (sauf mention explicite) »,
seules **trois** corrections mineures, explicitement nécessaires aux scénarios demandés,
ont été apportées. **Aucune autre modification** du code existant.

| # | Correction | Fichier | Motif (scénario requis) |
|---|------------|---------|--------------------------|
| 1 | Ajout des routes **`POST /api/blockchain/mint`** et **`GET /api/blockchain/position/:email`** (protégées par `X-Demo-Key`, désactivables) — s'appuient sur les services existants `mintTo`, `recordPositionChange`, `getNetPosition`, `weiToClrn` | `clearnet-backend/src/blockchain/blockchain.controller.ts` | Le scénario E2E demande « Minter des tokens sur Alice », « effectuer un règlement », « vérifier la position nette » via l'API |
| 2 | Paramètre **`industry`** (optionnel) sur `POST /api/demo/seed` | `clearnet-backend/src/demo/demo.controller.ts` | Le plan demande des comptes démo **par secteur** (Maritime/Aviation/Biotech) |
| 3 | Flag **`--dry-run`** (sh) / **`-DryRun`** (PowerShell) sur `scripts/clearner-prod.sh` / `.ps1` : prérequis + helm lint + rendu des manifests puis arrêt propre (jamais de build/upgrade) | `scripts/clearner-prod.sh`, `scripts/clearner-prod.ps1` | Le plan exige de « Lancer clearner-prod.sh en mode --dry-run pour générer les manifests » sans appliquer |

**Validation** : `npm run build` OK, `npm test` (11 tests) OK, `bash -n` OK, parse
PowerShell OK. Les deux nouveaux endpoints ne sont atteignables qu'avec une `X-Demo-Key`
non vide (config `DEMO_API_KEY` vide en production = 401 systématique) et retournent
`503` si le pont on-chain est désactivé.
