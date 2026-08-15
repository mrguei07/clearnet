import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { StripeWebhookController } from './webhooks/stripe.webhook.controller';

/**
 * V1.4 Axe 2 — Facturation Stripe (freemium → Pro → Enterprise).
 * Règle d'or : quand BILLING_ENABLED !== 'true', les contrôleurs ne sont pas
 * montés (routes 404) ; BillingService reste injectable mais inopérant
 * (assertEnabled → 503). Le Neo4j driver vient de Neo4jModule (@Global).
 */
const billingEnabled = process.env.BILLING_ENABLED === 'true';

@Module({
  imports: [ConfigModule],
  controllers: billingEnabled ? [BillingController, StripeWebhookController] : [],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}