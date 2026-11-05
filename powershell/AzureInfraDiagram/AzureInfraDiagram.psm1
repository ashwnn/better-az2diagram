# Loader: dot-source private helpers first, then the public commands.
$script:SchemaId = 'azure-atlas/1'
$script:ModuleVersion = '0.1.0'

foreach ($folder in 'Private', 'Public') {
    Get-ChildItem -Path (Join-Path $PSScriptRoot $folder) -Filter '*.ps1' -File | ForEach-Object { . $_.FullName }
}
Export-ModuleMember -Function 'Export-AzureInfraSnapshot', 'Test-AzureInfraSnapshot'
