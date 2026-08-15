#!/usr/bin/env bash
# =============================================================================
# ClearNet V1.3 — Déploiement PRODUCTION (Linux / WSL2)
# Copier-coller exécutable : ./scripts/clearner-prod.sh
#
# Périmètre : build image backend → push (optionnel) → helm lint →
# helm upgrade -f values-production.yaml → rollout → health → smoke e2e.
# Variables surchargées via --set : JWT_SECRET, NEO4J_PASSWORD, REDIS_PASSWORD.
#
# Mode --dry-run (validation pipeline) : prérequis + lint + rendu des
# manifests (écrit dans $DRY_RUN_MANIFESTS) puis arrêt propre, sans build,
# sans upgrade ni smoke. Exit 0 si tout est valide.
#
# Prérequis : docker, kubectl (cluster cible configuré), helm, accès registry.
# Pour l'activation BullMQ, le Redis du cluster doit être joignable
# (REDIS_HOST dans values-production.yaml).
# =============================================================================
set -euo pipefail

# ------------------------- Configuration -------------------------
REGISTRY="${REGISTRY:-ghcr.io/clearnet/backend}"
TAG="${TAG:-v1.3.0}"
NAMESPACE="${NAMESPACE:-clearnet}"
RELEASE="${RELEASE:-clearnet}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1
DRY_RUN_MANIFESTS="${DRY_RUN_MANIFESTS:-/tmp/clearnet-manifests.yaml}"
CHART_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../infrastructure/helm/clearnet" && pwd)"
VALUES_FILE="$CHART_DIR/values-production.yaml"
BUILD_CONTEXT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../clearnet-backend" && pwd)"
PUSH_IMAGE="${PUSH_IMAGE:-0}"          # 1 = docker push (registry distant)
PULL_IF_PRESENT="${PULL_IF_PRESENT:-0}"

# Secrets — à passer dans l'environnement d'exécution (jamais en clair ici)
JWT_SECRET="${JWT_SECRET:-}"
NEO4J_PASSWORD="${NEO4J_PASSWORD:-}"
REDIS_PASSWORD="${REDIS_PASSWORD:-}"

C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'; C_RESET=$'\033[0m'

step()  { echo ""; echo "${C_CYAN}════════════════════════════════════════════════════${C_RESET}"; echo "${C_CYAN}  $*${C_RESET}"; echo "${C_CYAN}════════════════════════════════════════════════════${C_RESET}"; }
ok()    { echo "  ${C_GREEN}[OK]${C_RESET} $*"; }
warn()  { echo "  ${C_YELLOW}[WARN]${C_RESET} $*"; }
die()   { echo "  ${C_RED}[KO]${C_RESET} $*" >&2; exit 1; }

# ------------------------- Prérequis -------------------------
step "1/6 — Prérequis (docker, helm, kubectl, cluster)"
command -v docker >/dev/null 2>&1 || die "docker introuvable"
if ! command -v helm >/dev/null 2>&1; then
  warn "helm absent — installation automatique (get.helm.sh)"
  curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
fi
command -v helm   >/dev/null 2>&1 || die "helm indisponible — installer https://helm.sh"
command -v kubectl >/dev/null 2>&1 || die "kubectl introuvable"
kubectl cluster-info >/dev/null 2>&1 || die "cluster Kubernetes injoignable (kubectl cluster-info)"
ok "Outils présents + cluster joignable"

# ------------------------- Build / push -------------------------
if [ "$DRY_RUN" = "1" ]; then
  step "2/6 — Build image backend ($REGISTRY:$TAG) [IGNORÉ en --dry-run]"
  warn "Mode --dry-run : pas de build ni de push"
else
  step "2/6 — Build de l'image backend ($REGISTRY:$TAG)"
  docker build -t "$REGISTRY:$TAG" "$BUILD_CONTEXT"
  ok "Image construite"
  if [ "$PUSH_IMAGE" = "1" ]; then
    docker push "$REGISTRY:$TAG"
    ok "Image poussée"
  else
    warn "PUSH_IMAGE=0 : l'image reste locale (charger vers le cluster : kind load / k3s ctr images import)"
  fi
fi

# ------------------------- Helm -------------------------
step "3/6 — Lint du chart + rendu production"
helm lint "$CHART_DIR" -f "$VALUES_FILE"
if [ "$DRY_RUN" = "1" ]; then
  helm template "$RELEASE" "$CHART_DIR" -f "$VALUES_FILE" --namespace "$NAMESPACE" > "$DRY_RUN_MANIFESTS"
  echo ""
  echo "${C_GREEN}════════════════════════════════════════════════════${C_RESET}"
  echo "${C_GREEN}  VALIDATION DRY-RUN TERMINÉE (PASS)${C_RESET}"
  echo "${C_GREEN}  Manifests rendus : $DRY_RUN_MANIFESTS${C_RESET}"
  echo "${C_GREEN}  Aucun changement appliqué au cluster.${C_RESET}"
  echo "${C_GREEN}════════════════════════════════════════════════════${C_RESET}"
  exit 0
fi
ok "Chart valide"

SET_ARGS=()
if [ -n "$JWT_SECRET" ];      then SET_ARGS+=("--set" "backend.jwtSecret=$JWT_SECRET"); fi
if [ -n "$NEO4J_PASSWORD" ];  then SET_ARGS+=("--set" "neo4j.authPassword=$NEO4J_PASSWORD"); fi
if [ -n "$REDIS_PASSWORD" ];  then SET_ARGS+=("--set" "backend.env.REDIS_PASSWORD=$REDIS_PASSWORD"); fi
[ "$PULL_IF_PRESENT" = "1" ] && SET_ARGS+=("--set" "backend.image.pullPolicy=Always")

step "4/6 — helm upgrade --install (release=$RELEASE, namespace=$NAMESPACE)"
helm upgrade --install "$RELEASE" "$CHART_DIR" \
  -f "$VALUES_FILE" \
  --namespace "$NAMESPACE" --create-namespace \
  --wait --timeout 5m \
  "${SET_ARGS[@]}"
ok "Helm appliqué"

# ------------------------- Rollout -------------------------
step "5/6 — Attente du rollout backend"
kubectl rollout status "deployment/$RELEASE-backend" --namespace "$NAMESPACE" --timeout=300s
kubectl get pods -n "$NAMESPACE" -l app=backend -o wide

# ------------------------- Vérification -------------------------
step "6/6 — Health + smoke test e2e (port-forward 3000)"
PF_PID=""
kubectl port-forward "deployment/$RELEASE-backend" 3000:3000 -n "$NAMESPACE" >/dev/null 2>&1 &
PF_PID=$!
trap 'kill $PF_PID 2>/dev/null || true' EXIT
for i in $(seq 1 30); do
  if curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS http://localhost:3000/api/health || die "Health KO après 60 s"
ok "GET /api/health → 200"

EMAIL="prod-smoke-$(date +%s)@clearnet.io"
curl -fsS -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"name\":\"Smoke Prod\",\"password\":\"Sm0ke!Pass\",\"industry\":\"Technology\"}" >/dev/null
TOKEN=$(curl -fsS -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Sm0ke!Pass\"}" \
  | sed -E 's/.*"access_token":"([^"]+)".*/\1/')
[ -n "$TOKEN" ] || die "Login échoué"
curl -fsS http://localhost:3000/api/transactions/balance -H "Authorization: Bearer $TOKEN" >/dev/null
ok "Smoke e2e : register → login → /transactions/balance → 200"

echo ""
echo "${C_GREEN}════════════════════════════════════════════════════${C_RESET}"
echo "${C_GREEN}  DÉPLOIEMENT PRODUCTION TERMINÉ${C_RESET}"
echo "${C_GREEN}  URL d'accès : voir l'ingress du cluster (host défini dans values-production.yaml)${C_RESET}"
echo "${C_GREEN}  Rollback    : helm rollback $RELEASE -n $NAMESPACE${C_RESET}"
echo "${C_GREEN}════════════════════════════════════════════════════${C_RESET}"
