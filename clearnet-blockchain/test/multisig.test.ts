import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('MultiSigWallet (2/3) — V1.4 Axe 4', function () {
  let multisig: Awaited<ReturnType<typeof deployMultiSig>>;
  let engine: Awaited<ReturnType<typeof deployEngine>>;
  let a: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  let b: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  let c: Awaited<ReturnType<typeof ethers.getSigners>>[0];

  async function deployMultiSig() {
    const MultiSig = await ethers.getContractFactory('MultiSigWallet');
    const ms = await MultiSig.deploy([a.address, b.address, c.address]);
    await ms.waitForDeployment();
    return ms;
  }

  async function deployEngine() {
    const Engine = await ethers.getContractFactory('CompensationEngine');
    const eng = await Engine.deploy();
    await eng.waitForDeployment();
    return eng;
  }

  beforeEach(async () => {
    [a, b, c] = await ethers.getSigners();
    multisig = await deployMultiSig();
    engine = await deployEngine();
    // Positions administrées AVANT le transfert d'admin au multisig
    // (updatePosition est onlyAdmin — le multisig ne modifie pas les positions).
    await engine.updatePosition(a.address, 1000);
    await engine.updatePosition(b.address, -1000);
    await engine.transferAdmin(await multisig.getAddress());
  });

  it('refuse l exécution sans 2 confirmations', async () => {
    const data = engine.interface.encodeFunctionData('settle', [a.address, b.address, 250]);
    await multisig.connect(a).submitTransaction(await engine.getAddress(), 0, data);
    await expect(multisig.connect(a).executeTransaction(0)).to.be.revertedWith('not enough confirmations');
    expect(await engine.netPositions(a.address)).to.equal(1000);
  });

  it('exécute après la 2ème confirmation (2/3)', async () => {
    const data = engine.interface.encodeFunctionData('settle', [a.address, b.address, 250]);
    await multisig.connect(a).submitTransaction(await engine.getAddress(), 0, data);
    await multisig.connect(b).confirmTransaction(0);          // 2/2 -> exécution auto
    expect(await engine.netPositions(a.address)).to.equal(750n);
    expect(await engine.netPositions(b.address)).to.equal(-750n);
  });

  it('permet un 3ème owner comme backup', async () => {
    const data = engine.interface.encodeFunctionData('settle', [a.address, b.address, 100]);
    await multisig.connect(a).submitTransaction(await engine.getAddress(), 0, data);
    await multisig.connect(c).confirmTransaction(0);
    expect(await engine.netPositions(a.address)).to.equal(900n);
  });
});