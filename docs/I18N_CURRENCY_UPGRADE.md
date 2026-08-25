# 🌍 CLEARNET V1.5 — INTERNATIONALISATION & MULTI‑DEVISES (+ CONVERTISSEUR TEMPS RÉEL)

**Rôle** : Lead Architect Full‑Stack — internationalisation Fintech B2B.
**Base** : ClearNet V1.4 fonctionnel (30/30 backend, 5/5 contrats, APK buildée, billing V1.5).
**Livrable** : unique — ce document (plan d'exécution prêt à soumettre).
**Devise du plan** : ~3 jours ouvrés.

---

## 1. INTRODUCTION — OBJECTIFS & PORTÉE

Objectif : préparer le lancement international (early adopters Maritime, Aviation, Biotech,
Commerce International) avec (1) des messages backend localisés, (2) une UI mobile multilingue
avec détection automatique, (3) le support multi‑devises EUR/USD/GBP/CHF converti vers CLRN via
oracles Chainlink, (4) l'affichage des soldes/transactions dans la devise locale, (5) un
**convertisseur de devises en temps réel** (widget mobile + endpoint API + flux WebSocket), et
(6) la configuration par variables d'environnement.

**Contrainte absolue — rétrocompatibilité totale V1.4** :

| Garantie | Mécanisme |
|:---|:---|
| Désactivable par défaut | `I18N_ENABLED=false`, `MULTI_CURRENCY_ENABLED=false` (règle d'or « off par défaut » du monorepo) |
| Comportement existant intact quand off | Français + EUR/CLRN, messages actuels, `amount` = CLRN (aucune réponse modifiée) |
| API additive uniquement | Champs `currency*` **optionnels** ; aucun champ existant supprimé ou renommé |
| Aucune migration Neo4j | Propriétés additionnelles sur nœuds (`currency`, `currencyAmount`, `fxRate*`) — pas de schéma |
| Aucun nouveau prérequis de runtime | Les flags off exigent **zéro** variable nouvelle ; fallback statique en dev |

Non‑objectifs : paiement multi‑devises on‑chain (le ledger reste libellé CLRN), changement du jeu
de symboles, refonte de navigation.

---

## 2. MODIFICATIONS BACKEND (NestJS — `clearnet-backend/`)

### 2.1. Module i18n — messages localisés (fr / en / es / de)

**Fichiers créés**

| Fichier | Rôle |
|:---|:---|
| `src/i18n/i18n.module.ts` | Module global (`@Global()`) — injectable partout |
| `src/i18n/i18n.service.ts` | Résolution de locale, `t(key, params)` typé |
| `src/i18n/i18n.interceptor.ts` | Attache `req.locale` (Accept‑Language → `?lang=` → défaut) |
| `src/i18n/i18n.filter.ts` | `HttpExceptionFilter` global : messages traduits (remplace la façade actuelle) |
| `src/i18n/locales/{fr,en,es,de}/validation.json` | Erreurs de validation |
| `src/i18n/locales/{fr,en,es,de}/business.json` | Erreurs métier (quota, solde, doublon, compliance…) |

**Extrait — `i18n.service.ts`**

```ts
export const SUPPORTED_LANGUAGES = ['fr', 'en', 'es', 'de'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

@Injectable()
export class I18nService {
  constructor(private readonly config: ConfigService) {}

  resolve(req: Request): AppLanguage {
    const q = String(req.query?.lang ?? '');
    if (SUPPORTED_LANGUAGES.includes(q as AppLanguage)) return q as AppLanguage;
    const header = String(req.headers['accept-language'] ?? '')
      .split(',')[0]?.split('-')[0]?.toLowerCase() ?? '';
    if (SUPPORTED_LANGUAGES.includes(header as AppLanguage)) return header as AppLanguage;
    return (this.config.get<string>('DEFAULT_LANGUAGE', 'fr') as AppLanguage) ?? 'fr';
  }

  t(locale: AppLanguage, key: string, params: Record<string, unknown> = {}): string {
    const dict = this.dictionaries[locale] ?? this.dictionaries.fr;
    const tmpl = (dict.business ?? {})[key] ??
      (dict.validation ?? {})[key] ?? key;   // clé non trouvée → fallback fr, puis clé brute
    return Object.entries(params).reduce(
      (s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)), tmpl);
  }
}
```

**Extrait — `i18n.interceptor.ts`** (locale posée sur `request` pour les filtres et DTO)

```ts
@Injectable()
export class I18nInterceptor implements NestInterceptor {
  constructor(private readonly i18n: I18nService) {}
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = ctx.switchToHttp();
    res.getRequest().locale = this.i18n.resolve(res.getRequest());
    return next.handle();
  }
}
```

**Mécanisme de traduction des erreurs** :

1. **Validation DTO** (class‑validator) : les messages statiques actuels (« Le montant doit être… »)
   sont remplacés par des **clés i18n** via un `TranslateConstraint` générique ou — approche retenue,
   minimale et sans décorateur custom — un **mapping constraint → clé** dans le ValidationPipe global :

```ts
// src/i18n/validation-keys.ts (quand I18N_ENABLED)
const KEY_BY_CONSTRAINTS: Record<string, string> = {
  isEmail: 'validation.email.invalid', isNotEmpty: 'validation.email.required',
  isNumber: 'validation.amount.mustBeNumber', min: 'validation.amount.min',
  max: 'validation.amount.max', isIsoCurrency: 'validation.currency.invalid', …
};

// Dans le filtre global (avant restructuration de la réponse 4xx)
const first = Object.keys(err.constraints ?? {})[0];
message = i18n.t(locale, KEY_BY_CONSTRAINTS[first] ?? first);
```

2. **Erreurs métier** : les `HttpException` actuelles (`422 unsupported currency`,
   `402 BILLING_QUOTA_EXCEEDED`, « Solde insuffisant »…) sont levées avec une **clé i18n** +
   `params` (ex. `quota: 15`) ; le filtre global traduit selon `req.locale`.
   ⚠️ **Rétrocompat** : quand `I18N_ENABLED=false`, le filtre renvoie **exactement** les messages
   actuels (les clés sont mappées vers les libellés français d'aujourd'hui — table de correspondance
   enrichie, jamais de libellé perdu).

3. **Locales — `validation.json` (cœur fourni par le prompt)** : `validation.amount.{mustBeNumber,
   min, max}`, `validation.email.{invalid, required}`, `validation.password.{minLength}` + extensions
   V1.5 : `validation.currency.{invalid, required}`, `validation.amount.required`, `validation.note.maxLength`.
   **`business.json`** : `business.insufficient_balance`, `business.quota_exceeded`
   (`Vous avez dépassé votre quota mensuel (15 opérations).` + lien upgrade), `business.duplicate_transaction`,
   `business.self_transfer`, `business.recipient_not_found`, `business.billing_quota_exceeded`
   (message 402 actuel), `business.compliance_*`, `business.fx_rate_unavailable`.

### 2.2. Multi‑devises & convertisseur temps réel

**Flux cible (une transaction multi‑devise)**

```
Création tx (MULTI_CURRENCY_ENABLED) :
  body { toEmail, amount: 124.50, currency: 'EUR', currencyAmount: 124.50 }
                          │
                          ▼
  FxService.convert('EUR' → 'CLRN')   // rate frais en cache (TTL), source Chainlink
                          │   rate = 0.9371 CLRN/EUR  (§ source chaîne)
                          ▼
  amount (CLRN) = round(currencyAmount × rate, 6)   — champ `amount` existant INCHANGÉ en sémantique
  nœud Transaction += { currency:'EUR', currencyAmount:124.50, fxRate:0.9371,
                        fxRateSource:'chainlink', fxRateAt: <UTC ISO> }
```

**Fichiers créés/modifiés**

| Fichier | Rôle |
|:---|:---|
| `src/fx/fx.module.ts` | Module de taux de change (global, garde `MULTI_CURRENCY_ENABLED`) |
| `src/fx/fx.service.ts` | `getRate(base, quote)` (cache mémoire TTL), `convert()`, snapshot rates |
| `src/fx/providers/chainlink.provider.ts` | Oracle Chainlink (AggregatorV3Interface — le contrat `ChainlinkPriceFeed.sol` existe déjà dans `clearnet-blockchain/contracts/`) |
| `src/fx/providers/static.provider.ts` | Fallback dev (`FX_STATIC_RATES`) — seule garantie hors réseau |
| `src/fx/fx.controller.ts` | REST : `GET /api/fx/rates` , `POST /api/fx/convert` |
| `src/fx/fx.gateway.ts` | WebSocket temps réel : `fx:rates` (snapshot) + `fx:rate` (push périodique) |
| `src/fx/currency.dto.ts` | DTOs (`ConvertDto`, body validé `isIsoCurrency`/`Min(0)`) |
| `src/transactions/dto/create-transaction.dto.ts` | `+ currency?`, `currencyAmount?` (modifié, additif) |
| `src/transactions/transactions.service.ts` | Conversion dans `create()` quand flag ON (modifié) |
| `src/i18n/locales/*/business.json` | Clés d'erreurs FX |

**Extrait — `fx.service.ts` (cœur conversion + cache)**

```ts
@Injectable()
export class FxService {
  private readonly cache = new Map<string, { rate: number; at: number }>();

  constructor(
    private readonly config: ConfigService,
    // Provider choisi par FX_PROVIDER (chainlink | static) — jamais instancié si flag off
    private readonly provider: RateProvider,
  ) {}

  private key(base: string, quote: string) { return `${base}/${quote}`; }

  async getRate(base: string, quote: string): Promise<number> {
    const k = this.key(base, quote);
    const cached = this.cache.get(k);
    const ttl = Number(this.config.get<string>('FX_CACHE_TTL_MS', '60000'));
    if (cached && Date.now() - cached.at < ttl) return cached.rate;
    const rate = await this.provider.rate(base, quote);          // throw si indisponible
    this.cache.set(k, { rate, at: Date.now() });
    return rate;
  }

  /** Conversion toward CLRN (ledger). `quote` défaut = l'ancre : CLRN. */
  async convert(amount: number, base: string, quote = 'CLRN'): Promise<{
    amount, currency, currencyAmount, fxRate, fxRateSource, fxRateAt }> {
    const fxRate = await this.getRate(base, quote);
    return {
      amount: Math.round(amount * fxRate * 1e6) / 1e6,           // 6 décimales CLRN
      currency: base, currencyAmount: amount,
      fxRate: Math.round(fxRate * 1e6) / 1e6,
      fxRateSource: this.provider.name, fxRateAt: new Date().toISOString(),
    };
  }

  /** Snapshot complet pour le convertisseur (devises supportées × CLRN), cache TTL. */
  async snapshot(): Promise<{ base: 'CLRN'; rates: Record<string, number>; at: string }> { … }
}
```

**Extrait — `chainlink.provider.ts`**

```ts
@Injectable()
export class ChainlinkProvider implements RateProvider {
  readonly name = 'chainlink';
  // AggregatorV3Interface (déjà déclarée dans clearnet-blockchain/contracts/ChainlinkPriceFeed.sol)
  // JSON des paires : FX_CHAINLINK_AGGREGATORS = { "EUR/CLRN": "0x…", "USD/CLRN": "0x…" }
  async rate(base: string, quote: string): Promise<number> {
    const address = this.aggregators[`${base}/${quote}`];
    if (!address) throw new UnprocessableEntityException(`unsupported currency ${base}`);
    const feed = await this.reader.feed(address);        // latestRoundData → decimals
    return Number(feed.answer) / 10 ** feed.decimals;    // paires Anchor Eurodollar vs CLRN
  }
}
```
> Chaîne de taux : `EUR→CLRN` se compose depuis les paires existantes si besoin
> (`EUR/USD` × `USD/CLRN`) ; **quand le flag est off**, aucune lecture réseau ni clé requise.

**Convertisseur temps réel — trois surfaces**

1. **REST (repos, polling léger)**
   ```
   GET  /api/fx/rates               → { base:'CLRN', rates:{EUR,USD,GBP,CHF}, at }
   POST /api/fx/convert             → body { amount, from, to?='CLRN' } → { amount, converted, rate, at }
   ```
   La validation et les erreurs (pairs inconnues → `422 unsupported currency`) passent par l'i18n.
2. **WebSocket temps réel (push)** — nouveau namespace `/fx` (Socket.IO déjà présent côté `/transactions`) :
   - `fx:rates` : snapshot à la connexion ;
   - `fx:rate` : émission **toutes les `FX_REALTIME_PUSH_MS` (défaut 5 000 ms)** uniquement quand
     `MULTI_CURRENCY_ENABLED=true` **et** au moins un client est abonné (aucun coût idle).
   ```ts
   @WebSocketGateway({ namespace: '/fx', cors: true })
   export class FxGateway implements OnModuleInit {
     private timer?: NodeJS.Timeout;
     onModuleInit() {
       if (this.config.get('MULTI_CURRENCY_ENABLED') !== 'true') return;   // off par défaut
       this.timer = setInterval(() => this.broadcast(), FX_REALTIME_PUSH_MS);
     }
     @SubscribeMessage('fx:subscribe') subscribe() {
       this.server.emit('fx:rates', await this.fx.snapshot()); return true;
     }
     private broadcast() { this.server.emit('fx:rate', this.latest()); }
   }
   ```
3. **Widget mobile** (cf. §3.3) — saisie montant, sélection devise, taux live, ouvre le
   paiement pré‑rempli (conversion EUR → CLRN en 1 tap).

**Modification `transactions.service.ts` (additive, dans `create()`)**

```ts
// après assertBillingQuota + compliance (déjà en place) :
let fx: FxResult | null = null;
if (this.fxEnabled && input.currency) {
  fx = await this.fx.convert(input.amount, input.currency);   // amount devient CLRN
}
// Cypher CREATE : + currency, currencyAmount, fxRate, fxRateSource, fxRateAt (null quand off)
```
`input.currency` validé par le DTO (`IsISO4217CurrencyCode` custom, restreint à
`SUPPORTED_CURRENCIES` — défaut `EUR,USD,GBP,CHF`).

### 2.3. Solde & historique multi‑devises (affichage)

- `GET /api/transactions/balance` et `/history` : nouveaux champs **optionnels**
  `displayCurrency` (devise locale demandée via `?currency=` ou `Accept-Language`mapping pays → devise)
  et `displayAmount` (CLRN → devise au taux courant du cache). **Flag off → pas de champ supplémentaire**.

### 2.4. Variables d'environnement (`.env.example`)

```dotenv
# ---- V1.5 Internationalisation ----
I18N_ENABLED=false                  # messages localisés (fr/en/es/de) — off = messages actuels
DEFAULT_LANGUAGE=fr                 # repli si aucune langue supportée détectée
SUPPORTED_LANGUAGES=fr,en,es,de

# ---- V1.5 Multi-devises & convertisseur temps réel ----
MULTI_CURRENCY_ENABLED=false        # off = EUR/CLRN uniquement (flux V1.4 strict)
DEFAULT_CURRENCY=EUR
SUPPORTED_CURRENCIES=EUR,USD,GBP,CHF
FX_PROVIDER=static                  # chainlink | static (chainlink = clés RPC requises)
FX_CHAINLINK_RPC_URL=               # RPC du réseau des feeds (⚠️ secret de push en prod)
FX_CHAINLINK_AGGREGATORS=           # JSON { "EUR/CLRN": "0x…", "USD/CLRN": "0x…" }
FX_STATIC_RATES={"EUR/CLRN":1,"USD/CLRN":0.9,"GBP/CLRN":1.05,"CHF/CLRN":0.98}  # dev/demo
FX_CACHE_TTL_MS=60000               # fraîcheur du cache taux
FX_REALTIME_PUSH_MS=5000            # période de push WebSocket (/fx) — 0 = désactivé
```
Aucune de ces variables n'est requise quand les flags sont off (rétrocompat stricte).

---

## 3. MODIFICATIONS MOBILE (Expo SDK 49 — `clearnet-mobile/`)

### 3.1. Dépendances & bootstrap i18n

```bash
npx expo install expo-localization
npm i i18next react-i18next
```

| Fichier | Rôle |
|:---|:---|
| `src/i18n/index.ts` | Init i18next : `expo-localization` (détection), langue persistée (`AsyncStorage`), fallback `fr` ; clés traduction `translation.json` par langue |
| `src/i18n/locales/{fr,en,es,de}/translation.json` | Toutes les strings UIs (écrans + toasts + erreurs de validation locales) |
| `src/api/client.ts` | Envoie `Accept-Language: <i18n.language>` sur chaque appel (backend localisé) |
| `src/contexts/SettingsContext.tsx` | `language`, `currency` (défaut devise appareil → EUR), persistance |

**Extrait — `src/i18n/index.ts`**

```ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

const locale = Localization.getLocales()[0]?.languageCode ?? 'fr';
const detected = ['fr','en','es','de'].includes(locale) ? locale : 'en';

i18n.use(initReactI18next).init({
  resources: { fr: { translation }, en: { translation }, es: { translation }, de: { translation } },
  lng: (await AsyncStorage.getItem('lang')) ?? detected,
  fallbackLng: 'fr', interpolation: { escapeValue: false },
});
export const setLanguage = (lng: string) => { i18n.changeLanguage(lng); void AsyncStorage.setItem('lang', lng); };
```

### 3.2. Traduction des écrans (testIDs préservés — flows Maestro intacts)

| Écran | Strings traduites (ex.) | Clé |
|:---|:---|:---|
| Login | « Connexion », « Mot de passe », « Créer un compte » | `login.*` |
| Register | « Entreprise », « Choisissez votre secteur » | `register.*` |
| Home | « Solde », « Dernière opération », toast réseau | `home.*` |
| Transactions | « Nouveau paiement », « Destinataire », « Montant », bouton Envoyer | `tx.*` |
| Billing (V1.5) | « Formulaire », « Tx ce mois », « Passer au niveau supérieur » | `billing.*` |
| Convertisseur (nouveau) | « Convertisseur », « De », « Vers », « Taux (temps réel) » | `converter.*` |

⚠️ Les `testID` restent **identiques** (logique de test, jamais traduite) — `login.yaml`,
`offline-sync.yaml`, `compensation.yaml`, `websocket.yaml` passent sans modification.

### 3.3. Écran « Convertisseur » (temps réel) — `src/screens/ConverterScreen.tsx`

- Sélecteurs `De`/`Vers` (SUPPORTED_CURRENCIES + CLRN), champs montants bidirectionnels
  (conversion symétrique en live : `amountA = amountB / rate`), indication **« Taux temps réel »**
  + timestamp de fraîcheur (TTL cache), mode hors‑ligne → taux du dernier snapshot persistant.
- **Données** : connecte le namespace `/fx` (WebSocket) → `fx:rates` au montage, abonné
  `fx:rate` pour mise à jour silencieuse ; repli REST `GET /api/fx/convert` (polling 15 s).
  Quand `MULTI_CURRENCY_ENABLED=false` → l'onglet est masqué (rétrocompat UI).
- **Transformation en paiement** : bouton « Payer {converted} CLRN » qui pré‑remplit l'écran
  Transactions (`currency`, `currencyAmount`, montant CLRN) — la conversion côté serveur est
  recalculée (source de vérité = backend, jamais le taux affiché).

**Extrait — rendu valeur + taux (toujours via `Intl.NumberFormat`)**

```tsx
const fmt = (v: number, c: string) =>
  new Intl.NumberFormat(i18n.language, { style: 'currency', currency: c }).format(v);
// …
{ticker && <Text style={s.rate}>{t('converter.rate')} : 1 {from} = {ticker.rate} {to}
  <Text style={s.muted}> · {t('converter.updatedAt')} {new Date(ticker.at).toLocaleTimeString(i18n.language)}</Text></Text>}
```

### 3.4. Affichage des montants dans la devise locale (soldes & historique)

- `src/utils/money.ts` : `fmtAmount(amount, currency = settings.currency)` — `Intl.NumberFormat`
  localisé (EUR `1 234,56 €`, USD `$1,234.56`, GBP `£1,234.56`, CHF `CHF 1'234.56`) ;
- Écran Home : solde CLRN affiché via l'endpoint balance enrichi (`displayCurrency/displayAmount`)
  quand le flag backend est ON, sinon affichage actuel (EUR/CLRN) ;
- Paramètres : sélecteurs `Langue` + `Devise d'affichage` (persistés AsyncStorage), badge
  « conversion indicative — le règlement s'effectue en CLRN ».

---

## 4. INFRASTRUCTURE (Helm — `infrastructure/helm/clearnet/`)

| Fichier | Changement |
|:---|:---|
| `values.yaml` / `values-production.yaml` | Bloc `i18n:` (enabled/languages/defaultLanguage) et `fx:` (enabled/defaultCurrency/supported/provier/cache/staticRates) — **tout off/vide par défaut** |
| `templates/backend-configmap.yaml` | `+8` variables : `I18N_ENABLED`, `DEFAULT_LANGUAGE`, `SUPPORTED_LANGUAGES`, `MULTI_CURRENCY_ENABLED`, `DEFAULT_CURRENCY`, `SUPPORTED_CURRENCIES`, `FX_PROVIDER`, `FX_CACHE_TTL_MS`, `FX_REALTIME_PUSH_MS` ; `FX_STATIC_RATES` et `FX_CHAINLINK_AGGREGATORS` passées en ConfigMap (JSON, non‑secrets) |
| `templates/backend-deployment.yaml` | `secretKeyRef` optionnel `fx-chainlink-rpc-url` (`FX_CHAINLINK_RPC_URL`) via `existingSecret` — ⚠️ si RPC payable, ne jamais mettre dans le ConfigMap |
| `.env.example` (backend) | bloc §2.4 |

**Défauts de production à valider avant activation** : paires Chainlink disponibles pour
CLRN (à publier) ou substitution par `EUR/USD` + USD ancré — décision produit, hors code.

---

## 5. PROCÉDURE DE VALIDATION

### 5.1. Tests automatisés (extension des suites existantes)

| Test | Fichier | Critère |
|:---|:---|:---|
| i18n : résolution locale (header, `?lang=`, défaut) | `src/i18n/i18n.service.spec.ts` | fr accept‑language français → `fr` ; `?lang=de` → `de` ; invalide → défaut |
| i18n : fallback clés | `i18n.service.spec.ts` | clé inconnue → français puis clé brute |
| Validation localisée (DTO) | `src/transactions/dto/*.spec.ts` | erreurs `en`/`es`/`de` conformes aux `validation.json` |
| FX : conversion ET arrondis | `src/fx/fx.service.spec.ts` | 124,50 EUR × 0,9371 → 116,689050 ; symétrie `to→from=1/rate` |
| FX : cache TTL | `fx.service.spec.ts` | 2 appels < TTL → 1 hit provider ; TTL écoulé → re‑fetch |
| FX : fallback provider hors ligne | `fx.service.spec.ts` | provider chainlink KO → `static` (si configuré) sinon `422` |
| Endpoints `convert`/`rates` | `src/fx/fx.controller.spec.ts` | JWT requis ; devises hors liste → 422 localisé |
| **Rétrocompat** | `transactions/transactions…spec` | `MULTI_CURRENCY_ENABLED=false` → nœud sans champs `currency*`, `amount` strict identique V1.4 |
| Maestro | flows existants | **green sans modification** (testIDs stables) |

Count visé : ~12 nouveaux tests → suite 42/42 (30 actuels + 12).

### 5.2. Validation manuelle (matrice)

```bash
# 1. Rétrocompat : flags off, comportement actuel strict
docker compose up -d neo4j
cd clearnet-backend && npm start
curl -s -X POST -H "Authorization: Bearer $JWT" -d '{"toEmail":"bob@x.fr","amount":100}' \
  http://localhost:3000/api/transactions          # → réponse strictement identique V1.4

# 2. i18n ON — messages localisés
curl -s -H "Authorization: Bearer $JWT" -H "Accept-Language: de" \
  -X POST .../api/transactions -d '{"toEmail":"bob@x.fr","amount":-5}'   # → 400 allemand
curl -s -H "Authorization: Bearer $JWT" "…/api/billing/status?lang=es"   # → champs/quota en espagnol

# 3. Multi-devises + convertisseur
curl -s -H "Authorization: Bearer $JWT" -X POST http://localhost:3000/api/fx/convert \
  -H "Content-Type: application/json" -d '{"amount":150,"from":"USD","to":"CLRN"}'
curl -s -H "Authorization: Bearer $JWT" http://localhost:3000/api/fx/rates       # snapshot
# → vérifier : 422 localisé pour "ZZZ" ; convert EUR→GBP symétrique ; historique avec currencyAmount+fxRate

# 4. WebSocket temps réel (/fx)
# node client : connect → fx:rates (snapshot) → fx:rate toutes les 5 s (visualiser variation)

# 5. Mobile (émulateur Pixel_7a headless + validate-apk.ps1)
# langue appareil = DE → UI allemande au 1er lancement ; réglage langue persisté ;
# convertisseur : saisie 250 EUR → CLRN live, « Payer 234,27 CLRN » → tx créée avec amount converti
```

### 5.3. Non‑régression

- `npm run build` + `npm test` (42/42) ;
- `tsc --noEmit` mobile + `validate-apk.ps1` (APK signée prod) ;
- Flows Maestro en CI (émulateur) — aucun testID modifié.

---

## 6. CALENDRIER ESTIMÉ — 3 JOURS OUVRÉS

| Jour | Livrable | Sortie |
|:---|:---|:---|
| **J1 — Backend i18n** | `i18n.module/service/interceptor/filter`, 4 locales (validation + business), mapping ValidationPipe, tests i18n + DTO localisés | 5 fichiers + 4×2 JSON ; suite +6 tests ; **flags off → messages actuels** |
| **J2 — Backend multi‑devises + convertisseur** | `fx.module` (providers chainlink/static, cache), endpoint `rates`/`convert`, gateway `/fx` temps réel, DTO `currency*` + conversion dans `create()`, endpoints balance/history enrichis, tests FX | 7 fichiers + 4 tests ; `.env.example` ; suite ≈ 12 nouveaux tests |
| **J3 — Mobile + infra + validation finale** | i18n mobile (4 langues, détection, réglages), écran Convertisseur temps réel + paiement pré‑rempli, affichage devise locale, Helm (values + configmap + deployment), matrice manuelle + non‑régression complète | UI 100 % traduite ; APK rebuildée + `validate-apk.ps1` OK ; doc à jour |

**Buffer** : ½ j (décision produit sur les paires Chainlink CLRN, polish UI convertisseur).

---

## ANNEXE — ARBORESCENCE CIBLE

```
clearnet-backend/src/
  i18n/            i18n.module|service|interceptor|filter + validation-keys
                   locales/{fr,en,es,de}/{validation,business}.json
  fx/              fx.module|service + providers/{chainlink,static}.provider
                   fx.controller|gateway + currency.dto
clearnet-mobile/src/
  i18n/            index.ts + locales/{fr,en,es,de}/translation.json
  screens/         ConverterScreen.tsx (nouveau) ; BillingScreen/Home/etc. via useTranslation
  utils/money.ts   fmtAmount (Intl.NumberFormat localisé)
  contexts/        SettingsContext.tsx (langue + devise persistées)
infrastructure/helm/clearnet/
  values.yaml, values-production.yaml, templates/backend-configmap.yaml, backend-deployment.yaml
```

**Notes de conformité** : aucune clé API commitée, aucune donnée client hors UE (RGPD),
prises de taux de change indicative (jamais contractuelle) — à mentionner dans l'UI convertisseur.