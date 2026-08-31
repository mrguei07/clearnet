# Pack d'exécution — Phase A produit (0-6 mois)

> Correspond à la feuille de route §2 Phase A « Tâches produit ».
> L'essentiel s'appuie sur des briques déjà existantes (ROI, cycles, app mobile).

---

## 1. Tableau de bord de trésorerie (gain net après compensation)

### Définition produit

Un écran « Trésorerie » (nouvel onglet mobile + page web) montrant :

| Bloc | Métrique | Source déjà en code |
|---|---|---|
| Capital immobilisé | Somme des créances > 30 j | `UsersService.computeRoi()` (`total_immobilise`) |
| Trésorerie libérée | Montants reçus via compensation | `total_liberes` |
| Économie potentielle | immobilisé × 15 % (coût d'opportunité) | `economie_potentielle` |
| Cycles actifs | Nombre + montant compressible | graphe Neo4j (détection de cycles) |
| BFR / DSO estimé | immobilisé / CA mensuel déclaré | nouveau champ `monthlyRevenue` |

### Actions d'exécution

- [ ] Backend : exposer `GET /api/transactions/treasury` (reprend `computeRoi` + cycles, ajoute `dsoEstimate`).
- [ ] Mobile : nouvel onglet « Trésorerie » (ou carte enrichie sur l'Accueil) — réutilise le widget « Économies réalisées » existant.
- [ ] Export PDF du tableau de bord (réutilise `expo-print` déjà présent).

### Maquette de l'écran (structure)

```
┌ Trésorerie ────────────────────────┐
│  Économie potentielle  1 284 €/mois│
│  ▓▓▓▓▓▓░░  capital immobilisé      │
│  4 cycles actifs  ·  240 k€ nettable│
│  DSO estimé : 52 j  (▼ 9 j vs avant)│
│  [Exporter PDF]                     │
└─────────────────────────────────────┘
```

---

## 2. Alertes & recommandations proactives de cycles

### Règles d'alerte (V1)

| # | Règle | Canal |
|---|---|---|
| A1 | Cycle détecté ≥ 50 k€ impliquant le client | Notification in-app + e-mail quotidien (1 seul, agrégé) |
| A2 | Quota mensuel ≥ 80 % | existant (Slack/écran) — étendre à l'e-mail |
| A3 | Dette vérifiée en retard > 15 j | notification + suggestion de compensation |
| A4 | Nouveau partenaire éligible (même secteur) | notification |

### Implémentation

- Backend : job quotidien (BullMQ `cycle-alerts`) → requête Cypher de cycles → notifications.
- Exemple Cypher (détection de cycle de longueur 3) :
```cypher
MATCH (a:User)-[:SENT]->(t1:Transaction)<-[:RECEIVED]-(b:User),
      (b)-[:SENT]->(t2:Transaction)<-[:RECEIVED]-(c:User),
      (c)-[:SENT]->(t3:Transaction)<-[:RECEIVED]-(a)
WHERE a.email = $email
RETURN a.email, b.email, c.email, min(t1.amount, t2.amount, t3.amount) AS nettable
```

---

## 3. UX directeurs financiers (mobile & desktop)

### Principes retenus

1. **3 gestes max** : connexion → voir le solde → compenser un cycle (actuel : déjà le cas).
2. **Chiffres avant jargon** : montants nets, jamais de hash en premier plan (le hash on-chain est dans « Détails »).
3. **Web desktop** : le bundler web Expo existe (`expo start --web`) — décliner les 4 onglets en layout desktop 2 colonnes (graphe + liste) via CSS responsive.
4. **Rôles** : vue CFO (agrégats multi-entités) en V2 ; V1 = vue entreprise unique.

---

## 4. Bac à sable (sandbox)

### Offre « essayer sans engagement »

- **Démo publique** : l'aperçu interactif existant (`docs/apercu-visuel.html`) sert de vitrine sans compte.
- **Sandbox connectée** : environnement `sandbox.clearnet.fr` avec Neo4j jetable + Sepolia (ou zkEVM testnet), comptes de démo pré-remplis (10 entreprises fictives multi-secteurs), réinitialisation hebdomadaire.
- **Provisionnement** : réutiliser `infrastructure/docker-compose.yml` + un seed `scripts/seed-demo.sh` existant.

### Check-list d'exécution

- [ ] Déployer le backend sandbox (docker compose, secrets de démo).
- [ ] Seed 10 entreprises (maritime, construction, pharma).
- [ ] Page d'inscription « accès sandbox instantané ».
- [ ] Bandeau « données réinitialisées chaque lundi ».

---

## 5. Jalons produit Phase A

| Jalon | Sortie |
|---|---|
| J+20 | `GET /api/transactions/treasury` + écran Trésorerie |
| J+35 | Job `cycle-alerts` (A1/A3) |
| J+45 | Sandbox en ligne |
| J+60 | Web desktop responsive V1 |
