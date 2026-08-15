#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# generate-zk-keys.sh — Artefacts Groth16 pour le circuit transaction.circom
#
# Prérequis : circom (2.x), snarkjs (0.7.x), node >= 18, npm install dans
#             clearnet-blockchain (circomlib est déjà une dépendance).
#
# Sorties (par défaut dans ./zkartifacts) :
#   - transaction.r1cs, transaction.wasm, transaction_js/
#   - transaction.zkey (proving key) + transaction.zkey.vkey (verification key
#     JSON = verification_key.json)
#   - ../contracts/Verifier.sol généré (écrasé à chaque run)
# Usage : ZK_PTAU_POWER=16 bash scripts/generate-zk-keys.sh
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOCKCHAIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CIRCUIT="$BLOCKCHAIN_DIR/circuits/transaction.circom"
OUT_DIR="${ZK_OUTPUT_DIR:-$BLOCKCHAIN_DIR/zkartifacts}"
PTAU_POWER="${ZK_PTAU_POWER:-16}"

mkdir -p "$OUT_DIR"
cd "$BLOCKCHAIN_DIR"

command -v circom >/dev/null 2>&1 || { echo "circom introuvable — voir https://docs.circom.io/"; exit 1; }
command -v snarkjs >/dev/null 2>&1 || { echo "snarkjs introuvable — npm i -g snarkjs"; exit 1; }

echo "==> Compilation du circuit"
circom "$CIRCUIT" --r1cs --wasm --sym -o "$OUT_DIR"

echo "==> Powers of Tau (phase 1) — puissance ${PTAU_POWER}"
PTAU_FILE="$OUT_DIR/potau_${PTAU_POWER}.ptau"
if [ ! -f "$PTAU_FILE" ]; then
  snarkjs powersoftau new bn128 "$PTAU_POWER" "$PTAU_FILE" -v
  snarkjs powersoftau contribute "$PTAU_FILE" "$OUT_DIR/potau_${PTAU_POWER}_0001.ptau" --name="ClearNet phase1" -v
  mv "$OUT_DIR/potau_${PTAU_POWER}_0001.ptau" "$PTAU_FILE"
fi

echo "==> Phase 2: setup Groth16"
snarkjs powersoftau prepare phase2 "$PTAU_FILE" "$OUT_DIR/potau_phase2.ptau" -v

snarkjs groth16 setup "$OUT_DIR/transaction.r1cs" "$OUT_DIR/potau_phase2.ptau" "$OUT_DIR/transaction.zkey" -v
snarkjs zkey contribute "$OUT_DIR/transaction.zkey" "$OUT_DIR/transaction_final.zkey" --name="ClearNet phase2" -v
mv "$OUT_DIR/transaction_final.zkey" "$OUT_DIR/transaction.zkey"

echo "==> Clé de vérification"
snarkjs zkey export verificationkey "$OUT_DIR/transaction.zkey" "$OUT_DIR/verification_key.json"

echo "==> Vérificateur Solidity (écrasement contrôlé de contracts/Verifier.sol)"
snarkjs zkey export solidityverifier "$OUT_DIR/transaction.zkey" "$BLOCKCHAIN_DIR/contracts/Verifier.sol"
sed -i '1i // SPDX-License-Identifier: GPL-3.0' "$BLOCKCHAIN_DIR/contracts/Verifier.sol"

echo "==> OK : artefacts dans ${OUT_DIR}, Verifier.sol généré"
echo "    Référence on-chain : VERIFIER_ADDRESS=0x… après hardhat deploy"