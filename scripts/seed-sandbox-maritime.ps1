# ---------------------------------------------------------------------------
# seed-sandbox-maritime.ps1 - Seed du sandbox pilotes (transport maritime).
#
# Cree 10 entreprises fictives du transport maritime (armateur, affreteur,
# port, transitaire, assureur, chantier, energie, commissionnaire,
# manutention, avitailleur) puis genere des dettes/creances formant des
# CYCLES de 2, 3 et 4 noeuds (visibles via GET /api/graph/cycles et
# l'onglet Tresorerie).
#
# Usage (sandbox locale sur les ports 8081/8444) :
#   $env:CLEARNET_API = "https://sandbox.localhost:8444/api"
#   powershell -ExecutionPolicy Bypass -File scripts\seed-sandbox-maritime.ps1
#
# Idempotent : re-exporter un user existant est tolere (erreur 409 ignoree).
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$base = $env:CLEARNET_API
if (-not $base) { $base = 'http://localhost:3000/api' }

function Invoke-Json($method, $path, $body, $token) {
    $headers = @{}
    if ($token) { $headers.Authorization = "Bearer $token" }
    try {
        if ($body) {
            return Invoke-RestMethod -Method $method -Uri ($base + $path) -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json)
        }
        return Invoke-RestMethod -Method $method -Uri ($base + $path) -Headers $headers
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code -eq 409) { Write-Host "  (existe deja : $path)"; return $null }
        Write-Host ("  ERREUR " + $code + " sur " + $method + " " + $path)
        throw
    }
}

# --- 10 entreprises fictives (email, nom, secteur) ---
$companies = @(
    @{ e = 'armateur-cmr@maritime-demo.fr';   n = 'CMR Armateur';            s = 'Maritime' },
    @{ e = 'affreteur-nova@maritime-demo.fr'; n = 'Nova Affretement';        s = 'Maritime' },
    @{ e = 'port-marseille@maritime-demo.fr'; n = 'Port de Marseille Demo';  s = 'Maritime' },
    @{ e = 'transitaire-transped@maritime-demo.fr'; n = 'TransSped Transit'; s = 'SupplyChain' },
    @{ e = 'assureur-marine@maritime-demo.fr'; n = 'MarineAssur';            s = 'Banking' },
    @{ e = 'chantier-cnm@maritime-demo.fr';    n = 'Chantier Naval CNM';     s = 'Metallurgy' },
    @{ e = 'energie-bunker@maritime-demo.fr';  n = 'BunkerEnergie';          s = 'Energy' },
    @{ e = 'commissionnaire-fw@maritime-demo.fr'; n = 'FreightWiki Commission'; s = 'InternationalTrade' },
    @{ e = 'manutention-mht@maritime-demo.fr'; n = 'Manutention MHT';        s = 'Maritime' },
    @{ e = 'avitailleur-azur@maritime-demo.fr'; n = 'Avitaillement Azur';    s = 'Energy' }
)

Write-Host "=== 1/3 Inscription des 10 entreprises ==="
$tokens = @{}
foreach ($c in $companies) {
    $r = Invoke-Json 'POST' '/auth/register' @{ email = $c.e; name = $c.n; password = 'Sandbox2026!'; industry = $c.s } $null
    if ($r) { $tokens[$c.e] = $r.access_token; Write-Host ("  + " + $c.n) }
}

function Tx($from, $to, $amount, $note) {
    $token = $tokens[$from]
    if (-not $token) { return }
    Invoke-Json 'POST' '/transactions' @{ toEmail = $to; amount = $amount; note = $note } $token | Out-Null
    Write-Host ("    " + $from.Split('@')[0] + " -> " + $to.Split('@')[0] + " : " + $amount + " EUR (" + $note + ")")
}

Write-Host "=== 2/3 Generation des dettes/creances (cycles 2/3/4 noeuds) ==="

# --- Cycle 3 : CMR -> TransSped -> Port -> CMR ---
Tx 'armateur-cmr@maritime-demo.fr' 'transitaire-transped@maritime-demo.fr' 450000 'Fret Rotterdam-Valence (cycle 3)'
Tx 'transitaire-transped@maritime-demo.fr' 'port-marseille@maritime-demo.fr' 220000 'Droits portuaires (cycle 3)'
Tx 'port-marseille@maritime-demo.fr' 'armateur-cmr@maritime-demo.fr' 180000 'Redevance quais CMR (cycle 3)'

# --- Cycle 2 : CMR <-> Nova ---
Tx 'armateur-cmr@maritime-demo.fr' 'affreteur-nova@maritime-demo.fr' 310000 'Affretement au voyage (cycle 2)'
Tx 'affreteur-nova@maritime-demo.fr' 'armateur-cmr@maritime-demo.fr' 260000 'Soutes et surestaries (cycle 2)'

# --- Cycle 4 : CMR -> Bunker -> Manutention -> Chantier -> CMR ---
Tx 'armateur-cmr@maritime-demo.fr' 'energie-bunker@maritime-demo.fr' 89000 'Carburant soute (cycle 4)'
Tx 'energie-bunker@maritime-demo.fr' 'manutention-mht@maritime-demo.fr' 64000 'Maintenance grues (cycle 4)'
Tx 'manutention-mht@maritime-demo.fr' 'chantier-cnm@maritime-demo.fr' 47000 'Prestations grutage (cycle 4)'
Tx 'chantier-cnm@maritime-demo.fr' 'armateur-cmr@maritime-demo.fr' 52000 'Reparations navales (cycle 4)'

# --- Flux simples (pas de cycle) pour epaissir le graphe ---
Tx 'armateur-cmr@maritime-demo.fr' 'assureur-marine@maritime-demo.fr' 42000 'Prime assurance corps'
Tx 'armateur-cmr@maritime-demo.fr' 'avitailleur-azur@maritime-demo.fr' 37000 'Avitaillement portuaire'
Tx 'commissionnaire-fw@maritime-demo.fr' 'armateur-cmr@maritime-demo.fr' 130000 'Commission de fret'
Tx 'transitaire-transped@maritime-demo.fr' 'assureur-marine@maritime-demo.fr' 28000 'Assurance marchandises'

Write-Host "=== 3/3 Verifications ==="
$cmr = $tokens['armateur-cmr@maritime-demo.fr']
if ($cmr) {
    $cycles = Invoke-Json 'GET' '/graph/cycles' $null $cmr
    Write-Host ("Cycles detectes pour CMR : " + $cycles.Count + " (net total : " + [Math]::Round((($cycles | Measure-Object -Property nettable -Sum).Sum), 0) + " EUR)")
    $treasury = Invoke-Json 'GET' '/transactions/treasury' $null $cmr
    Write-Host ("Tresorerie CMR : immobilise " + $treasury.total_immobilise + " / libere " + $treasury.total_liberes + " / economie " + $treasury.economie_potentielle)
}
Write-Host "Sandbox maritime prete. Compte demo : armateur-cmr@maritime-demo.fr / Sandbox2026!"
