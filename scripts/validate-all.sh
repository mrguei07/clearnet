#!/usr/bin/env bash
# =============================================================
# ClearNet V1.1 — Validation globale (Mac / Linux)
# Étape 1 : backend (build + tests)  -> Étape 2 : blockchain
# (compile + tests) -> Étape 3 : mobile (typecheck) ->
# Étape 4 (optionnelle) : E2E Docker.
# Usage : ./scripts/validate-all.sh [--skip-docker] [--skip-mobile]
# Windows : ./scripts/validate-all.ps1
# =============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_DOCKER=0
SKIP_MOBILE=0
for arg in "$@"; do
  case "$arg" in
    --skip-docker) SKIP_DOCKER=1 ;;
    --skip-mobile) SKIP_MOBILE=1 ;;
  esac
done

FAILURES=0
step() { echo ""; echo "============================================"; echo "  $1"; echo "============================================"; }
check() { if [ "$2" = "0" ]; then echo "  [OK] $1"; else echo "  [KO] $1"; FAILURES=1; fi }

step "Étape 1/4 — Backend (npm ci, build, tests)"
(cd "$ROOT/clearnet-backend" && npm ci --no-audit --no-fund >/dev/null 2>&1)
check "backend: npm ci" "$?"
(cd "$ROOT/clearnet-backend" && npm run build >/dev/null 2>&1)
check "backend: build" "$?"
(cd "$ROOT/clearnet-backend" && npm test >/dev/null 2>&1)
check "backend: tests jest" "$?"

step "Étape 2/4 — Blockchain (compile + tests)"
(cd "$ROOT/clearnet-blockchain" && npm ci --no-audit --no-fund >/dev/null 2>&1)
check "blockchain: npm ci" "$?"
(cd "$ROOT/clearnet-blockchain" && npx hardhat compile >/dev/null 2>&1)
check "blockchain: compile" "$?"
(cd "$ROOT/clearnet-blockchain" && npx hardhat test >/dev/null 2>&1)
check "blockchain: tests" "$?"

if [ "$SKIP_MOBILE" = "0" ]; then
  step "Étape 3/4 — Mobile (typecheck TypeScript)"
  (cd "$ROOT/clearnet-mobile" && npm ci --no-audit --no-fund >/dev/null 2>&1)
  check "mobile: npm ci" "$?"
  (cd "$ROOT/clearnet-mobile" && npx tsc --noEmit >/dev/null 2>&1)
  check "mobile: tsc --noEmit" "$?"
else
  step "Étape 3/4 — Mobile (SKIPPÉ : --skip-mobile)"
fi

if [ "$SKIP_DOCKER" = "0" ]; then
  step "Étape 4/4 — E2E Docker (test-e2e.sh)"
  "$ROOT/infrastructure/test-e2e.sh"
  check "E2E Docker" "$?"
else
  step "Étape 4/4 — E2E Docker (SKIPPÉ : --skip-docker — lancer infrastructure/test-e2e.sh manuellement)"
fi

echo ""
echo "============================================"
if [ "$FAILURES" = "0" ]; then
  echo "  VALIDATION GLOBALE : TOUT EST OK ✔"
else
  echo "  VALIDATION GLOBALE : ÉCHECS DÉTECTÉS ✘"
fi
echo "============================================"
exit $FAILURES
