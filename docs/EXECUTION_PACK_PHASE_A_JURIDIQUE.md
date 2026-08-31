# Pack d'exécution — Phase A juridique & conformité (0-6 mois)

> Correspond à la feuille de route §2 Phase A « Tâches juridiques et conformité » :
> avis juridique, KYB/AML, CGU, SLA, RGPD.

---

## 1. Avis juridique — qualification de l'activité (mémorandum à soumettre au conseil)

### Questions posées au conseil

1. La **compensation multilatérale de créances** entre entreprises constitue-t-elle :
   - un service de paiement au sens de la DSP2 (France : Code monétaire et financier) ?
   - un service de « monnaie électronique » ?
   - une simple prestation de services (hors périmètre) ?
2. Le **token CLRN** relève-t-il de **MiCA** (UE 2023/1114) : utility token, e-money token ou asset-referenced token ?
3. Le règlement **on-chain** des positions nettes modifie-t-il la qualification ?
4. Dans quelles juridictions cibles (France, UE, hors-UE) l'activité est-elle soumise à licence ou enregistrement ?

### Hypothèses internes (à faire valider)

- **Compensation multilatérale de créances entre entreprises** = hors périmètre DSP2 si aucun « fonds » n'est détenu par ClearNet et si le règlement net reste exécuté de compte à compte entre les parties (à confirmer).
- **CLRN** = utility token (réduction de frais, accès) → pas d'e-money token (pas de valeur stable revendiquée).
- Risque principal : **l'apparence de service de paiement** → structurer ClearNet comme « orchestrateur de netting + instructions de paiement », le règlement fiat transitant par les banques des parties.

### Livrable demandé au conseil

- Note d'analyse (10-15 pages) + plan de structuration + matrice des licences par pays. Budget : 5-10 k€.

---

## 2. Procédure KYB / AML (Know Your Business)

### KYC/KYB en 4 niveaux

| Niveau | Contrôle | Documents | Déclencheur |
|---|---|---|---|
| N0 | Email professionnel + SIREN auto | — | Inscription |
| N1 | Vérification SIREN (INSEE) + représentant légal | KBis < 3 mois, pièce d'identité du représentant | 1re transaction |
| N2 | Bénéficiaires effectifs + screening sanctions | Déclaration BE, screening OFAC/UE/ONU (API ou CSV — déjà câblé `OFAC_API_KEY`/`OFAC_CSV_PATH`) | volume cumulé > 100 k€ |
| N3 | Conformité renforcée (PEP, source des fonds) | Questionnaires, preuve d'origine | volume > 1 M€ |

### Décisions de risque

- `APPROVED` / `REVIEW` (revue humaine) / `BLOCKED` (sanctions).
- Réévaluation annuelle + à chaque événement déclencheur (changement de BE, sanction nouvelle).

### Implémentation (s'appuie sur l'existant)

- Backend : étendre le nœud `User` (`kybLevel`, `kybStatus`, `sanctioned` déjà présent).
- Module `KybService` : appels API INSEE/SIREN + screening listes.

---

## 3. Conditions Générales d'Utilisation (CGU) — sommaire exécutoire

1. **Objet** : plateforme de compensation multilatérale — ClearNet ne détient jamais les fonds.
2. **Inscription** : réservée aux personnes morales ; KYB obligatoire ; exactitude des informations.
3. **Service** : détection de cycles, netting, instructions de règlement ; best effort (SLA §4 du contrat, pas des CGU).
4. **Obligations de l'utilisateur** : licéité des créances, exactitude des montants, confidentialité des accès.
5. **Frais** : selon la grille tarifaire (Free/Essentiel/Pro/Enterprise) ; commissions sur règlements réussis.
6. **Données** : politique de confidentialité ; droit à l'effacement (suppression de compte dans l'app).
7. **Responsabilité** : ClearNet responsable des dommages directs (plafond = frais des 12 derniers mois) ; exclusion des dommages indirects (sauf dol/faute lourde).
8. **Propriété intellectuelle** : plateforme © ClearNet ; données métier = utilisateur.
9. **Résiliation** : à tout moment ; données supprimées sous 30 jours.
10. **Droit applicable** : français.

---

## 4. SLA — Accord de Niveau de Service (résumé contractuel)

| Engagement | Niveau | Mesure |
|---|---|---|
| Disponibilité plateforme | 99,5 % (Phase A) → 99,9 % (Phase B) | minutes d'indisponibilité/mois |
| Temps de détection de cycle | < 5 min après ingestion | job `cycle-alerts` |
| Règlement on-chain (instruction) | < 60 s après validation | métriques `transaction:status` |
| Rétention des données | contrat + 30 j | politique de suppression |
| Support | réponse < 4 h ouvrées (Pro/Enterprise) | ticketing |

Pénalités : crédits de service = 5 % de l'abonnement mensuel par tranche de 0,1 % de disponibilité manquée (plafond 50 %).

---

## 5. RGPD — registre des traitements (résumé à compléter)

| Traitement | Données | Base légale | Durée |
|---|---|---|---|
| Compte & authentification | nom, email, hash mdp | contrat | durée du compte |
| Compensation | montants, contreparties, factures | contrat | 5 ans (comptabilité) puis anonymisation |
| Facturation | identifiant Stripe | contrat | 10 ans (fiscal) |
| Conformité KYB | KBis, BE, screening | obligation légale | 5 ans après fin de relation |
| Sécurité/audit | logs | intérêt légitime | 12 mois |

- **DPO** : à désigner (externe possible) — contact `privacy@clearnet.fr` déjà dans la politique.
- **Droits** : accès, rectification, effacement (déjà implémenté : `DELETE /api/auth/account`), portabilité, opposition.
- **Transferts hors UE** : hébergement UE ; tout sous-traitant hors UE → SCC.

---

## 6. Jalons juridiques Phase A

| Jalon | Livrable |
|---|---|
| J+10 | Note de qualification soumise au conseil |
| J+30 | CGU + SLA signées par le 1er pilote |
| J+45 | KYB N0-N1 en production |
| J+60 | Registre RGPD + DPO désigné |
