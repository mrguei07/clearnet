import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  keccak256,
  toUtf8Bytes,
  formatEther,
  ZeroAddress,
} from 'ethers';
import { BLOCKCHAIN_CONSTANTS, CONTRACT_ABIS } from './blockchain.constants';
import {
  BlockchainStatus,
  OnchainBridgeError,
  PositionChangeResult,
  SettlementResult,
  ZkSettlementPayload,
} from './blockchain.types';
import { ZkProofService } from '../zkproof/zkproof.service';

/** Configuration effective du pont (résolue depuis ConfigService). */
export interface BlockchainConfig {
  rpcUrl: string;
  privateKey: string;
  tokenAddress: string;
  engineAddress: string;
  enabled: boolean;
}

/** Reçu de transaction normalisé (toutes les écritures uniques). */
export interface TransactionReceipt {
  hash: string;
  blockNumber: number;
  status: number;
  gasUsed: bigint;
}

/**
 * Pont on-chain backend → smart contracts (ethers 6.x) — v1.2.
 *
 * Activation : passe si ONCHAIN_ENABLED=true OU BLOCKCHAIN_ENABLED=true
 * (alias conservé pour la compatibilité compose V1.1).
 * Tant qu'aucun flag n'est actif, toutes les méthodes retournent des valeurs
 * vides / lèvent OnchainBridgeError('disabled') : zéro impact hors-ligne.
 *
 * Clés d'env : BLOCKCHAIN_RPC_URL (repli RPC_URL_SEPOLIA), BLOCKCHAIN_PRIVATE_KEY
 * (repli PRIVATE_KEY), CLRN_TOKEN_ADDRESS (repli CONTRACT_TOKEN_ADDRESS),
 * COMPENSATION_ENGINE_ADDRESS (repli CONTRACT_ENGINE_ADDRESS).
 *
 * Sémantique : le CompensationEngine est un LEDGER de netting bilatéral —
 * settle() ne déplace AUCUN ERC20, il décrémente/crédite la position nette.
 * Les helpers ERC20 (approve/getAllowance/transfer) sont donc des utilitaires
 * génériques pour flux annexes, et non un prérequis du settle.
 *
 * Identités : adresses déterministes dérivées des emails (MVP, voir
 * addressFromEmail). Les montants sont en CLRN (18 décimales) côté API.
 */
@Injectable()
export class BlockchainService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainService.name);
  private readonly warnings: string[] = [];
  private readonly config: BlockchainConfig;
  private provider?: JsonRpcProvider;
  private signer?: Wallet;
  private token?: Contract;
  private engine?: Contract;
  private multisig?: Contract;
  private multisigAddress = '';
  private isInitialized = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly zkProofService: ZkProofService,
  ) {
    const legacy = this.configService.get<string>('BLOCKCHAIN_ENABLED', 'false') === 'true';
    const explicit = this.configService.get<string>('ONCHAIN_ENABLED', 'false') === 'true';
    this.config = {
      rpcUrl:
        this.configService.get<string>('BLOCKCHAIN_RPC_URL', '') ||
        this.configService.get<string>('RPC_URL_SEPOLIA', '') ||
        BLOCKCHAIN_CONSTANTS.DEFAULT_RPC_URL,
      privateKey:
        this.configService.get<string>('BLOCKCHAIN_PRIVATE_KEY', '') ||
        this.configService.get<string>('PRIVATE_KEY', ''),
      tokenAddress:
        this.configService.get<string>('CLRN_TOKEN_ADDRESS', '') ||
        this.configService.get<string>('CONTRACT_TOKEN_ADDRESS', '') ||
        ZeroAddress,
      engineAddress:
        this.configService.get<string>('COMPENSATION_ENGINE_ADDRESS', '') ||
        this.configService.get<string>('CONTRACT_ENGINE_ADDRESS', '') ||
        ZeroAddress,
      enabled: legacy || explicit,
    };
    this.multisigAddress = this.configService.get<string>('MULTISIG_ADDRESS', '');
    if (!this.config.enabled) {
      this.logger.warn(
        'Pont on-chain DÉSACTIVÉ (ONCHAIN_ENABLED/BLOCKCHAIN_ENABLED != true). Transactions hors-chaîne uniquement.',
      );
    }
  }

  /**
   * Initialisation asynchrone du provider / wallet / contrats (cycle de vie
   * Nest). Échoue doucement : les erreurs réseau sont collectées dans
   * `warnings` et visibles via getStatus().
   */
  async onModuleInit() {
    if (!this.config.enabled) {
      this.logger.log(`Pont on-chain ACTIF (ONCHAIN_ENABLED=${this.configService.get('ONCHAIN_ENABLED')}) — initialisation différée à l'usage`);
      return;
    }
    this.logger.log('Initialisation du pont on-chain…');
    try {
      this.provider = new JsonRpcProvider(this.config.rpcUrl);
      if (!this.config.privateKey) {
        throw new Error('Aucune clé privée (BLOCKCHAIN_PRIVATE_KEY / PRIVATE_KEY)');
      }
      const wallet = new Wallet(this.config.privateKey, this.provider);
      this.signer = wallet;

      const balance = await this.provider.getBalance(wallet.address);
      this.logger.log(`Wallet ${wallet.address} — solde ${formatEther(balance)} ETH`);
      if (balance === 0n) {
        this.warnings.push('Wallet à 0.0000 ETH — alimentez le compte (faucet Sepolia) avant tout écriture.');
        this.logger.warn('Wal wallet à 0 ETH — les transactions revertront faute de gas.');
      }

      this.token = new Contract(this.config.tokenAddress, CONTRACT_ABIS.Token, wallet);
      this.engine = new Contract(this.config.engineAddress, CONTRACT_ABIS.Engine, wallet);
      if (this.multisigAddress) {
        // V1.4 Axe 4 : multi-sig 2/3 — le backend est owner 1/3 et SOUMET
        // les règlements ; les owners 2/3 confirment hors-ligne (scripts ops).
        this.multisig = new Contract(this.multisigAddress, CONTRACT_ABIS.MultiSig, wallet);
        this.logger.log(`MultiSigWallet 2/3 initialisé : ${this.multisigAddress}`);
      }
      this.isInitialized = true;
      this.logger.log(
        `Pont initialisé — engine: ${this.config.engineAddress}, token: ${this.config.tokenAddress}, rpc: ${this.config.rpcUrl}`,
      );
    } catch (error) {
      const message = (error as Error).message;
      this.warnings.push(`Initialisation du pont échouée : ${message}`);
      this.logger.error(`Failed to init on-chain bridge: ${message}`);
      this.isInitialized = false;
    }
  }

  isEnabled(): boolean {
    return this.config.enabled && this.isInitialized;
  }

  /** Diagnostic opérationnel (aucun secret). */
  async getStatus(): Promise<BlockchainStatus> {
    const status: BlockchainStatus = {
      enabled: this.config.enabled,
      zk: { required: false },
      warnings: this.warnings.length ? [...this.warnings] : undefined,
    };
    if (!this.config.enabled) return status;
    try {
      const network = await this.provider!.getNetwork();
      status.network = {
        chainId: network.chainId.toString(),
        name: network.name,
        rpcUrl: this.config.rpcUrl,
      };
    } catch (error) {
      status.warnings = [...(status.warnings ?? []), `RPC injoignable: ${(error as Error).message}`];
      return status;
    }
    status.signerAddress = this.signer?.address;
    if (this.token) status.tokenAddress = this.token.target?.toString();
    if (this.engine) status.engineAddress = this.engine.target?.toString();
    try {
      status.zk.required = Boolean(await this.engine?.zkRequired());
      status.zk.verifier = (await this.engine?.zkbVerifier()) as string | undefined;
      status.zk.maxAmountWei = (await this.engine?.maxAmount())?.toString();
    } catch (error) {
      status.warnings = [...(status.warnings ?? []), `lecture état ZK échouée: ${(error as Error).message}`];
    }
    return status;
  }

  // ============= TOKEN (CLRN / ERC20) =============

  /** Solde CLRN (wei) d'un compte dérivé de l'email. */
  async tokenBalanceOf(email: string): Promise<bigint> {
    if (!this.assertReady()) return 0n;
    return this.token!.balanceOf(this.addressFromEmail(email)) as Promise<bigint>;
  }

  /** Solde CLRN (wei) d'une adresse explicite. */
  async getTokenBalance(address: string): Promise<bigint> {
    this.checkEnabled();
    try {
      return (await this.token!.balanceOf(address)) as bigint;
    } catch (error) {
      this.logger.error(`getTokenBalance failed: ${(error as Error).message}`);
      throw new Error(`Failed to get balance: ${(error as Error).message}`);
    }
  }

  /** Mint CLRN (n'émet que si le wallet est l'admin du token). */
  async mintTo(to: string, amount: bigint): Promise<TransactionReceipt> {
    this.checkEnabled();
    try {
      this.logger.log(`Mint ${formatEther(amount)} CLRN → ${to}`);
      const tx = await this.token!.mint(to, amount);
      const receipt = await tx.wait();
      return {
        hash: receipt?.hash ?? tx.hash,
        blockNumber: Number(receipt?.blockNumber ?? 0),
        status: Number(receipt?.status ?? 1),
        gasUsed: receipt?.gasUsed ?? 0n,
      };
    } catch (error) {
      this.logger.error(`mintTo failed: ${(error as Error).message}`);
      throw new Error(`Failed to mint: ${(error as Error).message}`);
    }
  }

  /** Métadonnées du jeton (diagnostic). */
  async getTokenInfo(): Promise<{ name: string; symbol: string; decimals: number; totalSupply: bigint }> {
    this.checkEnabled();
    try {
      const [name, symbol, decimals, totalSupply] = await Promise.all([
        this.token!.name(),
        this.token!.symbol(),
        this.token!.decimals(),
        this.token!.totalSupply(),
      ]) as unknown as [string, string, number, bigint];
      return { name, symbol, decimals, totalSupply };
    } catch (error) {
      this.logger.error(`getTokenInfo failed: ${(error as Error).message}`);
      throw new Error(`Failed to get token info: ${(error as Error).message}`);
    }
  }

  /** Approuve un spender (utilitaire ERC20 — l'engine ne tire PAS de tokens). */
  async approve(spender: string, amount: bigint): Promise<TransactionReceipt> {
    this.checkEnabled();
    try {
      this.logger.log(`Approve ${formatEther(amount)} CLRN → ${spender}`);
      const tx = await this.token!.approve(spender, amount);
      const receipt = await tx.wait();
      return {
        hash: receipt?.hash ?? tx.hash,
        blockNumber: Number(receipt?.blockNumber ?? 0),
        status: Number(receipt?.status ?? 1),
        gasUsed: receipt?.gasUsed ?? 0n,
      };
    } catch (error) {
      this.logger.error(`approve failed: ${(error as Error).message}`);
      throw new Error(`Failed to approve: ${(error as Error).message}`);
    }
  }

  /** Allowance accordée par `owner` à `spender` (wei). */
  async getAllowance(owner: string, spender: string): Promise<bigint> {
    this.checkEnabled();
    try {
      return (await this.token!.allowance(owner, spender)) as bigint;
    } catch (error) {
      this.logger.error(`getAllowance failed: ${(error as Error).message}`);
      throw new Error(`Failed to get allowance: ${(error as Error).message}`);
    }
  }

  // ============= ENGINE (netting) =============

  /** Position nette (wei, signée) d'un compte dérivé de l'email. */
  async getNetPosition(email: string): Promise<bigint> {
    if (!this.assertReady()) return 0n;
    return this.engine!.netPositions(this.addressFromEmail(email)) as Promise<bigint>;
  }

  /**
   * Met à jour la position nette d'un compte identifié par son email
   * (delta en CLRN, converti en wei — 18 décimales).
   */
  async recordPositionChange(email: string, delta: number): Promise<PositionChangeResult> {
    if (!this.assertReady()) return { txHash: '', address: this.addressFromEmail(email), amountWei: 0n };
    const address = this.addressFromEmail(email);
    const wei = BigInt(Math.round(delta * 1e18));
    const tx = await this.engine!.updatePosition(address, wei);
    const receipt = await tx.wait();
    this.logger.log(`Position ${address} += ${delta} CLRN — tx ${receipt!.hash}`);
    return { txHash: receipt!.hash, address, amountWei: wei, blockNumber: receipt!.blockNumber };
  }

  /**
   * Compensation bilatérale : settle(from, to, amount) sur le réseau.
   * Le contrat vérifie lui-même les positions suffisantes (revert sinon).
   * Pas de transfert ERC20 : c'est un netting de positions.
   */
  async settleCompensation(fromEmail: string, toEmail: string, amount: number): Promise<SettlementResult> {
    this.checkEnabled();
    const from = this.addressFromEmail(fromEmail);
    const to = this.addressFromEmail(toEmail);
    const wei = BigInt(Math.round(amount * 1e18));

    // V1.4 Axe 4 : si le multisig 2/3 est déployé (MULTISIG_ADDRESS), le
    // backend ne fait que SOUMETTRE la transaction compilée. L'exécution
    // n'aura lieu qu'après la 2ème confirmation (owners 2/3, hors-ligne).
    if (this.multisig) {
      const data = this.engine!.interface.encodeFunctionData('settle', [from, to, wei]);
      const tx = await this.multisig.submitTransaction(this.config.engineAddress, 0n, data);
      const receipt = await tx.wait();
      this.logger.log(
        `Compensation ${from} → ${to} (${amount} CLRN) SOUMISE au multisig (2/3) — tx ${receipt!.hash}`,
      );
      return { txHash: receipt!.hash, from, to, amountWei: wei, status: 'PENDING_MULTISIG' };
    }

    const tx = await this.engine!.settle(from, to, wei);
    const receipt = await tx.wait();
    this.logger.log(`Compensation ${from} → ${to} (${amount} CLRN) — tx ${receipt!.hash}`);
    return { txHash: receipt!.hash, from, to, amountWei: wei, blockNumber: receipt!.blockNumber };
  }

  /**
   * Compensation avec preuve ZK (settleWithProof).
   * Si `proof`/`publicSignals` absents, la preuve est générée via
   * ZkProofService (ZK_ENABLED=true requis). Le contrat n'exige la preuve
   * que si zkRequired a été activé (setZkSettings).
   */
  async settleCompensationWithProof(payload: ZkSettlementPayload): Promise<SettlementResult> {
    this.checkEnabled();
    const { fromEmail, toEmail, amount, maxAmount, proof, publicSignals } = payload;
    let a: ZkSettlementPayload['proof'] = proof;
    let signals: [string, string] | undefined = publicSignals;
    if (!a || !signals || signals.length !== 2) {
      const generated = await this.zkProofService.generateProof({
        sender: this.addressFromEmail(fromEmail),
        receiver: this.addressFromEmail(toEmail),
        amount,
        maxAmount,
      });
      a = generated.proof;
      signals = [generated.publicSignals.maxAmount, generated.publicSignals.hash];
    }
    const from = this.addressFromEmail(fromEmail);
    const to = this.addressFromEmail(toEmail);
    const wei = BigInt(Math.round(amount * 1e18));
    const tx = await this.engine!.settleWithProof(from, to, wei, a.a, a.b, a.c, signals);
    const receipt = await tx.wait();
    this.logger.log(`Compensation ZK ${from} → ${to} (${amount} CLRN) — tx ${receipt!.hash}`);
    return { txHash: receipt!.hash, from, to, amountWei: wei, blockNumber: receipt!.blockNumber };
  }

  /**
   * Configure l'exigence ZK on-chain (admin = clé du back). maxAmount en CLRN.
   * Revert si appelé par une autre clé que celle du déploiement.
   */
  async configureZk(verifier: string, required: boolean, maxAmount: number): Promise<string> {
    this.checkEnabled();
    const wei = BigInt(Math.round(maxAmount * 1e18));
    const tx = await this.engine!.setZkSettings(verifier, required, wei);
    const receipt = await tx.wait();
    this.logger.log(`ZkSettings (verifier=${verifier}, required=${required}, max=${maxAmount} CLRN) — tx ${receipt!.hash}`);
    return receipt!.hash;
  }

  // ============= UTILITAIRES =============

  /** Adresse signataire du pont (ou ZeroAddress si désactivé). */
  getWalletAddress(): string {
    return this.signer?.address ?? ZeroAddress;
  }

  /** Réseau courrant (chainId + nom). */
  async getNetwork(): Promise<{ chainId: number; name: string }> {
    this.checkEnabled();
    const network = await this.provider!.getNetwork();
    return { chainId: Number(network.chainId), name: network.name || 'unknown' };
  }

  /** Défaut fourni en wei — utilitaire pour les logs. */
  static weiToClrn(wei: bigint): string {
    return formatEther(wei);
  }

  /**
   * Adresse pseudo-déterministe dérivée d'un email (bridge MVP).
   * hash = keccak256(email en minuscules) → 20 derniers octets.
   */
  private addressFromEmail(email: string): string {
    const hash = keccak256(toUtf8Bytes(email.trim().toLowerCase()));
    return getAddress(`0x${hash.slice(-40)}`);
  }

  private assertReady(): boolean {
    return this.isInitialized && Boolean(this.provider && this.signer && this.token && this.engine);
  }

  private checkEnabled() {
    if (!this.config.enabled) {
      throw new OnchainBridgeError('disabled', 'ONCHAIN_ENABLED=false');
    }
    if (!this.assertReady()) {
      const reason = this.warnings[this.warnings.length - 1] ?? 'configuration incomplète';
      throw new OnchainBridgeError('not-initialized', reason);
    }
  }
}