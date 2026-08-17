import { ConfigService } from '@nestjs/config';

/**
 * Modèle tarifaire ClearNet V1.5 — 4 niveaux (Free / Essentiel / Pro / Enterprise).
 *
 * Tout ce qui touche à la grille vit ici (aucune dépendance Stripe/Neo4j) :
 * quotas mensuels, commissions, labels, mapping Price-ID Stripe du dashboard.
 *
 * Règle d'or : les utilisateurs Free ne peuvent pas dépasser 15 transactions
 * par mois — au-delà, l'API renvoie 402 Payment Required (enforcement dans
 * TransactionsService.assertBillingQuota).
 */
export type SubscriptionTier = 'FREE' | 'ESSENTIAL' | 'PRO' | 'ENTERPRISE';

export const PAID_TIERS: readonly SubscriptionTier[] = ['ESSENTIAL', 'PRO', 'ENTERPRISE'];

export interface BillingTierInfo {
  tier: SubscriptionTier;
  label: string;
  monthlyPriceEur: number;
  commissionRate: number;
  /** Quota mensuel (mois civil UTC) ; null = illimité (Enterprise). */
  quota: number | null;
}

export const BILLING_TIERS: Record<SubscriptionTier, Omit<BillingTierInfo, 'quota'>> = {
  FREE: { tier: 'FREE', label: 'Free', monthlyPriceEur: 0, commissionRate: 0.02 },
  ESSENTIAL: { tier: 'ESSENTIAL', label: 'Essentiel', monthlyPriceEur: 99, commissionRate: 0.015 },
  PRO: { tier: 'PRO', label: 'Pro', monthlyPriceEur: 499, commissionRate: 0.012 },
  ENTERPRISE: {
    tier: 'ENTERPRISE',
    label: 'Enterprise',
    monthlyPriceEur: 1999,
    commissionRate: 0.009,
  },
};

export function isPaidTier(tier: string): tier is SubscriptionTier {
  return (PAID_TIERS as readonly string[]).includes(tier);
}

/** Quota mensuel du niveau ; null = illimité. FREE est piloté par BILLING_FREE_QUOTA. */
export function quotaForTier(tier: SubscriptionTier, config: ConfigService): number | null {
  switch (tier) {
    case 'FREE':
      return Number(config.get<string>('BILLING_FREE_QUOTA', '15'));
    case 'ESSENTIAL':
      return 50;
    case 'PRO':
      return 500;
    case 'ENTERPRISE':
      return null;
  }
}

/** Commission appliquée par niveau (constante métier, cf. grille V1.5). */
export function commissionForTier(tier: SubscriptionTier): number {
  return BILLING_TIERS[tier].commissionRate;
}

/** Price ID Stripe du niveau (dashboard Stripe, injecté via .env / Helm). */
export function priceIdForTier(tier: SubscriptionTier, config: ConfigService): string {
  switch (tier) {
    case 'ESSENTIAL':
      return config.get<string>('STRIPE_PRICE_ESSENTIAL', 'price_essential_default');
    case 'PRO':
      return config.get<string>('STRIPE_PRICE_PRO', 'price_pro_default');
    case 'ENTERPRISE':
      return config.get<string>('STRIPE_PRICE_ENTERPRISE', 'price_enterprise_default');
    default:
      return '';
  }
}

/**
 * Résout le niveau depuis le Price Stripe d'un abonnement (webhook) :
 *  - priorité au Price ID configuré (STRIPE_PRICE_* de l'environnement) ;
 *  - repli sur metadata.tier du Price (dashboard) ;
 *  - défaut historique : PRO (rétrocompatibilité webhooks existants).
 */
export function tierFromPrice(
  price: { id: string; metadata?: Record<string, string> | null } | null | undefined,
  config: ConfigService,
): SubscriptionTier {
  if (!price) return 'PRO';
  if (price.id === config.get<string>('STRIPE_PRICE_ESSENTIAL', '')) return 'ESSENTIAL';
  if (price.id === config.get<string>('STRIPE_PRICE_PRO', '')) return 'PRO';
  if (price.id === config.get<string>('STRIPE_PRICE_ENTERPRISE', '')) return 'ENTERPRISE';
  const meta = price.metadata?.tier;
  if (meta === 'essential') return 'ESSENTIAL';
  if (meta === 'enterprise') return 'ENTERPRISE';
  return 'PRO';
}

/** Message 402 côté API (outre le code BILLING_QUOTA_EXCEEDED). */
export function upgradeMessage(tier: SubscriptionTier): string {
  return tier === 'FREE'
    ? 'Quota mensuel Free atteint (15 transactions/mois) — passez à l’offre Essentiel pour continuer'
    : `Quota mensuel ${BILLING_TIERS[tier].label} atteint — passez au niveau supérieur pour continuer`;
}