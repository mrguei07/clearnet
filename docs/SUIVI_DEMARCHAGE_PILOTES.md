# ClearNet — Suivi du démarchage pilotes (tableau de bord opérationnel)

> Objectif : 10 entreprises contactées → ≥ 5 démos → **≥ 3 lettres d'intention
> signées** — sous 3 semaines. Mise à jour quotidienne par l'équipe commerciale.

## 1. Pipeline (à remplir)

| Prospect | Contact | Email envoyé (J0) | Relance tél. (J+3) | Démo (J+?) | Statut | LOI |
|---|---|---|---|---|---|---|
| UMF (fédération) | — | ☐ | ☐ | ☐ | à contacter | ☐ |
| GPMM | — | ☐ | ☐ | ☐ | à contacter | ☐ |
| HAROPA Port | — | ☐ | ☐ | ☐ | à contacter | ☐ |
| Marfret | — | ☐ | ☐ | ☐ | à contacter | ☐ |
| Med Europe Terminal | — | ☐ | ☐ | ☐ | à contacter | ☐ |
| CMA CGM (Trésorerie) | — | ☐ | ☐ | ☐ | à contacter | ☐ |
| Bolloré Logistics | — | ☐ | ☐ | ☐ | à contacter | ☐ |
| Boluda France | — | ☐ | ☐ | ☐ | à contacter | ☐ |
| CNR | — | ☐ | ☐ | ☐ | à contacter | ☐ |
| La Méridionale | — | ☐ | ☐ | ☐ | à contacter | ☐ |

## 2. KPI (critères de réussite)

| Indicateur | Cible | Réalisé |
|---|---|---|
| Entreprises contactées | 10 | 0 |
| Démos réalisées | ≥ 5 | 0 |
| **Lettres d'intention signées** | **≥ 3** | **0** |
| Feedback qualitatif positif (simplicité, pertinence) | — | — |

## 3. Checklist de lancement (feuille de route §7)

- [x] Sandbox isolé (`infrastructure/docker-compose.sandbox.yml` + `.env.sandbox.example`)
- [x] Données maritimes réalistes + cycles 2/3/4 nœuds (`scripts/seed-sandbox-maritime.ps1`)
- [x] Import CSV/API documenté (`scripts/import-csv-connectors.ps1` + exemple CSV)
- [x] Guide utilisateur 1 page (`GUIDE_UTILISATEUR_SANDBOX.md`)
- [x] Vidéo 2 min (script : `DEMO_SANDBOX_2MIN.md` — à filmer)
- [x] Landing page pilotes (`landing-pilote-maritime.html`)
- [x] Proposition commerciale (`PROPOSITION_COMMERCIALE_PILOTE_MARITIME.md`)
- [x] FAQ objections (`FAQ_OBJECTIONS_COMMERCIALES.md`)
- [x] Liste 20 prospects (`LISTE_20_PROSPECTS_MARITIME.md`)
- [x] 10 e-mails prêts (`EMAILS_DEMARCHAGE_10_PILOTES.md`)
- [x] Modèle de lettre d'intention (`MODELE_LOI_PILOTE.md`)
- [x] Guide APK de test interne (EAS `preview` → sandbox) (`APK_TEST_INTERNE.md`)
- [ ] **Équipe formée** (sandbox + objections) — action humaine
- [ ] **Envois + appels** — action humaine

## 4. Risques & parades (rappel)

| Risque | Parade |
|---|---|
| Pas de réponse | Relance multi-canal (email J0, téléphone J+3, LinkedIn J+7), personnalisation |
| Démo non convaincante | Scénario personnalisé (partenaires probables), gratuité + accompagnement, cas chiffré 10 M€ → 1,5 M€ |
| Pas de données exploitables | CSV simplifié (1 page) ou saisie guidée |
| Peur blockchain/confidentialité | Preuves ZK (montants masqués) + RGPD |
| Pas de temps en interne | Engagement max : 1 h/semaine |

## 5. Prochaine action immédiate

**Réunion kick-off (technique + commercial)** : lancer le sandbox (Docker +
seed), valider la liste, envoyer les 10 e-mails à J0. Délai : **3 semaines
jusqu'aux 3 lettres d'intention**.
