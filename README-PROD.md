# ClearNet V1.3 — Industrialisation & Durcissement (PRODUCTION)

Procédure opérationnelle : **prérequis → exécution → vérification → rollback**.
Périmètre livré :

| Livrable | Fichier | Rôle |
|---|---|---|
| Script Linux/WSL | `scripts/clearner-prod.sh` | Déploiement production en une commande |
| Script Windows | `scripts/clearner-prod.ps1` | Équivalent PowerShell |
| Overrides Helm prod | `infrastructure/helm/clearnet/values-production.yaml` | Image v1.3.0, HA, TLS, file BullMQ |
| Dashboard Grafana | `infrastructure/grafana/dashboard-clearnet.json` | Supervision (Prometheus + ingress-nginx + redis-exporter) |
| File de règlements BullMQ | `clearnet-backend/src/transactions/transaction.processor.ts` | Consommateur de la file `onchain-settlement` |

---

## 1. Prérequis

| Élément | Version | Notes |
|---|---|---|
| Docker | 24+ | `docker info` OK |
| Kubernetes | 1.27+ | `kubectl cluster-info` OK (kind, minikube, cloud, RKE…) |
| Helm | 3.12+ | `helm version` |
| Registry | — | `ghcr.io/clearnet/backend` (ou `REGISTRY=…` au lancement) |
| Redis | 7.x | **requis uniquement si `QUEUE_ENABLED=true`** (dans le cluster ou externe) |
| Bash (WSL2) ou PowerShell 5.1+ | — | selon plateforme |

### Secrets à préparer (jamais commités)

```bash
export JWT_SECRET="$(openssl rand -hex 32)"          # signature JWT
export NEO4J_PASSWORD="$(openssl rand -hex 16)"      # mot de passe graphe
export REDIS_PASSWORD="$(openssl rand -hex 16)"      # si Redis sécurisé
export SLACK_WEBHOOK_URL=""                          # (optionnel) alertes échecs définitifs
```
> ⚠️ Les passer dans l'environnement d'exécution : les scripts les injectent
> via `--set` (`backend.jwtSecret`, `neo4j.authPassword`, `backend.env.REDIS_PASSWORD`).
> **Production** : ne JAMAIS passer les secrets en `--set` (historique de commandes
> exposé) — voir §5 « Gestion des secrets ».

---

## 2. Exécution

### 2.1 Déploiement complet (Linux / WSL2)

```bash
# depuis la racine du dépôt
JWT_SECRET=… NEO4J_PASSWORD=… REDIS_PASSWORD=… ./scripts/clearner-prod.sh
# variantes :
REGISTRY=my.registry/clearnet/backend TAG=v1.3.0 NAMESPACE=clearnet ./scripts/clearner-prod.sh
PUSH_IMAGE=1 ./scripts/clearner-prod.sh              # + docker push
```

### 2.2 Déploiement complet (Windows PowerShell)

```powershell
$env:JWT_SECRET="…"; $env:NEO4J_PASSWORD="…"; $env:REDIS_PASSWORD="…"
.\scripts\clearner-prod.ps1
.\scripts\clearner-prod.ps1 -PushImage -Tag v1.3.0 -Namespace clearnet
```

Le script enchaîne : build image → lint + template Helm → `helm upgrade --install`
(`-f values-production.yaml`, `--wait`) → rollout → health `/api/health` →
smoke e2e (register → login → `/transactions/balance`).

### 2.3 Si les scripts ne sont pas utilisables (exécution manuelle)

```bash
docker build -t ghcr.io/clearnet/backend:v1.3.0 clearnet-backend
helm upgrade --install clearnet infrastructure/helm/clearnet \
  -f infrastructure/helm/clearnet/values-production.yaml \
  --namespace clearnet --create-namespace --wait --timeout 5m \
  --set backend.jwtSecret="$JWT_SECRET" \
  --set neo4j.authPassword="$NEO4J_PASSWORD" \
  --set backend.env.REDIS_PASSWORD="$REDIS_PASSWORD"
```

### 2.4 Environnement local avec la file BullMQ (développement)

```powershell
# infrastructure/docker-compose.yml inclut désormais redis (7-alpine, healthcheck)
$env:QUEUE_ENABLED = "true"
docker compose up --build -d
docker compose logs -f backend
```

> ⚠️ **Variable réelle d'environnement** : la file est câblée au chargement du
> module (`QUEUE_ENABLED === 'true'`). Elle n'est pas lue depuis un `.env`
> seul — exporter la variable (shell / conteneur / ConfigMap) puis redémarrer.
>
> **Sémantique (3.1)** : le *câblage* (module BullMQ + processor) est statique
> (redémarrage requis). La *décision* d'acheminer chaque transaction par la
> file est évaluée **dynamiquement** (ConfigService) : désactiver
> `QUEUE_ENABLED` en cours de vie du pod bascule proprement sur le
> fire-and-forget, sans redémarrage.

### 2.5 Activation / désactivation de la file

| `QUEUE_ENABLED` | Comportement du règlement on-chain |
|---|---|
| `false` (défaut) | fire-and-forget V1.2 préservé — aucune dépendance Redis |
| `true` | job BullMQ `onchain-settlement` : retries exponentielles (`QUEUE_ATTEMPTS`=5, `QUEUE_BACKOFF_MS`=5000), traçabilité, diffusion `transaction:status` |

Variables associées : `REDIS_HOST` (défaut `redis`), `REDIS_PORT` (6379),
`REDIS_PASSWORD` (vide), `QUEUE_ATTEMPTS`, `QUEUE_BACKOFF_MS`.

### 2.6 Échecs définitifs de règlement (3.3 — DLQ légère)

Chaque échec définitif (retries BullMQ épuisées) déclenche :
1. **Audit** : nœud `FailedJob` créé en Neo4j (`jobId`, `queue`, `txId`, `error`,
   `attemptsMade`, `failedAt`) — requête de revue :
   `MATCH (f:FailedJob) RETURN f ORDER BY f.failedAt DESC LIMIT 50`.
2. **Notification** : message envoyé au webhook `SLACK_WEBHOOK_URL` (optionnel,
   vide = désactivée).
3. La transaction reste **valide hors-chaîne** (statut `FAILED` + `onchainError`
   sur le nœud Transaction — dette de règlement traçable).

---

## 3. Vérification

```bash
# 1. Santé de la release
helm status clearnet -n clearnet
kubectl get pods -n clearnet -l app=backend -o wide          # Ready 3/3

# 2. Healthcheck HTTP (via l'ingress ou un port-forward)
curl -fsS https://api.clearnet.example.com/api/health        # {"status":"ok","neo4j":"up"}
curl -fsS https://api.clearnet.example.com/api/blockchain/status

# 3. File BullMQ (si QUEUE_ENABLED=true) — jobs en attente/échecs
kubectl exec -it deploy/clearnet-backend -n clearnet -- sh -c \
  'wget -qO- http://redis:6379' # connexion Redis OK
redis-cli -h <redis> keys 'bull:*:onchain-settlement:*'

# 4. Supervision Grafana — importer infrastructure/grafana/dashboard-clearnet.json
#    (variables : datasource Prometheus, namespace clearnet)

# 5. Logs en cas de doute
kubectl logs -n clearnet -l app=backend --tail=200
```

### Smoke test manuel complet (hors port-forward)

```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@clearnet.io","password":"clearnet-demo"}'   # après seed démo
```

---

## 4. Rollback

```bash
# Retour à la révision Helm précédente (même secrets injectés)
helm rollback clearnet -n clearnet
# ou révision précise :
helm history clearnet -n clearnet
helm rollback clearnet <REVISION> -n clearnet

# Désactiver la file BullMQ sans déployer :
helm upgrade clearnet infrastructure/helm/clearnet \
  -f infrastructure/helm/clearnet/values-production.yaml \
  --set backend.env.QUEUE_ENABLED=false -n clearnet
```

**Principes de réversibilité** : la file BullMQ est optionnelle (défaut off) ;
le pont on-chain reste réversible (`ONCHAIN_ENABLED=false`) ; aucune migration
de données irréversible n'est déclenchée par ce périmètre.

---

## 5. Gestion des secrets (3.4)

Trois options, de la plus simple à la plus robuste. **En production, privilégier
B ou C** : ne jamais exposer les clés dans l'historique de commandes.

### Option A — `--set` (développement / validation uniquement)

```bash
helm upgrade --install clearnet infrastructure/helm/clearnet \
  -f infrastructure/helm/clearnet/values-production.yaml \
  --set backend.jwtSecret="$JWT_SECRET" --set neo4j.authPassword="$NEO4J_PASSWORD"
```
⚠️ Clés visibles dans l'historique du shell et du Helm history.

### Option B — Secret Kubernetes + `existingSecret` (recommandé production)

```bash
# 1. Créer le Secret une seule fois (jamais commité, jamais en --set)
kubectl create secret generic clearnet-secrets -n clearnet \
  --from-literal=jwt-secret="$(openssl rand -hex 32)" \
  --from-literal=password="$(openssl rand -hex 16)" \
  --from-literal=auth="neo4j/$(openssl rand -hex 16)"

# 2. Référencer le Secret dans le chart (clés : jwt-secret, password, auth)
helm upgrade --install clearnet infrastructure/helm/clearnet \
  -f infrastructure/helm/clearnet/values-production.yaml \
  --set backend.existingSecret=clearnet-secrets \
  --set neo4j.existingSecret=clearnet-secrets
```

Le chart ne génère alors **plus** le Secret Neo4j interne : le backend lit
`jwt-secret`/`password` et Neo4j lit `auth` (format `user/password`) depuis
`clearnet-secrets` (clés : `jwt-secret`, `password`, `auth`).
Rotation : `kubectl create secret` (nouveau nom) puis re-déploiement + rollback
immédiat si problème.

### Option C — SealedSecrets (Bitnami) ou ExternalSecrets (KMS/Vault)

Les secrets sont **chiffrés dans le dépôt / injectés depuis le gestionnaire**
au moment du déploiement — jamais visibles dans les commandes :

- **SealedSecrets** : `kubeseal` chiffre le Secret → manifest `SealedSecret`
  commitable (clé privée dans le cluster) ; le contrôleur le désaçelle puis le
  chart référence le Secret résultant via `existingSecret`.
- **ExternalSecrets** (AWS KMS / HashiCorp Vault) : le contrôleur ES injecte le
  Secret depuis le gestionnaire ; même mécanisme `existingSecret` ensuite.

Références : `deployment/sealed-secrets/` (à créer), `PHASE2_DEPLOYMENT.md`.

---

## 6. CI avant déploiement (3.5)

`.github/workflows/ci-validation.yml` s'exécute à chaque push / pull request,
**avant tout déploiement** :

| Étape | Vérification |
|---|---|
| `helm lint` + `helm template` | chart + `values-production.yaml` + `values.yaml` (rendu 7-8 ressources) |
| `bash -n scripts/*.sh` | syntaxe des scripts shell |
| `npm ci` + `npm run build` | compilation backend |
| `npm test` | tests unitaires + **intégration BullMQ** (Redis provisionné en service CI — cf. §7) |

---

## 7. Test d'intégration BullMQ (3.2)

`clearnet-backend/src/transactions/queue.integration.spec.ts` valide le flux
complet : création de transaction → job `onchain-settlement` (Redis **réel**)
→ processor → **SUCCESS/FAILED** (écriture Neo4j) → **événement WebSocket**
(`transaction:status`).

- Exécution locale avec Redis : `docker run -d -p 6379:6379 redis:7-alpine`
  puis `npm test -- --runInBand` (2 tests d'intégration actifs).
- Sans Redis joignable, la suite reste **verte** avec un avertissement explicite
  (les assertions ne s'exécutent qu'en CI, où un service Redis est fourni).
- Le driver Neo4j est mocké : la boucle « job → statut → WebSocket » est le
  cœur testé ; Neo4j réel est couvert par l'E2E Sepolia
  (`DEPLOYMENT_STRATEGY_AND_EARLY_ADOPTERS.md`, Action 2).

---

## 8. Notes de durcissement (rappel des règles du dépôt)

- Les flags de durcissement (`ITAR_ENABLED`, `ORACLES_ENABLED`, `ZK_ENABLED`,
  `ONCHAIN_ENABLED`) restent **désactivés par défaut** : les activer uniquement
  après provisionnement des clés (voir `PHASE2_DEPLOYMENT.md`,
  `PONT_SEPOLIA_DEPLOYMENT.md`).
- `DEMO_API_KEY` vide en production = routes `/api/demo/*` verrouillées (401).
- Le dashboard Grafana s'appuie sur les exporteurs standards (kube-state-metrics,
  ingress-nginx, redis-exporter) ; l'exposition `/metrics` prom-client côté
  backend (jobs BullMQ, latences HTTP) est l'étape suivante d'industrialisation.
