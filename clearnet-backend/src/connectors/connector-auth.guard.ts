import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Garde machine-to-machine du Gateway connecteurs ERP.
 * En-tête `x-api-key` comparé à `DEMO_API_KEY` (règle d'or : vide = verrouillé).
 */
@Injectable()
export class ConnectorAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('DEMO_API_KEY', '');
    if (!expected) {
      throw new UnauthorizedException('Gateway connecteurs désactivé (DEMO_API_KEY absent)');
    }
    const request = context.switchToHttp().getRequest();
    const key = request.headers['x-api-key'];
    if (key !== expected) {
      throw new UnauthorizedException('Clé API connecteur invalide');
    }
    return true;
  }
}
