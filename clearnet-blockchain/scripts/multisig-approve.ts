import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

/**
 * V1.4 Axe 4 — Confirmation (2ème signature) d'une soumission multisig par un
 * owner 2/3, exécutée hors-ligne (jamais dans le pod backend).
 * La clé privée est lue depuis l'environnement et JAMAIS logguée.
 *
 * Usage : NETWORK=sepolia TX_ID=0 MULTISIG_OWNER_KEY_2=0x… npx hardhat run
 *         scripts/multisig-approve.ts --network ${NETWORK}
 */
async function main() {
  const txIdRaw = process.env.TX_ID;
  if (!txIdRaw || !/^\d+$/.test(txIdRaw)) {
    throw new Error('TX_ID requis (entier, id de soumission multisig)');
  }
  const key = process.env.MULTISIG_OWNER_KEY_2 || process.env.MULTISIG_OWNER_KEY_3;
  if (!key) {
    throw new Error('MULTISIG_OWNER_KEY_2/_3 requise (env ou secret ops)');
  }

  const deployFile = path.join(__dirname, '..', 'deployments', 'sepolia.json');
  const deployments = JSON.parse(fs.readFileSync(deployFile, 'utf8'));
  if (!deployments.multisig) {
    throw new Error('deployments/sepolia.json : champ multisig manquant (npm run deploy:multisig)');
  }

  const wallet = new ethers.Wallet(key, ethers.provider);
  const multisig = new ethers.Contract(
    deployments.multisig,
    ['function confirmTransaction(uint256)'],
    wallet,
  );

  const txId = Number(txIdRaw);
  const tx = await multisig.confirmTransaction(txId);
  const receipt = await tx.wait();
  // Log borné : id + statut uniquement — jamais de clé.
  console.log(`multisig #${txId} confirmé + exécuté (si 2/2) -> txHash ${receipt!.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});