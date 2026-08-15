import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ComplianceService } from '../compliance.service';

/**
 * Guard ITAR : si le secteur de l'utilisateur est Défense ou Spatial, son pays
 * doit être autorisé (US/FR/UK/DE/IT/JP/AU). No-op tant que ITAR_ENABLED != true.
 */
@Injectable()
export class ItarGuard implements CanActivate {
  constructor(private readonly compliance: ComplianceService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.compliance.isEnabled()) return true;
    const request = context.switchToHttp().getRequest<{ user?: { name?: string; industry?: string | null; country?: string | null } }>();
    const user = request.user;
    if (!user) throw new UnauthorizedException('Non authentifié');
    if (!this.compliance.isItarAllowed(user.industry ?? null, user.country ?? null)) {
      throw new UnauthorizedException(
        `ITAR: secteur ${user.industry} restreint — pays ${user.country ?? 'inconnu'} non autorisé`,
      );
    }
    return true;
  }
}