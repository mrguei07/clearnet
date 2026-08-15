import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { Gauge, Registry } from 'prom-client';
import { JsonRpcProvider } from 'ethers';
import { METRICS_REGISTRY } from '../metrics/metrics.constants';

/**
 * V1.4 Angles morts 3.4 - Métriques on-chain.
 * Poll du solde ETH du multisig (gas de règlement) toutes les
 * METRICS_POLL_BALANCE_MS (défaut 300000 ms soit 5 min) :
 *   gauge clearnet_multisig_eth_balance (ETH, alerte < 0.05 en annexe E.6).
 * Règle d'or : inactif si METRICS_ENABLED !== true, si MULTISIG_ADDRESS est vide
 * ou si aucun RPC n'est configuré (aucune dépendance à l'état du pont).
 */
@Injectable()
export class OnchainMetrics implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OnchainMetrics.name);
  private provider?: JsonRpcProvider;
  private gauge?: Gauge;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService,
    @Inject(METRICS_REGISTRY) private readonly registry: Registry,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get<string>('METRICS_ENABLED') !== 'true') return;
    const address = this.config.get<string>('MULTISIG_ADDRESS', '');
    const rpcUrl =
      this.config.get<string>('BLOCKCHAIN_RPC_URL', '') ||
      this.config.get<string>('RPC_URL_SEPOLIA', '');
    if (!address || !rpcUrl) return;

    this.provider = new JsonRpcProvider(rpcUrl);
    this.gauge = new Gauge({
      name: 'clearnet_multisig_eth_balance',
      help: 'Solde ETH du multisig (gas des règlements)',
      registers: [this.registry],
    });

    const intervalMs = Number(this.config.get<string>('METRICS_POLL_BALANCE_MS', '300000'));
    this.timer = setInterval(() => void this.poll(address), intervalMs);
  }

  private async poll(address: string): Promise<void> {
    try {
      const balance = await this.provider!.getBalance(address);
      this.gauge!.set(Number(balance) / 1e18);
    } catch (error) {
      this.logger.debug(`balance poll failed: ${(error as Error).message}`);
    }
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}