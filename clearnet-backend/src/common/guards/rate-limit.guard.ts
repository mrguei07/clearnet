import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';

/**
 * Guard global de rate-limiting basé sur @nestjs/throttler 5.x.
 * Limite globale : THROTTLE_TTL / THROTTLE_LIMIT (défauts dev : 60 s / 100 req).
 * Les endpoints sensibles (auth) surchargent via @Throttle.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected async throwThrottlingException(): Promise<void> {
    throw new ThrottlerException('Trop de requêtes. Réessayez dans quelques instants.');
  }
}
