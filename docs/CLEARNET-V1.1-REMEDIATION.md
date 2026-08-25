# CLEARNET V1.1 – CORRECTIFS ET EXTENSIONS

**Cible** : monorepo ClearNet V1.0 (51 fichiers, 3 lockfiles) — backend NestJS 10 / blockchain Hardhat / mobile Expo 49.
**Périmètre** : sprint de 2 semaines — 5 chantiers (E2E Docker, sécurité, pont on-chain, Sepolia, démo partenaire).
**État** : intégré dans le monorepo ET validé en conditions réelles — **E2E Docker 9/9 ✔ le 07/08/2026**, démo partenaire validée de bout en bout, 4 bugs réels V1.0 découverts et corrigés pendant la validation (voir section 7). Ce document est la source de vérité : chaque bloc est identifiable par son chemin, en `diff` pour les fichiers modifiés, en contenu complet pour les nouveaux fichiers.

---

## 1. E2E DOCKER VALIDATION

**Fichiers** : `infrastructure/docker-compose.yml` (modif), `infrastructure/test-e2e.sh` (nouveau), `infrastructure/test-e2e.ps1` (nouveau), `clearnet-backend/.dockerignore` (nouveau)

> **✅ RÉSULTAT — exécuté en conditions réelles le 07/08/2026 (Windows, Docker Desktop, WSL2)** :
> `.\infrastructure\test-e2e.ps1` → **9/9 réussi(s), 0 échec(s)** :
> `[OK] backend healthy en 5 min` · `[OK] register alice` · `[OK] register bob` · `[OK] login alice (token présent)` · `[OK] création transaction` · `[OK] historique = 1 transaction` · `[OK] destinataire = bob` · `[OK] login invalide -> 401` · `[OK] rate-limit login -> 429` — puis teardown `docker compose down -v` ✔.
> Validation démo partenaire complémentaire (même stack) : `GET /api/demo/status` sans clé → **401** ; avec `X-Demo-Key` → **200** `{users:3, transactions:3}` ; `POST /api/demo/seed` → **200** (alice/bob/carol, `clearnet-demo`) ; login `alice@clearnet.io` → token avec **id/email/name réels** ; historique → 2 transactions (carol→alice 80 €, alice→bob 250 €) avec dates ISO.
> ⚠️ Environnement de validation : le moteur Docker devait être réparé avant l'exécution (distro WSL2 `docker-desktop` corrompue, service Windows `com.docker.service` arrêté — recréée via `wsl --unregister docker-desktop`, service redémarré en admin). Non lié au code ClearNet.

### `infrastructure/docker-compose.yml` — healthcheck backend, restart, variables V1.1, healthcheck Neo4j fiabilisé

```diff
--- a/infrastructure/docker-compose.yml
+++ b/infrastructure/docker-compose.yml
@@ backend
   backend:
     build:
       context: ../clearnet-backend
     container_name: clearnet-backend
     environment:
       NODE_ENV: production
       PORT: 3000
       NEO4J_URI: bolt://neo4j:7687
       NEO4J_USER: neo4j
       NEO4J_PASSWORD: ${NEO4J_PASSWORD:-clearnet123}
       JWT_SECRET: ${JWT_SECRET:-change-me-in-production}
+      THROTTLE_TTL: ${THROTTLE_TTL:-60000}
+      THROTTLE_LIMIT: ${THROTTLE_LIMIT:-100}
+      DEMO_API_KEY: ${DEMO_API_KEY:-demo-secret-change-me}
+      # Pont on-chain (voir clearnet-backend/.env.example)
+      BLOCKCHAIN_ENABLED: ${BLOCKCHAIN_ENABLED:-false}
+      BLOCKCHAIN_RPC_URL: ${BLOCKCHAIN_RPC_URL:-}
+      BLOCKCHAIN_PRIVATE_KEY: ${BLOCKCHAIN_PRIVATE_KEY:-}
+      CLRN_TOKEN_ADDRESS: ${CLRN_TOKEN_ADDRESS:-}
+      COMPENSATION_ENGINE_ADDRESS: ${COMPENSATION_ENGINE_ADDRESS:-}
     ports:
       - "3000:3000"
     depends_on:
       neo4j:
         condition: service_healthy
+    restart: unless-stopped
+    healthcheck:
+      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
+      interval: 15s
+      timeout: 5s
+      retries: 10
+      start_period: 30s
+@@ neo4j — healthcheck fiabilisé (vérifié pendant la validation E2E)
+   neo4j:
+     image: neo4j:5.26
+     ...
+     healthcheck:
+-      test: ["CMD-SHELL", "cypher-shell -u neo4j -p $${NEO4J_PASSWORD:-clearnet123} 'RETURN 1' || exit 1"]
+-      interval: 10s
+-      timeout: 5s
+-      retries: 12
+-      start_period: 20s
++      test: ["CMD-SHELL", "wget -qO- http://localhost:7474/ >/dev/null 2>&1 || exit 1"]
++      interval: 10s
++      timeout: 10s
++      retries: 30
++      start_period: 30s
```

> **Pourquoi** : `cypher-shell` démarre une JVM complète (~20 s à froid, bien plus sur machines chargées) ; chaque tentative de check qui dépasse le timeout laisse une JVM orpheline qui consomme CPU et bloque le démarrage de Neo4j (observé en conditions réelles). Le check HTTP `wget` sur le port 7474 est instantané et sans JVM — Neo4j healthy en ~30-60 s sur la machine de validation.

### `clearnet-backend/.dockerignore` (nouveau) — contexte de build allégé

```gitignore
node_modules
dist
coverage
.env
.env.*
*.log
.git
```

> **Pourquoi** : sans `.dockerignore`, le contexte de build Docker embarque `node_modules` (~500 Mo) — transfert de contexte >100 Mo en 30 min observé lors de la validation. Avec ce fichier : contexte ~2 Ko, build complet ~7 min (dont npm ci ×2).

### `infrastructure/.env.example` — variables V1.1

```diff
--- a/infrastructure/.env.example
+++ b/infrastructure/.env.example
@@
 # Mot de passe Neo4j (doit correspondre à celui du backend/.env)
 NEO4J_PASSWORD=clearnet123
 # Secret JWT (à changer en production)
 JWT_SECRET=change-me-in-production
+# Rate-limiting
+THROTTLE_TTL=60000
+THROTTLE_LIMIT=100
+# Clé de l'API de démo partenaire (à changer hors dév.)
+DEMO_API_KEY=demo-secret-change-me
```

### `infrastructure/test-e2e.sh` — validation E2E (Mac / Linux)

```bash
#!/usr/bin/env bash
# =============================================================
# ClearNet V1.1 — Validation E2E Docker (Mac / Linux)
# Exécute : build compose -> healthcheck -> registre/login ->
# transaction -> historique -> 401/429 -> teardown.
# Usage : ./infrastructure/test-e2e.sh
# Windows : ./infrastructure/test-e2e.ps1
# =============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -f "${ROOT}/infrastructure/docker-compose.yml")
BASE_URL="${E2E_BASE_URL:-http://localhost:3000/api}"
PASS=0
FAIL=0

cleanup() {
  echo "==> Nettoyage (docker compose down -v)"
  "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

check() {
  local name="$1" ok="$2"
  if [ "$ok" = "0" ]; then
    echo "  ✔ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✘ $name"
    FAIL=$((FAIL + 1))
  fi
}

json_get() { # json_get <json> <key>
  node -e "const d=JSON.parse(process.argv[1]);console.log(d[process.argv[2]] ?? '')" "$1" "$2"
}

echo "==> [1/7] docker compose up -d --build"
"${COMPOSE[@]}" up -d --build

echo "==> [2/7] Attente du healthcheck backend (/api/health = ok)"
OK=""
for i in $(seq 1 60); do
  if curl -sf "${BASE_URL}/health" 2>/dev/null | grep -q '"status":"ok"'; then
    OK=1
    break
  fi
  sleep 5
done
check "backend healthy en 5 min" "${OK:+0:-1}"

echo "==> [3/7] Inscription de deux utilisateurs E2E"
ALICE=$(curl -sf -X POST "${BASE_URL}/auth/register" -H "Content-Type: application/json" \
  -d '{"email":"alice.e2e@clearnet.io","name":"Alice E2E","password":"e2e-password"}')
check "register alice" "$?"
BOB=$(curl -sf -X POST "${BASE_URL}/auth/register" -H "Content-Type: application/json" \
  -d '{"email":"bob.e2e@clearnet.io","name":"Bob E2E","password":"e2e-password"}')
check "register bob" "$?"

echo "==> [4/7] Login + token"
LOGIN=$(curl -sf -X POST "${BASE_URL}/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"alice.e2e@clearnet.io","password":"e2e-password"}')
TOKEN=$(json_get "$LOGIN" access_token)
check "login alice (token présent)" "$([ -n "$TOKEN" ] && echo 0 || echo 1)"

echo "==> [5/7] Transaction alice -> bob"
TX=$(curl -sf -X POST "${BASE_URL}/transactions" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" -d '{"toEmail":"bob.e2e@clearnet.io","amount":10.5,"note":"E2E"}')
check "création transaction" "$?"

echo "==> [6/7] Historique alice (1 transaction, to=bob)"
HIST=$(curl -sf "${BASE_URL}/transactions/history" -H "Authorization: Bearer $TOKEN")
HIST_COUNT=$(node -e "const d=JSON.parse(process.argv[1]);console.log(d.length)" "$HIST")
TO_EMAIL=$(json_get "$HIST" "$(node -e "const d=JSON.parse(process.argv[1]);console.log(d[0].toEmail)" "$HIST")" 2>/dev/null || echo "")
check "historique = 1 transaction" "$([ "$HIST_COUNT" = "1" ] && echo 0 || echo 1)"
check "destinataire = bob" "$([ "$TO_EMAIL" = "bob.e2e@clearnet.io" ] && echo 0 || echo 1)"

echo "==> [7/7] Sécurité : 401 (mauvais mot de passe) + 429 (rate-limit login)"
HTTP401=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/auth/login" \
  -H "Content-Type: application/json" -d '{"email":"alice.e2e@clearnet.io","password":"wrong-pass"}')
check "login invalide -> 401" "$([ "$HTTP401" = "401" ] && echo 0 || echo 1)"

HTTP429=""
for i in 1 2 3 4 5 6; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/auth/login" \
    -H "Content-Type: application/json" -d '{"email":"alice.e2e@clearnet.io","password":"wrong-pass"}')
  if [ "$CODE" = "429" ]; then HTTP429=1; break; fi
done
check "rate-limit login -> 429" "${HTTP429:-1}"

echo ""
echo "=================================================="
echo "  Résultats E2E : $PASS réussi(s), $FAIL échec(s)"
echo "=================================================="
[ "$FAIL" = "0" ]
```

### `infrastructure/test-e2e.ps1` — validation E2E (Windows PowerShell)

```powershell
# =============================================================
# ClearNet V1.1 — Validation E2E Docker (Windows PowerShell)
# Exécute : build compose -> healthcheck -> registre/login ->
# transaction -> historique -> 401/429 -> teardown.
# Usage : .\infrastructure\test-e2e.ps1
# Mac/Linux : ./infrastructure/test-e2e.sh
# =============================================================
$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BASE_URL = if ($env:E2E_BASE_URL) { $env:E2E_BASE_URL } else { "http://localhost:3000/api" }
$PASS = 0
$FAIL = 0

function Check([string]$name, [bool]$ok) {
  if ($ok) { Write-Host "  [OK] $name" -ForegroundColor Green; $script:PASS++ }
  else { Write-Host "  [KO] $name" -ForegroundColor Red; $script:FAIL++ }
}

function PostJson([string]$path, [hashtable]$body, [string]$token = "") {
  $headers = @{ "Content-Type" = "application/json" }
  if ($token) { $headers["Authorization"] = "Bearer $token" }
  Invoke-RestMethod -Uri "$BASE_URL$path" -Method Post -Headers $headers -Body ($body | ConvertTo-Json)
}

Write-Host "==> [1/7] docker compose up -d --build"
Push-Location $ROOT
$ErrorActionPreference = "Continue"
docker compose -f infrastructure/docker-compose.yml up -d --build 2>&1 | ForEach-Object { if ($_ -is [string]) { Write-Host $_ } }
if ($LASTEXITCODE -ne 0) { throw "docker compose up a echoue (code $LASTEXITCODE)" }
$ErrorActionPreference = "Stop"
Pop-Location

Write-Host "==> [2/7] Attente du healthcheck backend"
$healthy = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $h = Invoke-RestMethod -Uri "$BASE_URL/health" -TimeoutSec 5
    if ($h.status -eq "ok") { $healthy = $true; break }
  } catch { }
  Start-Sleep -Seconds 5
}
Check "backend healthy en 5 min" $healthy

Write-Host "==> [3/7] Inscription de deux utilisateurs E2E"
$alice = PostJson "/auth/register" @{ email = "alice.e2e@clearnet.io"; name = "Alice E2E"; password = "e2e-password" }
Check "register alice" ($null -ne $alice)
$bob = PostJson "/auth/register" @{ email = "bob.e2e@clearnet.io"; name = "Bob E2E"; password = "e2e-password" }
Check "register bob" ($null -ne $bob)

Write-Host "==> [4/7] Login + token"
$login = PostJson "/auth/login" @{ email = "alice.e2e@clearnet.io"; password = "e2e-password" }
Check "login alice (token présent)" (-not [string]::IsNullOrEmpty($login.access_token))

Write-Host "==> [5/7] Transaction alice -> bob"
$tx = PostJson "/transactions" @{ toEmail = "bob.e2e@clearnet.io"; amount = 10.5; note = "E2E" } $login.access_token
Check "création transaction" ($null -ne $tx)

Write-Host "==> [6/7] Historique alice (1 transaction, to=bob)"
$headers = @{ Authorization = "Bearer $($login.access_token)" }
$hist = Invoke-RestMethod -Uri "$BASE_URL/transactions/history" -Headers $headers
Check "historique = 1 transaction" ($hist.Count -eq 1)
Check "destinataire = bob" ($hist[0].toEmail -eq "bob.e2e@clearnet.io")

Write-Host "==> [7/7] Sécurité : 401 (mauvais mot de passe) + 429 (rate-limit login)"
$http401 = $false
try {
  Invoke-RestMethod -Uri "$BASE_URL/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = "alice.e2e@clearnet.io"; password = "wrong-pass" } | ConvertTo-Json) | Out-Null
} catch {
  $http401 = ($_.Exception.Response.StatusCode.value__ -eq 401)
}
Check "login invalide -> 401" $http401

$http429 = $false
for ($i = 0; $i -lt 6; $i++) {
  try {
    Invoke-RestMethod -Uri "$BASE_URL/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = "alice.e2e@clearnet.io"; password = "wrong-pass" } | ConvertTo-Json) | Out-Null
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 429) { $http429 = $true; break }
  }
}
Check "rate-limit login -> 429" $http429

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Résultats E2E : $PASS réussi(s), $FAIL échec(s)" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

Write-Host "==> Nettoyage (docker compose down -v)"
Push-Location $ROOT
$ErrorActionPreference = "Continue"
docker compose -f infrastructure/docker-compose.yml down -v 2>&1 | ForEach-Object { if ($_ -is [string]) { Write-Host $_ } }
if ($LASTEXITCODE -ne 0) { Write-Host "  [KO] docker compose down (code $LASTEXITCODE)" -ForegroundColor Red; $script:FAIL++ }
$ErrorActionPreference = "Stop"
Pop-Location

if ($FAIL -gt 0) { exit 1 } else { exit 0 }
```

> **Correctifs appliqués aux scripts pendant la validation** (vérifiés en conditions réelles) :
> - **`LoginDto.password` a `@MinLength(6)`** → un mot de passe de 5 caractères (« wrong ») renvoie **400** (ValidationPipe), pas 401. Les tests 401/429 utilisent désormais `wrong-pass` (≥ 6 caractères) pour tester réellement le chemin d'authentification.
> - **PowerShell 5.1** : avec `$ErrorActionPreference = "Stop"`, la sortie **stderr** de Docker (progrès du build) lève une erreur terminante → le script s'arrêtait pendant le build. Les appels `docker compose` basculent sur `$ErrorActionPreference = "Continue"` + contrôle explicite de `$LASTEXITCODE`.

---

## 2. SÉCURITÉ & RATE-LIMITING

**Fichiers** : `clearnet-backend/src/common/guards/rate-limit.guard.ts` (nouveau), `clearnet-backend/src/common/guards/demo-api-key.guard.ts` (nouveau), `clearnet-backend/src/app.module.ts` (modif), `clearnet-backend/src/auth/auth.controller.ts` (modif), `clearnet-backend/src/main.ts` (modif), `clearnet-backend/.env.example` (modif)

> **Note version** : `@nestjs/throttler@5.0.0` exige `reflect-metadata@^0.1.13`, incompatible avec `reflect-metadata@^0.2.2` (norme NestJS 10). Utiliser **`@nestjs/throttler@^5.1.2`**, dont le peer range est `^0.1.13 || ^0.2.0`.

### `clearnet-backend/src/common/guards/rate-limit.guard.ts` (nouveau)

```ts
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';

/**
 * Guard global de rate-limiting basé sur @nestjs/throttler 5.x.
 * Limite globale : THROTTLE_TTL / THROTTLE_LIMIT (défauts dev : 60 s / 100 req).
 * Les endpoints sensibles (auth) surchargent via @Throttle.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected async throwThrottlingException(): Promise<void> {
    throw new ThrottlerException('Trop de requêtes. Réessayez dans quelques instants.');
  }
}
```

### `clearnet-backend/src/common/guards/demo-api-key.guard.ts` (nouveau)

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guard d'API interne de démo : exige l'en-tête `X-Demo-Key`.
 * Clé lue depuis DEMO_API_KEY (défaut dev non sécurisé, à remplacer en prod).
 */
@Injectable()
export class DemoApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const expected = this.config.get<string>('DEMO_API_KEY', 'demo-secret-change-me');
    const provided = request.headers['x-demo-key'] as string | undefined;
    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Clé de démo invalide');
    }
    return true;
  }
}
```

### `clearnet-backend/src/app.module.ts` — activation globale du throttler + modules V1.1

```diff
--- a/clearnet-backend/src/app.module.ts
+++ b/clearnet-backend/src/app.module.ts
@@
-import { Module } from '@nestjs/common';
-import { ConfigModule } from '@nestjs/config';
+import { Module } from '@nestjs/common';
+import { APP_GUARD } from '@nestjs/core';
+import { ConfigModule, ConfigService } from '@nestjs/config';
+import { ThrottlerModule } from '@nestjs/throttler';
 import { AppController } from './app.controller';
 import { AppService } from './app.service';
 import { Neo4jModule } from './neo4j/neo4j.module';
 import { AuthModule } from './auth/auth.module';
 import { UsersModule } from './users/users.module';
 import { TransactionsModule } from './transactions/transactions.module';
+import { BlockchainModule } from './blockchain/blockchain.module';
+import { DemoModule } from './demo/demo.module';
+import { RateLimitGuard } from './common/guards/rate-limit.guard';
 
 @Module({
   imports: [
     ConfigModule.forRoot({ isGlobal: true }),
+    ThrottlerModule.forRootAsync({
+      inject: [ConfigService],
+      useFactory: (config: ConfigService) => ({
+        throttlers: [
+          {
+            name: 'default',
+            ttl: config.get<number>('THROTTLE_TTL', 60000),
+            limit: config.get<number>('THROTTLE_LIMIT', 100),
+          },
+        ],
+      }),
+    }),
     Neo4jModule.forRoot(),
     AuthModule,
     UsersModule,
     TransactionsModule,
+    BlockchainModule,
+    DemoModule,
   ],
   controllers: [AppController],
-  providers: [AppService],
+  providers: [AppService, { provide: APP_GUARD, useClass: RateLimitGuard }],
 })
 export class AppModule {}
```

### `clearnet-backend/src/auth/auth.controller.ts` — limites strictes sur register/login

```diff
--- a/clearnet-backend/src/auth/auth.controller.ts
+++ b/clearnet-backend/src/auth/auth.controller.ts
@@
 import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
+import { Throttle } from '@nestjs/throttler';
 import { AuthService } from './auth.service';
 import { RegisterDto } from './dto/register.dto';
 import { LoginDto } from './dto/login.dto';
 import { JwtAuthGuard } from './jwt-auth.guard';
 import { CurrentUser, CurrentUserPayload } from './current-user.decorator';
@@
   @Post('register')
   @HttpCode(HttpStatus.CREATED)
+  @Throttle({ default: { limit: 10, ttl: 60_000 } })
   register(@Body() dto: RegisterDto) {
     return this.authService.register(dto);
   }
 
   @Post('login')
   @HttpCode(HttpStatus.OK)
+  @Throttle({ default: { limit: 5, ttl: 60_000 } })
   login(@Body() dto: LoginDto) {
     return this.authService.login(dto);
   }
```

### `clearnet-backend/src/main.ts` — log d'état enrichi au démarrage

```diff
--- a/clearnet-backend/src/main.ts
+++ b/clearnet-backend/src/main.ts
@@
   const port = config.get<number>('PORT', 3000);
   await app.listen(port);
-  console.log(`ClearNet backend ready on http://localhost:${port}/api`);
+
+  const bridge = config.get<string>('BLOCKCHAIN_ENABLED', 'false') === 'true';
+  console.log(
+    `ClearNet backend ready on http://localhost:${port}/api` +
+      ` | rate-limit: ${config.get<number>('THROTTLE_LIMIT', 100)} req/${config.get<number>('THROTTLE_TTL', 60000) / 1000}s` +
+      ` | pont on-chain: ${bridge ? 'ON' : 'OFF'}`,
+  );
 }
```

### `clearnet-backend/.env.example` — variables V1.1 (défauts non sécurisés signalés)

```diff
--- a/clearnet-backend/.env.example
+++ b/clearnet-backend/.env.example
@@
 # Copier ce fichier en .env et adapter les valeurs
+# ⚠️ Tous les défauts ci-dessous sont NON SÉCURISÉS (dév. local uniquement).
 PORT=3000
 
 # Neo4j (Docker : infrastructure/docker-compose.yml)
 NEO4J_URI=bolt://localhost:7687
 NEO4J_USER=neo4j
 NEO4J_PASSWORD=clearnet123
 
-# JWT
+# JWT — ⚠️ changer en production
 JWT_SECRET=change-me-in-production
 JWT_EXPIRES_IN=7d
+
+# Rate-limiting global (@nestjs/throttler 5.x)
+THROTTLE_TTL=60000
+THROTTLE_LIMIT=100
+
+# Pont on-chain (ethers 6.x) — laissé OFF en dev
+# ⚠️ BLOCKCHAIN_PRIVATE_KEY est la clé de l'opérateur : NE JAMAIS exposer ni committer.
+BLOCKCHAIN_ENABLED=false
+BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
+# Clé n°0 du nœud Hardhat (défaut dev, jamais en production)
+BLOCKCHAIN_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
+# Adresses issues de : npx hardhat run scripts/deploy.ts --network localhost
+CLRN_TOKEN_ADDRESS=
+COMPENSATION_ENGINE_ADDRESS=
+
+# API de démo partenaire — ⚠️ clé à remplacer hors dév.
+DEMO_API_KEY=demo-secret-change-me
```

### `clearnet-backend/package.json` — nouvelles dépendances

```diff
--- a/clearnet-backend/package.json
+++ b/clearnet-backend/package.json
@@ dependencies
     "@nestjs/passport": "^10.0.3",
     "@nestjs/platform-express": "^10.4.0",
+    "@nestjs/throttler": "^5.1.2",
     "bcryptjs": "^2.4.3",
     "class-transformer": "^0.5.1",
     "class-validator": "^0.14.1",
+    "ethers": "^6.13.0",
     "neo4j-driver": "^5.8.0",
```

---

## 3. PONT ON-CHAIN (BACKEND → SMART CONTRACTS)

**Fichiers** : `clearnet-backend/src/blockchain/blockchain.module.ts` (nouveau), `clearnet-backend/src/blockchain/blockchain.service.ts` (nouveau), `clearnet-backend/src/transactions/transactions.service.ts` (modif), `clearnet-backend/src/transactions/transactions.module.ts` (modif), `clearnet-backend/package.json` (voir section 2)

### `clearnet-backend/src/blockchain/blockchain.module.ts` (nouveau)

```ts
import { Global, Module } from '@nestjs/common';
import { BlockchainService } from './blockchain.service';

@Global()
@Module({
  providers: [BlockchainService],
  exports: [BlockchainService],
})
export class BlockchainModule {}
```

### `clearnet-backend/src/blockchain/blockchain.service.ts` (nouveau)

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Contract, JsonRpcProvider, Wallet, getAddress, keccak256, toUtf8Bytes } from 'ethers';

const COMPENSATION_ENGINE_ABI = [
  'function updatePosition(address account, int256 delta) external',
  'function netPositions(address account) view returns (int256)',
];

const TOKEN_ABI = ['function balanceOf(address account) view returns (uint256)'];

/**
 * Pont backend → smart contracts (ethers 6.x).
 * Actif uniquement si BLOCKCHAIN_ENABLED=true + RPC + clé + adresses configurés.
 * MVP : chaque transaction hors-chaîne met à jour la position nette on-chain
 * (adresse déterministe dérivée de l'email — à remplacer par une gestion de
 * portefeuilles réelle en phase 2).
 */
@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private readonly enabled: boolean;
  private readonly provider?: JsonRpcProvider;
  private readonly signer?: Wallet;
  private readonly engine?: Contract;
  private readonly token?: Contract;

  constructor(private readonly config: ConfigService) {
    this.enabled = config.get<string>('BLOCKCHAIN_ENABLED', 'false') === 'true';
    if (!this.enabled) {
      this.logger.warn(
        'Pont on-chain DÉSACTIVÉ (BLOCKCHAIN_ENABLED != true). Transactions hors-chaîne uniquement.',
      );
      return;
    }
    const rpc = config.getOrThrow<string>('BLOCKCHAIN_RPC_URL');
    const privateKey = config.getOrThrow<string>('BLOCKCHAIN_PRIVATE_KEY');
    const engineAddress = config.getOrThrow<string>('COMPENSATION_ENGINE_ADDRESS');
    const tokenAddress = config.getOrThrow<string>('CLRN_TOKEN_ADDRESS');
    this.provider = new JsonRpcProvider(rpc);
    this.signer = new Wallet(privateKey, this.provider);
    this.engine = new Contract(engineAddress, COMPENSATION_ENGINE_ABI, this.signer);
    this.token = new Contract(tokenAddress, TOKEN_ABI, this.provider);
    this.logger.log(`Pont on-chain actif sur ${rpc} (engine: ${engineAddress})`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Met à jour la position nette d'un compte identifié par son email.
   * delta en unités CLRN (converti en wei, 18 décimales).
   */
  async recordPositionChange(email: string, delta: number): Promise<string> {
    if (!this.enabled || !this.engine || !this.signer) return '';
    const address = this.addressFromEmail(email);
    const wei = BigInt(Math.round(delta * 1e18));
    const tx = await this.engine.updatePosition(address, wei);
    const receipt = await tx.wait();
    this.logger.log(`Position mise à jour ${address} (${delta} CLRN) — tx ${receipt!.hash}`);
    return receipt!.hash;
  }

  async tokenBalanceOf(email: string): Promise<bigint> {
    if (!this.enabled || !this.token) return 0n;
    return this.token.balanceOf(this.addressFromEmail(email)) as Promise<bigint>;
  }

  /**
   * Adresse pseudo-déterministe dérivée de l'email (MVP).
   * hash = keccak256(email en minuscules), on garde les 20 derniers octets.
   */
  private addressFromEmail(email: string): string {
    const hash = keccak256(toUtf8Bytes(email.trim().toLowerCase()));
    return getAddress(`0x${hash.slice(-40)}`);
  }
}
```

### `clearnet-backend/src/transactions/transactions.service.ts` — répercussion on-chain (dégradation douce)

```diff
--- a/clearnet-backend/src/transactions/transactions.service.ts
+++ b/clearnet-backend/src/transactions/transactions.service.ts
@@
-import { BadRequestException, Injectable, Inject } from '@nestjs/common';
+import { BadRequestException, Injectable, Inject, Logger } from '@nestjs/common';
 import { Driver } from 'neo4j-driver';
 import { NEO4J_DRIVER } from '../neo4j/neo4j.module';
+import { BlockchainService } from '../blockchain/blockchain.service';
@@
 @Injectable()
 export class TransactionsService {
-  constructor(@Inject(NEO4J_DRIVER) private readonly driver: Driver) {}
+  private readonly logger = new Logger(TransactionsService.name);
+
+  constructor(
+    @Inject(NEO4J_DRIVER) private readonly driver: Driver,
+    private readonly blockchainService: BlockchainService,
+  ) {}
@@
       if (result.records.length === 0) {
         throw new BadRequestException('Destinataire introuvable');
       }
-      return this.toTransaction(input.fromEmail, input.toEmail, result.records[0].get('t'));
+      const record = this.toTransaction(input.fromEmail, input.toEmail, result.records[0].get('t'));
+      await this.recordOnChain(input);
+      return record;
     } finally {
       await session.close();
     }
   }
+
+  /**
+   * Répercute la transaction sur la CompensationEngine (pont on-chain).
+   * Dégradation douce : si le pont est désactivé ou en erreur, la transaction
+   * hors-chaîne reste valide (un warning est émis).
+   */
+  private async recordOnChain(input: {
+    fromEmail: string;
+    toEmail: string;
+    amount: number;
+    note?: string;
+  }): Promise<void> {
+    if (!this.blockchainService.isEnabled()) return;
+    try {
+      await this.blockchainService.recordPositionChange(input.fromEmail, -input.amount);
+      await this.blockchainService.recordPositionChange(input.toEmail, input.amount);
+    } catch (error) {
+      this.logger.warn(`Pont on-chain : mise à jour de position ignorée (${(error as Error).message})`);
+    }
+  }
```

### `clearnet-backend/src/transactions/transactions.module.ts` — export du service (requis par DemoModule)

```diff
--- a/clearnet-backend/src/transactions/transactions.module.ts
+++ b/clearnet-backend/src/transactions/transactions.module.ts
@@
 @Module({
   controllers: [TransactionsController],
   providers: [TransactionsService],
+  exports: [TransactionsService],
 })
 export class TransactionsModule {}
```

---

## 4. DÉPLOIEMENT SUR SEPOLIA

**Fichiers** : `clearnet-blockchain/hardhat.config.ts` (modif), `clearnet-blockchain/.env.example` (modif), `clearnet-blockchain/scripts/deploy-sepolia.ts` (nouveau), `clearnet-blockchain/scripts/verify-sepolia.ts` (nouveau). Variables backend `BLOCKCHAIN_*` : voir section 2 (`.env.example`).

### `clearnet-blockchain/hardhat.config.ts` — réseau sepolia + Etherscan

```diff
--- a/clearnet-blockchain/hardhat.config.ts
+++ b/clearnet-blockchain/hardhat.config.ts
@@
 const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
 const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
 
+// Réseau public de test (Sepolia)
+const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || '';
+const SEPOLIA_PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY || '';
+const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || '';
+
 const config: HardhatUserConfig = {
@@
   networks: {
     localhost: { url: 'http://127.0.0.1:8545' },
     clearnet: {
       url: RPC_URL,
       accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
     },
+    sepolia: {
+      url: SEPOLIA_RPC_URL,
+      accounts: SEPOLIA_PRIVATE_KEY ? [SEPOLIA_PRIVATE_KEY] : [],
+    },
+  },
+  etherscan: {
+    apiKey: {
+      sepolia: ETHERSCAN_API_KEY,
+    },
   },
 };
```

### `clearnet-blockchain/.env.example` — variables Sepolia

```diff
--- a/clearnet-blockchain/.env.example
+++ b/clearnet-blockchain/.env.example
@@
 # URL du nœud RPC (mainnet/testnet) - en local, utiliser le nœud Hardhat
 RPC_URL=http://127.0.0.1:8545
 # Clé privée du déployeur (NE JAMAIS COMMITTER une clé réelle)
 PRIVATE_KEY=
+
+# --- Réseau de test Sepolia ---
+# RPC public : https://ethereum-sepolia-rpc.publicnode.com (ou votre fournisseur)
+SEPOLIA_RPC_URL=
+# ⚠️ Compte de test uniquement, avec des ETH de test (faucet). Jamais de clé réelle.
+SEPOLIA_PRIVATE_KEY=
+# Clé Etherscan pour la vérification des contrats : https://etherscan.io/myapikey
+ETHERSCAN_API_KEY=
```

### `clearnet-blockchain/scripts/deploy-sepolia.ts` (nouveau)

```ts
import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Déploiement des contrats ClearNet sur Sepolia.
 * Prérequis : SEPOLIA_RPC_URL + SEPOLIA_PRIVATE_KEY (avec ETH de test) dans .env.
 * Résultat : écrit deployments/sepolia.json (adresses utilisées par le backend).
 */
async function main() {
  if (!process.env.SEPOLIA_RPC_URL || !process.env.SEPOLIA_PRIVATE_KEY) {
    throw new Error(
      'SEPOLIA_RPC_URL et SEPOLIA_PRIVATE_KEY sont requis dans le fichier .env',
    );
  }

  const [deployer] = await ethers.getSigners();
  console.log('Déployeur (Sepolia):', deployer.address);

  const Token = await ethers.getContractFactory('ClearNetToken');
  const token = await Token.deploy();
  await token.waitForDeployment();

  const Engine = await ethers.getContractFactory('CompensationEngine');
  const engine = await Engine.deploy();
  await engine.waitForDeployment();

  const network = await ethers.provider.getNetwork();
  const output = {
    chainId: network.chainId.toString(),
    network: 'sepolia',
    clearNetToken: await token.getAddress(),
    compensationEngine: await engine.getAddress(),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  const dir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sepolia.json'), JSON.stringify(output, null, 2));

  console.log('ClearNetToken:', output.clearNetToken);
  console.log('CompensationEngine:', output.compensationEngine);
  console.log('Adresses écrites dans deployments/sepolia.json');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

### `clearnet-blockchain/scripts/verify-sepolia.ts` (nouveau)

```ts
import * as fs from 'fs';
import * as path from 'path';
import hre from 'hardhat';

/**
 * Vérification des contrats sur Etherscan (Sepolia).
 * Prérequis : ETHERSCAN_API_KEY dans .env + deployments/sepolia.json
 * (généré par deploy-sepolia.ts).
 */
async function main() {
  const deploymentsPath = path.join(__dirname, '..', 'deployments', 'sepolia.json');
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error('deployments/sepolia.json introuvable — lancer scripts/deploy-sepolia.ts d’abord');
  }
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8')) as {
    clearNetToken: string;
    compensationEngine: string;
  };

  const targets = [
    { name: 'ClearNetToken', address: deployments.clearNetToken },
    { name: 'CompensationEngine', address: deployments.compensationEngine },
  ];

  for (const target of targets) {
    console.log(`Vérification de ${target.name} (${target.address})…`);
    try {
      await hre.run('verify:verify', {
        address: target.address,
        constructorArguments: [],
      });
      console.log(`✔ ${target.name} vérifié`);
    } catch (error) {
      console.warn(`Échec de la vérification de ${target.name}: ${(error as Error).message}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

---

## 5. PRÉPARATION DE LA DÉMO PARTENAIRE

**Fichiers** : `clearnet-backend/src/demo/demo.module.ts` (nouveau), `clearnet-backend/src/demo/demo.controller.ts` (nouveau), `clearnet-mobile/src/screens/DemoScreen.tsx` (nouveau), `clearnet-mobile/App.tsx` (modif), `clearnet-mobile/src/screens/LoginScreen.tsx` (modif), `scripts/seed-demo.sh` (nouveau), `README-DEMO.md` (nouveau)

### `clearnet-backend/src/demo/demo.module.ts` (nouveau)

```ts
import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { DemoController } from './demo.controller';

@Module({
  imports: [UsersModule, TransactionsModule],
  controllers: [DemoController],
})
export class DemoModule {}
```

### `clearnet-backend/src/demo/demo.controller.ts` (nouveau)

```ts
import { Controller, Get, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Driver } from 'neo4j-driver';
import { NEO4J_DRIVER } from '../neo4j/neo4j.module';
import { UsersService } from '../users/users.service';
import { TransactionsService } from '../transactions/transactions.service';
import { DemoApiKeyGuard } from '../common/guards/demo-api-key.guard';

const DEMO_USERS = [
  { email: 'alice@clearnet.io', name: 'Alice' },
  { email: 'bob@clearnet.io', name: 'Bob' },
  { email: 'carol@clearnet.io', name: 'Carol' },
];

const DEMO_PASSWORD = 'clearnet-demo';

const DEMO_TRANSACTIONS = [
  { from: 'alice@clearnet.io', to: 'bob@clearnet.io', amount: 250, note: 'Facture fournisseur' },
  { from: 'bob@clearnet.io', to: 'carol@clearnet.io', amount: 120, note: 'Prestation sous-traitée' },
  { from: 'carol@clearnet.io', to: 'alice@clearnet.io', amount: 80, note: 'Compensation partielle' },
];

/**
 * API de démo partenaire (protégée par X-Demo-Key).
 * seed : crée les comptes démo et un jeu de transactions initial.
 * status : compteurs pour le tableau de bord de démonstration.
 */
@Controller('demo')
@UseGuards(DemoApiKeyGuard)
export class DemoController {
  constructor(
    @Inject(NEO4J_DRIVER) private readonly driver: Driver,
    private readonly usersService: UsersService,
    private readonly transactionsService: TransactionsService,
  ) {}

  @Post('seed')
  @HttpCode(HttpStatus.OK)
  async seed(): Promise<{ seeded: boolean; users: string[]; password: string }> {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const created: string[] = [];

    for (const demo of DEMO_USERS) {
      const existing = await this.usersService.findByEmail(demo.email);
      if (!existing) {
        await this.usersService.create({ email: demo.email, name: demo.name, passwordHash });
        created.push(demo.email);
      }
    }

    const alice = await this.usersService.findByEmail('alice@clearnet.io');
    if (alice) {
      const history = await this.transactionsService.history(alice.email, 1);
      if (history.length === 0) {
        for (const t of DEMO_TRANSACTIONS) {
          await this.transactionsService.create({
            fromEmail: t.from,
            toEmail: t.to,
            amount: t.amount,
            note: t.note,
          });
        }
      }
    }

    return {
      seeded: created.length > 0,
      users: DEMO_USERS.map((u) => u.email),
      password: DEMO_PASSWORD,
    };
  }

  @Get('status')
  async status(): Promise<{ users: number; transactions: number }> {
    const session = this.driver.session();
    try {
      const users = await session.run('MATCH (u:User) RETURN count(u) AS c');
      const transactions = await session.run('MATCH (t:Transaction) RETURN count(t) AS c');
      return {
        users: users.records[0].get('c').toNumber(),
        transactions: transactions.records[0].get('c').toNumber(),
      };
    } finally {
      await session.close();
    }
  }
}
```

### `clearnet-mobile/src/screens/DemoScreen.tsx` (nouveau)

```tsx
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';

interface AuthResponse {
  access_token: string;
  user: { id: string; email: string; name: string };
}

interface Props {
  onAuthenticated: (token: string, email: string) => void;
  onBack: () => void;
}

const DEMO_ACCOUNTS = [
  { name: 'Alice', email: 'alice@clearnet.io', color: '#38bdf8' },
  { name: 'Bob', email: 'bob@clearnet.io', color: '#a78bfa' },
  { name: 'Carol', email: 'carol@clearnet.io', color: '#4ade80' },
];

const DEMO_PASSWORD = 'clearnet-demo';

/**
 * Écran « Mode démo partenaire » : connexion en un geste sur des comptes
 * pré-seedés (POST /api/demo/seed) pour la démonstration client.
 */
export default function DemoScreen({ onAuthenticated, onBack }: Props) {
  const [loadingEmail, setLoadingEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loginAs = async (email: string) => {
    setLoadingEmail(email);
    setError(null);
    try {
      const data = await api<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password: DEMO_PASSWORD }),
      });
      onAuthenticated(data.access_token, data.user.email);
    } catch (e) {
      setError(
        `Connexion impossible (${email}). Vérifiez que le backend est lancé et que POST /api/demo/seed a été exécuté (mot de passe: ${DEMO_PASSWORD}).`,
      );
    } finally {
      setLoadingEmail(null);
    }
  };

  return (
    <View style={styles.container}>
      <Pressable onPress={onBack}>
        <Text style={styles.back}>‹ Retour</Text>
      </Pressable>

      <Text style={styles.title}>Mode démo partenaire</Text>
      <Text style={styles.subtitle}>
        Connectez-vous en un geste avec un compte pré-chargé. L'API de démo est protégée par
        une clé (X-Demo-Key) et ne doit servir qu'en démonstration.
      </Text>

      <ScrollView contentContainerStyle={styles.list}>
        {DEMO_ACCOUNTS.map((account) => (
          <Pressable
            key={account.email}
            style={[styles.card, { borderLeftColor: account.color }]}
            onPress={() => loginAs(account.email)}
            disabled={loadingEmail !== null}
          >
            <View style={styles.cardText}>
              <Text style={styles.cardName}>{account.name}</Text>
              <Text style={styles.cardEmail}>{account.email}</Text>
            </View>
            {loadingEmail === account.email ? (
              <ActivityIndicator color={account.color} />
            ) : (
              <Text style={[styles.cardAction, { color: account.color }]}>Entrer ›</Text>
            )}
          </Pressable>
        ))}
      </ScrollView>

      {error && <Text style={styles.error}>{error}</Text>}

      <Text style={styles.hint}>
        Pour préparer la démo : POST /api/demo/seed avec l'en-tête X-Demo-Key (voir
        README-DEMO.md).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b1220', padding: 24, paddingTop: 64 },
  back: { color: '#94a3b8', fontSize: 15, marginBottom: 20 },
  title: { fontSize: 28, fontWeight: '700', color: '#e2e8f0' },
  subtitle: { color: '#94a3b8', fontSize: 14, marginTop: 8, marginBottom: 24 },
  list: { paddingBottom: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    borderLeftWidth: 4,
    padding: 16,
    marginBottom: 10,
  },
  cardText: { flex: 1 },
  cardName: { color: '#e2e8f0', fontWeight: '600', fontSize: 16 },
  cardEmail: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  cardAction: { fontWeight: '700', fontSize: 15 },
  error: { color: '#f87171', marginTop: 12, textAlign: 'center' },
  hint: { color: '#64748b', fontSize: 12, marginTop: 16, textAlign: 'center' },
});
```

### `clearnet-mobile/App.tsx` — câblage du mode démo

```diff
--- a/clearnet-mobile/App.tsx
+++ b/clearnet-mobile/App.tsx
@@
 import LoginScreen from './src/screens/LoginScreen';
 import HomeScreen from './src/screens/HomeScreen';
+import DemoScreen from './src/screens/DemoScreen';
@@
 export default function App() {
   const [token, setToken] = useState<string | null>(null);
   const [email, setEmail] = useState<string | null>(null);
+  const [showDemo, setShowDemo] = useState(false);
   const [ready, setReady] = useState(false);
@@
   return (
     <View style={styles.container}>
       <StatusBar style="light" />
       {token && email ? (
         <HomeScreen token={token} email={email} onLogout={onLogout} />
+      ) : showDemo ? (
+        <DemoScreen onAuthenticated={onAuthenticated} onBack={() => setShowDemo(false)} />
       ) : (
-        <LoginScreen onAuthenticated={onAuthenticated} />
+        <LoginScreen onAuthenticated={onAuthenticated} onDemo={() => setShowDemo(true)} />
       )}
     </View>
   );
```

### `clearnet-mobile/src/screens/LoginScreen.tsx` — bouton d'accès au mode démo

```diff
--- a/clearnet-mobile/src/screens/LoginScreen.tsx
+++ b/clearnet-mobile/src/screens/LoginScreen.tsx
@@
 interface Props {
   onAuthenticated: (token: string, email: string) => void;
+  onDemo?: () => void;
 }
 
-export default function LoginScreen({ onAuthenticated }: Props) {
+export default function LoginScreen({ onAuthenticated, onDemo }: Props) {
@@
       <Pressable onPress={() => setMode(mode === 'login' ? 'register' : 'login')}>
         <Text style={styles.switch}>
           {mode === 'login'
             ? 'Pas de compte ? Créer un compte'
             : 'Déjà un compte ? Se connecter'}
         </Text>
       </Pressable>
+
+      {onDemo && (
+        <Pressable onPress={onDemo} style={styles.demoButton}>
+          <Text style={styles.demoButtonText}>Mode démo partenaire ›</Text>
+        </Pressable>
+      )}
     </KeyboardAvoidingView>
   );
 }
@@
   switch: { color: '#94a3b8', textAlign: 'center', marginTop: 16 },
   error: { color: '#f87171', marginBottom: 8, textAlign: 'center' },
+  demoButton: { marginTop: 24, padding: 10, borderWidth: 1, borderColor: '#334155', borderRadius: 10 },
+  demoButtonText: { color: '#38bdf8', textAlign: 'center', fontWeight: '600' },
 });
```

### `scripts/seed-demo.sh` (nouveau)

```bash
#!/usr/bin/env bash
# =============================================================
# ClearNet V1.1 — Seed de la démo partenaire (Mac / Linux)
# Prépare les comptes alice/bob/carol + transactions de démonstration.
# Prérequis : backend lancé (docker compose up -d --build).
# Usage : ./scripts/seed-demo.sh [URL_API] [DEMO_API_KEY]
#   Défauts : http://localhost:3000/api / demo-secret-change-me
# Windows : Invoke-RestMethod -Uri http://localhost:3000/api/demo/seed -Method Post `
#           -Headers @{ "X-Demo-Key" = "demo-secret-change-me" }
# =============================================================
set -euo pipefail

BASE_URL="${1:-http://localhost:3000/api}"
DEMO_KEY="${2:-demo-secret-change-me}"

echo "==> Seed de la démo sur $BASE_URL"

STATUS=$(curl -sf -o /tmp/clearnet-seed.json -w "%{http_code}" -X POST "${BASE_URL}/demo/seed" \
  -H "X-Demo-Key: ${DEMO_KEY}") || {
  echo "✘ Impossible de joindre l'API (le backend est-il lancé ?)" >&2
  exit 1
}

echo "✔ Réponse ($STATUS) : $(cat /tmp/clearnet-seed.json)"
echo ""
echo "Comptes de démonstration (mot de passe : clearnet-demo) :"
echo "  alice@clearnet.io   (facturée -> compense)"
echo "  bob@clearnet.io     (fournisseur)"
echo "  carol@clearnet.io   (sous-traitante)"
echo ""
echo "Vérification rapide :"
echo "  curl -s ${BASE_URL}/demo/status -H \"X-Demo-Key: ${DEMO_KEY}\""
```

### `README-DEMO.md` (nouveau)

> Fichier complet dans le monorepo : guide de démonstration partenaire en 30 min
> (préparation, stack, seed, scénario 4.1→4.4, argumentaire commercial, nettoyage,
> dépannage). Voir `README-DEMO.md` à la racine — référence directe dans la section 5.

---

## 6. PROCÉDURE DE VALIDATION GLOBALE

**Fichiers** : `scripts/validate-all.sh` (nouveau), `scripts/validate-all.ps1` (nouveau)

### `scripts/validate-all.sh` (nouveau)

```bash
#!/usr/bin/env bash
# =============================================================
# ClearNet V1.1 — Validation globale (Mac / Linux)
# Étape 1 : backend (build + tests)  -> Étape 2 : blockchain
# (compile + tests) -> Étape 3 : mobile (typecheck) ->
# Étape 4 (optionnelle) : E2E Docker.
# Usage : ./scripts/validate-all.sh [--skip-docker] [--skip-mobile]
# Windows : ./scripts/validate-all.ps1
# =============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_DOCKER=0
SKIP_MOBILE=0
for arg in "$@"; do
  case "$arg" in
    --skip-docker) SKIP_DOCKER=1 ;;
    --skip-mobile) SKIP_MOBILE=1 ;;
  esac
done

FAILURES=0
step() { echo ""; echo "============================================"; echo "  $1"; echo "============================================"; }
check() { if [ "$2" = "0" ]; then echo "  [OK] $1"; else echo "  [KO] $1"; FAILURES=1; fi }

step "Étape 1/4 — Backend (npm ci, build, tests)"
(cd "$ROOT/clearnet-backend" && npm ci --no-audit --no-fund >/dev/null 2>&1)
check "backend: npm ci" "$?"
(cd "$ROOT/clearnet-backend" && npm run build >/dev/null 2>&1)
check "backend: build" "$?"
(cd "$ROOT/clearnet-backend" && npm test >/dev/null 2>&1)
check "backend: tests jest" "$?"

step "Étape 2/4 — Blockchain (compile + tests)"
(cd "$ROOT/clearnet-blockchain" && npm ci --no-audit --no-fund >/dev/null 2>&1)
check "blockchain: npm ci" "$?"
(cd "$ROOT/clearnet-blockchain" && npx hardhat compile >/dev/null 2>&1)
check "blockchain: compile" "$?"
(cd "$ROOT/clearnet-blockchain" && npx hardhat test >/dev/null 2>&1)
check "blockchain: tests" "$?"

if [ "$SKIP_MOBILE" = "0" ]; then
  step "Étape 3/4 — Mobile (typecheck TypeScript)"
  (cd "$ROOT/clearnet-mobile" && npm ci --no-audit --no-fund >/dev/null 2>&1)
  check "mobile: npm ci" "$?"
  (cd "$ROOT/clearnet-mobile" && npx tsc --noEmit >/dev/null 2>&1)
  check "mobile: tsc --noEmit" "$?"
else
  step "Étape 3/4 — Mobile (SKIPPÉ : --skip-mobile)"
fi

if [ "$SKIP_DOCKER" = "0" ]; then
  step "Étape 4/4 — E2E Docker (test-e2e.sh)"
  "$ROOT/infrastructure/test-e2e.sh"
  check "E2E Docker" "$?"
else
  step "Étape 4/4 — E2E Docker (SKIPPÉ : --skip-docker — lancer infrastructure/test-e2e.sh manuellement)"
fi

echo ""
echo "============================================"
if [ "$FAILURES" = "0" ]; then
  echo "  VALIDATION GLOBALE : TOUT EST OK ✔"
else
  echo "  VALIDATION GLOBALE : ÉCHECS DÉTECTÉS ✘"
fi
echo "============================================"
exit $FAILURES
```

### `scripts/validate-all.ps1` (nouveau)

```powershell
# =============================================================
# ClearNet V1.1 — Validation globale (Windows PowerShell)
# Étape 1 : backend (build + tests) -> Étape 2 : blockchain
# (compile + tests) -> Étape 3 : mobile (typecheck) ->
# Étape 4 (optionnelle) : E2E Docker.
# Usage : .\scripts\validate-all.ps1 [-SkipDocker] [-SkipMobile]
# Mac/Linux : ./scripts/validate-all.sh
# =============================================================
param([switch]$SkipDocker, [switch]$SkipMobile)
$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$FAILURES = $false

function Step([string]$title) {
  Write-Host ""
  Write-Host "============================================" -ForegroundColor Cyan
  Write-Host "  $title" -ForegroundColor Cyan
  Write-Host "============================================" -ForegroundColor Cyan
}
function Check([string]$name, [bool]$ok) {
  if ($ok) { Write-Host "  [OK] $name" -ForegroundColor Green }
  else { Write-Host "  [KO] $name" -ForegroundColor Red; $script:FAILURES = $true }
}
function RunCmd([string]$name, [scriptblock]$block) {
  try { & $block | Out-Null; Check $name $true }
  catch { Check $name $false; Write-Host "      $($_.Exception.Message)" -ForegroundColor DarkGray }
}

Step "Étape 1/4 — Backend (npm ci, build, tests)"
RunCmd "backend: npm ci" { Push-Location "$ROOT\clearnet-backend"; npm ci --no-audit --no-fund; Pop-Location }
RunCmd "backend: build" { Push-Location "$ROOT\clearnet-backend"; npm run build; Pop-Location }
RunCmd "backend: tests jest" { Push-Location "$ROOT\clearnet-backend"; npm test; Pop-Location }

Step "Étape 2/4 — Blockchain (compile + tests)"
RunCmd "blockchain: npm ci" { Push-Location "$ROOT\clearnet-blockchain"; npm ci --no-audit --no-fund; Pop-Location }
RunCmd "blockchain: compile" { Push-Location "$ROOT\clearnet-blockchain"; npx hardhat compile; Pop-Location }
RunCmd "blockchain: tests" { Push-Location "$ROOT\clearnet-blockchain"; npx hardhat test; Pop-Location }

if (-not $SkipMobile) {
  Step "Étape 3/4 — Mobile (typecheck TypeScript)"
  RunCmd "mobile: npm ci" { Push-Location "$ROOT\clearnet-mobile"; npm ci --no-audit --no-fund; Pop-Location }
  RunCmd "mobile: tsc --noEmit" { Push-Location "$ROOT\clearnet-mobile"; npx tsc --noEmit; Pop-Location }
} else {
  Step "Étape 3/4 — Mobile (SKIPPÉ : -SkipMobile)"
}

if (-not $SkipDocker) {
  Step "Étape 4/4 — E2E Docker (test-e2e.ps1)"
  RunCmd "E2E Docker" { & "$ROOT\infrastructure\test-e2e.ps1" }
} else {
  Step "Étape 4/4 — E2E Docker (SKIPPÉ : -SkipDocker — lancer infrastructure\test-e2e.ps1 manuellement)"
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
if ($FAILURES) {
  Write-Host "  VALIDATION GLOBALE : ÉCHECS DÉTECTÉS" -ForegroundColor Red
} else {
  Write-Host "  VALIDATION GLOBALE : TOUT EST OK" -ForegroundColor Green
}
Write-Host "============================================" -ForegroundColor Cyan
if ($FAILURES) { exit 1 } else { exit 0 }
```

### Résultats de validation — exécutés en conditions réelles (Windows, Node 24, Docker Desktop 08/08/2026)

| Étape | Commande | Résultat |
|---|---|---|
| Dépendances backend | `npm install` (throttler 5.1.2 + ethers 6.13.0) | ✔ 9 paquets ajoutés |
| Backend | `npm run build` | ✔ Exit 0 |
| Backend | `npm test` | ✔ 2/2 |
| Backend | démarrage réel (pont OFF) | ✔ log « rate-limit: 100 req/60s \| pont on-chain: OFF » |
| Backend | `GET /api/demo/status` sans clé | ✔ 401 (guard démo actif) |
| Blockchain | `npx hardhat compile` | ✔ 7 fichiers Solidity 0.8.19 |
| Blockchain | `npx hardhat test` | ✔ 2/2 (stable après 2 exécutions) |
| Mobile | `npx tsc --noEmit` | ✔ 0 erreur |
| **Docker E2E** | `infrastructure/test-e2e.ps1` (build compose → health → registre → login → transaction → historique → 401 → 429 → teardown) | ✔ **9/9 le 07/08/2026** (voir section 1) |
| **Démo partenaire** | `status` 401 sans clé / 200 avec clé · `seed` 3 comptes · login alice · historique 2 tx | ✔ validé de bout en bout (voir section 1) |

### Correctifs découverts et appliqués pendant la validation

La validation E2E en conditions réelles (section 7) a révélé **4 bugs réels**, tous corrigés et re-testés verts.

### Notes d'application

1. **Ordre d'intégration** : appliquer les sections 2 → 3 → 4 → 5 → 1, puis lancer `scripts/validate-all.sh --skip-docker` (ou `.ps1 -SkipDocker`), enfin `infrastructure/test-e2e.sh` sur une machine avec Docker opérationnel.
2. **Version impérative** : `@nestjs/throttler@^5.1.2` (le `5.0.0` casse la résolution avec `reflect-metadata@^0.2.2`).
3. **Secrets** : tous lus depuis `process.env` avec des défauts de développement explicitement signalés (`⚠️`) — aucun secret réel ajouté au dépôt.
4. **Aucun fichier existant n'a été réécrit intégralement** : seules les modifications incrémentales ci-dessus ont été appliquées (règle d'or n°1).
5. **Stack laissée démarrée** après la validation (compose up, données démo seedées) : `docker compose -f infrastructure/docker-compose.yml ps` pour vérifier, `docker compose down -v` pour arrêter et purger le volume Neo4j.

---

## 7. CORRECTIFS RÉELS DÉCOUVERTS LORS DE LA VALIDATION E2E

La première exécution E2E en conditions réelles (07/08/2026) a mis en évidence des bugs de la base V1.0 qui passaient inaperçus en unit test (driver Neo4j mocké). Tous sont corrigés et la validation complète passe 9/9.

### 7.1 `clearnet-backend/src/users/users.service.ts` — mapping des nœuds Neo4j (bug racine)

**Symptôme** : le register renvoyait `user: {id:"", email:"", name:""}` et le login échouait en 401 même avec le bon mot de passe.

**Cause** : `record.get('u')` (neo4j-driver v5) renvoie un objet `Node` avec une propriété `.properties` — pas un objet plat. La conversion directe produisait des champs vides, et `findByEmail` renvoyait un enregistrement sans `passwordHash` → `Identifiants invalides`.

```diff
--- a/clearnet-backend/src/users/users.service.ts
+++ b/clearnet-backend/src/users/users.service.ts
@@ toUser
   private toUser(node: Record<string, unknown>): UserRecord {
-    const props = node as unknown as {
-      id?: string;
-      email?: string;
-      name?: string;
-      passwordHash?: string;
-      createdAt?: Date;
-    };
+    const props = (node as { properties?: Record<string, unknown> }).properties ?? node;
     return {
-      id: props.id ?? '',
-      email: props.email ?? '',
-      name: props.name ?? '',
-      passwordHash: props.passwordHash,
-      createdAt: props.createdAt,
+      id: (props.id as string) ?? '',
+      email: (props.email as string) ?? '',
+      name: (props.name as string) ?? '',
+      passwordHash: props.passwordHash as string | undefined,
+      createdAt: props.createdAt as Date | undefined,
     };
   }
```

### 7.2 `clearnet-backend/src/transactions/transactions.service.ts` — même classe de bug × 3

**Symptômes** : historique → 500 « Internal server error » ; `createdAt` dupliqués/cassés ; `LIMIT: Invalid input. '50.0'`.

**Causes** :
1. `record.get('t')` → objet `Node` lu comme objet plat (mêmes champs vides que 7.1).
2. `datetime()` de Neo4j renvoie un objet `DateTime` (pas un `Date` JS) → `new Date(...)` = Invalid Date → `.toISOString()` lève `RangeError` → 500.
3. `Number(limit)` est sérialisé par le driver en flottant `50.0` → Neo4j rejette `LIMIT $limit` (entier requis).

```diff
--- a/clearnet-backend/src/transactions/transactions.service.ts
+++ b/clearnet-backend/src/transactions/transactions.service.ts
@@ imports
-import { Driver } from 'neo4j-driver';
+import { Driver, int } from 'neo4j-driver';
@@ history — lecture du nœud + LIMIT entier
       return result.records.map((record) => {
-        const props = record.get('t') as { id?: string; amount?: number; note?: string; createdAt?: Date };
+        const raw = record.get('t') as { properties?: Record<string, unknown> };
+        const props = raw.properties ?? (raw as unknown as Record<string, unknown>);
         return {
-          id: props.id ?? '',
+          id: (props.id as string) ?? '',
           fromEmail: record.get('fromEmail') as string,
           toEmail: record.get('toEmail') as string,
           amount: Number(props.amount ?? 0),
-          note: props.note ?? null,
-          createdAt: props.createdAt ? new Date(props.createdAt as Date).toISOString() : '',
+          note: (props.note as string | null) ?? null,
+          createdAt: this.toIso(props.createdAt),
         };
       });
@@ requête history
-        { email, limit: Number(limit) },
+        { email, limit: int(Number.isFinite(Number(limit)) ? Number(limit) : 50) },
@@ toTransaction — même correctif nœud + dates
   private toTransaction(fromEmail: string, toEmail: string, node: unknown): TransactionRecord {
-    const props = node as { id?: string; amount?: number; note?: string; createdAt?: Date };
+    const props = ((node as { properties?: Record<string, unknown> }).properties ??
+      (node as Record<string, unknown>)) as {
+      id?: string;
+      amount?: number;
+      note?: string;
+      createdAt?: Date;
+    };
     return {
       id: props.id ?? '',
       fromEmail,
       toEmail,
       amount: Number(props.amount ?? 0),
       note: props.note ?? null,
-      createdAt: props.createdAt ? new Date(props.createdAt as Date).toISOString() : '',
+      createdAt: this.toIso(props.createdAt),
     };
   }
+
+  private toIso(value: unknown): string {
+    if (value instanceof Date) return value.toISOString();
+    const dt = value as { toStandardDate?: () => Date; toString?: () => string };
+    if (dt && typeof dt.toStandardDate === 'function') return dt.toStandardDate().toISOString();
+    if (value != null) return new Date(String(value)).toISOString();
+    return '';
+  }
```

### 7.3 Scripts E2E — 2 bugs de test (voir section 1 pour les détails)

- `infrastructure/test-e2e.ps1` / `.sh` : mot de passe du test 401/429 `"wrong"` → `"wrong-pass"` (validation `@MinLength(6)` renvoie 400).
- `infrastructure/test-e2e.ps1` : quirk PowerShell 5.1 (stderr de Docker + `$ErrorActionPreference = "Stop"`) → bascule `Continue` + contrôle de `$LASTEXITCODE` sur les appels `docker compose`.

### 7.4 `infrastructure/docker-compose.yml` + `clearnet-backend/.dockerignore` (voir section 1)

- Healthcheck Neo4j : `cypher-shell` (JVM) → `wget` HTTP (fiabilité et temps de boot).
- `.dockerignore` backend : contexte de build réduit de ~500 Mo à ~2 Ko.

> **Bilan** : ces correctifs ne modifient aucune API publique ; le contrat de réponse (champs `id`/`email`/`name`, ISO 8601 pour `createdAt`) est désormais réellement respecté. Revalidation complète après correctifs : E2E 9/9, jest 2/2, build ✔.
