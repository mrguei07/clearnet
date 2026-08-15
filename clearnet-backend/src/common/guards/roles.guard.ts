import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

/**
 * V1.4 Axe 1 - Garde de rôles.
 * Le payload JWT V1.3 ({sub, email}) n'est pas modifié : le rôle 'admin' est
 * dérivé de l'appartenance à ADMIN_EMAILS (liste CSV dans l'environnement,
 * vide = aucun admin = garde inopérante). Règle d'or : off par défaut.
 */
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const admins = (this.config.get<string>('ADMIN_EMAILS', '') || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (admins.length === 0) {
      throw new ForbiddenException('admin feature disabled');
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user?.email || !admins.includes(String(user.email).toLowerCase())) {
      throw new ForbiddenException('insufficient role');
    }
    return true;
  }
}