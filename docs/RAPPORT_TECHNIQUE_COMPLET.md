# ClearNet — Rapport technique complet

**Version : V1.5 (gel `v1.5.0`) · Date : 2026-08-25 · Auteur : équipe technique**

---

## 1. Vue d'ensemble

ClearNet est une **plateforme de compensation multilatérale de dettes
interentreprises** : détection de cycles de créances dans un graphe, règlement
en net, confidentialité des montants par preuve ZK (Groth16), traçabilité
on-chain, application mobile et facturation intégrée.

### Architecture

```
┌─────────────┐   HTTPS/WSS   ┌──────────────────────────────┐
│  Mobile     │ ────────────► │  Backend NestJS 10           │
│  Expo SDK 57│               │  Auth JWT · Throttler        │
│  (RN 0.86)  │               │  Transactions · Billing      │
└─────────────┘               │  Graph/Cycles · Treasury     │
                              │  KYB · Connectors (ERP)      │
┌─────────────┐   REST        │  Compliance OFAC/ITAR        │
│  ERP        │ ────────────► │  ZK Proof · Oracles          │
│  SAP/Oracle │  (x-api-key)  │  BullMQ/Redis · Metrics      │
│  Dynamics/  │               └──────┬───────────────┬───────┘
│  Odoo       │                      │               │
└─────────────┘               ┌──────▼──────┐  ┌─────▼──────────────┐
                              │  Neo4j 5    │  │  Blockchain (L2)   │
                              │  graphe de  │  │  CompensationEngine│
                              │  dettes     │  │  CLRN ERC20        │
                              └─────────────┘  │  MultiSig 2/3      │
                                               │  Verifier Groth16  │
                                               └────────────────────┘
```

---

## 2. Backend — NestJS 10 + Neo4j 5

### 2.1 Surface API (résumé)

| Module | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/profile`, **`DELETE /auth/account`** (RGPD) |
| Transactions | `POST /`, `GET /`, `GET /balance`, `GET /history`, **`GET /treasury`** (Phase A) |
| Graph | `GET /graph/egonet`, **`GET /graph/cycles`** (Phase A) |
| Blockchain | `GET /blockchain/status`, `POST /blockchain/mint`, `GET /blockchain/position/:email` |
| Billing | `POST /billing/create-checkout`, `GET /billing/status`, `POST /billing/webhooks/stripe` |
| Kyb | **`GET /kyb/status`** (Phase A — N0-N3) |
| Connectors | **`POST /connectors/events`** (Phase A — ingestion ERP, idempotent) |
| Users / Company / Admin / Demo / Oracles / ZkProof / Metrics / Signatures | voir code |

### 2.2 Nouveautés V1.5 (cette itération)

- **Gateway ERP** (`src/connectors/`) : ingestion des dettes depuis
  SAP/Oracle/Dynamics/Odoo → nœuds `IngestedDebt`, idempotence
  `source:externalId` (409 doublon), garde `x-api-key` (vide = verrouillé).
- **KYB** (`src/kyb/`) : lecture du niveau/statut de conformité (`kybLevel`
  N0-N3, `kybStatus`, `sanctioned`).
- **Trésorerie** (`GET /transactions/treasury`) : capital immobilisé (> 30 j),
  trésorerie libérée, économie potentielle (15 %/an), cycles compensables,
  estimation DSO (si `monthlyRevenue` renseigné).
- **Cycles** (`GET /graph/cycles`) : détection Cypher des cycles de dettes de
  longueur 2 et 3, triés par montant nettable décroissant.

### 2.3 Robustesse

- Validation stricte (`whitelist` + `forbidNonWhitelisted`), rate-limiting
  global (`THROTTLE_LIMIT`), JWT 7 j, hash bcrypt.
- File BullMQ (`onchain-settlement`, retries ×5) + DLQ légère (nœud
  `FailedJob` + Slack) — activation dynamique via `QUEUE_ENABLED`.
- Règlement on-chain **asynchrone** (fire-and-forget ou BullMQ), statuts
  temps réel WebSocket (`transaction:status`).

---

## 3. Blockchain — Solidity 0.8.19 + Hardhat

| Contrat | Rôle |
|---|---|
| `ClearNetToken` | ERC20 CLRN (mintable par le déployeur) |
| `CompensationEngine` | Ledger de netting bilatéral (`settle` décrémente/crédite les positions nettes) |
| `MultiSigWallet` | Multisig 2/3 (garde des fonds) |
| `ChainlinkPriceFeed` | Oracle de prix (Phase C) |
| `IZkVerifier` + circuit `transaction.circom` | Confidentialité ZK (Groth16) |

- **Tests** : 5/5 (`ClearNetToken`, `CompensationEngine`, `MultiSigWallet`).
- **Réseaux configurés** : localhost, `clearnet` (RPC libre), **Sepolia**
  (testnet persistant — procédure : `CLEARNET_SEPOLIA_FINAL.md`), **Polygon
  zkEVM** (ajouté V1.5, migration cible Phase A).
- **Pont backend** : `BlockchainService` (ethers 6) — adresses déterministes
  dérivées des emails, `settleCompensation`, preuve ZK (lot), exposé via
  `GET /blockchain/status`.
- **Restant externe** : audit ZK (cahier des charges :
  `EXECUTION_PACK_PHASE_A_TECH.md`), clés RPC/faucet pour Sepolia/zkEVM.

---

## 4. Mobile — Expo SDK 57 / RN 0.86

- **Migration SDK 49 → 57 validée** : `tsc` 0 erreur, `expo-doctor` 21/21,
  `expo prebuild` (Gradle 9.3.1, New Architecture, Hermes), `expo export`
  (bundle Hermes `.hbc`, 811 modules).
- **AAB Play Store construit + validé en CI** : `app-release.aab` 29,4 Mo
  (workflow `ci-cd.yml` ; EAS alternatif : `release-store.yml`).
- Écrans : Connexion, Inscription (15 secteurs, thème dynamique), Accueil,
  Transactions (mode hors-ligne SQLite + sync), Réseau (graphe animé),
  Abonnement (4 niveaux), **Notifications & Profil + suppression de compte**.
- Durcissement store : HTTPS only (`usesCleartextTraffic=false`), permissions
  minimales (INTERNET + ACCESS_NETWORK_STATE), version 1.5.0 / versionCode 1.

---

## 5. Infrastructure & CI/CD

- **Docker Compose** (dev + prod HTTPS via Caddy) ; **Helm** (HA, HPA,
  Prometheus/Grafana, ingress TLS) ; **deploy-vps.sh** (VPS one-command,
  Let's Encrypt).
- **CI GitHub Actions** : `ci-cd.yml` (typecheck backend/mobile, tests,
  gitleaks, **build AAB** + validation, release sur tag), `mobile-ci.yml`
  (Maestro E2E), `release-store.yml` (EAS AAB+IPA), `ci-validation.yml`.
- **Environnements** : local (docker compose / natif), sandbox (prévu Phase A),
  production K8s (Helm).
- Statut CI : pipeline AAB ✅ ; 2 jobs rouges connus — `gitleaks` (secrets
  d'exemple documentés, allowlist en cours d'ajustement) et `test-backend`
  (échec Jest pré-existant à stabiliser ; n'a pas bloqué la release V1.5).

---

## 6. Sécurité & conformité

| Domaine | État |
|---|---|
| Authentification | JWT 7 j, bcrypt, rate-limiting |
| Secrets | jamais commités (`.env` gitignorés, gitleaks en CI) |
| Multisig | 2/3 pour les fonds (déployable) |
| KYB | module V1.5 (N0-N3, screening sanctions) |
| RGPD | politique de confidentialité + suppression de compte + registre (pack Phase A) |
| Store | HTTPS only, permissions minimales, data safety documenté |
| À faire | audit ZK externe, ISO 27001/SOC 2 (Phase B/C), avis juridique de qualification |

---

## 7. Validation globale

| Vérification | Résultat |
|---|---|
| Backend `tsc --noEmit` (nouveaux modules inclus) | ✅ 0 erreur |
| Contrats `npx hardhat test` | ✅ 5/5 |
| Mobile `tsc --noEmit` + `expo-doctor` | ✅ 21/21 |
| `expo export` (Hermes) | ✅ 811 modules |
| Build AAB CI + validation | ✅ 29,4 Mo |
| Tag de gel | ✅ `v1.5.0` |

---

## 8. Roadmap technique (exécution)

Les packs d'exécution livrés couvrent l'intégralité de la feuille de route
investisseur :

| Pack | Fichier |
|---|---|
| Phase A technique (ZK/zkEVM/ERP/EDI) | `EXECUTION_PACK_PHASE_A_TECH.md` |
| Phase A produit (trésorerie/alertes/sandbox) | `EXECUTION_PACK_PHASE_A_PRODUIT.md` |
| Phase A commercial (pilotes/NDA) | `EXECUTION_PACK_PHASE_A_COMMERCIAL.md` |
| Phase A juridique (KYB/CGU/SLA/RGPD) | `EXECUTION_PACK_PHASE_A_JURIDIQUE.md` |
| Phase A financement (subventions/BA) | `EXECUTION_PACK_PHASE_A_FINANCEMENT.md` |
| Phase B / C / Transverse | `EXECUTION_PACK_PHASE_B.md`, `_C.md`, `_TRANSVERSAL.md` |

**Prochain chantier code** : job `cycle-alerts` (BullMQ) branché sur
`GraphService.detectCycles` (requête déjà en place) + notifications e-mail.

---

## 9. Références

- Aperçus visuels : `docs/apercu-visuel.html` (FR), `docs/apercu-visuel-en.html` (EN).
- Déploiement : `docs/DEPLOIEMENT_HTTPS_ET_SDK57.md`, `docs/STORE_SUBMISSION.md`.
- Investisseurs : `docs/EXECUTIVE_SUMMARY_INVESTISSEURS.md`, `docs/DEMO_VIDEO_3MIN.md`.
- Historique technique : `docs/RAPPORT_TECHNIQUE.md` (V1.4).
