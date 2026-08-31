# Pack d'exécution — Phase A technique (0-6 mois)

> Correspond à la feuille de route §2 Phase A « Tâches techniques ».
> Statut : livrables exécutés sous forme de runbooks/specs — les étapes externes
> (audit, clés RPC, faucet) restent à provisionner par l'équipe.

---

## 1. Gel V1.5 — circuit ZK (Groth16) : audit & non-régression

**État vérifié** : `circuits/transaction.circom` présent ; cérémonie de confiance
documentée (`docs/CEREMONIE_TRUSTED_SETUP.md`) ; intégration ZK par lots
(`docs/ZK_BATCH_INTEGRATION.md`). Contrats compilés, **5/5 tests passent**
(`npx hardhat test` — ClearNetToken, CompensationEngine, MultiSigWallet 2/3).

### Checklist de gel (à cocher par l'équipe)

- [x] `npx hardhat compile` sans erreur (fait)
- [x] `npx hardhat test` 5/5 (fait)
- [ ] `./scripts/generate-zk-keys.sh` : régénérer les clés de test (toy phase 2) et vérifier `VERIFIER_ADDRESS`
- [ ] Test de non-régression ZK : prouver/vérifier 1 batch de 3 transactions (gabarit : `ZK_BATCH_INTEGRATION.md` §tests)
- [ ] **Audit externe** : lancer un appel d'offres — cibles : Trail of Bits, Quantstamp, Zellic (annexe A : trame du cahier des charges)
- [ ] Corriger tout finding avant le tag `v1.5.0` de gel

### Annexe A — Trame de cahier des charges d'audit

1. Périmètre : `transaction.circom` + `IZkVerifier` + `CompensationEngine` (contrat proxy ZK).
2. Menaces : fuite de confidentialité des montants, malleabilité des preuves, replay, front-running du `settle`.
3. Livrables : rapport + PoC d'exploit éventuel + recommandations classées (Critique/Élevé/Moyen/Faible).
4. Délai : 3-4 semaines. Budget indicatif : 15-40 k€ selon périmètre.

---

## 2. Migration `CompensationEngine` → zkEVM (Polygon zkEVM)

### Plan (M1-M2 de la Phase A)

| Étape | Action |
|---|---|
| 1 | Ajouter le réseau dans `hardhat.config.ts` (voir patch ci-dessous) |
| 2 | Récupérer ETH de test zkEVM Cardona (faucet Polygon) |
| 3 | `npx hardhat run scripts/deploy.ts --network polygonZkEvm` |
| 4 | Vérifier le vérifieur ZK sur la chaîne (coût gaz ≈ 300 k gas/preuve) |
| 5 | Sponsorisation du gaz : relais paymaster — options : (a) `CustomPaymaster` EIP-4337, (b) relais maison qui signe les `settle` côté backend (recommandé V1) |
| 6 | Reporter les adresses dans `clearnet-backend/.env` (`BLOCKCHAIN_RPC_URL`, `CLRN_TOKEN_ADDRESS`, `COMPENSATION_ENGINE_ADDRESS`) |

### Patch `hardhat.config.ts` (réseau Polygon zkEVM)

```ts
polygonZkEvm: {
  url: process.env.POLYGON_ZKEVM_RPC_URL || '',
  accounts: process.env.POLYGON_ZKEVM_PRIVATE_KEY ? [process.env.POLYGON_ZKEVM_PRIVATE_KEY] : [],
},
```
Ajouter au `.env.example` : `POLYGON_ZKEVM_RPC_URL=` et `POLYGON_ZKEVM_PRIVATE_KEY=`.

> **Décision gaz sponsorisé** : en V1, le backend signe les `settle` avec la clé
> opérateur (déjà le pattern `BLOCKCHAIN_PRIVATE_KEY`) ; les utilisateurs ne paient
> jamais de gaz. En V2, migrer vers un paymaster EIP-4337.

---

## 3. Connecteurs ERP (SAP, Oracle, Dynamics, Odoo)

### Architecture retenue : un adaptateur par ERP, une API interne unique

```
ERP (SAP/Oracle/Dynamics/Odoo) ── webhook / polling ──> [ClearNet Connector Gateway]
        POST /connectors/events { source, externalId, fromCompany, toCompany, amount, currency, invoiceRef, dueDate }
        → normalisation → graphe Neo4j (dettes) → détection de cycles
```

### Spécification de l'endpoint (OpenAPI 3.0, extrait)

```yaml
openapi: 3.0.1
info: { title: ClearNet Connector Gateway, version: 1.0.0 }
paths:
  /connectors/events:
    post:
      summary: Ingestion d'une dette/créance depuis un ERP
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [source, externalId, fromCompany, toCompany, amount, currency]
              properties:
                source:   { type: string, enum: [SAP, ORACLE, DYNAMICS, ODOO] }
                externalId: { type: string }
                fromCompany: { type: string }   # SIREN / DUNS / VAT
                toCompany:   { type: string }
                amount:    { type: number, minimum: 0.01 }
                currency:  { type: string, default: EUR }
                invoiceRef: { type: string }
                dueDate:   { type: string, format: date }
      responses:
        '202': { description: Accepted (traitement asynchrone) }
        '409': { description: Doublon (externalId déjà vu) — idempotence }
```

### Connecteurs livrés dans ce pack (spécifications)

| ERP | Mécanisme | Détail |
|---|---|---|
| **SAP S/4HANA** | OData `I_BillingDocument` + webhook CDS | map : `BillingDocument`→facture, `SoldToParty`→contrepartie |
| **Oracle NetSuite** | SuiteScript RESTlet + Saved Search | map : `invoice` → `tranid` |
| **Dynamics 365** | Dataverse `invoices` table + Power Automate | map : `invoicenumber` |
| **Odoo** | Module addon `clearnet_connector` (Python) | `account.move` → événement JSON |

> **Livrable suivant** : squelette du module NestJS `ConnectorModule` (M3) — la
> spec ci-dessus est la source de vérité.

---

## 4. Vérification des créances (Factur-X / Peppol / EDI)

### Spécification du module `invoice-proof`

| Étape | Action |
|---|---|
| 1 | Réception de la facture électronique (Factur-X = PDF/A-3 + XML ; Peppol = UBL BIS 3) |
| 2 | Extraction : montant, TVA, SIREN émetteur/destinataire, échéance |
| 3 | Contrôles : cohérence montant vs dette déclarée, doublon (`hash` du XML), fournisseur enregistré (KYB) |
| 4 | Statut de la dette : `VERIFIED` / `PENDING_PROOF` / `MISMATCH` |
| 5 | Mismatch → alerte au CFO (pas de blocage : dégradation douce) |

### Formats supportés (ordre de priorité)

1. **Peppol BIS Billing 3** (UBL 2.1) — prioritaire (réseau européen).
2. **Factur-X** (ZUGFeRD 2.x / Factur-X 1.07) — prioritaire France.
3. **EDI** (EDIFACT INVOIC) — via passerelle de conversion (ex. API partenaire).

### Bibliothèques cibles (backend NestJS)

- `mustache`/`xmldom` pour le parsing UBL (léger) ; ou `peppol-bis` validators existants.
- Stockage : document hashé en Neo4j (nœud `InvoiceProof`) + fichier en object storage.

---

## 5. Suivi & jalons Phase A technique

| Jalon | Date cible | Sortie |
|---|---|---|
| Gel contrats + tests | J+7 | tag `v1.5.0` |
| Audit ZK lancé | J+15 | cahier des charges envoyé |
| zkEVM Cardona déployé | J+30 | adresses + tx Etherscan |
| Gateway connecteurs (spec figée) | J+30 | ce document |
| POC Odoo (1er connecteur) | J+60 | démo pilote |
