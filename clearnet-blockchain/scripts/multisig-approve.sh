#!/usr/bin/env bash
# V1.4 Axe 4 - Confirmation + exécution d'une soumission multisig par un owner 2/3.
# Utilisation : TX_ID=0 MULTISIG_OWNER_KEY_2=0x… ./scripts/multisig-approve.sh
# Sécurité : la clé n'est JAMAIS logguée (log borné à txId + txHash).
set -euo pipefail
TX_ID="${TX_ID:?usage: TX_ID=<id> MULTISIG_OWNER_KEY_2=0x… ./scripts/multisig-approve.sh}"
KEY="${MULTISIG_OWNER_KEY_2:-${MULTISIG_OWNER_KEY_3:-}}"
[ -n "$KEY" ] || { echo "MULTISIG_OWNER_KEY_2/_3 requise (env ou secret ops)" >&2; exit 1; }

npx hardhat run scripts/multisig-approve.ts --network "${NETWORK:-sepolia}"