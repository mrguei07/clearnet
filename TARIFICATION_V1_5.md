# 🧾 TARIFICATION CLEARNET — V1.4 → V1.5 Pricing (4 niveaux)

**Rôle** : Lead Backend & Mobile Engineer — monétisation ClearNet.
**Statut** : implémenté et vérifié (`npm run build` ✅, 30/30 tests ✅, `tsc --noEmit` mobile ✅).
**Portée** : monorepo — backend NestJS, infra Helm, mobile Expo (écran Abonnement).
**À soumettre** : équipe technique (revue) puis équipe produit (grille tarifaire).

---

## 1. Nouvelle grille tarifaire (source de vérité)

| Niveau (tier) | Opérations / mois | Commission (fee) | Prix mensuel | Stripe Price ID |
| :--- | :--- | :--- | :--- | :--- |
| **Free** | 15 (limité) | 2,0 % | 0 € | — (pas de paiement) |
| **Essentiel** | 50 | 1,5 % | 99 € | `price_essential_xxx` |
| **Pro** | 500 | 1,2 % | 499 € | `price_pro_xxx` |
| **Enterprise** | Illimité | 0,9 % | 1 999 € | `price_enterprise_xxx` |

**Règle d'or** : les utilisateurs `Free` ne peuvent pas effectuer plus de
15 transactions par mois. Au-delà, l'API renvoie une erreur
**`402 Payment Required`** (code `BILLING_QUOTA_EXCEEDED`) avec un message les
invitant à passer à l'offre Essentiel.

> La commission n'est **pas** encore prélevée (facturation manuelle historique) :
> elle est désormais **timbrée sur chaque transaction** (`feeRate` stocké sur le
> nœud `Transaction`) pour préparer le prélèvement automatisé (P2 — voir §7).

---

## 2. Changements backend (NestJS — `clearnet-backend/`)

### 2.1 Nouveau : `src/billing/pricing.ts` — grille centralisée (source de vérité)

Seul endroit où vivent les constantes métier (aucune dépendance Stripe/Neo4j) :

```ts
export type SubscriptionTier = 'FREE' | 'ESSENTIAL' | 'PRO' | 'ENTERPRISE';
export const PAID_TIERS = ['ESSENTIAL', 'PRO', 'ENTERPRISE'];
// BILLING_TIERS : label, prix mensuel, commissionRate (2/1,5/1,2/0,9 %)
quotaForTier(tier, config)   // FREE→BILLING_FREE_QUOTA(15), ESSENTIAL→50, PRO→500, ENTERPRISE→null (illimité)
commissionForTier(tier)      // taux de commission du niveau
priceIdForTier(tier, config) // STRIPE_PRICE_ESSENTIAL/PRO/ENTERPRISE
tierFromPrice(price, config) // webhook : Price ID configuré → repli metadata.tier → défaut PRO
upgradeMessage(tier)         // message 402 orienté upgrade
```

### 2.2 `src/billing/billing.service.ts`

- `SubscriptionTier` étendu (re-exporté depuis `pricing.ts`) : `FREE | ESSENTIAL | PRO | ENTERPRISE`.
- `createCheckout(email, tier = 'PRO')` : line_item piloté par le **Price ID du
  niveau** ; `metadata = { source, email, tier }`.
- `status()` : `quotaMax` résolu via `quotaForTier` — **null = illimité**
  (Enterprise) ; comptage du mois uniquement pour les niveaux à quota fini.

### 2.3 `src/billing/billing.controller.ts`

`POST /api/billing/create-checkout` accepte un body optionnel :
`{ "tier": "ESSENTIAL" | "PRO" | "ENTERPRISE" }` (défaut `PRO`, rétrocompat
mobile). Tier invalide / `FREE` → `400 Bad Request`.

### 2.4 `src/billing/webhooks/stripe.webhook.controller.ts`

Mapping webhook `customer.subscription.*` :
- `deleted` → `FREE` ;
- sinon **`tierFromPrice(price)`** : Price ID de l'environnement
  (`STRIPE_PRICE_*`) → repli `price.metadata.tier` (`essential`|`enterprise`|`pro`)
  → défaut historique `PRO`.

### 2.5 `src/transactions/transactions.service.ts` — Règle d'or ⭐

- `assertBillingQuota` : **tout niveau à quota fini** est compté (Free 15,
  Essentiel 50, Pro 500) ; dépassement →
  `402 Payment Required { statusCode, code: 'BILLING_QUOTA_EXCEEDED', tier, used, quota, message }`.
- Early adopters : exemption conservée (`EARLY_ADOPTER_ENABLED`).
- Alerte Slack 80 % : libellé par niveau (`⚠️ Quota {tier} {used}/{quota} atteint (80 %)`).
- **Forfait** : la transaction enregistre `feeRate` (commission du niveau de
  l'émetteur, `null` si billing off) — V1.5 ne prélève encore rien.

### 2.6 `.env.example`

```diff
 BILLING_FREE_QUOTA=10
-STRIPE_PRICE_PRO=price_pro_default
-BILLING_ENTERPRISE_QUOTA=0
+BILLING_FREE_QUOTA=15
+STRIPE_PRICE_ESSENTIAL=price_essential_default
+STRIPE_PRICE_PRO=price_pro_default
+STRIPE_PRICE_ENTERPRISE=price_enterprise_default
```

`BILLING_ENTERPRISE_QUOTA` supprimé (Enterprise = illimité, fixe dans `pricing.ts`).

### 2.7 Infra Helm (`infrastructure/helm/clearnet/`)

`values.yaml`, `values-production.yaml` : `backend.billing.{priceEssential,
pricePro, priceEnterprise, freeQuota: 15}` ;
`templates/backend-configmap.yaml` : passe `STRIPE_PRICE_ESSENTIAL/PRO/ENTERPRISE`.
⚠️ **Sans changement** : les Price IDs restent **vides** en valeurs de config —
ils sont injectés ailleurs (dashboard Stripe → variable d'environnement
déploiement, jamais commités).

---

## 3. Changement mobile (Expo — `clearnet-mobile/`)

`src/screens/BillingScreen.tsx` :
- type `BillingStatus.tier` étendu ; `quotaMax: number | null` (null = illimité) ;
- barre de quota affichée pour **tout niveau à quota fini** (Essentiel/Pro inclus),
  `∞` pour Enterprise ;
- libellés : « Quota presque atteint — passez au niveau supérieur pour
  continuer » ; CTA Free = « Passer au niveau supérieur ».
- Aucun prix/commission affiché dans l'écran (grid tarifaire : P2, cf. §7).

---

## 4. Configuration côté dashboard Stripe (à faire par l'équipe)

| Étape | Détail |
| :--- | :--- |
| 1. Créer 3 produits + 3 Prices (mode *subscription* mensuel) | Essentiel 99 €, Pro 499 €, Enterprise 1 999 € |
| 2. Renseigner `metadata.tier` sur chaque Price | `essential` / `pro` / `enterprise` (repli webhook si l'ID change) |
| 3. Injecter les Price IDs en prod | `STRIPE_PRICE_ESSENTIAL/PRO/ENTERPRISE` (jamais dans le repo ; `existingSecret` Helm) |
| 4. Activer | `BILLING_ENABLED=true` + `EARLY_ADOPTER_ENABLED=false` en prod |
| 5. Vérifier webhook | Événements `customer.subscription.created/updated/deleted` → tier appliqué |

---

## 5. Migration & rétrocompatibilité

- Anciens abonnements Pro sans `metadata.tier` → mapping **défaut PRO** (inchangé).
- `create-checkout` sans body → **PRO** (mobile existant inchangé).
- `BILLING_ENABLED=false` → le flux V1.3 reste identique (no-op strict) ;
  `feeRate` non écrit.
- Nœuds `Transaction` existants : sans `feeRate` → `null` en lecture (champs
  optionnels, `toTransaction` gère l'absence).

## 6. Tests

- `npm run build` ✅ — `npm test` ✅ **30/30** (dont : mapping webhook 4 niveaux
  via Price ID, grille quotas/prix, message d'upgrade).
- `tsc --noEmit` mobile ✅.
- Tests CI (`lint-backend`, `test-backend`) valident ces fichiers automatiquement.

## 7. Reste à faire (P2 — hors périmètre de cette PR)

1. **Prélèvement des commissions** : calcul `amount × feeRate` récupéré à
   l'arrivée du règlement on-chain (nb : le Paiement/Stripe n'admettra pas
   d'aller-retour — définition produit requise).
2. **Écran de choix de formule** (grid 4 offres) + lien checkout paramétré par
   niveau dans l'app.
3. **Rotations des anciens Price IDs** une fois les nouveaux live.
4. Produit : messages 402 localisés (FR) et page « upgrade » (URL
   `BILLING_SUCCESS/CANCEL_URL`).

## 8. Rollback

`git revert` de la PR + retour des IDs Stripe précédents → le modèle single-Pro
reste fonctionnel (défaut PRO couvre les webhooks historiques).