#!/usr/bin/env bash
# =============================================================
# ClearNet V1.1 — Seed de la démo partenaire (Mac / Linux)
# Prépare les comptes alice/bob/carol + transactions de démonstration.
# Prérequis : backend lancé (docker compose up -d --build).
# Usage : ./scripts/seed-demo.sh [URL_API] [DEMO_API_KEY]
#   Défauts : http://localhost:3000/api / demo-secret-change-me
# Windows : utiliser : Invoke-RestMethod -Uri http://localhost:3000/api/demo/seed -Method Post -Headers @{ "X-Demo-Key" = "demo-secret-change-me" }
# =============================================================
set -euo pipefail

BASE_URL="${1:-http://localhost:3000/api}"
DEMO_KEY="${2:-demo-secret-change-me}"

echo "==> Seed de la démo sur $BASE_URL"

STATUS=$(curl -sf -o /tmp/clearnet-seed.json -w "%{http_code}" -X POST "${BASE_URL}/demo/seed" \
  -H "X-Demo-Key: ${DEMO_KEY}") || {
  echo "✘ Impossible de joindre l'API (le backend est-il lancé ?)" >&2
  exit 1
}

echo "✔ Réponse ($STATUS) : $(cat /tmp/clearnet-seed.json)"
echo ""
echo "Comptes de démonstration (mot de passe : clearnet-demo) :"
echo "  alice@clearnet.io   (facturée -> compense)"
echo "  bob@clearnet.io     (fournisseur)"
echo "  carol@clearnet.io   (sous-traitante)"
echo ""
echo "Vérification rapide :"
echo "  curl -s ${BASE_URL}/demo/status -H \"X-Demo-Key: ${DEMO_KEY}\""
