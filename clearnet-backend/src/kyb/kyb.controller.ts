import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { KybService, KybStatusReport } from './kyb.service';

/** KYB — statut de conformité de l'entreprise (N0-N3). */
@Controller('kyb')
export class KybController {
  constructor(private readonly kybService: KybService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  status(@CurrentUser() user: CurrentUserPayload): Promise<KybStatusReport> {
    return this.kybService.getStatus(user.email);
  }
}
