# Pack d'exécution — Phase A commerciale (0-6 mois)

> Correspond à la feuille de route §2 Phase A « Tâches commerciales » :
> 3 secteurs pilotes, 10 entreprises/secteur, NDA, co-création.

---

## 1. Les 3 secteurs pilotes (et pourquoi)

| Secteur | Densité de transactions croisées | Friction BFR | Pourquoi ClearNet y gagne |
|---|---|---|---|
| **Transport maritime** | Très forte (armateur ↔ affréteur ↔ portuaire ↔ énergéticien ↔ commissionnaire) | Cycles longs 30-90 j | Écosystème fermé, déjà équipé EDI, DSO élevé |
| **Construction / BTP** | Forte (maître d'ouvrage ↔ majors ↔ sous-traitants) | Retards de paiement structurels (loi LME) | Cascade de dettes idéale pour le netting |
| **Pharmacie / Santé** | Forte (labo ↔ grossiste ↔ hôpital ↔ façonniers) | Marges serrées, exigence de conformité | Bonus : argument ZK (confidentialité des prix négociés) |

---

## 2. Cibles prioritaires — transport maritime (5 premières)

| # | Cible | Rôle dans l'écosystème | Accroche pour ClearNet |
|---|---|---|---|
| 1 | **CMA CGM** (Marseille) | Armateur mondial | Des centaines de contreparties payeuses/payées — ROI immédiat |
| 2 | **Grand Port Maritime de Marseille** | Autorité portuaire | Fédérateur naturel : peut embarquer ses concessionnaires |
| 3 | **Bolloré Logistics** | Commissionnaire de transport | Nœud central multi-clients = multi-cycles |
| 4 | **Compagnie Nationale du Rhône (CNR)** | Logistique fluviale + énergie | Croisements maritime/fluvial/énergie |
| 5 | **Fédération nationale des ports** / **UMF** (Union Maritime et Fluviale) | Fédération professionnelle | Effet de levier : 10 pilotes via la fédération |

> Stratégie : contacter d'abord la **fédération** (n°5) pour un parrainage, puis
> approcher les entreprises avec l'appui fédéral. Doubler par un intérêt
> économique direct : « combien coûte votre DSO ? » (voir accroche mail).

---

## 3. E-mail de premier contact (modèle)

**Objet :** Réduire votre besoin en fonds de roulement — compensation de dettes interentreprises

```
Bonjour [Prénom Nom],

Chez [Entreprise], chaque créance en attente finance le besoin en fonds de
roulement — souvent à 8-15 % par an. Une partie de ces dettes forme des cycles
entre partenaires (vous devez à X qui doit à Y qui vous doit) qui pourraient
être compensés en net au lieu d'être payés en brut.

ClearNet est une plateforme de compensation multilatérale interentreprises :
elle détecte ces cycles, les solde en un minimum de paiements, et garantit la
confidentialité des montants par preuve cryptographique (zero-knowledge).

Pour les entreprises pilotes du transport maritime, nous proposons :
- un diagnostic gratuit de vos cycles de dettes (données anonymisées),
- un accès gratuit pendant 6 mois,
- un accompagnement dédié (intégration ERP/EDI incluse).

Gain typique mesuré : BFR réduit de 10 à 25 % sur les flux éligibles.

Seriez-vous disponible 20 minutes la semaine prochaine pour une démonstration ?

Bien cordialement,
[Vous] — ClearNet
```

---

## 4. Fiche pilote (une page, à envoyer en PJ)

**ClearNet — Programme Pilote Transport Maritime**

- **Durée** : 6 mois, gratuit, sans engagement.
- **Ce que vous fournissez** : export anonymisé de vos flux payés/payeurs (ou connexion ERP en lecture seule).
- **Ce que ClearNet fournit** : diagnostic des cycles, compensations nettes, tableau de bord de trésorerie, confidentialité ZK, traçabilité on-chain.
- **Sécurité** : données chiffrées, KYB, RGPD (suppression de compte possible à tout moment).
- **À la fin** : vous gardez les gains réalisés ; poursuite en abonnement (Free/99 €/499 €/1 999 €) ou arrêt sans frais.
- **Preuve** : démo 3 min (script : `docs/DEMO_VIDEO_3MIN.md`) + PoC Sepolia/zkEVM auditable.

---

## 5. Accord de confidentialité & expérimentation (modèle)

**ACCORD DE CONFIDENTIALITÉ ET D'EXPÉRIMENTATION**

Entre **ClearNet** ([forme sociale], [adresse]) et **[Entreprise pilote]** ([forme sociale], [adresse]), ci-après « les Parties ».

1. **Objet** : expérimentation de la plateforme ClearNet (compensation multilatérale) pendant 6 mois.
2. **Confidentialité** : chaque Partie s'engage à ne divulguer aucune information confidentielle de l'autre (8 ans). Les données de flux sont traitées selon la politique de confidentialité ClearNet (RGPD).
3. **Propriété** : les données fournies par le Pilote restent sa propriété ; ClearNet les traite uniquement pour l'expérimentation. Les résultats agrégés et anonymisés peuvent être publiés (volumes compensés).
4. **Gratuité** : aucun frais pendant la période d'expérimentation.
5. **Résiliation** : à tout moment, préavis 30 jours ; suppression des données à la demande.
6. **Responsabilité** : ClearNet fournit un service « en l'état » en phase pilote ; les Parties conviennent d'un partage des risques d'expérimentation.
7. **Droit applicable** : droit français ; tribunal compétent : [ville].

Fait en deux exemplaires, le [date]. — Signatures.

---

## 6. Ateliers de co-création (programme type)

| Atelier | Objectif | Durée |
|---|---|---|
| #1 Découverte | cartographier les flux & points de friction | 2 h |
| #2 Diagnostic | présenter les cycles détectés (données réelles) | 2 h |
| #3 Co-conception | prioriser les cas d'usage + connecteurs ERP | 3 h |
| #4 Bilan | mesurer le gain, décider la suite | 1 h |

---

## 7. Suivi commercial (tableau de bord de prospection)

| Cible | Contact | Statut | Prochaine action | Date |
|---|---|---|---|---|
| UMF/Fédération | — | à contacter | mail + appel | — |
| CMA CGM | — | à contacter | intro via fédération | — |
| GPMM | — | à contacter | mail diagnostic | — |
| Bolloré Logistics | — | à contacter | mail diagnostic | — |
| CNR | — | à contacter | mail diagnostic | — |
