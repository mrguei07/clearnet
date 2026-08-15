import { ForbiddenException, Injectable } from '@nestjs/common';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Angle mort 3.5 — Liste blanche d'IP des webhooks Stripe (fail-closed).
 *
 * Source officielle : https://stripe.com/files/ips/ips_webhooks.json (cache 24 h),
 * enrichie par la liste statique STRIPE_WEBHOOK_IPS (CSV, env) qui fait aussi
 * office de repli si la source distante est injoignable.
 * - En développement (NODE_ENV !== 'production') : loopback accepté
 *   (stripe listen --forward-to) ;
 * - aucune liste configurable → ForbiddenException (règle d'or : fail-closed).
 */
@Injectable()
export class StripeIpGuard implements CanActivate {
  private cached: string[] | null = null;
  private cachedAt = 0;

  constructor(private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const env = this.config.get<string>('NODE_ENV', 'development');
    const req = context.switchToHttp().getRequest();
    const ip = String(req.ip ?? '').replace(/^::ffff:/, '');
    if (env !== 'production' && (ip === '127.0.0.1' || ip === '::1')) return true;

    const staticList = (this.config.get<string>('STRIPE_WEBHOOK_IPS', '') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (Date.now() - this.cachedAt > 24 * 3_600_000) {
      try {
        const res = await fetch('https://stripe.com/files/ips/ips_webhooks.json');
        const data = (await res.json()) as { webhooks?: string[] };
        this.cached = (data.webhooks ?? []).map((range) => range.split('/')[0]);
        this.cachedAt = Date.now();
      } catch {
        /* repli statique */
      }
    }
    const allowed = new Set([...staticList, ...(this.cached ?? [])]);
    if (allowed.size === 0) throw new ForbiddenException('stripe ips not configured');
    if (!allowed.has(ip)) throw new ForbiddenException('ip not allowed');
    return true;
  }
}