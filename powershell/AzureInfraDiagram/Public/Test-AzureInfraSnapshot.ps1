function Test-AzureInfraSnapshot {
    <#
    .SYNOPSIS
        Checks that a snapshot file has the shape the viewer expects.
    .EXAMPLE
        Test-AzureInfraSnapshot -Path .\inventory.json
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory, ValueFromPipeline)][string]$Path)
    process {
        $problems = New-Object System.Collections.Generic.List[string]
        if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "File not found: $Path" }
        try { $j = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch { throw "Not valid JSON: $($_.Exception.Message)" }
        if ($j.schema -ne $script:SchemaId) { $problems.Add("schema is '$($j.schema)', expected '$script:SchemaId'") }
        foreach ($k in 'subscriptions', 'containers', 'resources', 'roleAssignments') {
            if ($null -eq $j.PSObject.Properties[$k]) { $problems.Add("missing '$k'") }
        }
        foreach ($r in @($j.resources)) {
            if (-not ($r.id -and $r.type -and $r.name)) { $problems.Add("resource without id/type/name: $($r.id)"); break }
        }
        [pscustomobject]@{
            Path            = $Path
            Valid           = ($problems.Count -eq 0)
            Subscriptions   = @($j.subscriptions).Count
            Containers      = @($j.containers).Count
            Resources       = @($j.resources).Count
            RoleAssignments = @($j.roleAssignments).Count
            Problems        = $problems.ToArray()
        }
    }
}
