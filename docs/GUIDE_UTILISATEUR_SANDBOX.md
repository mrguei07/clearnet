# ClearNet Sandbox — Guide utilisateur rapide (1 page)

## 1. Se connecter (30 secondes)

1. Ouvrir `https://sandbox.clearnet.fr` (ou l'URL fournie par l'équipe).
2. Compte de démonstration : `armateur-cmr@maritime-demo.fr` / `Sandbox2026!`
   (ou le compte dédié fourni pour votre entreprise).
3. Le thème s'adapte à votre secteur d'activité.

## 2. Lire le tableau de bord (1 minute)

- **Accueil** : solde disponible, derniers règlements, cycles détectés.
- **Tréso** : capital immobilisé (> 30 j), trésorerie libérée, **économie
  potentielle** (15 %/an), cycles compensables, DSO estimé.
- **Réseau** : graphe de vos contreparties (colorées par secteur) — cliquez
  un nœud pour la fiche, **▶ Simuler** pour voir les règlements en direct.

## 3. Importer vos données (2 options)

| Option | Comment |
|---|---|
| **CSV** (le plus rapide) | Format : `source;externalId;fromCompany;toCompany;amount;currency;invoiceRef;dueDate` — envoyer à l'équipe, import en 1 commande (`import-csv-connectors.ps1`, exemple : `scripts/exemple-import-maritime.csv`) |
| **Connecteur ERP** | SAP / Oracle / Dynamics / Odoo — `POST /api/connectors/events` (spec fournie) ; comptez 1 jour d'intégration |

## 4. Voir la compensation

1. **Réseau** → les cycles s'affichent en surbrillance avec le montant nettable.
2. Valider un cycle → les transactions se règlent en net (statut ⏳ → ✅).
3. La **preuve** (hash on-chain) est consultable dans les détails de la transaction.

## 5. Confidentialité & sécurité

- Les **montants sont masqués** aux autres membres (preuves ZK Groth16) — vos
  concurrents ne voient jamais vos flux.
- Données chiffrées en transit (HTTPS), RGPD (suppression de compte à tout moment).
- Rien n'est payé pendant le pilote : compensation simulée ou réelle selon votre choix.

## 6. Support

- Contact : [email] · réponse < 4 h ouvrées pendant le pilote.
- Réunion de suivi mensuelle (30 min) — engagement maximal : 1 h/semaine.
