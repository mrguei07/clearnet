#!/usr/bin/env bash
# =============================================================================
# ClearNet — Déploiement VPS one-command (HTTPS via Caddy + Let's Encrypt)
#
# Usage :
#   DOMAIN=api.clearnet.fr ./scripts/deploy-vps.sh
#
# Prérequis (une seule fois, sur une Ubuntu/Debian fraîche) :
#   1. Un VPS (n'importe quel fournisseur) avec au moins 2 vCPU / 4 Go.
#   2. Un enregistrement DNS A (et AAAA si IPv6) pointant DOMAIN vers l'IP du VPS.
#   3. Les ports 80 et 443 ouverts (firewall / security group).
#
# Ce que fait le script (idempotent) :
#   1. Installe Docker + le plugin compose si absents.
#   2. Génère JWT_SECRET et NEO4J_PASSWORD (openssl rand) dans infrastructure/.env.prod.
#   3. Lance la stack (neo4j + redis + backend + caddy) via docker compose.
#   4. Attend le healthcheck puis affiche l'URL publique HTTPS.
#
# Le certificat TLS est délivré automatiquement par Let's Encrypt (Caddy) lors
# de la première requête — aucune action manuelle.
# =============================================================================
set -euo pipefail

# ------------------------- Configuration -------------------------
DOMAIN="${DOMAIN:?Définir DOMAIN (ex. api.clearnet.fr) et pointer son DNS vers ce serveur}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_DIR/infrastructure/docker-compose.prod.yml"
ENV_FILE="$REPO_DIR/infrastructure/.env.prod"

C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_CYAN=$'\033[36m'; C_RESET=$'\033[0m'
step() { echo ""; echo "${C_CYAN}==> $*${C_RESET}"; }
ok()   { echo "  ${C_GREEN}[OK]${C_RESET} $*"; }
die()  { echo "  ${C_RED}[KO]${C_RESET} $*" >&2; exit 1; }

# ------------------------- 1. Docker -------------------------
step "1/5 — Installation de Docker (si absent)"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh || die "échec installation Docker"
fi
if ! docker compose version >/dev/null 2>&1; then
  die "docker compose indisponible — installer le plugin compose"
fi
ok "Docker présent : $(docker --version)"

# ------------------------- 2. Secrets -------------------------
step "2/5 — Génération des secrets ($ENV_FILE)"
mkdir -p "$REPO_DIR/infrastructure/caddy"
if [ ! -f "$ENV_FILE" ]; then
  cp "$REPO_DIR/infrastructure/.env.prod.example" "$ENV_FILE"
fi
# Surcharge idempotente sans exposer les secrets dans l'historique :
# on régénère à chaque déploiement uniquement s'ils sont vides.
if ! grep -q '^JWT_SECRET=.\+' "$ENV_FILE"; then
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" "$ENV_FILE"
fi
if ! grep -q '^NEO4J_PASSWORD=.\+' "$ENV_FILE"; then
  sed -i "s|^NEO4J_PASSWORD=.*|NEO4J_PASSWORD=$(openssl rand -hex 16)|" "$ENV_FILE"
fi
sed -i "s|^SITE_ADDRESS=.*|SITE_ADDRESS=$DOMAIN|" "$ENV_FILE"
sed -i "s|^HTTP_PORT=.*|HTTP_PORT=80|" "$ENV_FILE"
sed -i "s|^HTTPS_PORT=.*|HTTPS_PORT=443|" "$ENV_FILE"
chmod 600 "$ENV_FILE"
ok "Secrets prêts (JWT_SECRET + NEO4J_PASSWORD) — fichier 600"

# ------------------------- 3. Lancement -------------------------
step "3/5 — Build + démarrage de la stack (Caddy -> Let's Encrypt)"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build
ok "Conteneurs démarrés"

# ------------------------- 4. Health -------------------------
step "4/5 — Attente du healthcheck backend (max 120 s)"
for i in $(seq 1 60); do
  if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T backend \
      wget -qO- http://localhost:3000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T backend \
  wget -qO- http://localhost:3000/api/health || die "backend non sain après 120 s"
ok "Backend sain"

# ------------------------- 5. Vérification HTTPS -------------------------
step "5/5 — Vérification HTTPS publique (Let's Encrypt)"
# La première requête déclenche l'émission du certificat (quelques secondes).
for i in $(seq 1 30); do
  if curl -fsS "https://$DOMAIN/api/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "https://$DOMAIN/api/health" || die "HTTPS non joignable (vérifier DNS + ports 80/443)"
ok "GET https://$DOMAIN/api/health -> 200 (certificat Let's Encrypt actif)"

echo ""
echo "${C_GREEN}================================================================${C_RESET}"
echo "${C_GREEN}  ClearNet est en ligne : https://$DOMAIN${C_RESET}"
echo "${C_GREEN}  Mettre à jour le mobile : EXPO_PUBLIC_API_URL=https://$DOMAIN/api${C_RESET}"
echo "${C_GREEN}  Logs   : docker compose --env-file $ENV_FILE -f $COMPOSE_FILE logs -f${C_RESET}"
echo "${C_GREEN}  Stop    : docker compose --env-file $ENV_FILE -f $COMPOSE_FILE down${C_RESET}"
echo "${C_GREEN}================================================================${C_RESET}"
