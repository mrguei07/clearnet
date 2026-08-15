import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { BillingService } from './billing.service';

/**
 * V1.4 Axe 2 — Facturation : routes JWT-only (checkout hébergé + statut).
 * Les deux routes lèvent 503 via BillingService.assertEnabled si
 * BILLING_ENABLED !== 'true' (règle d'or : off par défaut).
 */
@Controller('billing')
@UseGuards(AuthGuard('jwt'))
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('create-checkout')
  async checkout(@Req() req: Request) {
    return this.billing.createCheckout((req.user as any).email);
  }

  @Get('status')
  async status(@Req() req: Request) {
    return this.billing.status((req.user as any).email);
  }
}