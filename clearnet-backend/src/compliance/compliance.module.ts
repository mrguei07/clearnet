import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { ComplianceService } from './compliance.service';
import { ItarGuard } from './guards/itar.guard';
import { OfacGuard } from './guards/ofac.guard';

@Module({
  imports: [UsersModule],
  providers: [ComplianceService, ItarGuard, OfacGuard],
  exports: [ComplianceService, ItarGuard, OfacGuard],
})
export class ComplianceModule {}