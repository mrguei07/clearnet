import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ZkProof {
  proof: {
    a: [string, string];
    b: [[string, string], [string, string]];
    c: [string, string];
  };
  publicSignals: { hash: string; maxAmount: string };
}

export interface ZkVerification {
  valid: boolean;
  error?: string;
  onChain?: boolean;
}

export interface ZkInputs {
  sender: string;
  receiver: string;
  amount: number;
  maxAmount: number;
}

/** ABI du vérificateur Groth16 généré par snarkjs (verifyProof signature). */
const VERIFIER_ABI = [
  'function verifyProof(uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[2] memory input) external view returns (bool)',
];

const toDec = (value: bigint | string): string => BigInt(value).toString(10);

/**
 * Preuves ZK transactionnelles (feature flag ZK_ENABLED, désactivé par défaut).
 * Circuit Groth16 (circom 2 + snarkjs) : les parties prouvent la compensation
 * sans révéler le montant exact ni les identités complètes sur la chaîne.
 * ZK_ENABLED != 'true' → generateProof() échoue explicitement et verifyProof()
 * retourne { valid: false } : aucun impact sur le flux V1.1.
 */
@Injectable()
export class ZkProofService {
  private readonly logger = new Logger(ZkProofService.name);
  private readonly enabled: boolean;
  private readonly artifactsDir: string;

  constructor(private readonly config: ConfigService) {
    this.enabled = this.config.get<string>('ZK_ENABLED', 'false') === 'true';
    this.artifactsDir = this.config.get<string>('ZK_ARTIFACTS_DIR', './zkartifacts');
    if (this.enabled) {
      this.logger.log('Preuves ZK ACTIVES (snarkjs + verificateur Solidity)');
    } else {
      this.logger.warn('Preuves ZK DÉSACTIVÉES (ZK_ENABLED != true).');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async generateProof(inputs: ZkInputs): Promise<ZkProof> {
    if (!this.enabled) {
      throw new Error('ZK désactivé — définissez ZK_ENABLED=true et lancez scripts/generate-zk-keys.sh');
    }
    const snarkjs = await import('snarkjs');
    const { wasmPath, zkeyPath } = this.resolveArtifactPaths();
    const witness = {
      sender: inputs.sender,
      receiver: inputs.receiver,
      amount: toDec(BigInt(Math.round(inputs.amount * 1000000)).toString()),
      max_amount: toDec(BigInt(Math.round(inputs.maxAmount * 1000000))),
    };
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(witness, wasmPath, zkeyPath);
    return {
      proof: {
        a: [toDec(proof.a[0]), toDec(proof.a[1])],
        b: [
          [toDec(proof.b[0][0]), toDec(proof.b[0][1])],
          [toDec(proof.b[1][0]), toDec(proof.b[1][1])],
        ],
        c: [toDec(proof.c[0]), toDec(proof.c[1])],
      },
      publicSignals: { maxAmount: toDec(publicSignals[0]), hash: toDec(publicSignals[1]) },
    };
  }

  async verifyProof(proof: ZkProof): Promise<ZkVerification> {
    if (!this.enabled) return { valid: false, error: 'ZK_ENABLED=false — vérification désactivée' };
    const verifierAddress = this.config.get<string>('VERIFIER_ADDRESS', '');
    if (verifierAddress) return this.verifyOnChain(proof, verifierAddress);
    return this.verifyOffChain(proof);
  }

  /**
   * Rapport de preuve téléchargeable pour une transaction (V1.3, audit).
   * Le pont ne persiste pas les preuves générées (MVP) : le rapport indique
   * l'état ZK du système et les artefacts requis. Quand la persistance des
   * preuves sera en place, renvoyer ici le JSON signé complet.
   */
  async getProofReport(txId: string): Promise<{
    txId: string;
    zkEnabled: boolean;
    verifierAddress: string | null;
    proof: null;
    message: string;
    generatedAt: string;
  }> {
    const verifierAddress = this.config.get<string>('VERIFIER_ADDRESS', '') || null;
    return {
      txId,
      zkEnabled: this.enabled,
      verifierAddress,
      proof: null,
      message: this.enabled
        ? 'Les preuves générées par le pont ne sont pas encore persistées (MVP). ' +
          'Le rapport documente l’état ZK ; la persistance des preuves arrive en phase suivante.'
        : 'ZK_ENABLED=false — aucune preuve générée pour cette transaction.',
      generatedAt: new Date().toISOString(),
    };
  }

  private async verifyOnChain(proof: ZkProof, address: string): Promise<ZkVerification> {
    try {
      const { JsonRpcProvider, Contract } = await import('ethers');
      const rpc = this.config.get<string>('BLOCKCHAIN_RPC_URL', '');
      if (!rpc) throw new Error('BLOCKCHAIN_RPC_URL manquant');
      const provider = new JsonRpcProvider(rpc);
      const verifier = new Contract(address, VERIFIER_ABI, provider);
      const valid = (await verifier.verifyProof(
        [proof.proof.a[0], proof.proof.a[1]],
        [[proof.proof.b[0][0], proof.proof.b[0][1]], [proof.proof.b[1][0], proof.proof.b[1][1]]],
        [proof.proof.c[0], proof.proof.c[1]],
        [proof.publicSignals.maxAmount, proof.publicSignals.hash],
      )) as boolean;
      return { valid: Boolean(valid), onChain: true };
    } catch (error) {
      this.logger.warn(`Vérification on-chain impossible (${(error as Error).message}) — repli off-chain`);
      return this.verifyOffChain(proof);
    }
  }

  private async verifyOffChain(proof: ZkProof, vkey?: unknown): Promise<ZkVerification> {
    try {
      const snarkjs = await import('snarkjs');
      if (!vkey) vkey = await this.readVerificationKey();
      const valid = await snarkjs.groth16.verify(
        vkey,
        [proof.publicSignals.maxAmount, proof.publicSignals.hash],
        { a: proof.proof.a, b: proof.proof.b, c: proof.proof.c },
      );
      return { valid: Boolean(valid), onChain: false };
    } catch (error) {
      this.logger.warn(`Vérification off-chain impossible (${(error as Error).message})`);
      return { valid: false, error: (error as Error).message, onChain: false };
    }
  }

  private resolveArtifactPaths(): { wasmPath: string; zkeyPath: string } {
    return {
      wasmPath: `${this.artifactsDir}/transaction_js/transaction.wasm`,
      zkeyPath: `${this.artifactsDir}/transaction.zkey`,
    };
  }

  private async readVerificationKey(): Promise<unknown> {
    const fs = await import('node:fs/promises');
    const content = await fs.readFile(`${this.artifactsDir}/verification_key.json`, 'utf8');
    return JSON.parse(content) as unknown;
  }
}