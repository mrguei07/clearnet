import { ethers } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deployer:', deployer.address);

  const Token = await ethers.getContractFactory('ClearNetToken');
  const token = await Token.deploy();
  await token.waitForDeployment();
  console.log('ClearNetToken deployé:', await token.getAddress());

  const Engine = await ethers.getContractFactory('CompensationEngine');
  const engine = await Engine.deploy();
  await engine.waitForDeployment();
  console.log('CompensationEngine deployé:', await engine.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
