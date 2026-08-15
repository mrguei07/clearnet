import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guard d'API interne de démo : exige l'en-tête `X-Demo-Key`.
 * Clé lue depuis DEMO_API_KEY (défaut dev non sécurisé, à remplacer en prod).
 */
@Injectable()
export class DemoApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const expected = this.config.get<string>('DEMO_API_KEY', 'demo-secret-change-me');
    const provided = request.headers['x-demo-key'] as string | undefined;
    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Clé de démo invalide');
    }
    return true;
  }
}
