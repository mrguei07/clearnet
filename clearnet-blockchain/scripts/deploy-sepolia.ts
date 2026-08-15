import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Déploiement des contrats ClearNet sur Sepolia (v1.2).
 * Prérequis : SEPOLIA_RPC_URL + SEPOLIA_PRIVATE_KEY (compte avec ETH de test)
 *             dans clearnet-blockchain/.env (dotenv chargé par hardhat.config.ts).
 * Écrit : deployments/sepolia.json → adresses à reporter dans le backend.
 *
 * Usage : npm run deploy:sepolia
 */
async function main() {
  const privateKey = process.env.SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!process.env.SEPOLIA_RPC_URL || !privateKey) {
    throw new Error('SEPOLIA_RPC_URL et SEPOLIA_PRIVATE_KEY (ou PRIVATE_KEY) sont requis dans le fichier .env');
  }

  const [deployer] = await ethers.getSigners();
  console.log('Déployeur (Sepolia) :', deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Solde ETH de test   :', ethers.formatEther(balance));
  if (balance < ethers.parseEther('0.05')) {
    throw new Error('Solde insuffisant pour payer le gas — utilisez un faucet Sepolia (≥ 0.05 ETH)');
  }

  console.log('→ Déploiement ClearNetToken…');
  const Token = await ethers.getContractFactory('ClearNetToken');
  const token = await Token.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log('  ClearNetToken :', tokenAddress);

  console.log('→ Déploiement CompensationEngine…');
  const Engine = await ethers.getContractFactory('CompensationEngine');
  const engine = await Engine.deploy();
  await engine.waitForDeployment();
  const engineAddress = await engine.getAddress();
  console.log('  CompensationEngine :', engineAddress);

  const network = await ethers.provider.getNetwork();
  const output = {
    chainId: network.chainId.toString(),
    network: 'sepolia',
    clearNetToken: tokenAddress,
    compensationEngine: engineAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  const dir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sepolia.json'), JSON.stringify(output, null, 2));

  console.log('\n✔ Contrats déployés — adresses reportées dans deployments/sepolia.json');
  console.log('  Backend (.env) : CLRN_TOKEN_ADDRESS=' + tokenAddress);
  console.log('  Backend (.env) : COMPENSATION_ENGINE_ADDRESS=' + engineAddress);
  console.log('Vérification (optionnel) : npm run verify:sepolia');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});