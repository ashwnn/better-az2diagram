# Two interchangeable read-only backends. Nothing else in Azure is ever called.
#   AzModule : Get-AzSubscription + Search-AzGraph   (Az.Accounts, Az.ResourceGraph)
#   AzCli    : az account list + az graph query      (Azure CLI + resource-graph extension)

$script:AllowedAzCli = @(
    @('graph', 'query'),
    @('account', 'list'),
    @('account', 'show')
)

function Invoke-ReadOnlyAzCli {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string[]]$Arguments)

    $allowed = $false
    foreach ($prefix in $script:AllowedAzCli) {
        if ($Arguments.Count -ge $prefix.Count -and $Arguments[0] -eq $prefix[0] -and $Arguments[1] -eq $prefix[1]) { $allowed = $true; break }
    }
    if (-not $allowed) {
        throw "Refusing to run a non-allowlisted az command: az $($Arguments[0..([Math]::Min(2, $Arguments.Count - 1))] -join ' ') ..."
    }
    $attempt = 0
    while ($true) {
        $attempt++
        $text = & az @Arguments -o json 2>&1
        $code = $LASTEXITCODE
        $joined = ($text | ForEach-Object { "$_" }) -join "`n"
        if ($code -eq 0) {
            if ([string]::IsNullOrWhiteSpace($joined)) { return $null }
            return ($joined | ConvertFrom-Json)
        }
        if ($joined -match '429|throttl|too many requests' -and $attempt -lt 5) {
            $wait = [Math]::Pow(2, $attempt)
            Write-Warning "Throttled by Azure, waiting $wait s"
            Start-Sleep -Seconds $wait
            continue
        }
        throw "az failed ($code): $($joined.Substring(0, [Math]::Min(600, $joined.Length)))"
    }
}

function Get-InfraBackend {
    param([ValidateSet('Auto', 'AzModule', 'AzCli')][string]$Backend = 'Auto')
    if ($Backend -ne 'Auto') { return $Backend }
    if (Get-Command -Name Search-AzGraph -ErrorAction SilentlyContinue) { return 'AzModule' }
    if (Get-Command -Name az -ErrorAction SilentlyContinue) { return 'AzCli' }
    throw "No backend found. Install the Az.ResourceGraph module (Install-Module Az.ResourceGraph) or the Azure CLI with 'az extension add --name resource-graph', then sign in."
}

function Get-InfraSubscriptions {
    param([string]$Backend)
    if ($Backend -eq 'AzModule') {
        @(Get-AzSubscription -WarningAction SilentlyContinue | Where-Object { $_.State -eq 'Enabled' } |
            ForEach-Object { [ordered]@{ id = $_.Id; name = $_.Name; tenantId = $_.TenantId } })
    } else {
        @(Invoke-ReadOnlyAzCli -Arguments @('account', 'list', '--query', "[?state=='Enabled'].{id:id,name:name,tenantId:tenantId}") |
            ForEach-Object { [ordered]@{ id = $_.id; name = $_.name; tenantId = $_.tenantId } })
    }
}

function Get-InfraGraphRows {
    param([string]$Backend, [string]$Query, [string[]]$Subscriptions, [string]$Label)
    $rows = New-Object System.Collections.Generic.List[object]
    $token = $null
    $page = 0
    do {
        if ($Backend -eq 'AzModule') {
            $p = @{ Query = $Query; Subscription = $Subscriptions; First = $script:PageSize }
            if ($token) { $p.SkipToken = $token }
            $res = Search-AzGraph @p
            $data = @($res.Data)
            $token = $res.SkipToken
        } else {
            $a = @('graph', 'query', '-q', $Query, '--first', "$script:PageSize", '--subscriptions') + $Subscriptions
            if ($token) { $a += @('--skip-token', $token) }
            $res = Invoke-ReadOnlyAzCli -Arguments $a
            $data = @($res.data)
            $token = if ($res.skip_token) { $res.skip_token } elseif ($res.skipToken) { $res.skipToken } else { $null }
        }
        foreach ($d in $data) { if ($null -ne $d) { $rows.Add($d) } }
        $page++
        Write-Verbose "${Label}: page $page, $($rows.Count) rows"
        if ($token) { Start-Sleep -Milliseconds 400 }
    } while ($token)
    , $rows.ToArray()
}
