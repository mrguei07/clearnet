import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ComplianceService } from '../compliance.service';

/**
 * Guard OFAC : l'utilisateur courant ne doit pas figurer sur la liste des
 * sanctions. No-op tant que ITAR_ENABLED != true.
 */
@Injectable()
export class OfacGuard implements CanActivate {
  constructor(private readonly compliance: ComplianceService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.compliance.isEnabled()) return true;
    const request = context.switchToHttp().getRequest<{ user?: { name?: string; email?: string } }>();
    const user = request.user;
    if (!user) throw new UnauthorizedException('Non authentifié');
    const report = await this.compliance.screenOfac(user.name ?? user.email ?? '');
    if (report.sanctioned) {
      throw new UnauthorizedException('OFAC: entité sous sanction');
    }
    return true;
  }
}