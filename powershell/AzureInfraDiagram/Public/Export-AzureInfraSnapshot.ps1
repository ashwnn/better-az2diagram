function Export-AzureInfraSnapshot {
    <#
    .SYNOPSIS
        Writes ONE read-only JSON snapshot of your Azure estate for the diagram viewer.
    .DESCRIPTION
        Runs a few paged Azure Resource Graph queries (resources, subscriptions and resource groups,
        optionally role assignments of service principals) and saves the result. Relationships,
        layout and drawing happen later in the browser, offline, from that single file.

        Read-only by design: the Az backend only calls Get-AzSubscription and Search-AzGraph; the
        Azure CLI backend only runs 'az account list|show' and 'az graph query'. Nothing is created,
        changed or deleted in Azure. For defence in depth, sign in with an identity that only has Reader.
    .PARAMETER Path
        Output file. Default: .\inventory.json
    .PARAMETER SubscriptionId
        One or more subscription GUIDs. Default: every enabled subscription you can see.
    .PARAMETER SkipRoleAssignments
        Skip the role assignment query (disables the optional identity view).
    .PARAMETER Backend
        Auto (default) prefers Az.ResourceGraph and falls back to the Azure CLI.
    .PARAMETER PassThru
        Also return the snapshot object.
    .EXAMPLE
        Connect-AzAccount
        Export-AzureInfraSnapshot -Path .\inventory.json
    .EXAMPLE
        Export-AzureInfraSnapshot -SubscriptionId 00000000-0000-0000-0000-000000000000 -Backend AzCli
    #>
    [CmdletBinding()]
    param(
        [string]$Path = (Join-Path (Get-Location) 'inventory.json'),
        [string[]]$SubscriptionId,
        [switch]$SkipRoleAssignments,
        [ValidateSet('Auto', 'AzModule', 'AzCli')][string]$Backend = 'Auto',
        [switch]$PassThru
    )

    foreach ($s in $SubscriptionId) {
        if ($s -notmatch $script:GuidPattern) { throw "Not a subscription GUID: $s" }
    }
    $be = Get-InfraBackend -Backend $Backend
    Write-Verbose "Backend: $be"

    $subsMeta = @(Get-InfraSubscriptions -Backend $be)
    if ($SubscriptionId) {
        $wanted = $SubscriptionId | ForEach-Object { $_.ToLowerInvariant() }
        $found = @($subsMeta | ForEach-Object { $_.id.ToLowerInvariant() })
        foreach ($w in $wanted) { if ($found -notcontains $w) { Write-Warning "Subscription $w was not found among your enabled subscriptions and is skipped." } }
        $subsMeta = @($subsMeta | Where-Object { $wanted -contains $_.id.ToLowerInvariant() })
    }
    if ($subsMeta.Count -eq 0) { throw 'No matching enabled subscriptions found. Sign in first (Connect-AzAccount or az login) and check -SubscriptionId.' }
    $subs = @($subsMeta | ForEach-Object { $_.id })
    Write-Host "Exporting $($subs.Count) subscription(s) with the $be backend"

    $resources = Get-InfraGraphRows -Backend $be -Query $script:KqlResources -Subscriptions $subs -Label 'resources'
    $containers = Get-InfraGraphRows -Backend $be -Query $script:KqlContainers -Subscriptions $subs -Label 'containers'
    $roles = if ($SkipRoleAssignments) { @() } else { Get-InfraGraphRows -Backend $be -Query $script:KqlRoles -Subscriptions $subs -Label 'role assignments' }

    $snapshot = [ordered]@{
        schema          = $script:SchemaId
        exportedAt      = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        tool            = "AzureInfraDiagram PowerShell module $script:ModuleVersion ($be)"
        subscriptions   = @($subsMeta)
        containers      = @($containers)
        resources       = @($resources)
        roleAssignments = @($roles)
    }
    $json = $snapshot | ConvertTo-Json -Depth 100 -Compress
    $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    [IO.File]::WriteAllText($full, $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Wrote $full ($($resources.Count) resources, $($containers.Count) containers, $(@($roles).Count) role assignments)"
    Write-Warning 'The file contains resource names, IDs and IP addresses. Treat it as sensitive; do not publish it unless you mean to.'
    if ($PassThru) { $snapshot }
}
