# setup-env.ps1 — crée .env depuis .env.example et vérifie les variables Sepolia
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile  = Join-Path $root ".env"
$example  = Join-Path $root ".env.example"

if (Test-Path $envFile) {
  Write-Host "✅ .env existe déjà ($(Resolve-Path $envFile))" -ForegroundColor Green
} else {
  if (-not (Test-Path $example)) { Write-Host "❌ .env.example introuvable" -ForegroundColor Red; exit 1 }
  Copy-Item $example $envFile
  Write-Host "📝 .env créé depuis .env.example. Renseignez SEPOLIA_RPC_URL et SEPOLIA_PRIVATE_KEY." -ForegroundColor Yellow
}

$content = Get-Content $envFile -Raw
if ($content -match "(?m)^SEPOLIA_RPC_URL=($|`r?`n)") {
  Write-Host "❌ SEPOLIA_RPC_URL vide — éditez .env" -ForegroundColor Red; exit 1
}
if ($content -match "(?m)^SEPOLIA_PRIVATE_KEY=($|`r?`n)") {
  Write-Host "❌ SEPOLIA_PRIVATE_KEY vide — éditez .env" -ForegroundColor Red; exit 1
}
Write-Host "✅ .env correctement configuré." -ForegroundColor Green
