# UX_IMPROVEMENTS_V1.4 — Plan d'exécution technique

**Périmètre** : applicatif mobile React Native / Expo (SDK 49) + ajustements backend NestJS.
**Règle d'or** : chaque axe est **rétrocompatible** et **désactivé par défaut** (feature flags). Aucune modification des contrats Solidity.

---

## 1. Introduction

L'audit de la maquette (`apercu-visuel.html`) a identifié 6 lacunes UX qui freinent l'adoption par les CFO et les équipes opérationnelles :

| Lacune | Impact | Axe d'amélioration |
|:---|:---|:---|
| Absence de statut on-chain (PENDING/SUCCESS/FAILED) | L'utilisateur ne sait pas si sa compensation est finalisée | **Axe 1** – Badge de statut sur les transactions |
| Pas de visualisation des pays des contreparties | Les flux transfrontaliers ne sont pas mis en valeur | **Axe 2** – Drapeaux pays (emoji) partout |
| Les cycles de dettes détectés ne sont pas mis en avant | L'USP principal est invisible | **Axe 3** – Carte « Cycles détectés » sur l'accueil |
| Pas de ROI visible sur l'écran d'abonnement | Le CFO ne voit pas la valeur générée | **Axe 4** – Widget « Économies réalisées » |
| Le graphe est statique (pas d'interaction) | L'utilisateur ne peut pas explorer le réseau | **Axe 5** – Nœuds cliquables + animations de cycle |
| Le feedback utilisateur est limité (toasts, chargement) | L'utilisateur ne sait pas ce qui se passe en arrière‑plan | **Axe 6** – Toasts enrichis + barres de progression |

### État de l'existant vérifié dans le code (session précédente)

| Brique | Déjà en place | Manque |
|:---|:---|:---|
| Événement WS `transaction:status` | ✔ `transactions.gateway.ts` (room `user:<email>`), payload `{txId, status, hash?, error?, at}` | Rien côté backend pour Axe 1 (le champ `at` = timestamp existe déjà) |
| Statut on-chain en base | ✔ `onchainStatus` / `onchainHash` / `onchainError` (Neo4j `Transaction.onchainStatus`) | La liste REST ne l'expose pas forcément de façon unifiée |
| Détection de cycles | ✘ `graph.service.ts` : commentaire « détection de cycles aisée » uniquement | Endpoint dédié + calcul |
| Pays des contreparties | ✔ `country` sur les users (profil OFAC) ; `fromEmail/toEmail` sur les tx | Jointure pays → transaction |
| ForceGraph | ✔ `src/components/ForceGraph.tsx` (statique) | Interaction + animation |
| Toasts | ✔ `react-native-toast-message` déjà intégré (`App.tsx`) | Enrichissement |

---

## 2. Détail des 6 axes

### AXE 1 — Badge de statut on-chain (PENDING / SUCCESS / FAILED)

#### Sous-tâches

| # | Fichier | Type | Description |
|:---|:---|:---|:---|
| 1.1 | `clearnet-mobile/src/components/TransactionStatusBadge.tsx` | [N] | Composition du badge (icône + libellé + couleur), prop `status: string \| null \| undefined` → rend `null` si statut absent (rétrocompatibilité totale). |
| 1.2 | `clearnet-mobile/src/screens/TransactionsScreen.tsx` | [M] | Ajout du badge dans chaque ligne (`tx.onchainStatus`), mis à jour en direct via une map locale `txId → status` alimentée par le WS. |
| 1.3 | `clearnet-backend/src/transactions/transactions.controller.ts` | [M] | Exposer `onchainStatus` dans la réponse REST de l'historique (champ **optionnel**, absent si vide — aucun breaking change). |
| 1.4 | `clearnet-mobile/src/hooks/useTransactionWebSocket.ts` | [M] | Brancher `transaction:status` sur un callback de mise à jour du state (normalisation `PENDING_MULTISIG` → affichage « Multisig 2/3 »). |

#### Extrait de code — badge complété

```tsx
// clearnet-mobile/src/components/TransactionStatusBadge.tsx
import { Text, View } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

const statusMap: Record<string, { label: string; color: string; icon: string }> = {
  PENDING:        { label: 'En attente',  color: '#f59e0b', icon: '⏳' },
  PENDING_MULTISIG:{ label: 'Multisig 2/3', color: '#fbbf24', icon: '🔐' },
  SUCCESS:        { label: 'Réussi',      color: '#4ade80', icon: '✅' },
  FAILED:         { label: 'Échec',       color: '#f87171', icon: '❌' },
};

export default function TransactionStatusBadge({ status }: { status?: string | null }) {
  const { palette } = useTheme();
  const meta = status ? statusMap[status] : null;
  if (!meta) return null; // rétrocompat : aucune supercherie visuelle si statut inconnu
  return (
    <View testID={`tx-status-${status}`} style={{
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: palette.surface, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
      alignSelf: 'flex-start',
    }}>
      <Text style={{ fontSize: 11 }}>{meta.icon}</Text>
      <Text style={{ fontSize: 11, color: meta.color, fontWeight: '700' }}>{meta.label}</Text>
    </View>
  );
}
```

#### Extrait de code — intégration liste + temps réel

```tsx
// TransactionsScreen.tsx — extrait (couche state)
const [liveStatus, setLiveStatus] = useState<Record<string, string>>({});
// via useTransactionWebSocket({ enabled: true, token, onEvent: (e) => {
//   if (e.type === 'transaction') setLiveStatus((m) => ({ ...m, [e.payload.txId]: e.payload.status }));
// }});
const statusOf = (tx: TxItem) => liveStatus[tx.id] ?? tx.onchainStatus ?? null;
// ...
<TransactionStatusBadge status={statusOf(tx)} />
```

---

### AXE 2 — Drapeaux pays (emoji) partout

#### Sous-tâches

| # | Fichier | Type | Description |
|:---|:---|:---|:---|
| 2.1 | `clearnet-mobile/src/constants/countries.ts` | [N] | Table `ISO2 → emoji drapeau` (retourné par `String.fromCodePoint` pour éviter tout bundle de données). |
| 2.2 | `clearnet-mobile/src/components/CountryFlag.tsx` | [N] | Composant `CountryFlag({ countryCode?: string \| null, size?: number })` → drapeau ou `null`. |
| 2.3 | `clearnet-backend/src/transactions/transactions.controller.ts` | [M] | Champs **optionnels** `counterpartyCountry` / `fromCountry` (jointure Neo4j user→company, `NULL` si flag off). |
| 2.4 | `clearnet-mobile/src/screens/TransactionsScreen.tsx` | [M] | Drapeau à côté de chaque contrepartie dans les cartes tx. |
| 2.5 | `clearnet-mobile/src/screens/HomeScreen.tsx` | [M] | Drapeau du pays de la dernière opération (ligne « Dernière opération ») quand disponible. |

#### Extrait de code — conversion ISO2 → emoji (aucune ressource externe)

```ts
// clearnet-mobile/src/constants/countries.ts
/** "FR" → "🇫🇷", "GB" → "🇬🇧", fallback null. */
export function countryFlag(iso2: string | null | undefined): string | null {
  if (!iso2 || iso2.length !== 2) return null;
  const code = iso2.toUpperCase().replace(/[A-Z]/g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
  return /^[🇦-🇿]{2}$/.test(code) ? code : null;
}
```

---

### AXE 3 — Carte « Cycles détectés » sur l'accueil

#### Sous-tâches

| # | Fichier | Type | Description |
|:---|:---|:---|:---|
| 3.1 | `clearnet-backend/src/graph/graph.controller.ts` | [M] | Nouvel endpoint `GET /graph/cycles` (flag `UX_CYCLES_ENABLED`), réponse `{ cycles: [{nodes: string[], amount: number}], generatedAt }`. |
| 3.2 | `clearnet-backend/src/graph/graph.service.ts` | [M] | Requête Neo4j des cycles dirigés de ≤ 4 nœuds sur les 90 derniers jours (Cypher `MATCH p = (a)-[:OWES]->(b)-...->(a)`), sans doublon par rotation. |
| 3.3 | `clearnet-mobile/src/components/CyclesCard.tsx` | [N] | Carte repliable sur l'accueil : liste des cycles (noms + montant), état vide → carte masquée. |
| 3.4 | `clearnet-mobile/src/screens/HomeScreen.tsx` | [M] | Insertion de la carte sous le solde ; appui → onglet « Réseau » avec le cycle sélectionné mis en évidence (couplage Axe 5). |
| 3.5 | `clearnet-mobile/src/screens/GraphScreen.tsx` | [M] | Prop `highlightCycle?: string[]` pour surligner les nœuds/arêtes d'un cycle. |

#### Extrait de code — Cypher de détection (backend)

```cypher
// graph.service.ts — détection des cycles courts (débiteur → créancier)
MATCH p = (a:Company)-[:OWES]->(b:Company)-[:OWES]->(c:Company)-[:OWES]->(a:Company)
WHERE a.name < b.name AND a.name < c.name   -- 1 seule rotation par cycle
  AND p IS NOT NULL
RETURN [a.name, b.name, c.name] AS cycle,
       min(length(p)) AS hops
LIMIT $maxCycles
```

> Désactivé par défaut : `UX_CYCLES_ENABLED=false` → endpoint renvoie `{ cycles: [], generatedAt: null }`, la carte est masquée côté mobile (aucun impact visuel).

---

### AXE 4 — Widget « Économies réalisées » (abonnement)

#### Sous-tâches

| # | Fichier | Type | Description |
|:---|:---|:---|:---|
| 4.1 | `clearnet-mobile/src/utils/roi.ts` | [N] | Calcul déterministe **client-side** : `savings = Σ txs SUCCESS × feePerTx` (`feePerTx` depuis le quota/tier, défaut 2,50 €) — aucune dépendance réseau supplémentaire. |
| 4.2 | `clearnet-mobile/src/screens/BillingScreen.tsx` | [M] | Widget au-dessus de la jauge de quota : total économisé, moyenne mensuelle, badge « vs frais bancaires classiques ». |
| 4.3 | `clearnet-mobile/src/config/featureFlags.ts` | [N] | Flag `showRoiWidget` (défaut `false`). |
| 4.4 | `clearnet-backend/src/billing/billing.service.ts` | [M] *(optionnel)* | Endpoint `/billing/savings` consolidé (calcul serveur, flag `UX_ROI_ENABLED`) si l'on veut une vérité partagée. |

#### Extrait de code — widget

```tsx
// BillingScreen.tsx — extrait
{flags.showRoiWidget && (
  <View testID="roi-widget" style={{ backgroundColor: '#0f3d2e', borderRadius: 16, padding: 16, marginBottom: 16 }}>
    <Text style={{ color: '#4ade80', fontSize: 12, fontWeight: '700' }}>Économies réalisées (V1.4)</Text>
    <Text style={{ color: '#dff7ec', fontSize: 26, fontWeight: '800', marginVertical: 4 }}>
      {fmt(savings.total)} <Text style={{ fontSize: 13 }}>/ mois</Text>
    </Text>
    <Text style={{ color: '#8fb8a8', fontSize: 12 }}>
      Basé sur {savings.txCount} règlements réussis × frais évités ({fmt(feePerTx)}/op.)
    </Text>
  </View>
)}
```

---

### AXE 5 — Graphe interactif : nœuds cliquables + animations de cycle

#### Sous-tâches

| # | Fichier | Type | Description |
|:---|:---|:---|:---|
| 5.1 | `clearnet-mobile/src/components/ForceGraph.tsx` | [M] | Nouvelle prop `onNodePress?: (node) => void` (Pressable/SVG `onPress`, avec `hitSlop`) et `highlightCycle?: string[]` (nœuds + arêtes du cycle animés en accent). |
| 5.2 | `clearnet-mobile/src/components/GraphNodeSheet.tsx` | [N] | Bottom-sheet léger au tap : nom, pays (drapeau — Axe 2), volume total, nb de tx, statut live. |
| 5.3 | `clearnet-mobile/src/screens/GraphScreen.tsx` | [M] | Câblage des interactions + pulsing (RN `Animated`) sur les arêtes du cycle sélectionné (lien Axe 3). |

#### Extrait de code — pulsation du cycle (RN Animated, zéro dépendance)

```tsx
// ForceGraph.tsx — extrait
const pulse = useRef(new Animated.Value(0)).current;
useEffect(() => {
  Animated.loop(Animated.sequence([
    Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
    Animated.timing(pulse, { toValue: 0, duration: 1400, useNativeDriver: true }),
  ])).start();
}, []);
// stroke-opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) — arêtes du cycle
```

---

### AXE 6 — Toasts enrichis + barres de progression

#### Sous-tâches

| # | Fichier | Type | Description |
|:---|:---|:---|:---|
| 6.1 | `clearnet-mobile/src/components/ProgressBar.tsx` | [N] | Barre RN `Animated` (width animée), utilisée pour la synchro offline et le quota. |
| 6.2 | `clearnet-mobile/src/contexts/ToastProvider.tsx` | [N] | Wrapper `react-native-toast-message` avec variantes `success | error | warn | sync` (icône + titre + sous-titre). |
| 6.3 | `clearnet-mobile/src/screens/TransactionsScreen.tsx` | [M] | Toast lors de la création, du retour WS (SUCCESS/FAILED) et pendant la synchro de la file offline (progression `n/m` via Axe 6.1). |
| 6.4 | `clearnet-mobile/src/screens/HomeScreen.tsx` | [M] | Toast « Réseau restauré » enrichi (indicateur de latence), suppression du bandeau provisoire `liveBanner` au profit du toast (flag). |
| 6.5 | `clearnet-mobile/App.tsx` | [M] | Montage du provider + `Toast` final du composant racine. |

#### Extrait de code — toast enrichi

```tsx
// ToastProvider.tsx — extrait
showToast('sync', {
  title: 'Synchronisation en cours',
  subtitle: `${done}/${total} paiements envoyés`,
  icon: '🔄', duration: 4000,
});
// découplage UI/logique : le provider reste un simple wrapper config de
// react-native-toast-message (backdrop, position 'bottom', safe area).
```

---

## 3. Contraintes techniques

### 3.1 Feature flags (tous off par défaut)

**Mobile** — `clearnet-mobile/src/config/featureFlags.ts` (variables d'environnement Expo `EXPO_PUBLIC_*`, lues au lancement, figées dans le bundle) :

```ts
// clearnet-mobile/src/config/featureFlags.ts
const env = (k: string, d = 'false') => process.env[`EXPO_PUBLIC_${k}`] ?? d;
export const flags = {
  showOnchainStatus: env('FF_ONCHAIN_STATUS') === 'true',   // Axe 1
  showCountryFlags:  env('FF_COUNTRY_FLAGS')  === 'true',   // Axe 2
  showCyclesCard:    env('FF_CYCLES_CARD')    === 'true',   // Axe 3
  showRoiWidget:     env('FF_ROI_WIDGET')     === 'true',   // Axe 4
  interactiveGraph:  env('FF_GRAPH_INTERACTIVE') === 'true',// Axe 5
  richToasts:        env('FF_RICH_TOASTS')    === 'true',   // Axe 6
};
```

**Backend** — **one flag par axe** via `ConfigService` (pattern déjà utilisé pour `ONCHAIN_ENABLED`) :
`UX_STATUS_ENABLED`, `UX_COUNTRY_ENABLED`, `UX_CYCLES_ENABLED`, `UX_ROI_ENABLED` (défauts : non définis → off). Les champs ajoutés aux réponses REST sont **ignorés par les clients anciens** (ajout d'attributs ≠ rupture).

### 3.2 Rétrocompatibilité

| Règle | Application |
|:---|:---|
| Aucun champ API ne devient obligatoire | `onchainStatus`, `counterpartyCountry`, `cycles` : présents **seulement** si flag actif ET valeur non nulle |
| Aucun composant ne casse si donnée absente | Badge/drapeau → `null` → rendu inchangé |
| Aucune dépendance npm ajoutée | Emojis, `Animated`, `String.fromCodePoint` : 100 % natif |
| WebSocket inchangé | L'événement `transaction:status` (avec `at`) est inchangé ; le client l'ignore s'il n'est pas abonné aux nouveaux champs |

### 3.3 Performance

- `useTransactionWebSocket` : callback référencé via `useRef` (déjà en place) — pas de re-subscription.
- Map `txId → statut` : une seule mise à jour par événement, `FlatList` inchangée (aucune re-render globale).
- Animation de cycle : `useNativeDriver: true` obligatoirement (opacité/scale uniquement).
- Aucune requête supplémentaire quand les flags sont off (le client ne demande pas `/graph/cycles`).

---

## 4. Procédure de validation

### 4.1 Tests automatisés

| Cible | Cadre | Cas couverts |
|:---|:---|:---|
| `transactions.controller` | Jest (backend, pattern `*.spec.ts` existant) | `onchainStatus` présent/absent selon flag ; `counterpartyCountry` null-safe |
| `graph.service.cycles` | Jest | Cycle 3 nœuds détecté une seule fois (+rotation), graphe acyclique → `[]`, flag off → `[]` |
| `roi.ts` | Jest (mobile, nouveau) | Somme des txs SUCCESS × fee ; liste vide → 0 ; fee/cap du tier |
| `countryFlag()` | Jest (mobile, nouveau) | `FR`→🇫🇷, `gb`→🇬🇧, `''`/`X`/null → null |
| E2E Maestro | `.maestro/` existant (`login.yaml`, `offline-sync.yaml`) | Ajout : badge visible sur tx après règlement mocké ; cycle présent sur l'accueil si fixture de données injectée |

### 4.2 Tests manuels (émulateur + APK réel)

1. **Régression visuelle** : comparer chaque écran avec `apercu-visuel.html` (palettes sectorielles inchangées).
2. **Axe 1** : créer une tx → badge ⏳ PENDING, puis ✅ SUCCESS arrive via WS sans pull-to-refresh ; mode avion → file offline → badge intact après réouverture.
3. **Axe 2** : tx avec `counterpartyCountry='DE'` → drapeau 🇩🇪 visible ; entrée sans pays → aucune régression d'espacement.
4. **Axe 3** : fixture 3 entreprises en dette circulaire → 1 carte cycle sur l'accueil ; appui → surlignage du cycle dans le graphe.
5. **Axe 5** : tap nœud → sheet (nom/pays/volume) ; double-tap hors nœud → fermeture ; aucun freeze de l'animation (dev mode 60 fps, RN `PerfMonitor`).
6. **Axe 6** : provoquer un échec on-chain → toast ❌ Échec avec message d'erreur ; synchro offline → barre de progression n/m puis toast succès.
7. **Flags off (défaut)** : bundle avec `FF_*=false`/variables absentes → comportement strictement identique à V1.4 livrée (checklist des 6 points au-dessus inversée).

### 4.3 Validation de non-régression du build

- Rebuild complet APK : `clearnet-mobile\build-gradle.cmd` (Gradle 8.0.1 / JDK 17 / AGP 7.4.2 / NDK 26.3 — stack validée en session).
- Suite backend : `npm test` (backend, specs existantes + nouvelles).

---

## 5. Calendrier estimé (en jours ouvrables)

| Axe | Sous-tâches | Backend | Mobile | Tests | Total |
|:---|:---|:---|:---|:---|:---|
| 1 – Statut on-chain | 1.1 → 1.4 | 0,25 | 1 | 0,5 | **1,75** |
| 2 – Drapeaux pays | 2.1 → 2.5 | 0,5 | 1 | 0,5 | **2** |
| 3 – Cycles détectés | 3.1 → 3.5 | 1 | 1,25 | 1 | **3,25** |
| 4 – Économies réalisées | 4.1 → 4.4 | 0,25 (optionnel) | 0,75 | 0,5 | **1,5** |
| 5 – Graphe interactif | 5.1 → 5.3 | 0 | 2 | 1 | **3** |
| 6 – Toasts & progression | 6.1 → 6.5 | 0 | 1,5 | 0,5 | **2** |
| **Total axes** | | **2** | **7,5** | **4** | **13,5** |
| Forfait intégration + APK (flags, build full, checklist manuelle) | | | | | **2** |
| **TOTAL V1.4-UX** | | | | | **≈ 15,5 j** |

> Hypothèses : 1 développeur senior mobile + 1 backend (mi-temps sur Axes 2-3) ; pas de prise en compte du temps d'attente CI/build (~30 min de build Android par itération, à paralléliser avec les tests Jest).

---

**Rappel du contexte de livraison** : le build Android V1.4 tourne actuellement en arrière-plan (stack validée Gradle 8.0.1 + JDK 17 + AGP 7.4.2) ; ce document n'introduit **aucune modification** du contrat Solidity ni de la stack de build.