#!/usr/bin/env bash
# =============================================================
# ClearNet V1.1 — Validation E2E Docker (Mac / Linux)
# Exécute : build compose -> healthcheck -> registre/login ->
# transaction -> historique -> 401/429 -> teardown.
# Usage : ./infrastructure/test-e2e.sh
# Windows : ./infrastructure/test-e2e.ps1
# =============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -f "${ROOT}/infrastructure/docker-compose.yml")
BASE_URL="${E2E_BASE_URL:-http://localhost:3000/api}"
PASS=0
FAIL=0

cleanup() {
  echo "==> Nettoyage (docker compose down -v)"
  "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

check() {
  local name="$1" ok="$2"
  if [ "$ok" = "0" ]; then
    echo "  ✔ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✘ $name"
    FAIL=$((FAIL + 1))
  fi
}

json_get() { # json_get <json> <key>
  node -e "const d=JSON.parse(process.argv[1]);console.log(d[process.argv[2]] ?? '')" "$1" "$2"
}

echo "==> [1/7] docker compose up -d --build"
"${COMPOSE[@]}" up -d --build

echo "==> [2/7] Attente du healthcheck backend (/api/health = ok)"
OK=""
for i in $(seq 1 60); do
  if curl -sf "${BASE_URL}/health" 2>/dev/null | grep -q '"status":"ok"'; then
    OK=1
    break
  fi
  sleep 5
done
check "backend healthy en 5 min" "${OK:+0:-1}"

echo "==> [3/7] Inscription de deux utilisateurs E2E"
ALICE=$(curl -sf -X POST "${BASE_URL}/auth/register" -H "Content-Type: application/json" \
  -d '{"email":"alice.e2e@clearnet.io","name":"Alice E2E","password":"e2e-password"}')
check "register alice" "$?"
BOB=$(curl -sf -X POST "${BASE_URL}/auth/register" -H "Content-Type: application/json" \
  -d '{"email":"bob.e2e@clearnet.io","name":"Bob E2E","password":"e2e-password"}')
check "register bob" "$?"

echo "==> [4/7] Login + token"
LOGIN=$(curl -sf -X POST "${BASE_URL}/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"alice.e2e@clearnet.io","password":"e2e-password"}')
TOKEN=$(json_get "$LOGIN" access_token)
check "login alice (token présent)" "$([ -n "$TOKEN" ] && echo 0 || echo 1)"

echo "==> [5/7] Transaction alice -> bob"
TX=$(curl -sf -X POST "${BASE_URL}/transactions" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" -d '{"toEmail":"bob.e2e@clearnet.io","amount":10.5,"note":"E2E"}')
check "création transaction" "$?"

echo "==> [6/7] Historique alice (1 transaction, to=bob)"
HIST=$(curl -sf "${BASE_URL}/transactions/history" -H "Authorization: Bearer $TOKEN")
HIST_COUNT=$(node -e "const d=JSON.parse(process.argv[1]);console.log(d.length)" "$HIST")
TO_EMAIL=$(json_get "$HIST" "$(node -e "const d=JSON.parse(process.argv[1]);console.log(d[0].toEmail)" "$HIST")" 2>/dev/null || echo "")
check "historique = 1 transaction" "$([ "$HIST_COUNT" = "1" ] && echo 0 || echo 1)"
check "destinataire = bob" "$([ "$TO_EMAIL" = "bob.e2e@clearnet.io" ] && echo 0 || echo 1)"

echo "==> [7/7] Sécurité : 401 (mauvais mot de passe) + 429 (rate-limit login)"
HTTP401=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/auth/login" \
  -H "Content-Type: application/json" -d '{"email":"alice.e2e@clearnet.io","password":"wrong-pass"}')
check "login invalide -> 401" "$([ "$HTTP401" = "401" ] && echo 0 || echo 1)"

HTTP429=""
for i in 1 2 3 4 5 6; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/auth/login" \
    -H "Content-Type: application/json" -d '{"email":"alice.e2e@clearnet.io","password":"wrong-pass"}')
  if [ "$CODE" = "429" ]; then HTTP429=1; break; fi
done
check "rate-limit login -> 429" "${HTTP429:-1}"

echo ""
echo "=================================================="
echo "  Résultats E2E : $PASS réussi(s), $FAIL échec(s)"
echo "=================================================="
[ "$FAIL" = "0" ]
