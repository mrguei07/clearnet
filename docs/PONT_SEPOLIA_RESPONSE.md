# ClearNet V1.2 — PONT ON-CHAIN & DÉPLOIEMENT SEPOLIA (Réponse)

**Livrable unique** — diffs/extraits des fichiers backend, nouveaux fichiers, scripts de
déploiement Sepolia, cohérence ZK on-chain et procédure opérationnelle.

- Date : 2026-08-08
- Base : V1.2 (Phase 2 durcissement)
- Réseau cible : **Sepolia** (testnet, chainId 11155111)

---

## 1. Synthèse et décisions

| Décision | Choix | Justification |
|---|---|---|
| Flag d'activation | `ONCHAIN_ENABLED=true` (alias `BLOCKCHAIN_ENABLED`) | Prompt + compatibilité compose V1.1 ; tout off = export hors-chaîne strict |
| Clé privée backend | `BLOCKCHAIN_PRIVATE_KEY`, fallback `PRIVATE_KEY` | Jamais en dur dans le code ; uniquement `process.env` |
| Signer admin | Clé du déploiement = jointure `admin` du `CompensationEngine` | Les appels `settle`/`setZkSettings` exigent `onlyAdmin` |
| Identités | Dérivation déterministe email → adresse (keccak[-40:]) | bridge MVP (déjà utilisé par `TransactionsService`) |
| Groth16 on-chain | `IZkVerifier.verifyProof(..., uint256[2] input)` — signaux = `[maxAmount, commitment]` | Le vérificateur généré attend **2** signaux publics (corrige input[1] et l'ordre inversé) |
| Échelle ZK vs ledger | Circuit en micro-CLRN (×1e6), ledger en wei (×1e18) | Bornes 64 bits du circuit (documenté, §6 PONT_SEPOLIA_DEPLOYMENT.md) |

Non-régression : le flux de transaction évolue de `recordPositionChange` (V1.1, positions
enregistrées) vers un **règlement asynchrone fire-and-forget** (`settleCompensation`) avec
écriture de `onchainHash`/`onchainStatus` sur le nœud Transaction (voir §2.3) — la réponse
HTTP n'est jamais bloquée et tout peut redevenir hors-chaîne (`ONCHAIN_ENABLED=false`).

---

## 2. Diffs des fichiers backend modifiés

### 2.1 `clearnet-backend/src/blockchain/blockchain.module.ts`

```diff
  import { Global, Module } from '@nestjs/common';
+ import { ZkProofModule } from '../zkproof/zkproof.module';
  import { BlockchainService } from './blockchain.service';
+ import { BlockchainController } from './blockchain.controller';

  @Global()
  @Module({
+   imports: [ZkProofModule],
+   controllers: [BlockchainController],
    providers: [BlockchainService],
    exports: [BlockchainService],
  })
  export class BlockchainModule {}
```

### 2.2 `blockchain.service.ts` — extrait des ajouts (service complet maintenu, voir §3.3)

- Flag : `enabled = ONCHAIN_ENABLED === 'true' || BLOCKCHAIN_ENABLED === 'true'`
- Initialisation **tolérante** **async** (`OnModuleInit`) : variables manquantes → `warnings`
  dans `getStatus()`, pas de crash ; check du solde ETH du wallet (warning si 0)
- Clés d'env avec replis : `BLOCKCHAIN_RPC_URL` ← `RPC_URL_SEPOLIA` ← défaut ;
  `BLOCKCHAIN_PRIVATE_KEY` ← `PRIVATE_KEY` ; `CLRN_TOKEN_ADDRESS` ← `CONTRACT_TOKEN_ADDRESS` ;
  `COMPENSATION_ENGINE_ADDRESS` ← `CONTRACT_ENGINE_ADDRESS`
- Méthodes : `getStatus()`, `getNetPosition()` (contrat : `netPositions`), `settleCompensation()`,
  `settleCompensationWithProof()` (génère la preuve via `ZkProofService` si absente),
  `configureZk()` (admin on-chain) + utilitaires ERC20 `getTokenBalance/mintTo/getTokenInfo/
  approve/getAllowance`, réseau (`getNetwork`), `getWalletAddress`
- Retours typés (`PositionChangeResult`, `SettlementResult`) ; erreur métier `OnchainBridgeError`

```ts
// Extraits structurants
async onModuleInit() {
  if (!this.config.enabled) { /* pont actif, init différée */ return; }
  this.provider = new JsonRpcProvider(this.config.rpcUrl);
  const wallet = new Wallet(this.config.privateKey, this.provider);
  const balance = await this.provider.getBalance(wallet.address);
  if (balance === 0n) this.warnings.push('Wallet à 0 ETH — alimentez le compte (faucet Sepolia)');
  this.token = new Contract(this.config.tokenAddress, CONTRACT_ABIS.Token, wallet);
  this.engine = new Contract(this.config.engineAddress, CONTRACT_ABIS.Engine, wallet);
  this.isInitialized = true;
}

async settleCompensation(fromEmail: string, toEmail: string, amount: number): Promise<SettlementResult> {
  this.checkEnabled();
  const from = this.addressFromEmail(fromEmail);
  const to = this.addressFromEmail(toEmail);
  const wei = BigInt(Math.round(amount * 1e18));
  const tx = await this.engine!.settle(from, to, wei);
  const receipt = await tx.wait();
  return { txHash: receipt!.hash, from, to, amountWei: wei, blockNumber: receipt!.blockNumber };
}
```

### 2.3 `transactions.service.ts` — règlement on-chain fire-and-forget + statut

Le branchement V1.1 (mises à jour de position synchrones) devient un **règlement asynchrone**
**fire-and-forget** : la réponse HTTP n'est jamais bloquée ; le hash et le statut sont écrits
sur le nœud Transaction.

```diff
   import { Injectable, Logger, ... } from '@nestjs/common';
+  import { ConfigService } from '@nestjs/config';
   import { BlockchainService } from '../blockchain/blockchain.service';
   ...
   export class TransactionsService {
     private readonly logger = new Logger(TransactionsService.name);
+    private readonly onchainEnabled: boolean;
     constructor(
       @Inject(NEO4J_DRIVER) private readonly driver: Driver,
       private readonly blockchainService: BlockchainService,
       ...
+      private readonly config: ConfigService,
     ) {
+      this.onchainEnabled = this.config.get<string>('ONCHAIN_ENABLED') === 'true';
     }
   ...
   const record = this.toTransaction(...);
-  await this.recordOnChain(input);
+
+  // --- PONT ON-CHAIN (FIRE-AND-FORGET) ---
+  if (this.onchainEnabled) {
+    this.processOnChainSettlement(record.id, input.fromEmail, input.toEmail, input.amount)
+      .catch(err => this.logger.error(`On-chain settlement failed for tx ${record.id}: ${err.message}`));
+  }
   return record;
 }
```

Nouvelle méthode (adresses dérivées des emails — aucune donnée wallet à stocker) :

```ts
private async processOnChainSettlement(txId: string, fromEmail: string, toEmail: string, amount: number) {
  try {
    const result = await this.blockchainService.settleCompensation(fromEmail, toEmail, amount);
    await this.updateTransactionHash(txId, result.txHash);           // onchainHash + 'SUCCESS'
    this.logger.log(`On-chain settlement successful for tx ${txId}. Hash: ${result.txHash}`);
  } catch (error) {
    await this.updateTransactionStatus(txId, 'FAILED', (error as Error).message); // onchainError
    throw error;
  }
}
// + updateTransactionHash / updateTransactionStatus : Cypher MATCH (t:Transaction {id}) SET …
```

### 2.4 `app.module.ts` — AUCUN changement

`BlockchainModule` est déjà importé et `@Global()` ; la chaîne de dépendances
`BlockchainModule ⇒ ZkProofModule` est résolue par le module lui-même.

### 2.5 `clearnet-backend/.env.example`

```diff
+ # Pont on-chain (ethers 6.x, v1.2) — ONCHAIN_ENABLED = alias clair
+ ONCHAIN_ENABLED=false
  BLOCKCHAIN_ENABLED=false
  BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
  BLOCKCHAIN_PRIVATE_KEY=0xac0974…  # défaut dev ; alias accepté : PRIVATE_KEY
@@
+ # ---- Phase 2 (règle d'or : tout désactivé par défaut) ----
+ ITAR_ENABLED=false
+ OFAC_API_KEY=
+ OFAC_CSV_PATH=
+ ORACLES_ENABLED=false
+ ORACLE_TIMEOUT_MS=2500
+ STORMGLASS_API_KEY=
+ SPACE_TRACK_USER=
+ SPACE_TRACK_PASSWORD=
+ ZK_ENABLED=false
+ VERIFIER_ADDRESS=
+ ZK_ARTIFACTS_DIR=./zkartifacts
```

> Le service accepte en repli les alias de la doc opérationnelle : `RPC_URL_SEPOLIA` →
> `BLOCKCHAIN_RPC_URL`, `CONTRACT_TOKEN_ADDRESS` → `CLRN_TOKEN_ADDRESS`,
> `CONTRACT_ENGINE_ADDRESS` → `COMPENSATION_ENGINE_ADDRESS`, `PRIVATE_KEY` →
> `BLOCKCHAIN_PRIVATE_KEY`.

### 2.6 `clearnet-backend/package.json` — `ethers` (satisfait au ^6.10.0)

```diff
  {
    "name": "clearnet-backend",
-   "version": "0.0.1",
+   "version": "1.2.0",
    "private": true,
    "engines": { "node": ">=18.0.0" },
    "dependencies": {
      "@nestjs/common": "^10.4.0",
      "@nestjs/config": "^3.2.0",
      "@nestjs/core": "^10.4.0",
      "@nestjs/jwt": "^10.2.0",
      "@nestjs/passport": "^10.0.3",
      "@nestjs/platform-express": "^10.4.0",
      "@nestjs/throttler": "^5.1.2",
      "bcryptjs": "^2.4.3",
      "class-transformer": "^0.5.1",
      "class-validator": "^0.14.1",
+     "ethers": "^6.13.0",     ← présent (satisfait le requis ^6.10.0)
      "neo4j-driver": "^5.8.0",
      "passport": "^0.7.0",
      "passport-jwt": "^4.0.1",
      "reflect-metadata": "^0.2.2",
      "rxjs": "^7.8.1",
+     "snarkjs": "^0.7.4"       ← Phase 2 (ZkProofService)
    },
    ...
```

> `ethers` était déjà une dépendance à l'installation V1.1 (`^6.13.0`) — aucun `npm install`
> supplémentaire n'est nécessaire ; la version installée satisfait le `^6.10.0` du cahier des charges.

---

## 3. Nouveaux fichiers — Backend (contenu intégral)

### 3.1 `clearnet-backend/src/blockchain/blockchain.constants.ts`

```ts
import type { InterfaceAbi } from 'ethers';

/**
 * Constantes du pont on-chain (v1.2) — valeurs par défaut / alinéas.
 */
export const BLOCKCHAIN_CONSTANTS = {
  DEFAULT_RPC_URL: 'https://ethereum-sepolia-rpc.publicnode.com',
  TOKEN_DECIMALS: 18,
  WAIT_BLOCKS: 5,
} as const;

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

/** ABI groupés (format attendu par BlockchainService). */
export const CONTRACT_ABIS = {
  Token: TOKEN_ABI,
  Engine: COMPENSATION_ENGINE_ABI,
} as const;
```

### 3.2 `clearnet-backend/src/blockchain/blockchain.types.ts`

```ts
export interface OnchainNetworkView {
  chainId?: string;
  name?: string;
  rpcUrl: string;
}

export interface BlockchainStatus {
  enabled: boolean;
  network?: OnchainNetworkView;
  signerAddress?: string;
  tokenAddress?: string;
  engineAddress?: string;
  zk: { required: boolean; verifier?: string; maxAmountWei?: string };
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
}

export interface ZkProofShape {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
}

export interface ZkSettlementPayload {
  fromEmail: string;
  toEmail: string;
  amount: number;
  maxAmount: number;
  proof?: ZkProofShape;
  publicSignals?: [string, string];
}

export class OnchainBridgeError extends Error {
  constructor(public readonly reason: string, public readonly details?: unknown) {
    super(reason);
    this.name = 'OnchainBridgeError';
  }
}
```

### 3.3 `clearnet-backend/src/blockchain/blockchain.service.ts` (contenu intégral)

```ts
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
 * Les helpers ERC20 (approve/getAllowance) sont des utilitaires génériques.
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
  private isInitialized = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly zkProofService: ZkProofService,
  ) {
    const legacy = this.configService.get<string>('BLOCKCHAIN_ENABLED', 'false') === 'true';
    const explicit = this.configService.get<string>('ONCHAIN_ENABLED', 'false') === 'true';
    this.config = {
      enabled: legacy || explicit,
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
    };
    if (!this.config.enabled) {
      this.logger.warn('Pont on-chain DÉSACTIVÉ — transactions hors-chaîne uniquement.');
    }
  }

  /** Initialisation asynchrone (cycle de vie Nest) : échoue doucement. */
  async onModuleInit() {
    if (!this.config.enabled) return;
    this.logger.log('Initialisation du pont on-chain…');
    try {
      this.provider = new JsonRpcProvider(this.config.rpcUrl);
      if (!this.config.privateKey) throw new Error('Aucune clé privée (BLOCKCHAIN_PRIVATE_KEY / PRIVATE_KEY)');
      const wallet = new Wallet(this.config.privateKey, this.provider);
      this.signer = wallet;
      const balance = await this.provider.getBalance(wallet.address);
      this.logger.log(`Wallet ${wallet.address} — solde ${formatEther(balance)} ETH`);
      if (balance === 0n) {
        this.warnings.push('Wallet à 0 ETH — alimentez le compte (faucet Sepolia) avant tout écriture.');
      }
      this.token = new Contract(this.config.tokenAddress, CONTRACT_ABIS.Token, wallet);
      this.engine = new Contract(this.config.engineAddress, CONTRACT_ABIS.Engine, wallet);
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

  isEnabled(): boolean { return this.config.enabled && this.isInitialized; }

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
      status.network = { chainId: network.chainId.toString(), name: network.name, rpcUrl: this.config.rpcUrl };
    } catch (error) { status.warnings = [...(status.warnings ?? []), `RPC injoignable: ${(error as Error).message}`]; return status; }
    status.signerAddress = this.signer?.address;
    if (this.token) status.tokenAddress = this.token.target?.toString();
    if (this.engine) status.engineAddress = this.engine.target?.toString();
    try {
      status.zk.required = Boolean(await this.engine?.zkRequired());
      status.zk.verifier = await this.engine?.zkbVerifier() as string | undefined;
      status.zk.maxAmountWei = (await this.engine?.maxAmount())?.toString();
    } catch (error) { status.warnings = [...(status.warnings ?? []), `lecture ZK échouée: ${(error as Error).message}`]; }
    return status;
  }

  // ============= TOKEN (CLRN / ERC20) =============

  async tokenBalanceOf(email: string): Promise<bigint> {
    if (!this.assertReady()) return 0n;
    return this.token!.balanceOf(this.addressFromEmail(email)) as Promise<bigint>;
  }

  async getTokenBalance(address: string): Promise<bigint> {
    this.checkEnabled();
    return this.token!.balanceOf(address) as Promise<bigint>;
  }

  async mintTo(to: string, amount: bigint): Promise<TransactionReceipt> {
    this.checkEnabled();
    const tx = await this.token!.mint(to, amount);
    const receipt = await tx.wait();
    return { hash: receipt?.hash ?? tx.hash, blockNumber: Number(receipt?.blockNumber ?? 0), status: Number(receipt?.status ?? 1), gasUsed: receipt?.gasUsed ?? 0n };
  }

  async getTokenInfo(): Promise<{ name: string; symbol: string; decimals: number; totalSupply: bigint }> {
    this.checkEnabled();
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      this.token!.name(), this.token!.symbol(), this.token!.decimals(), this.token!.totalSupply(),
    ]) as unknown as [string, string, number, bigint];
    return { name, symbol, decimals, totalSupply };
  }

  async approve(spender: string, amount: bigint): Promise<TransactionReceipt> {
    this.checkEnabled();
    const tx = await this.token!.approve(spender, amount);
    const receipt = await tx.wait();
    return { hash: receipt?.hash ?? tx.hash, blockNumber: Number(receipt?.blockNumber ?? 0), status: Number(receipt?.status ?? 1), gasUsed: receipt?.gasUsed ?? 0n };
  }

  async getAllowance(owner: string, spender: string): Promise<bigint> {
    this.checkEnabled();
    return this.token!.allowance(owner, spender) as Promise<bigint>;
  }

  // ============= ENGINE (netting) =============

  async getNetPosition(email: string): Promise<bigint> {
    if (!this.assertReady()) return 0n;
    return this.engine!.netPositions(this.addressFromEmail(email)) as Promise<bigint>;
  }

  async recordPositionChange(email: string, delta: number): Promise<PositionChangeResult> {
    if (!this.assertReady()) return { txHash: '', address: this.addressFromEmail(email), amountWei: 0n };
    const address = this.addressFromEmail(email);
    const wei = BigInt(Math.round(delta * 1e18));
    const tx = await this.engine!.updatePosition(address, wei);
    const receipt = await tx.wait();
    return { txHash: receipt!.hash, address, amountWei: wei, blockNumber: receipt!.blockNumber };
  }

  async settleCompensation(fromEmail: string, toEmail: string, amount: number): Promise<SettlementResult> {
    this.checkEnabled();
    const from = this.addressFromEmail(fromEmail);
    const to = this.addressFromEmail(toEmail);
    const wei = BigInt(Math.round(amount * 1e18));
    const tx = await this.engine!.settle(from, to, wei);
    const receipt = await tx.wait();
    return { txHash: receipt!.hash, from, to, amountWei: wei, blockNumber: receipt!.blockNumber };
  }

  async settleCompensationWithProof(payload: ZkSettlementPayload): Promise<SettlementResult> {
    this.checkEnabled();
    let proof = payload.proof;
    let signals = payload.publicSignals;
    if (!proof || !signals || signals.length !== 2) {
      const generated = await this.zkProofService.generateProof({
        sender: this.addressFromEmail(payload.fromEmail),
        receiver: this.addressFromEmail(payload.toEmail),
        amount: payload.amount,
        maxAmount: payload.maxAmount,
      });
      proof = generated.proof;
      signals = [generated.publicSignals.maxAmount, generated.publicSignals.hash];
    }
    const from = this.addressFromEmail(payload.fromEmail);
    const to = this.addressFromEmail(payload.toEmail);
    const wei = BigInt(Math.round(payload.amount * 1e18));
    const tx = await this.engine!.settleWithProof(from, to, wei, proof!.a, proof!.b, proof!.c, signals);
    const receipt = await tx.wait();
    return { txHash: receipt!.hash, from, to, amountWei: wei, blockNumber: receipt!.blockNumber };
  }

  async configureZk(verifier: string, required: boolean, maxAmount: number): Promise<string> {
    this.checkEnabled();
    const wei = BigInt(Math.round(maxAmount * 1e18));
    const tx = await this.engine!.setZkSettings(verifier, required, wei);
    const receipt = await tx.wait();
    return receipt!.hash;
  }

  // ============= UTILITAIRES =============

  getWalletAddress(): string { return this.signer?.address ?? ZeroAddress; }

  async getNetwork(): Promise<{ chainId: number; name: string }> {
    this.checkEnabled();
    const network = await this.provider!.getNetwork();
    return { chainId: Number(network.chainId), name: network.name || 'unknown' };
  }

  static weiToClrn(wei: bigint): string { return formatEther(wei); }

  private addressFromEmail(email: string): string {
    const hash = keccak256(toUtf8Bytes(email.trim().toLowerCase()));
    return getAddress(`0x${hash.slice(-40)}`);
  }

  private assertReady(): boolean {
    return this.isInitialized && Boolean(this.provider && this.signer && this.token && this.engine);
  }

  private checkEnabled() {
    if (!this.config.enabled) throw new OnchainBridgeError('disabled', 'ONCHAIN_ENABLED=false');
    if (!this.assertReady()) {
      const reason = this.warnings[this.warnings.length - 1] ?? 'configuration incomplète';
      throw new OnchainBridgeError('not-initialized', reason);
    }
  }
}
```

### 3.4 `clearnet-backend/src/blockchain/blockchain.controller.ts`

```ts
import { Controller, Get } from '@nestjs/common';
import { BlockchainService } from './blockchain.service';

@Controller('blockchain')
export class BlockchainController {
  constructor(private readonly blockchainService: BlockchainService) {}

  @Get('status')
  status() {
    return this.blockchainService.getStatus();
  }
}
```

---

## 4. Scripts de déploiement (clearnet-blockchain)

### 4.1 `scripts/deploy-sepolia.ts` — diffs / extrait clé

- Ajout : vérification du solde de gas (rejet < 0.05 ETH)
- Ajout : affichage des variables à reporter dans le backend
- Ajout : accepte `PRIVATE_KEY` comme alias de `SEPOLIA_PRIVATE_KEY` (documentation opérationnelle)
- Strictement le même rendu `deployments/sepolia.json` qu'avant (rétrocompat)

```diff
   const [deployer] = await ethers.getSigners();
   console.log('Déployeur (Sepolia) :', deployer.address);
+  const privateKey = process.env.SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY;
+  if (!process.env.SEPOLIA_RPC_URL || !privateKey) throw new Error('SEPOLIA_RPC_URL et clé requis (.env)');
+  const balance = await ethers.provider.getBalance(deployer.address);
+  console.log('Solde :', ethers.formatEther(balance));
+  if (balance < ethers.parseEther('0.05')) throw new Error('Solde insuffisant (faucet)');
@@
   const output = { chainId, network: 'sepolia', clearNetToken, compensationEngine, deployer, deployedAt };
   fs.writeFileSync(path.join(dir, 'sepolia.json'), JSON.stringify(output, null, 2));
+  console.log('Backend : CLRN_TOKEN_ADDRESS=' + tokenAddress);
+  console.log('Backend : COMPENSATION_ENGINE_ADDRESS=' + engineAddress);
```

### 4.2 `scripts/verify-sepolia.ts` — inchangé (vérification Etherscan des deux contrats, lecture de `deployments/sepolia.json`).

### 4.3 `scripts/validate-sepolia.ts` — NOUVEAU (validation de bout en bout)

```ts
import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const DEMO = { alice: 'alice@clearnet.io', bob: 'bob@clearnet.io' };
const AMOUNT_CLRN = 500;

function addressFromEmail(email: string): string {
  const hash = ethers.keccak256(ethers.toUtf8Bytes(email.trim().toLowerCase()));
  return ethers.getAddress(`0x${hash.slice(-40)}`);
}

async function main() {
  const deploymentsPath = path.join(__dirname, '..', 'deployments', 'sepolia.json');
  if (!fs.existsSync(deploymentsPath)) throw new Error('deployments/sepolia.json introuvable');
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8')) as {
    clearNetToken: string; compensationEngine: string; deployer: string;
  };
  const [deployer] = await ethers.getSigners();
  if (deployer.address.toLowerCase() !== deployments.deployer.toLowerCase())
    throw new Error('Signer != déployeur — utilisez la clé de déploiement');

  const token = await ethers.getContractAt('ClearNetToken', deployments.clearNetToken);
  const engine = await ethers.getContractAt('CompensationEngine', deployments.compensationEngine);
  const alice = addressFromEmail(DEMO.alice);
  const bob = addressFromEmail(DEMO.bob);

  await (await token.mint(alice, ethers.parseEther(String(AMOUNT_CLRN)))).wait();
  await (await token.mint(bob, ethers.parseEther(String(AMOUNT_CLRN)))).wait();
  await (await engine.updatePosition(alice, ethers.parseEther(`+${AMOUNT_CLRN}`))).wait();
  await (await engine.updatePosition(bob, ethers.parseEther(`-${AMOUNT_CLRN}`))).wait();
  await (await engine.settle(alice, bob, ethers.parseEther(String(AMOUNT_CLRN)))).wait();

  const netA = await engine.netPositions(alice);
  const netB = await engine.netPositions(bob);
  console.log('Positions après règlement : Alice', ethers.formatEther(netA), '/ Bob', ethers.formatEther(netB));
  if (netA !== 0n || netB !== 0n) throw new Error('netting incomplet');
  console.log('✔ Validation de bout en bout réussie (0/0)');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
```

### 4.4 `clearnet-blockchain/package.json` — scripts ajoutés

```diff
   "deploy:local": "hardhat run scripts/deploy.ts --network localhost",
+  "deploy:sepolia": "hardhat run scripts/deploy-sepolia.ts --network sepolia",
+  "verify:sepolia": "hardhat run scripts/verify-sepolia.ts --network sepolia",
+  "validate:sepolia": "hardhat run scripts/validate-sepolia.ts --network sepolia",
```

### 4.5 `clearnet-blockchain/.env.example` — inchangé (déjà complet : SEPOLIA_RPC_URL / SEPOLIA_PRIVATE_KEY / ETHERSCAN_API_KEY).

---

## 5. Corrections de cohérence ZK on-chain (nécessaires au pont)

Trois fichiers ajustés pour que `settleWithProof` fonctionne réellement contre le
vérificateur généré par snarkjs (2 signaux publics) :

### 5.1 `contracts/interfaces/IZkVerifier.sol` — input `[1]` → `[2]`

```diff
     function verifyProof(
         uint256[2] memory a,
         uint256[2][2] memory b,
         uint256[2] memory c,
-        uint256[1] memory input
+        uint256[2] memory input   // [maxAmount, commitment] — ordre du circuit
     ) external view returns (bool);
```

### 5.2 `contracts/CompensationEngine.sol` — `settleWithProof` input `[2]`

```diff
     function settleWithProof(
         address from, address to, uint256 amount,
         uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c,
-        uint256[1] calldata input
+        uint256[2] calldata input
     ) external onlyAdmin {
```

### 5.3 `clearnet-backend/src/zkproof/zkproof.service.ts` — ordre des signaux

Le portefeuille public du circuit est `[maxAmount, commitment]` ; l'ABI et les appels
on/off-chain sont alignés :

```diff
- const VERIFIER_ABI = [ 'function verifyProof(uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[1] memory input) ...' ];
+ const VERIFIER_ABI = [ 'function verifyProof(uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[2] memory input) ...' ];
@@
- publicSignals: { hash: toDec(publicSignals[0]), maxAmount: toDec(publicSignals[1]) },
+ publicSignals: { maxAmount: toDec(publicSignals[0]), hash: toDec(publicSignals[1]) },
@@  // on-chain
- [proof.publicSignals.hash],
+ [proof.publicSignals.maxAmount, proof.publicSignals.hash],
@@  // off-chain
- [proof.publicSignals.hash, proof.publicSignals.maxAmount],
+ [proof.publicSignals.maxAmount, proof.publicSignals.hash],
```

> Échelle du circuit : inchangé — les montants du circuit restent en micro-CLRN (×1e6)
> comme en Phase 2 ; le ledger on-chain reste en wei (×1e18). Discordance documentée (§6
> de PONT_SEPOLIA_DEPLOYMENT.md), acceptable pour le gate MVP de testnet.

---

## 6. Documentation opérationnelle

- **`PONT_SEPOLIA_DEPLOYMENT.md`** (racine du dépôt) : prérequis (Node 20+, Hardhat, Alchemy/
  Infura, wallet test + faucet, clé Etherscan), déploiement (`cp .env.example .env` puis
  `npx hardhat run scripts/deploy-sepolia.ts --network sepolia`), vérification Etherscan,
  activation backend, validation bout-en-bout, gate ZK, rollback, registre.

Résumé du flux de validation (Sepolia) :

```bash
cd clearnet-blockchain
npm run deploy:sepolia      # → deployments/sepolia.json
npm run verify:sepolia      # Etherscan
npm run validate:sepolia    # mint → positions → settle → contrôle 0/0
# backend
ONCHAIN_ENABLED=true + adresses + clé admin dans clearnet-backend/.env
curl localhost:3000/api/blockchain/status   # enabled: true, chainId 11155111
```

Flux de règlement (transactions) : `POST /api/transactions` → nœud Transaction créé →
`settleCompensation(fromEmail, toEmail, amount)` fire-and-forget → `onchainHash` +
`onchainStatus: SUCCESS` (ou `FAILED` + `onchainError`) écrits sur le nœud.

---

## 7. Validation locale (exécutée)

- `npm run build` (backend) — TS OK (service fusionné : `OnModuleInit` + méthodes ERC20 +
  `checkEnabled` ; transactions : fire-and-forget)
- `npx jest --runInBand` — 11/11
- `npx hardhat compile` — 9 fichiers Solidity OK (IZkVerifier et CompensationEngine input[2])
- Déploiement réel Sepolia : **à exécuter avec vos clés** (aucune clé/faucet n'est
  fournie par défaut — procédure complète dans PONT_SEPOLIA_DEPLOYMENT.md)

---

_Fin du livrable PONT_SEPOLIA_RESPONSE.md._