# Run:  Invoke-Pester ./powershell/tests
# No Azure access is needed: Search-AzGraph, Get-AzSubscription and `az` are replaced by mocks that
# serve the bundled sample inventory, so the tests also prove the output has the shape the viewer reads.

BeforeAll {
    $script:Module = Join-Path $PSScriptRoot '..' 'AzureInfraDiagram' 'AzureInfraDiagram.psd1'
    $script:SamplePath = Join-Path $PSScriptRoot '..' '..' 'sample' 'inventory.json'
    $script:Sample = Get-Content -LiteralPath $script:SamplePath -Raw | ConvertFrom-Json
    # Stubs so Pester can mock commands that are not installed on the test machine.
    function global:Search-AzGraph { param($Query, $Subscription, $First, $SkipToken) }
    function global:Get-AzSubscription { param() }
    function global:az { }
    Import-Module $script:Module -Force
}

AfterAll {
    Remove-Item function:global:Search-AzGraph, function:global:Get-AzSubscription, function:global:az -ErrorAction SilentlyContinue
    Remove-Module AzureInfraDiagram -ErrorAction SilentlyContinue
}

Describe 'Export-AzureInfraSnapshot (Az module backend)' {
    BeforeEach {
        $script:calls = New-Object System.Collections.Generic.List[string]
        $script:AllRes = @($script:Sample.resources)
        Mock -ModuleName AzureInfraDiagram Get-AzSubscription {
            $script:Sample.subscriptions | ForEach-Object { [pscustomobject]@{ Id = $_.id; Name = $_.name; TenantId = $_.tenantId; State = 'Enabled' } }
            [pscustomobject]@{ Id = '99999999-9999-9999-9999-999999999999'; Name = 'disabled'; TenantId = 't'; State = 'Disabled' }
        } -ParameterFilter { $true }
        $sample = $script:Sample
        Mock -ModuleName AzureInfraDiagram Search-AzGraph {
            $script:graphCalls += , $Query
            if ($Query -like 'Resources*') {
                $all = @($sample.resources)
                $start = if ($SkipToken) { [int]$SkipToken } else { 0 }
                $page = 40   # force pagination (real page size is 1000)
                $slice = @($all | Select-Object -Skip $start -First $page)
                $next = if ($start + $page -lt $all.Count) { [string]($start + $page) } else { $null }
                [pscustomobject]@{ Data = $slice; SkipToken = $next }
            } elseif ($Query -like 'ResourceContainers*') {
                [pscustomobject]@{ Data = @($sample.containers); SkipToken = $null }
            } else {
                [pscustomobject]@{ Data = @($sample.roleAssignments); SkipToken = $null }
            }
        }
        $script:graphCalls = @()
        $script:out = Join-Path $TestDrive 'inventory.json'
        Remove-Item -LiteralPath $script:out -ErrorAction SilentlyContinue
    }

    It 'writes a snapshot with every resource, following pagination' {
        Export-AzureInfraSnapshot -Path $script:out -Backend AzModule -WarningAction SilentlyContinue 6>$null
        $j = Get-Content -LiteralPath $script:out -Raw | ConvertFrom-Json
        $j.schema | Should -Be 'azure-atlas/1'
        @($j.resources).Count | Should -Be @($script:Sample.resources).Count
        @($j.containers).Count | Should -Be @($script:Sample.containers).Count
        @($j.roleAssignments).Count | Should -Be @($script:Sample.roleAssignments).Count
        @($j.subscriptions).Count | Should -Be @($script:Sample.subscriptions).Count   # disabled subscription excluded
        ($script:graphCalls | Where-Object { $_ -like 'Resources*' }).Count | Should -BeGreaterThan 1
    }

    It 'keeps nested properties intact (round trip equals the source data)' {
        Export-AzureInfraSnapshot -Path $script:out -Backend AzModule -WarningAction SilentlyContinue 6>$null
        $a = (Get-Content -LiteralPath $script:out -Raw | ConvertFrom-Json).resources | ConvertTo-Json -Depth 100 -Compress
        $b = $script:Sample.resources | ConvertTo-Json -Depth 100 -Compress
        $a | Should -Be $b
    }

    It 'skips role assignments on request' {
        Export-AzureInfraSnapshot -Path $script:out -Backend AzModule -SkipRoleAssignments -WarningAction SilentlyContinue 6>$null
        $j = Get-Content -LiteralPath $script:out -Raw | ConvertFrom-Json
        @($j.roleAssignments).Count | Should -Be 0
        $j.PSObject.Properties.Name | Should -Contain 'roleAssignments'
        ($script:graphCalls | Where-Object { $_ -like 'AuthorizationResources*' }).Count | Should -Be 0
    }

    It 'limits to the requested subscriptions' {
        $one = $script:Sample.subscriptions[0].id
        Export-AzureInfraSnapshot -Path $script:out -Backend AzModule -SubscriptionId $one -WarningAction SilentlyContinue 6>$null
        $j = Get-Content -LiteralPath $script:out -Raw | ConvertFrom-Json
        @($j.subscriptions).Count | Should -Be 1
        $j.subscriptions[0].id | Should -Be $one
    }

    It 'rejects a value that is not a GUID before doing anything' {
        { Export-AzureInfraSnapshot -Path $script:out -Backend AzModule -SubscriptionId "x'; drop" } | Should -Throw '*Not a subscription GUID*'
        Test-Path $script:out | Should -BeFalse
    }

    It 'returns the snapshot with -PassThru and passes Test-AzureInfraSnapshot' {
        $r = Export-AzureInfraSnapshot -Path $script:out -Backend AzModule -PassThru -WarningAction SilentlyContinue 6>$null
        $r.schema | Should -Be 'azure-atlas/1'
        $t = Test-AzureInfraSnapshot -Path $script:out
        $t.Valid | Should -BeTrue
        $t.Resources | Should -Be @($script:Sample.resources).Count
    }

    It 'only ever calls read-only commands' {
        Export-AzureInfraSnapshot -Path $script:out -Backend AzModule -WarningAction SilentlyContinue 6>$null
        Should -Invoke -ModuleName AzureInfraDiagram Get-AzSubscription -Times 1
        Should -Invoke -ModuleName AzureInfraDiagram Search-AzGraph -Times 3 -Exactly:$false
        $script:graphCalls | ForEach-Object { $_ | Should -Not -Match '(?i)\b(delete|create|update|set|remove)\b\s' }
    }
}

Describe 'Export-AzureInfraSnapshot (Azure CLI backend)' {
    BeforeEach {
        $script:azLog = New-Object System.Collections.Generic.List[string]
        $sample = $script:Sample
        Mock -ModuleName AzureInfraDiagram az {
            $global:LASTEXITCODE = 0
            $a = @($args)
            $script:azLog.Add(($a[0..1] -join ' '))
            if ($a[0] -eq 'account') {
                return ($sample.subscriptions | ConvertTo-Json -Depth 10 -AsArray)
            }
            $q = $a[$a.IndexOf('-q') + 1]
            $data = if ($q -like 'Resources*') { @($sample.resources) } elseif ($q -like 'ResourceContainers*') { @($sample.containers) } else { @($sample.roleAssignments) }
            [pscustomobject]@{ data = $data; skip_token = $null } | ConvertTo-Json -Depth 100 -Compress
        }
        $script:out = Join-Path $TestDrive 'cli.json'
    }

    It 'exports through az graph query only' {
        Export-AzureInfraSnapshot -Path $script:out -Backend AzCli -WarningAction SilentlyContinue 6>$null
        $j = Get-Content -LiteralPath $script:out -Raw | ConvertFrom-Json
        @($j.resources).Count | Should -Be @($script:Sample.resources).Count
        ($script:azLog | Sort-Object -Unique) | Should -Be @('account list', 'graph query')
    }

    It 'refuses any az command outside the allowlist' {
        InModuleScope AzureInfraDiagram {
            { Invoke-ReadOnlyAzCli -Arguments @('group', 'delete', '--name', 'x') } | Should -Throw '*non-allowlisted*'
            { Invoke-ReadOnlyAzCli -Arguments @('vm', 'start') } | Should -Throw '*non-allowlisted*'
            { Invoke-ReadOnlyAzCli -Arguments @('graph') } | Should -Throw '*non-allowlisted*'
        }
    }
}

Describe 'Test-AzureInfraSnapshot' {
    It 'accepts the bundled sample' {
        (Test-AzureInfraSnapshot -Path $script:SamplePath).Valid | Should -BeTrue
    }
    It 'flags a wrong schema and missing arrays' {
        $bad = Join-Path $TestDrive 'bad.json'
        '{"schema":"other/9","resources":[]}' | Set-Content -LiteralPath $bad
        $r = Test-AzureInfraSnapshot -Path $bad
        $r.Valid | Should -BeFalse
        ($r.Problems -join ' ') | Should -Match 'schema'
        ($r.Problems -join ' ') | Should -Match "missing 'containers'"
    }
    It 'throws on invalid JSON' {
        $bad = Join-Path $TestDrive 'broken.json'
        'not json' | Set-Content -LiteralPath $bad
        { Test-AzureInfraSnapshot -Path $bad } | Should -Throw '*Not valid JSON*'
    }
}
