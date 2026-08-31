# ---------------------------------------------------------------------------
# import-csv-connectors.ps1 - Import CSV de dettes/creances vers le Gateway
# connecteurs ERP (POST /api/connectors/events), idempotent par source+externalId.
#
# Format CSV (separateur ;) : source;externalId;fromCompany;toCompany;amount;currency;invoiceRef;dueDate
#   source = SAP | ORACLE | DYNAMICS | ODOO
#
# Usage :
#   $env:CLEARNET_API  = "https://sandbox.localhost:8444/api"
#   $env:CONNECTOR_KEY = "sandbox-demo-key"
#   powershell -ExecutionPolicy Bypass -File scripts\import-csv-connectors.ps1 scripts\exemple-import-maritime.csv
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$base = $env:CLEARNET_API
if (-not $base) { $base = 'http://localhost:3000/api' }
$key = $env:CONNECTOR_KEY
if (-not $key) { $key = 'sandbox-demo-key' }

$csvPath = $args[0]
if (-not $csvPath) { Write-Host 'Usage : import-csv-connectors.ps1 <fichier.csv>'; exit 1 }
if (-not (Test-Path $csvPath)) { throw "CSV introuvable : $csvPath" }

$rows = Import-Csv -Path $csvPath -Delimiter ';'
$headers = @{ 'x-api-key' = $key }
$ok = 0; $dup = 0
foreach ($row in $rows) {
    $body = @{
        source      = $row.source
        externalId  = $row.externalId
        fromCompany = $row.fromCompany
        toCompany   = $row.toCompany
        amount      = [double]$row.amount
        currency    = $row.currency
        invoiceRef  = $row.invoiceRef
        dueDate     = $row.dueDate
    } | ConvertTo-Json
    try {
        $r = Invoke-RestMethod -Method Post -Uri ($base + '/connectors/events') -Headers $headers -ContentType 'application/json' -Body $body
        Write-Host ("  ACCEPTE  " + $row.source + ":" + $row.externalId + " (" + $row.fromCompany + " -> " + $row.toCompany + " " + $row.amount + " " + $row.currency + ")")
        $ok++
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code -eq 409) { Write-Host ("  DOUBLON  " + $row.source + ":" + $row.externalId); $dup++ }
        else { Write-Host ("  ERREUR " + $code + " sur " + $row.externalId + " : " + $_.Exception.Message) }
    }
}
Write-Host ("Import termine : " + $ok + " accepte(s), " + $dup + " doublon(s).")
