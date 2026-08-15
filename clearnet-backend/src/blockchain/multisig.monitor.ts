import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { Gauge, Registry } from 'prom-client';
import { Contract, JsonRpcProvider } from 'ethers';
import { METRICS_REGISTRY } from '../metrics/metrics.constants';
import { MULTISIG_ABI } from './blockchain.constants';

/**
 * V1.4 Angles morts 3.1 - Surveillance des soumissions multisig bloquées.
 * Poll toutes les 15 min (cron interne) : toute transaction soumise au
 * MultiSigWallet et non exécutée depuis plus de MULTISIG_PENDING_MAX_MS
 * (défaut 14400000 ms soit 4 h) déclenche :
 *   - gauge clearnet_multisig_pending_tx_seconds (âge de la plus ancienne),
 *   - notification Slack via SLACK_WEBHOOK_URL (V1.3, non bloquante).
 * Règle d'or : inactif si MULTISIG_ENABLED !== true, si MULTISIG_ADDRESS est
 * vide ou si aucun RPC n'est configuré.
 */
@Injectable()
export class MultisigMonitor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MultisigMonitor.name);
  private provider?: JsonRpcProvider;
  private multisig?: Contract;
  private gauge?: Gauge;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService,
    @Inject(METRICS_REGISTRY) private readonly registry: Registry,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get<string>('MULTISIG_ENABLED') !== 'true') return;
    const address = this.config.get<string>('MULTISIG_ADDRESS', '');
    const rpcUrl =
      this.config.get<string>('BLOCKCHAIN_RPC_URL', '') ||
      this.config.get<string>('RPC_URL_SEPOLIA', '');
    if (!address || !rpcUrl) return;

    this.provider = new JsonRpcProvider(rpcUrl);
    this.multisig = new Contract(address, MULTISIG_ABI, this.provider);

    if (this.config.get<string>('METRICS_ENABLED') === 'true') {
      this.gauge = new Gauge({
        name: 'clearnet_multisig_pending_tx_seconds',
        help: 'Âge (s) de la plus ancienne soumission multisig non exécutée',
        registers: [this.registry],
      });
    }

    this.timer = setInterval(() => void this.check(), 15 * 60_000);
  }

  private async check(): Promise<void> {
    try {
      const count = Number(await this.multisig!.transactionCount());
      let oldest: { id: number; ageSec: number } | null = null;
      for (let i = 0; i < count; i++) {
        const t = await this.multisig!.transactions(i);
        if (t.executed) continue;
        const ageSec = Date.now() / 1000 - Number(t.timestamp);
        if (!oldest || ageSec > oldest.ageSec) oldest = { id: i, ageSec };
      }
      this.gauge?.set(oldest?.ageSec ?? 0);

      const maxMs = Number(this.config.get<string>('MULTISIG_PENDING_MAX_MS', '14400000'));
      if (oldest && oldest.ageSec > maxMs / 1000) {
        this.logger.warn(
          `multisig tx #${oldest.id} non confirmée depuis ${Math.round(oldest.ageSec / 3600)} h`,
        );
        await this.notifySlack(oldest);
      }
    } catch (error) {
      /* Réseau indisponible : dégradation douce (prochain poll) */
      this.logger.debug(`multisig monitor check failed: ${(error as Error).message}`);
    }
  }

  private async notifySlack(t: { id: number; ageSec: number }): Promise<void> {
    const url = this.config.get<string>('SLACK_WEBHOOK_URL', '');
    if (!url) return;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: `⚠️ ClearNet : soumission multisig #${t.id} non confirmée depuis ${Math.round(t.ageSec / 3600)} h — vérifier owners 2/3.`,
        }),
      });
    } catch {
      /* Slack indisponible : silencieux */
    }
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}