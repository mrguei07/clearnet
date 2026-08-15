# V1.4 Axe 4 — Confirmation + exécution d'une soumission multisig par un owner 2/3 (Windows).
# Usage : $env:TX_ID="0"; $env:MULTISIG_OWNER_KEY_2="0x…"; .\scripts\multisig-approve.ps1
# Sécurité : la clé n'est JAMAIS logguée (log borné à txId + txHash).
$ErrorActionPreference = 'Stop'
if (-not $env:TX_ID) { throw 'TX_ID requis (id de soumission multisig)' }
if (-not ($env:MULTISIG_OWNER_KEY_2 -or $env:MULTISIG_OWNER_KEY_3)) {
  throw 'MULTISIG_OWNER_KEY_2/_3 requise (env ou secret ops)'
}
npx hardhat run scripts/multisig-approve.ts --network $env:NETWORK