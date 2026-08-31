# ClearNet — Executive Summary (Investisseurs)

**Version : V1.5 · Document confidentiel · Destinataires : investisseurs & conseil**

> ClearNet est la plateforme de **compensation multilatérale de dettes interentreprises**.
> Elle identifie les cycles de créances entre sociétés, les solde en un nombre minimal
> de paiements, et garantit la confidentialité des montants par preuve à divulgation
> nulle de connaissance (ZK Groth16). Résultat mesurable : **réduction structurelle du
> besoin en fonds de roulement (BFR)**, sans intermédiaire financier.

---

## 1. Le problème

En Europe, les entreprises supportent **~1 500 Md€ de créances commerciales** en
permanence (DSO moyen 55-60 jours). Dans une chaîne de valeur, A doit à B, B doit à C,
C doit à A : chacun finance l'attente de l'autre via **lignes de crédit, affacturage
ou découvert**, à un coût de **8 à 15 % par an**. Ce capital immobilisé est une pure
inefficience de réseau — et personne ne peut la résoudre seul.

## 2. La solution

ClearNet détecte les **cycles de dettes** dans le graphe des transactions et les
**compense en net** : 3 factures de 1 M€ se règlent en 1 paiement de 200 k€.

| Avantage | Détail |
|---|---|
| 💰 Trésorerie | BFR réduit, DSO raccourci, gain mesurable par tableau de bord |
| 🔒 Confidentialité | Montants cryptés par **ZK Groth16** — les concurrents ne voient pas vos flux |
| ⚡ Règlement | On-chain (smart contract `CompensationEngine`) avec traçabilité et multisig 2/3 |
| 🤝 Sans intermédiaire | Pas de banque, pas de fonds déposés — uniquement une infrastructure de compensation |

## 3. Le produit — déjà construit (MVP V1.5)

Stack réelle et testée :

- **Backend** NestJS + **Neo4j** (graphe de compensation), API REST + WebSocket temps réel, file BullMQ/Redis, Prometheus/Grafana, Helm/K8s.
- **Blockchain** Solidity 0.8 (token CLRN ERC-20 + `CompensationEngine`), circuit **ZK Groth16** (ceremony documentée), pont Sepolia, multisig 2/3.
- **Mobile** React Native / Expo SDK 57 (Android AAB construit en CI GitHub Actions — prêt Play Store), mode hors-ligne SQLite, export PDF.
- **Monétisation** Stripe : 4 niveaux (Free / Essentiel / Pro / Enterprise), quotas, webhooks, commissions timbrées par transaction.
- **Conformité** flags OFAC/ITAR, rate-limiting, RGPD (suppression de compte implémentée), politique de confidentialité.

## 4. Modèle économique (V1.5)

| Niveau | Prix | Opérations/mois | Commission |
|---|---|---|---|
| Free | 0 € | 15 | 2,0 % |
| Essentiel | 99 € | 50 | 1,5 % |
| Pro | 499 € | 500 | 1,2 % |
| Enterprise | 1 999 € | Illimité | 0,9 % |

Deux moteurs de revenus : **abonnements** (MRR) + **commissions sur volume compensé**
(prélèvement automatisé en P2 — déjà « timbré » sur chaque transaction).

## 5. Projections 24 mois (alignées sur la feuille de route)

| Indicateur | M6 (fin Phase A) | M12 | M18 | M24 |
|---|---|---|---|---|
| Entreprises actives | 30 (pilotes) | 60 | 80 | **100** |
| Dettes compensées / mois | 10 M€ | 25 M€ | 40 M€ | **50 M€** |
| MRR abonnements | ~9 k€ | ~26 k€ | ~41 k€ | **~55 k€** |
| Rétention | — | — | — | **> 90 %** |

*Hypothèses M24 : mix 30 Free / 25 Essentiel / 25 Pro / 20 Enterprise.*
*Upside commissions (P2) : 50 M€ × ~1 % ≈ 500 k€/mois additionnels.*

## 6. Besoin de financement

- **Maintenant** : subventions d'innovation (Bpifrance, Horizon Europe) pour l'audit ZK et les connecteurs ERP.
- **Phase B (6-18 mois)** : **Série A de 5 à 10 M€** — déploiement commercial (10 pilotes × 3 secteurs → 100 entreprises), conformité/licences, équipe.
- **Phase C (18-36 mois)** : Série B de 20 à 50 M€ pour l'expansion internationale.

## 7. Risques & mitigations

| Risque | Mitigation |
|---|---|
| Adoption lente | Pilotes sectoriels ciblés, ROI démontré, connecteurs ERP (SAP/Oracle/Odoo) |
| Réglementaire (services de paiement ?) | Avis juridique immédiat, KYB/AML, licences précoces |
| Technique (ZK, scalabilité) | Audit externe du circuit, zkEVM, lots ZK |
| Concurrence | Confidentialité ZK + absence d'intermédiaire = différenciation structurelle |

## 8. Prochaines étapes (30 jours)

1. Geler V1.5 : circuit ZK finalisé + testnet persistant.
2. Chef de projet conformité.
3. 5 entreprises pilotes (transport maritime).
4. Démo vidéo 3 min (script livré : `docs/DEMO_VIDEO_3MIN.md`).
5. Ce document — à diffuser après validation du conseil.

---

*Contact : à compléter — Le présent document ne constitue pas une offre de titres financiers.*
