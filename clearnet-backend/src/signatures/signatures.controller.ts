import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { SignaturesService } from './signatures.service';

/**
 * V1.4 Axe 4 - Approbation des soumissions multisig (ledger 2FA).
 * JWT + rôle admin ; 503 si MULTISIG_ENABLED !== 'true'.
 */
@Controller('signatures')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
export class SignaturesController {
  constructor(private readonly signaturesService: SignaturesService) {}

  /** Crée une demande d'approbation pour une soumission multisig. */
  @Post('request')
  request(@Body() body: { txId: string; fromEmail: string; dataDescription: string }) {
    return this.signaturesService.request(body.txId, body.fromEmail, body.dataDescription);
  }

  /** Approuve avec l'OTP (transmis hors bande). */
  @Post(':id/approve')
  approve(
    @Param('id') id: string,
    @Body() body: { otp: string },
    @Body('by') by?: string,
  ) {
    return this.signaturesService.approve(id, body.otp, by || 'admin');
  }

  /** Demandes en attente (dashboard ops). */
  @Get('pending')
  pending() {
    return this.signaturesService.pending();
  }
}