import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingService } from './billing.service';
import { NEO4J_DRIVER } from '../neo4j/neo4j.module';
import { isPaidTier, priceIdForTier, quotaForTier, tierFromPrice, upgradeMessage } from './pricing';

/** Stub ConfigService minimal (isolation des tests — aucune variable d'env requise). */
function configStub(values: Record<string, string> = {}): ConfigService {
  return {
    get: <T>(key: string, def?: T) => (values[key] as T) ?? (def as T),
  } as ConfigService;
}

/** Stub neo4j-driver : chaque session.recorde les requêtes ; countMonth renvoie `n`. */
function driverStub(runImpl?: (query: string, params: Record<string, unknown>) => unknown) {
  const calls: Array<{ query: string; params: Record<string, unknown> }> = [];
  const defaultRun = (query: string) =>
    query.includes('RETURN count(t)')
      ? { records: [{ get: () => ({ toNumber: () => 3 }) }] }
      : query.includes('SET u.subscriptionTier')
        ? { records: [] }
        : { records: [] };
  const session = jest.fn(() => ({
    run: jest.fn(async (query: string, params: Record<string, unknown>) => {
      calls.push({ query, params });
      return (runImpl ?? defaultRun)(query, params);
    }),
    close: jest.fn(async () => undefined),
  }));
  return { driver: { session }, calls };
}

describe('BillingService', () => {
  it('assertEnabled lève 503 si BILLING_ENABLED est off (règle d or)', () => {
    const service = new BillingService(configStub({}), driverStub().driver as any);
    expect(service.isEnabled()).toBe(false);
    expect(() => service.assertEnabled()).toThrow(ServiceUnavailableException);
  });

  it('countMonth compte les transactions SENT du mois civil UTC uniquement', async () => {
    const { driver, calls } = driverStub();
    const service = new BillingService(
      configStub({ BILLING_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_x' }),
      driver as any,
    );
    const n = await service.countMonth('alice@clearnet.io');
    expect(n).toBe(3);
    expect(calls[0].query).toContain('-[:SENT]->(t:Transaction)');
    expect(calls[0].query).toContain('t.createdAt >= $start');
    expect(calls[0].params.start).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
  });

  it('applySubscription écrit le tier et le customer sur le nœud User (idempotent)', async () => {
    const { driver, calls } = driverStub();
    const service = new BillingService(
      configStub({ BILLING_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_x' }),
      driver as any,
    );
    await service.applySubscription({
      customerEmail: 'bob@clearnet.io',
      customerId: 'cus_123',
      tier: 'PRO',
    });
    expect(calls[0].query).toContain('SET u.subscriptionTier = $tier');
    expect(calls[0].params).toEqual(
      expect.objectContaining({ email: 'bob@clearnet.io', tier: 'PRO', customer: 'cus_123' }),
    );
  });

  it('mappe le tier webhook : deleted → FREE, Price ID configuré → niveau, metadata → repli', () => {
    const config = configStub({
      STRIPE_PRICE_ESSENTIAL: 'price_essential_real',
      STRIPE_PRICE_PRO: 'price_pro_real',
      STRIPE_PRICE_ENTERPRISE: 'price_enterprise_real',
    });
    expect(tierFromPrice(null, config)).toBe('PRO');
    expect(tierFromPrice({ id: 'price_essential_real' }, config)).toBe('ESSENTIAL');
    expect(tierFromPrice({ id: 'price_pro_real' }, config)).toBe('PRO');
    expect(tierFromPrice({ id: 'price_enterprise_real' }, config)).toBe('ENTERPRISE');
    expect(tierFromPrice({ id: 'price_xyz', metadata: { tier: 'enterprise' } }, config)).toBe(
      'ENTERPRISE',
    );
    expect(tierFromPrice({ id: 'price_xyz', metadata: { tier: 'essential' } }, config)).toBe(
      'ESSENTIAL',
    );
    expect(tierFromPrice({ id: 'price_xyz', metadata: {} }, config)).toBe('PRO');
  });

  it('grille V1.5 : quotas + prix par niveau (bankable)', () => {
    const config = configStub({
      BILLING_FREE_QUOTA: '15',
      STRIPE_PRICE_ESSENTIAL: 'price_ess',
      STRIPE_PRICE_PRO: 'price_pro',
      STRIPE_PRICE_ENTERPRISE: 'price_ent',
    });
    expect(quotaForTier('FREE', config)).toBe(15);
    expect(quotaForTier('ESSENTIAL', config)).toBe(50);
    expect(quotaForTier('PRO', config)).toBe(500);
    expect(quotaForTier('ENTERPRISE', config)).toBeNull();
    expect(priceIdForTier('ESSENTIAL', config)).toBe('price_ess');
    expect(priceIdForTier('PRO', config)).toBe('price_pro');
    expect(priceIdForTier('ENTERPRISE', config)).toBe('price_ent');
    expect(isPaidTier('FREE')).toBe(false);
    expect(isPaidTier('ESSENTIAL') && isPaidTier('ENTERPRISE')).toBe(true);
    expect(upgradeMessage('FREE')).toContain('Essentiel');
    expect(upgradeMessage('PRO')).toContain('niveau supérieur');
  });
});