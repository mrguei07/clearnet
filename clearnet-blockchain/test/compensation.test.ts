import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('ClearNetToken', function () {
  it('permet au owner de mint et au détenteur de burn', async function () {
    const [owner, addr1] = await ethers.getSigners();
    const Token = await ethers.getContractFactory('ClearNetToken');
    const token = await Token.deploy();
    await token.waitForDeployment();

    await token.mint(addr1.address, ethers.parseEther('1000'));
    expect(await token.balanceOf(addr1.address)).to.equal(ethers.parseEther('1000'));

    await token.connect(addr1).burn(ethers.parseEther('100'));
    expect(await token.balanceOf(addr1.address)).to.equal(ethers.parseEther('900'));
  });
});

describe('CompensationEngine', function () {
  it('met à jour les positions et règle une compensation', async function () {
    const [, a, b] = await ethers.getSigners();
    const Engine = await ethers.getContractFactory('CompensationEngine');
    const engine = await Engine.deploy();
    await engine.waitForDeployment();

    await engine.updatePosition(a.address, 100);
    await engine.updatePosition(b.address, -100);

    await engine.settle(a.address, b.address, 50);

    expect(await engine.netPositions(a.address)).to.equal(50);
    expect(await engine.netPositions(b.address)).to.equal(-50);
  });
});
