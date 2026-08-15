# INDUSTRIALISATION_RESPONSE.md — ClearNet V1.3 · Production (BullMQ + Helm + Scripts + Monitoring)

> **Périmètre exécuté strictement** : A. Scripts Shell/PowerShell de déploiement
> production · B. Manifests K8s (Helm overrides + dashboard Grafana) ·
> C. Configuration backend (file BullMQ `transaction.processor.ts`) ·
> D. Documentation opérationnelle (`README-PROD.md`).
>
> **Règle d'or respectée** : tout le dispositif d'industrialisation est **off par
> défaut** (`QUEUE_ENABLED=false`) — le comportement V1.2 (fire-and-forget, aucune
> dépendance Redis) reste le défaut ; l'API et le mobile sont inchangés.

---

## 0. Note de contexte (important pour le review)

- Le backend était en **V1.3.0** avant ce périmètre (solde, pagination, egonet,
  gateway socket.io, `user.industry`). Ce livrable ajoute **uniquement** la couche
  opérationnelle de production — **aucun contrat API ni flux métier n'est modifié**.
- La file BullMQ remplace le fire-and-forget **uniquement** si la variable
  d'environnement **réelle** `QUEUE_ENABLED=true` (évaluation statique au chargement
  du module — documenté : ne pas passer par `.env` seul, exporter la variable puis
  redémarrer le pod). Sans Redis ni flag, le backend démarre strictement comme avant.
- Les fichiers de scripts ont été nommés **exactement** comme demandé
  (`clearner-prod.sh` / `clearner-prod.ps1`, orthographe « clearner » conservée).
- PowerShell 5.1 lit les fichiers en ANSI : les scripts sont **ASCII strict**
  (pas d'em-dash/UTF-8 multi-octets) pour rester « copier-coller » exécutables
  sur Windows.

---

## 1. Arborescence du livrable

```
C:\dev\ClearNet\
├── README-PROD.md                                     # (D) procédure complète
├── scripts\
│   ├── clearner-prod.sh                               # (A) Linux / WSL2
│   └── clearner-prod.ps1                               # (A) Windows PowerShell 5.1+
├── infrastructure\
│   ├── grafana\dashboard-clearnet.json                 # (B) supervision production
│   ├── docker-compose.yml                              # (C) + service redis:7-alpine
│   └── helm\clearnet\
│       ├── values.yaml                                 # (B/C) + env file/Redis/démo
│       ├── values-production.yaml                      # (B) overrides production
│       └── templates\backend-configmap.yaml            # (B/C) rendu des nouvelles env
└── clearnet-backend\
    ├── package.json / package-lock.json                # (C) + @nestjs/bullmq, bullmq
    └── src\transactions\
        ├── transaction.processor.ts                    # (C) NOUVEAU — worker BullMQ
        ├── transactions.module.ts                      # (C) câblage conditionnel
        └── transactions.service.ts                     # (C) dispatch file/fallback
```

---

## 2. Diff(s) sur fichiers existants

### 2.1 `clearnet-backend/src/transactions/transactions.module.ts` — câblage BullMQ conditionnel

```diff
+import { BullModule } from '@nestjs/bullmq';
+import { ConfigService } from '@nestjs/config';
+import { TransactionProcessor, ONCHAIN_QUEUE } from './transaction.processor';
+
+// File BullMQ : activée uniquement si QUEUE_ENABLED=true (règle d'or : off par défaut)
+const queueEnabled = process.env.QUEUE_ENABLED === 'true';

 @Module({
-  imports: [ComplianceModule, UsersModule],
+  imports: [
+    ComplianceModule,
+    UsersModule,
+    ...(queueEnabled
+      ? [
+          BullModule.forRootAsync({
+            inject: [ConfigService],
+            useFactory: (config: ConfigService) => ({
+              connection: {
+                host: config.get<string>('REDIS_HOST', 'redis'),
+                port: Number(config.get<string>('REDIS_PORT', '6379')),
+                password: config.get<string>('REDIS_PASSWORD', '') || undefined,
+                maxRetriesPerRequest: null,
+              },
+              defaultJobOptions: {
+                attempts: Number(config.get<string>('QUEUE_ATTEMPTS', '5')),
+                backoff: { type: 'exponential', delay: Number(config.get<string>('QUEUE_BACKOFF_MS', '5000')) },
+                removeOnComplete: 1000,
+                removeOnFail: 5000,
+              },
+            }),
+          }),
+          BullModule.registerQueue({ name: ONCHAIN_QUEUE }),
+        ]
+      : []),
+  ],
   controllers: [TransactionsController],
-  providers: [TransactionsService, TransactionGateway],
+  providers: [TransactionsService, TransactionGateway, ...(queueEnabled ? [TransactionProcessor] : [])],
   exports: [TransactionsService],
 })
 export class TransactionsModule {}
```

### 2.2 `clearnet-backend/src/transactions/transactions.service.ts` — dispatch file / fallback

```diff
+import { InjectQueue } from '@nestjs/bullmq';
+import { Queue } from 'bullmq';
+import { ONCHAIN_QUEUE } from './transaction.processor';
+
   constructor(
     ...
     private readonly gateway: TransactionGateway,
+    @Optional() @InjectQueue(ONCHAIN_QUEUE) private readonly queue?: Queue,
   ) { ... }

       // création (POST /transactions) — en arrière-plan, réponse 201 non bloquée :
-      this.processOnChainSettlement(record.id, ...).catch(...);   // fire-and-forget
+      if (this.queue) {
+        await this.queue.add(ONCHAIN_QUEUE, {
+          txId: record.id, fromEmail: input.fromEmail, toEmail: input.toEmail, amount: input.amount,
+        });
+      } else {
+        this.processOnChainSettlement(record.id, ...).catch(...); // fallback V1.2
+      }

-  private async updateTransactionHash(txId, hash) { ... }        // → public
-  private async updateTransactionStatus(txId, status, msg) { ... } // → public
+  async markOnchainSuccess(txId: string, hash: string): Promise<void> { ... }
+  async markOnchainFailed(txId: string, errorMessage: string): Promise<void> { ... }
```

> Rétrocompat : `history`, `list`, `balance`, gateway `transaction:status`,
> validation pipe — intacts (11/11 tests).

### 2.3 `infrastructure/docker-compose.yml` — service Redis (prérequis file)

```diff
 services:
+  redis:
+    image: redis:7-alpine
+    container_name: clearnet-redis
+    command: ["redis-server", "--maxmemory-policy", "noeviction", "--appendonly", "yes"]
+    ports: ["6379:6379"]
+    volumes: [redis-data:/data]
+    healthcheck:
+      test: ["CMD", "redis-cli", "ping"]
+      ...
   backend:
     environment:
+      QUEUE_ENABLED: ${QUEUE_ENABLED:-false}
+      REDIS_HOST: ${REDIS_HOST:-redis}
+      REDIS_PORT: ${REDIS_PORT:-6379}
+      REDIS_PASSWORD: ${REDIS_PASSWORD:-}
+      QUEUE_ATTEMPTS: ${QUEUE_ATTEMPTS:-5}
+      QUEUE_BACKOFF_MS: ${QUEUE_BACKOFF_MS:-5000}
     depends_on:
       neo4j: { condition: service_healthy }
+      redis: { condition: service_healthy }
 volumes:
   neo4j-data:
+  redis-data:
```

### 2.4 Chart Helm — `values.yaml` + `backend-configmap.yaml`

```diff
 # values.yaml
   env:
     ...
+    QUEUE_ENABLED: "false"
+    REDIS_HOST: "redis"
+    REDIS_PORT: "6379"
+    REDIS_PASSWORD: ""
+    DEMO_API_KEY: ""          # clé vide = routes /demo verrouillées (401)
+  queue:
+    enabled: false
+    attempts: 5
+    backoffMs: 5000

 # templates/backend-configmap.yaml
 data:
   ...
+  QUEUE_ENABLED: {{ .Values.backend.env.QUEUE_ENABLED | quote }}
+  REDIS_HOST: {{ .Values.backend.env.REDIS_HOST | quote }}
+  REDIS_PORT: {{ .Values.backend.env.REDIS_PORT | quote }}
+  REDIS_PASSWORD: {{ .Values.backend.env.REDIS_PASSWORD | quote }}
+  QUEUE_ATTEMPTS: {{ .Values.backend.queue.attempts | quote }}
+  QUEUE_BACKOFF_MS: {{ .Values.backend.queue.backoffMs | quote }}
+  DEMO_API_KEY: {{ .Values.backend.env.DEMO_API_KEY | quote }}
```

---

## 3. Nouveaux fichiers (résumé)

| Fichier | Rôle |
|---|---|
| `transaction.processor.ts` | Worker BullMQ `onchain-settlement` : `settleCompensation` → `markOnchainSuccess` + `transaction:status SUCCESS` ; échec → `markOnchainFailed` + `FAILED` + rethrow (retries exponentielles, traçabilité) |
| `values-production.yaml` | image v1.3.0, 3 réplicas + HPA 3→8 (CPU 65 %), resources 500m/1Gi, ingress TLS, throttling 300 req/min, `QUEUE_ENABLED=true` (REDIS_HOST à ajuster), démo verrouillée, durcissement off |
| `dashboard-clearnet.json` | Grafana (schemaVersion 39) : 12 panneaux — disponibilité, QPS/5xx/p95 ingress, CPU/mémoire, Redis (clients/mémoire/ops), Neo4j, panneau explicatif BullMQ |
| `clearner-prod.sh` | prérequis → build/push → lint+template → upgrade --wait → rollout → health → smoke e2e (register→login→balance) ; secrets par `--set` ; rollback en sortie |
| `clearner-prod.ps1` | équivalent Windows (ASCII strict, port-forward + Invoke-RestMethod) |
| `README-PROD.md` | prérequis → exécution → vérification → rollback + notes durcissement |

---

## 4. Validation exécutée

| Vérification | Résultat |
|---|---|
| `npm run build` (backend 1.3.0) | OK — 0 erreur TS (module/service/processor) |
| `npx jest --runInBand` | OK — 3 suites, **11/11** tests |
| `npx tsc --noEmit` (clearnet-mobile) | OK — 0 erreur |
| `bash -n scripts/clearner-prod.sh` (git-bash) | OK — syntaxe valide |
| Parse PowerShell (`Parser.ParseFile`, PS 5.1) | OK — 0 erreur (ASCII strict) |
| `docker compose config -q` | OK — compose valide (redis + backend) |
| `ConvertFrom-Json` (dashboard Grafana) | OK — JSON valide |
| `helm lint` / `helm template` | **Non exécutables** — helm absent de la machine ; à exécuter en CI ou une fois helm installé (chart inchangé structurellement, ajout de clés env) |

---

## 5. Procédure (résumé — détail complet : `README-PROD.md`)

```bash
# Linux/WSL — depuis la racine
JWT_SECRET=$(openssl rand -hex 32) NEO4J_PASSWORD=$(openssl rand -hex 16) \
  REDIS_PASSWORD=$(openssl rand -hex 16) ./scripts/clearner-prod.sh

# Windows
$env:JWT_SECRET="…"; $env:NEO4J_PASSWORD="…"; $env:REDIS_PASSWORD="…"
.\scripts\clearner-prod.ps1
```

Rollback : `helm rollback clearnet -n clearnet` (ou `--set backend.env.QUEUE_ENABLED=false`).

---

## 6. Limites & étapes suivantes

- **`QUEUE_ENABLED` statique au chargement du module** : variable d'environnement
  réelle requise (pas `.env` seul) puis redémarrage du pod — documenté.
- **`REDIS_HOST` dans `values-production.yaml`** : valeur d'exemple
  (`clearnet-redis-master`) à ajuster au déploiement Redis réel du cluster.
- **Métriques `/metrics` (prom-client)** : non exposées (périmètre strict) — le
  dashboard utilise les exporteurs standards ; exposition des métriques BullMQ =
  étape suivante d'industrialisation.
- **`helm lint`** : à exécuter en CI (outil absent de la machine de build).
- **Smoke production réel** : nécessite un cluster + registry ; le script est prêt,
  l'exécution dépend de l'infrastructure de l'opérateur.
