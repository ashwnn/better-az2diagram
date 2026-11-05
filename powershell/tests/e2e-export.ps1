# Produces a snapshot through the real module code path, using stand-ins for the two Azure commands
# that serve the bundled sample. Used by CI to prove that "module output -> viewer" works.
#   pwsh ./powershell/tests/e2e-export.ps1 -Out dist/e2e-inventory.json
param([string]$Out = 'dist/e2e-inventory.json')
$ErrorActionPreference = 'Stop'
$sample = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..' '..' 'sample' 'inventory.json') -Raw | ConvertFrom-Json
function global:Get-AzSubscription { $sample.subscriptions | ForEach-Object { [pscustomobject]@{ Id = $_.id; Name = $_.name; TenantId = $_.tenantId; State = 'Enabled' } } }
function global:Search-AzGraph {
    param($Query, $Subscription, $First, $SkipToken)
    $data = if ($Query -like 'Resources*') { $sample.resources } elseif ($Query -like 'ResourceContainers*') { $sample.containers } else { $sample.roleAssignments }
    [pscustomobject]@{ Data = @($data); SkipToken = $null }
}
Import-Module (Join-Path $PSScriptRoot '..' 'AzureInfraDiagram' 'AzureInfraDiagram.psd1') -Force
New-Item -ItemType Directory -Force -Path (Split-Path -Parent (Join-Path (Get-Location) $Out)) | Out-Null
Export-AzureInfraSnapshot -Path $Out -Backend AzModule -WarningAction SilentlyContinue | Out-Null
$t = Test-AzureInfraSnapshot -Path $Out
if (-not $t.Valid) { throw "Snapshot invalid: $($t.Problems -join '; ')" }
Write-Host "e2e snapshot ok: $($t.Resources) resources"
