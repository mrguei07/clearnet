import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { BlockchainService } from './blockchain.service';
import { DemoApiKeyGuard } from '../common/guards/demo-api-key.guard';

/**
 * Diagnostic du pont on-chain (lecture seule, aucun secret exposé).
 * Disponible même si le pont est désactivé (répond { enabled: false }).
 *
 * Utilitaires de staging/testnet (V1.3, industrialisation) :
 *  - POST /api/blockchain/mint        : mint CLRN + position nette (+amount) —
 *    exclusivement pour les tests E2E/démos, protégé par X-Demo-Key (clé vide
 *    en production = 401 systématique).
 *  - GET /api/blockchain/position/:email : position nette (wei + CLRN) —
 *    même protection ; aucun secret exposé.
 */
@Controller('blockchain')
export class BlockchainController {
  constructor(private readonly blockchainService: BlockchainService) {}

  @Get('status')
  status() {
    return this.blockchainService.getStatus();
  }

  @Post('mint')
  @UseGuards(DemoApiKeyGuard)
  async mint(@Body() body: { email?: string; amount?: number }) {
    if (!body.email || !body.amount || body.amount <= 0) {
      throw new HttpException('email et montant (positif) requis', HttpStatus.BAD_REQUEST);
    }
    if (!this.blockchainService.isEnabled()) {
      throw new HttpException('Pont on-chain désactivé (ONCHAIN_ENABLED=false)', HttpStatus.SERVICE_UNAVAILABLE);
    }
    try {
      const wei = BigInt(Math.round(body.amount * 1e18));
      const tokenReceipt = await this.blockchainService.mintTo(body.email, wei);
      const position = await this.blockchainService.recordPositionChange(body.email, body.amount);
      return {
        email: body.email,
        amount: body.amount,
        tokenTxHash: tokenReceipt.hash,
        positionTxHash: position.txHash,
      };
    } catch (error) {
      throw new HttpException(`Mint échoué : ${(error as Error).message}`, HttpStatus.BAD_GATEWAY);
    }
  }

  @Get('position/:email')
  @UseGuards(DemoApiKeyGuard)
  async position(@Param('email') email: string) {
    if (!this.blockchainService.isEnabled()) {
      throw new HttpException('Pont on-chain désactivé (ONCHAIN_ENABLED=false)', HttpStatus.SERVICE_UNAVAILABLE);
    }
    try {
      const wei = await this.blockchainService.getNetPosition(email);
      return {
        email,
        positionWei: wei.toString(),
        positionClrn: BlockchainService.weiToClrn(wei),
      };
    } catch (error) {
      throw new HttpException(`Lecture de position échouée : ${(error as Error).message}`, HttpStatus.BAD_GATEWAY);
    }
  }
}
