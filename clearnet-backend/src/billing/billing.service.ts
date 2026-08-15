import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NEO4J_DRIVER } from '../neo4j/neo4j.module';
import Stripe from 'stripe';
import type { Driver } from 'neo4j-driver';

export type SubscriptionTier = 'FREE' | 'PRO' | 'ENTERPRISE';

/**
 * V1.4 Axe 2 — Facturation Stripe (freemium → Pro → Enterprise).
 *
 * Règle d'or (V1.3 conservée) : `BILLING_ENABLED !== 'true'` → BillingService
 * instancié mais inopérant (`assertEnabled` lève 503) ; le flux transactions
 * V1.3 ne change pas (la garde de quota est un no-op strict).
 *
 * Stockage : `subscriptionTier` et `stripeCustomer` sur le nœud User (Neo4j) —
 * aucun index ni contrainte ajoutés (rétrocompatibilité des requêtes V1.3).
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe | null;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    @Inject(NEO4J_DRIVER) private readonly driver: Driver,
  ) {
    this.enabled = this.config.get<string>('BILLING_ENABLED') === 'true';
    const key = this.config.get<string>('STRIPE_SECRET_KEY', '');
    this.stripe = this.enabled && key ? new Stripe(key, { apiVersion: '2024-06-20' as any }) : null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  assertEnabled(): void {
    if (!this.enabled || !this.stripe) {
      throw new ServiceUnavailableException('billing disabled');
    }
  }

  /** Checkout hébergé Stripe (mode subscription, aucune donnée PCI côté ClearNet). */
  async createCheckout(email: string): Promise<{ url: string }> {
    this.assertEnabled();
    const session = await this.stripe!.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: [
        { price: this.config.get<string>('STRIPE_PRICE_PRO', 'price_pro_default'), quantity: 1 },
      ],
      success_url: this.config.get<string>('BILLING_SUCCESS_URL', 'clearnet://billing?ok=1'),
      cancel_url: this.config.get<string>('BILLING_CANCEL_URL', 'clearnet://billing'),
      metadata: { source: 'clearnet-backend', email },
    });
    return { url: session.url ?? '' };
  }

  async status(email: string): Promise<{
    tier: SubscriptionTier;
    customerId: string | null;
    quotaUsed: number;
    quotaMax: number;
  }> {
    this.assertEnabled();
    const session = this.driver.session();
    try {
      const res = await session.run(
        `MATCH (u:User {email: $email})
         RETURN coalesce(u.subscriptionTier, 'FREE') AS tier,
                u.stripeCustomer AS customer`,
        { email },
      );
      const tier: SubscriptionTier = res.records[0]?.get('tier') ?? 'FREE';
      const quotaMax =
        tier === 'FREE'
          ? Number(this.config.get<string>('BILLING_FREE_QUOTA', '10'))
          : Number(this.config.get<string>('BILLING_ENTERPRISE_QUOTA', '0')) || Infinity;
      const used = tier === 'FREE' ? await this.countMonth(email) : 0;
      return { tier, customerId: res.records[0]?.get('customer') ?? null, quotaUsed: used, quotaMax };
    } finally {
      await session.close();
    }
  }

  /** Quota mensuel (mois civil UTC — aligné sur la facturation Stripe). */
  async countMonth(email: string): Promise<number> {
    const session = this.driver.session();
    try {
      const start = new Date();
      start.setUTCDate(1);
      start.setUTCHours(0, 0, 0, 0);
      const res = await session.run(
        `MATCH (u:User {email: $email})-[:SENT]->(t:Transaction)
         WHERE t.createdAt >= $start
         RETURN count(t) AS n`,
        { email, start: start.toISOString() },
      );
      return res.records[0]?.get('n')?.toNumber?.() ?? 0;
    } finally {
      await session.close();
    }
  }

  /**
   * Applique le changement de tier propagé par le webhook Stripe.
   * Idempotent : un événement rejoué (livraisons Stripe) ne casse pas.
   */
  async applySubscription(payload: {
    customerEmail: string;
    customerId: string;
    tier: SubscriptionTier;
  }): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `MATCH (u:User {email: $email})
         SET u.subscriptionTier = $tier, u.stripeCustomer = $customer`,
        {
          email: payload.customerEmail,
          tier: payload.tier,
          customer: payload.customerId,
        },
      );
      this.logger.log(`tier ${payload.tier} -> ${payload.customerEmail}`);
    } finally {
      await session.close();
    }
  }
}