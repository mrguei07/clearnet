# Pack d'exécution — Phase B croissance ciblée (6-18 mois)

> Correspond à la feuille de route §2 Phase B. Chaque item = un livrable prêt à assigner.

---

## 1. Technique

### 1.1 Cloud multi-régions 99,9 %
- Cible : K8s managé (GKE/EKS/AKS) × 3 zones + Neo4j Aura Enterprise (ou causal cluster).
- Le Helm chart existe déjà (`infrastructure/helm/clearnet`) : ajouter `topologySpreadConstraints` + PodDisruptionBudget + HPA multi-métriques.
- Objectif RTO < 1 h / RPO < 5 min (backups Neo4j `neo4j-admin backup`).

### 1.2 Tests de charge & sécurité automatisés
- Outillage : k6 (charge API/WebSocket), OWASP ZAP (scan API), Slither/Aderyn (contrats), dépendabot + gitleaks (déjà en CI).
- Cadence : pentest externe semestriel ; scan de charge avant chaque release.

### 1.3 Lots ZK (batch proof)
- Déjà spécifié : `docs/ZK_BATCH_INTEGRATION.md` — implémenter le prouveur par lot (100-500 tx/preuve) côté backend, preuve unique vérifiée on-chain.

### 1.4 Règlement net fiat (SEPA / instantané / prélèvement)
- Architecture : ClearNet émet des **instructions de paiement net** aux banques des parties (pas de fonds détenus).
- Partenariats : open banking (PSD2) via agrégateur (ex. Tink, Finverse) + fichiers SEPA XML pain.001 pour les banques classiques.
- Option V2 : IBAN virtuels (BaaS) uniquement si la qualification juridique l'impose.

---

## 2. Produit

| Item | Spec résumée |
|---|---|
| **Portail partenaire** (experts-comptables, intégrateurs) | workspace multi-clients, commission de revue 20 %, API token |
| **Simulation avant engagement** | « et si j'entre ce cycle ? » — calcul du net prévisionnel sur données anonymisées |
| **Rapports d'audit vérifiables** | export PDF + preuve ZK + hash on-chain horodaté (déjà : export PDF mobile) |
| **Scoring de solvabilité** | score interne basé sur l'historique de compensation (régularité, montants, retards) |

---

## 3. Commercial

- **Parrainage** : 1 mois offert par filleul converti (plafond 6 mois).
- **Salons** : VivaTech (Paris), Money 20/20 (Amsterdam), SITL (transport), Big Data & AI Paris ; stand « démo cycle 3 min ».
- **Fédérations** : UMF (maritime), FFB/EGF (BTP), Leem (pharma) — pack d'adhésion fédéral préparé.
- **Force de vente** : 2 AE senior (finance d'entreprise) + 1 SDR + revendeurs régionaux (20 % de marge).
- **Études de cas** : gabarit — contexte / cycles détectés / net compensé / BFR gagné / ROI — publier 1/mois.

---

## 4. Tokenomics CLRN (whitepaper économique — plan)

1. **Utilité** : (a) réduction de frais (staking CLRN = -20 % commissions), (b) accès avancé (API ouverte, multi-entités), (c) récompenses de vérification (liquidity of verification).
2. **Offre** : 1 Md CLRN — répartition proposée : 30 % écosystème/récompenses, 20 % équipe (vesting 4 ans), 20 % trésorerie, 15 % investisseurs, 10 % liquidité, 5 % conseil.
3. **Mécanismes** : staking, burn de 10 % des commissions, gouvernance progressive.
4. **DEX** : listing Uniswap V3 (Polygon) avec liquidité initiale de 100-200 k€.
5. **Fidélité** : points → CLRN pour volume compensé (non rétroactif, hors US).

> Rédaction du whitepaper complet : action Phase B — le présent plan en est le sommaire validé.

---

## 5. Juridique & conformité

- **Licences** : selon l'avis Phase A — viser l'**enregistrement PSAN** (France) ou l'équivalent EU ; établissement de monnaie électronique **seulement si** des fonds sont détenus.
- **Partenariats bancaires** : 1 banque partenaire (compte de cantonnement dédié) + 1 acquéreur (Stripe déjà intégré).
- **OFAC/sanctions auto** : jobs quotidiens de mise à jour des listes (le squelette `ComplianceService` existe).
- **Politique de sécurité + rapport de transparence** : publier semestriellement (volumes, incidents, audits).

---

## 6. Financement — Série A (5-10 M€)

### Plan d'usage des fonds (scénario 7 M€)

| Poste | Montant | Horizon |
|---|---|---|
| Équipe (12 mois) | 3,2 M€ | run |
| Go-to-market pilotes → 100 entreprises | 1,5 M€ | 18 mois |
| ZK batch + audits | 0,8 M€ | 12 mois |
| Conformité/licences | 0,6 M€ | 18 mois |
| Infrastructure cloud | 0,5 M€ | 18 mois |
| Réserve | 0,4 M€ | — |

### Métriques à présenter aux VC

CAC < 3 000 € · LTV/CAC > 5 · NRR > 110 % · volume compensé mensuel en croissance · rétention > 90 %.

---

## 7. Jalons Phase B

| Mois | Jalon |
|---|---|
| M6-M9 | 60 entreprises, 25 M€/mois, MRR 26 k€ |
| M9-M12 | Lots ZK + SEPA net en production |
| M12 | Série A clôturée |
| M12-M18 | 80 entreprises, 40 M€/mois, portail partenaire |
