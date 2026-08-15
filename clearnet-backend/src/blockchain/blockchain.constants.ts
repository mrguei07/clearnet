import type { InterfaceAbi } from 'ethers';

/**
 * Constantes du pont on-chain (v1.2) — valeurs par défaut / alinéas.
 */
export const BLOCKCHAIN_CONSTANTS = {
  /**
   * RPC de repli (démo uniquement). En réel : injecter une URL Alchemy/Infura.
   */
  DEFAULT_RPC_URL: 'https://ethereum-sepolia-rpc.publicnode.com',
  /** Décimale CLRN (OZ ERC20 par défaut). */
  TOKEN_DECIMALS: 18,
  /** Nombre de blocs max observés avant déclaration d'échec (tx.wait). */
  WAIT_BLOCKS: 5,
} as const;

/**
 * ABI minimale du jeton ClearNetToken (ERC20 + mint/burn admin).
 * Fragment chaîne : parse par ethers v6 à l'instanciation du Contract.
 */
export const TOKEN_ABI: InterfaceAbi = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount)',
  'function burn(uint256 amount)',
  'function burnFrom(address account, uint256 amount)',
];

/**
 * ABI du CompensationEngine (v1.2) : netting bilatéral + hook ZK optionnel.
 * Comprend les fonctions ajoutées en Phase 2 (setZkSettings / settleWithProof)
 * avec la signature Groth16 : input = [maxAmount, commitment] (2 signaux publics).
 */
export const COMPENSATION_ENGINE_ABI: InterfaceAbi = [
  // V1.1 — netting
  'function updatePosition(address account, int256 delta) external',
  'function netPositions(address account) view returns (int256)',
  'function settle(address from, address to, uint256 amount) external',
  // V1.2 — intégration ZK (gated par zkRequired)
  'function settleWithProof(address from, address to, uint256 amount, uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[2] input) external',
  'function setZkSettings(address verifier, bool required, uint256 maxAmount) external',
  // Lecture (diagnostic / status)
  'function admin() view returns (address)',
  'function zkRequired() view returns (bool)',
  'function zkbVerifier() view returns (address)',
  'function maxAmount() view returns (uint256)',
];

/**
 * V1.4 Axe 4 - ABI minimale du MultiSigWallet (2/3) : lecture seule suffisante
 * pour le monitoring (angles mort 3.1) et le diagnostic ops.
 */
export const MULTISIG_ABI: InterfaceAbi = [
  'function transactionCount() view returns (uint256)',
  'function transactions(uint256) view returns (address destination, uint256 value, bytes data, bool executed, uint256 confirmations, uint256 timestamp)',
  'function getOwners() view returns (address[])',
  'function getConfirmations(uint256) view returns (address[])',
  // V1.4 Axe 4 : soumission par le backend (le wallet est owner 1/3).
  'function submitTransaction(address destination, uint256 value, bytes data) returns (uint256)',
];

/** ABI groupés (format attendu par BlockchainService). */
export const CONTRACT_ABIS = {
  Token: TOKEN_ABI,
  Engine: COMPENSATION_ENGINE_ABI,
  MultiSig: MULTISIG_ABI,
} as const;
