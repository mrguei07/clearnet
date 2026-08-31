# Pack d'exécution — Phase A financement (0-6 mois)

> Correspond à la feuille de route §2 Phase A « Tâches de financement » :
> due diligence, subventions (Bpifrance, Horizon Europe), business angels.

---

## 1. Dossier de due diligence — sommaire de la data room

```
/01-corporate
    statuts, KBis, pacte d'associés, cap table
/02-produit
    architecture (ce repo), roadmap, roadmap de sécurité, aperçus interactifs
/03-technique
    audits (à venir : ZK), tests (5/5 contrats, 30/30 backend), CI/CD
/04-juridique
    avis de qualification (en cours), CGU, SLA, politique de confidentialité,
    registre RGPD, KYB/AML
/05-commercial
    kit pilotes, pipeline, lettres d'intention, études de cas
/06-financier
    business plan, projections (EXECUTIVE_SUMMARY_INVESTISSEURS.md),
    grille tarifaire (TARIFICATION_V1_5.md), burn & runway
/07-token
    whitepaper économique (Phase B), tokenomics CLRN
/08-rh
    organigramme, fiches de poste, plan de stock-options
```

**Règle** : chaque dossier = un PDF horodaté ; réviser à chaque levée.

---

## 2. Subventions d'innovation — fiches de candidature (résumés prêts à soumettre)

### 2.1 Bpifrance — Aide « DeepTech » / « Innovation » (France)

| Champ | Contenu proposé |
|---|---|
| Thème | Preuve à divulgation nulle (Groth16) appliquée à la compensation B2B confidentielle |
| Verrous | Confidentialité des montants entre concurrents ; passage à l'échelle des preuves par lots |
| Livrables | Circuit ZK audité, connecteurs ERP, démonstrateur zkEVM |
| Budget | 400-600 k€ sur 24 mois (2 ingénieurs ZK + audit + intégrations) |
| Retombées | 30 pilotes, 10 M€ compensés/mois, souveraineté fintech française |

### 2.2 Horizon Europe — EIC Accelerator (ou EIT Digital)

| Champ | Contenu proposé |
|---|---|
| Call | EIC Accelerator (TRL 6-8) — deeptech fintech |
| Problème | 1 500 Md€ de créances B2B financées à 8-15 %/an en Europe |
| Solution | Compensation multilatérale confidentielle (ZK) + règlement net |
| Impact | Réduction du BFR des PME européennes ; marché : 3 secteurs pilotes puis expansion UE |
| Demande | 2,5 M€ grant + 10 M€ equity (option) |

### 2.3 Autres guichets

- **France 2030** — volet « Souveraineté numérique / finance innovante ».
- **Région Sud (PACA)** — aides innovation (ancrage Marseille/maritime).

---

## 3. Approche business angels & family offices

### Liste de cibles (profil)

| Type | Exemples de réseaux | Argument |
|---|---|---|
| Réseaux fintech FR | France FinTech, Paris Business Angels, Femmes Business Angels | traction pilotes + série A |
| Family offices | industriels (logistique/énergie) | intérêt stratégique (leurs participations utiliseraient ClearNet) |
| Ex-fondateurs fintech | anciens fondateurs de solutions de paiement B2B | réseau + opérationnel |

### E-mail d'approche (modèle court)

```
Objet : ClearNet — compensation B2B confidentielle (ZK) — tour de table early

Bonjour [Nom],

ClearNet compense les dettes interentreprises : nous détectons les cycles
(A doit à B doit à C doit à A) et les soldons en net, avec confidentialité
cryptographique des montants. Le MVP est en production (contrats audités,
CI/CD, mobile prêt Play Store) et nous ouvrons 30 postes pilotes dans le
transport maritime.

Nous levons [x] k€ en convertibles avant la Série A (5-10 M€) prévue dans
12-18 mois. Executive summary en PJ — 20 minutes pour vous montrer la démo ?

[Vous]
```

### Pièces jointes

- `EXECUTIVE_SUMMARY_INVESTISSEURS.md`
- `DEMO_VIDEO_3MIN.md` (script) ou l'aperçu interactif en ligne
- Lien GitHub public + CI (preuve de livraison)

---

## 4. Jalons financement Phase A

| Jalon | Action |
|---|---|
| J+7 | Data room structurée (dossiers ci-dessus) |
| J+15 | Candidatures Bpifrance + EIC soumises |
| J+30 | 10 rencontres BA/family offices |
| J+60 | Convertibles signées (objectif) |
