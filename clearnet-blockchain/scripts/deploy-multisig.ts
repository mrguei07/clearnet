import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

/**
 * V1.4 Axe 4 : déploie le MultiSigWallet 2/3 puis transfère la gouvernance au
 * multisig — ClearNetToken via transferOwnership (OZ Ownable, existant) et
 * CompensationEngine via transferAdmin (ajout V1.4, admin n'est plus immutable).
 * Aucune clé privée supplémentaire côté backend : owners 2/3 = signatures
 * hors-ligne (scripts/multisig-approve.sh/.ps1).
 *
 * Prérequis : MULTISIG_OWNERS="0x…,0x…,0x…" (3 adresses ou plus, séparées par
 * virgules) dans clearnet-blockchain/.env ; deployments/sepolia.json existant.
 * Usage : npm run deploy:multisig
 */
async function main() {
  const owners = (process.env.MULTISIG_OWNERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (owners.length < 3) throw new Error('MULTISIG_OWNERS : 3 adresses (ou plus) requises (2/3)');

  const deployFile = path.join(__dirname, '..', 'deployments', 'sepolia.json');
  const deployments = JSON.parse(fs.readFileSync(deployFile, 'utf8'));

  const MultiSig = await ethers.getContractFactory('MultiSigWallet');
  const multisig = await MultiSig.deploy(owners);
  await multisig.waitForDeployment();
  const multisigAddress = await multisig.getAddress();
  console.log(`MultiSigWallet @ ${multisigAddress} (owners=${owners.length}, REQUIRED=2)`);

  const token = await ethers.getContractAt('ClearNetToken', deployments.clearNetToken);
  const engine = await ethers.getContractAt('CompensationEngine', deployments.compensationEngine);
  await (await token.transferOwnership(multisigAddress)).wait();
  await (await engine.transferAdmin(multisigAddress)).wait();
  console.log('Ownership transféré : ClearNetToken (Ownable) + CompensationEngine (admin) -> multisig');

  deployments.multisig = multisigAddress;
  deployments.multisigOwners = owners;
  deployments.ownershipTransferredAt = new Date().toISOString();
  fs.writeFileSync(deployFile, JSON.stringify(deployments, null, 2));
  console.log('deployments/sepolia.json mis à jour (multisig + owners).');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});