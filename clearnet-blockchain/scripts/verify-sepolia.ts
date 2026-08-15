import * as fs from 'fs';
import * as path from 'path';
import hre from 'hardhat';

/**
 * Vérification des contrats sur Etherscan (Sepolia).
 * Prérequis : ETHERSCAN_API_KEY dans .env + deployments/sepolia.json
 * (généré par deploy-sepolia.ts).
 */
async function main() {
  const deploymentsPath = path.join(__dirname, '..', 'deployments', 'sepolia.json');
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error('deployments/sepolia.json introuvable — lancer scripts/deploy-sepolia.ts d’abord');
  }
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8')) as {
    clearNetToken: string;
    compensationEngine: string;
  };

  const targets = [
    { name: 'ClearNetToken', address: deployments.clearNetToken },
    { name: 'CompensationEngine', address: deployments.compensationEngine },
  ];

  for (const target of targets) {
    console.log(`Vérification de ${target.name} (${target.address})…`);
    try {
      await hre.run('verify:verify', {
        address: target.address,
        constructorArguments: [],
      });
      console.log(`✔ ${target.name} vérifié`);
    } catch (error) {
      console.warn(`Échec de la vérification de ${target.name}: ${(error as Error).message}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
