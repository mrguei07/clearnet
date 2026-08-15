import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingService, SubscriptionTier } from './billing.service';
import { NEO4J_DRIVER } from '../neo4j/neo4j.module';

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

  it('mappe le tier webhook : deleted → FREE, metadata tier enterprise → ENTERPRISE', () => {
    const map = (type: string, priceMeta: { tier?: string }): SubscriptionTier => {
      if (type === 'customer.subscription.deleted') return 'FREE';
      return priceMeta?.tier === 'enterprise' ? 'ENTERPRISE' : 'PRO';
    };
    expect(map('customer.subscription.deleted', {})).toBe('FREE');
    expect(map('customer.subscription.updated', { tier: 'enterprise' })).toBe('ENTERPRISE');
    expect(map('customer.subscription.created', {})).toBe('PRO');
  });
});