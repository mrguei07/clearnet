import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ZkProofService } from './zkproof.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * Accès audit aux preuves ZK (V1.3) :
 * GET /api/zkproof/download/:txId — rapport de preuve pour une transaction.
 * Protégé par JWT ; le rapport ne contient aucun secret.
 */
@Controller('zkproof')
@UseGuards(JwtAuthGuard)
export class ZkProofController {
  constructor(private readonly zkProofService: ZkProofService) {}

  @Get('download/:txId')
  download(@Param('txId') txId: string) {
    return this.zkProofService.getProofReport(txId);
  }
}
