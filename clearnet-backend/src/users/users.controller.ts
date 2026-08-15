import { Controller, Get, UseGuards } from '@nestjs/common';
import { UsersService, UserRecord } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(
    @CurrentUser() user: { userId: string; email: string },
  ): Promise<Omit<UserRecord, 'passwordHash'>> {
    const record = await this.usersService.findById(user.userId);
    const { passwordHash: _ignored, ...safe } = record ?? {};
    return safe as Omit<UserRecord, 'passwordHash'>;
  }

  /** ROI ClearNet (V1.3) : capital immobilisé &gt; 30 j, montants compensés, économie potentielle. */
  @Get('roi')
  @UseGuards(JwtAuthGuard)
  roi(@CurrentUser() user: { userId: string; email: string }) {
    return this.usersService.computeRoi(user.email);
  }
}
