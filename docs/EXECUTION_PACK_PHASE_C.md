# Pack d'exécution — Phase C passage à l'échelle (18-36 mois)

> Correspond à la feuille de route §2 Phase C. Objectif : devenir la norme de
> compensation interentreprises dans plusieurs secteurs.

---

## 1. Technique

### 1.1 Nœuds de validation décentralisés
- V1 : 5-7 validateurs institutionnels (fédérations, cabinets d'audit, industriels) signant les lots de règlement (multisig on-chain étendu — le `MultiSigWallet 2/3` existe déjà).
- V2 : réseau PoA → PoS léger, sélection des validateurs par réputation (volume compensé vérifié).

### 1.2 Multi-blockchain
- Polygon zkEVM (primaire) + Linea / Scroll (redondance) ; passerelle de messages `IZkVerifier` identique sur chaque chaîne ; failover automatique côté backend.

### 1.3 Oracles financiers
- `ChainlinkPriceFeed.sol` **déjà présent** dans le repo → câbler les flux de change (EUR/USD/…) et de taux pour la valorisation temps réel des créances.

### 1.4 Règlements multi-devises
- Position nette par devise, conversion via oracles au moment du netting, instructions SEPA/SWIFT par devise.

---

## 2. Produit

### 2.1 API ouverte
- `api.clearnet.fr/v1` publique (OAuth2 client-credentials) : cycles, netting, rapports — documentation OpenAPI + sandbox.
- Tarification d'usage pour les tiers (rev share 80/20).

### 2.2 IA prédictive
- Modèle : prédiction des cycles futurs (graphe + saisonnalité + historiques de paiement) → recommandations « compensez avant le 15 ».
- Architecture : features Neo4j → modèle (XGBoost initial, GNN ensuite) ; API `POST /insights/predict-cycles`.

### 2.3 Marketplace d'apps partenaires
- Catégories : scoring crédit, assurance-crédit, financement de factures, intégrations ERP.
- Modèle : listing + commission 10-20 % ; SDK + sandbox pour développeurs.

---

## 3. Commercial

- **5 secteurs × 50 entreprises** : maritime, BTP, pharma, énergie, agroalimentaire (ordre de conquête recommandé).
- **Grands groupes** : signer 2 « deployments de chaîne d'approvisionnement » (un groupe impose ClearNet à ses fournisseurs — effet réseau massif).
- **International** : Allemagne (B2B pay-later massif), Benelux (ports), Italie (BTP), puis Asie (Singapour) / Amérique du Nord (via partenaire local).
- **Statut « fournisseur de confiance »** : dialogue avec l'ANC (normes comptables) et l'EFRAG (reporting) pour la reconnaissance des compensations nettes.

---

## 4. Tokenomics & gouvernance

- **DAO** : snapshot + délégation par volume compensé vérifié ; vote sur les paramètres (frais, burn, validateurs).
- **Burn/buyback** : 10 % des commissions → buyback + burn trimestriel (annoncé à l'avance, hors US).
- **Liquidité** : DEX initial (Phase B) → 1-2 CEX réglementés (Phase C) ; teneur de marché institutionnel.

---

## 5. Juridique & conformité

- **ISO 27001 + SOC 2 Type II** : plan — SMSI (6 mois) → audit (3 mois) ; SOC 2 Type I à M24, Type II à M30.
- **Enregistrements** : opérateur de plateforme selon les juridictions ; dialogue avec l'AMF/ACPR en continu.
- **Consultations réglementaires** : contribuer aux consultations MiCA/deFi (position papers publics — crédibilité + influence).

---

## 6. Financement — Série B (20-50 M€)

- **Usage** : expansion internationale (40 %), R&D IA/multi-chaîne (25 %), commercial (20 %), réserves réglementaires (15 %).
- **Cibles** : fonds growth fintech + corporate ventures (banques, assureurs-crédit, industriels).
- **Métriques attendues** : > 250 entreprises, 100 M€+/mois compensés, ARR > 5 M€.

---

## 7. Jalons Phase C

| Mois | Jalon |
|---|---|
| M18-M24 | 100 entreprises, 50 M€/mois, MRR 55 k€, rétention > 90 % |
| M24-M30 | API ouverte + marketplace (10 apps) |
| M30-M36 | 5 secteurs × 50, multi-chaîne, ISO 27001/SOC 2, Série B |
