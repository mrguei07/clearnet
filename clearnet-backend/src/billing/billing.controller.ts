import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { BillingService } from './billing.service';
import { isPaidTier, SubscriptionTier } from './pricing';

/**
 * V1.5 Pricing — Facturation : routes JWT-only (checkout hébergé + statut).
 * Les deux routes lèvent 503 via BillingService.assertEnabled si
 * BILLING_ENABLED !== 'true' (règle d'or : off par défaut).
 */
@Controller('billing')
@UseGuards(AuthGuard('jwt'))
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /**
   * POST /api/billing/create-checkout { "tier": "ESSENTIAL" | "PRO" | "ENTERPRISE" }
   * Niveau optionnel (défaut PRO, rétrocompatibilité). Les tiers Free n'ont
   * pas de checkout (aucun paiement).
   */
  @Post('create-checkout')
  async checkout(@Req() req: Request, @Body() body: { tier?: string }) {
    const tier: SubscriptionTier = (body?.tier ?? 'PRO').toUpperCase() as SubscriptionTier;
    if (!isPaidTier(tier)) {
      throw new BadRequestException(`tier invalide : ${body?.tier ?? ''}`);
    }
    return this.billing.createCheckout((req.user as any).email, tier);
  }

  @Get('status')
  async status(@Req() req: Request) {
    return this.billing.status((req.user as any).email);
  }
}