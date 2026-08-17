import {
  BadRequestException,
  Controller,
  Headers,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import Stripe from 'stripe';
import { BillingService } from '../billing.service';
import { StripeIpGuard } from '../../common/guards/stripe-ip.guard';
import { tierFromPrice } from '../pricing';

/**
 * Endpoint public mais protégé par :
 *  1. StripeIpGuard (angle mort 3.5 — IP allowlist, fail-closed) ;
 *  2. la vérification de signature Stripe : constructEvent(rawBody, sig, secret).
 *
 * Événements gérés : customer.subscription.created / .updated / .deleted.
 * Le body brut est requis : NestFactory.create(AppModule, { rawBody: true })
 * dans main.ts.
 */
@Controller('webhooks')
@UseGuards(StripeIpGuard)
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly billing: BillingService,
  ) {}

  @Post('stripe')
  async handle(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') sig: string) {
    if (this.config.get<string>('BILLING_ENABLED') !== 'true') {
      throw new BadRequestException('billing disabled');
    }
    const key = this.config.get<string>('STRIPE_SECRET_KEY', '');
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET', '');
    if (!key || !secret || !sig) throw new BadRequestException('missing stripe config');
    const stripe = new Stripe(key, { apiVersion: '2024-06-20' as any });

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody as Buffer, sig, secret);
    } catch (err) {
      throw new BadRequestException(`invalid signature: ${(err as Error).message}`);
    }

    if (event.type.startsWith('customer.subscription.')) {
      const sub = event.data.object as Stripe.Subscription;
      const tier =
        event.type === 'customer.subscription.deleted'
          ? 'FREE'
          : tierFromPrice(sub.items?.data?.[0]?.price, this.config);

      const customerEmail = await this.resolveCustomerEmail(stripe, sub);
      if (!customerEmail) {
        this.logger.warn(`webhook ${event.id} : email client introuvable — tier non appliqué`);
        return { received: true };
      }
      await this.billing.applySubscription({
        customerEmail: customerEmail.toLowerCase(),
        customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
        tier,
      });
    }
    return { received: true };
  }

  /**
   * L'email arrive via sub.metadata.email (posé par createCheckout) ; en repli,
   * remontée au customer Stripe (1 appel API — le cas nominal des imports).
   */
  private async resolveCustomerEmail(
    stripe: Stripe,
    sub: Stripe.Subscription,
  ): Promise<string | null> {
    const fromMetadata = String(sub.metadata?.email ?? '').trim();
    if (fromMetadata) return fromMetadata;
    try {
      const customer = await stripe.customers.retrieve(
        typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      );
      if ('deleted' in customer || !customer.email) return null;
      return customer.email;
    } catch {
      return null;
    }
  }
}