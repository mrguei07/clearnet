/**
 * Types partagés du pont on-chain (v1.2).
 * Les montants côté API sont exprimés en CLRN (18 décimales) ; ils sont
 * convertis en wei (BigInt) au moment de la soumission de la transaction.
 */

/** Vue réseau pour le statut opérationnel. */
export interface OnchainNetworkView {
  chainId?: string;
  name?: string;
  rpcUrl: string;
}

/** Statut global du pont — exposé par GET /api/blockchain/status. */
export interface BlockchainStatus {
  enabled: boolean;
  network?: OnchainNetworkView;
  signerAddress?: string;
  tokenAddress?: string;
  engineAddress?: string;
  zk: {
    required: boolean;
    verifier?: string;
    maxAmountWei?: string;
  };
  /** Avertissements d'initialisation (ex. : variable manquante). */
  warnings?: string[];
}

export interface PositionChangeResult {
  txHash: string;
  address: string;
  amountWei: bigint;
  blockNumber?: number;
}

export interface SettlementResult {
  txHash: string;
  from: string;
  to: string;
  amountWei: bigint;
  blockNumber?: number;
  /** V1.4 Axe 4 : PENDING_MULTISIG = soumission 2/3 en attente de confirmations. */
  status?: 'SUCCESS' | 'PENDING_MULTISIG';
}

/** Preuve Groth16 (snarkjs) au format attendu par le Contract ethers. */
export interface ZkProofShape {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
}

/**
 * Règlement avec preuve : les identifiants sont dérivés en adresses
 * déterministes (bridge MVP) ; la preuve peut être fournie (calculée par
 * ZkProofService) ou générée à la volée via ZkProofService si absente.
 */
export interface ZkSettlementPayload {
  fromEmail: string;
  toEmail: string;
  amount: number;
  maxAmount: number;
  proof?: ZkProofShape;
  /** Signaux publics [maxAmount, commitment] (ordre du circuit). */
  publicSignals?: [string, string];
}

/** Erreur métier du pont : reason exploitable par l'API. */
export class OnchainBridgeError extends Error {
  constructor(
    public readonly reason: string,
    public readonly details?: unknown,
  ) {
    super(reason);
    this.name = 'OnchainBridgeError';
  }
}
