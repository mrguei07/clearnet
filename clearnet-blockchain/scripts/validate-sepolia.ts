import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Validation de bout en bout sur Sepolia (v1.2) :
 *   1. lit deployments/sepolia.json (généré par deploy-sepolia.ts)
 *   2. mint CLRN aux adresses dérivées des emails de demo
 *   3. met à jour les positions nettes (CompensationEngine.updatePosition)
 *   4. compense une portion (settle) et vérifie les positions résiduelles
 *
 * Usage : npm run validate:sepolia
 * Les identités suivent la même dérivation que le backend (bridge MVP) :
 * address = keccak256(email.toLowerCase())[-40:] — cohérent.
 */

function addressFromEmail(email: string): string {
  const hash = ethers.keccak256(ethers.toUtf8Bytes(email.trim().toLowerCase()));
  return ethers.getAddress(`0x${hash.slice(-40)}`);
}

const DEMO = { alice: 'alice@clearnet.io', bob: 'bob@clearnet.io' };
const AMOUNT_CLRN = 500; // CLRN

async function main() {
  const deploymentsPath = path.join(__dirname, '..', 'deployments', 'sepolia.json');
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error('deployments/sepolia.json introuvable — lancez d’abord npm run deploy:sepolia');
  }
  const deployments = JSON.parse(
    fs.readFileSync(deploymentsPath, 'utf8'),
  ) as { clearNetToken: string; compensationEngine: string; deployer: string };

  const [deployer] = await ethers.getSigners();
  if (deployer.address.toLowerCase() !== deployments.deployer.toLowerCase()) {
    throw new Error(
      `Le signer courant (${deployer.address}) diffère du déployeur enregistré (${deployments.deployer})`,
    );
  }

  const token = await ethers.getContractAt('ClearNetToken', deployments.clearNetToken);
  const engine = await ethers.getContractAt('CompensationEngine', deployments.compensationEngine);

  const alice = addressFromEmail(DEMO.alice);
  const bob = addressFromEmail(DEMO.bob);
  console.log('Alice (dérivée) :', alice);
  console.log('Bob   (dérivée) :', bob);

  console.log(`\n→ Mint ${AMOUNT_CLRN} CLRN à Alice et Bob…`);
  const mintAlice = await token.mint(alice, ethers.parseEther(String(AMOUNT_CLRN)));
  await mintAlice.wait();
  const mintBob = await token.mint(bob, ethers.parseEther(String(AMOUNT_CLRN)));
  await mintBob.wait();
  console.log('  ✔ mint tx:', mintAlice.hash, '|', mintBob.hash);

  console.log(`\n→ Positions nettes (Alice +${AMOUNT_CLRN} CLRN, Bob −${AMOUNT_CLRN})…`);
  const upA = await engine.updatePosition(alice, ethers.parseEther(String(AMOUNT_CLRN)));
  await upA.wait();
  const upB = await engine.updatePosition(bob, ethers.parseEther(`-${AMOUNT_CLRN}`));
  await upB.wait();

  console.log(`\n→ Compensation Alice → Bob de ${AMOUNT_CLRN} CLRN…`);
  const settle = await engine.settle(alice, bob, ethers.parseEther(String(AMOUNT_CLRN)));
  const receipt = await settle.wait();
  console.log('  ✔ settlement tx:', receipt?.hash);

  const netA = await engine.netPositions(alice);
  const netB = await engine.netPositions(bob);
  console.log('\nPositions nettes après règlement :');
  console.log('  Alice :', ethers.formatEther(netA), 'CLRN');
  console.log('  Bob   :', ethers.formatEther(netB), 'CLRN');

  if (netA !== 0n || netB !== 0n) {
    throw new Error(`Règlement incomplet — attente 0/0, obtenu ${netA}/${netB}`);
  }
  console.log('\n✔ Validation de bout en bout réussie (netting bilan : 0/0)');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});