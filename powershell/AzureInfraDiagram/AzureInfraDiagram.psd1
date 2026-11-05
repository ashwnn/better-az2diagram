@{
    RootModule        = 'AzureInfraDiagram.psm1'
    ModuleVersion     = '0.1.0'
    GUID              = '6f1d2c0e-5a43-4d57-9b0b-2f6a9a3c7e11'
    Author            = 'Another Azure Infrastructure to Diagram contributors'
    Description       = 'Read-only Azure inventory export (Azure Resource Graph) that produces a single JSON snapshot for the Another Azure Infrastructure to Diagram viewer.'
    PowerShellVersion = '5.1'
    CompatiblePSEditions = @('Desktop', 'Core')
    FunctionsToExport = @('Export-AzureInfraSnapshot', 'Test-AzureInfraSnapshot')
    CmdletsToExport   = @()
    VariablesToExport = @()
    AliasesToExport   = @()
    PrivateData       = @{
        PSData = @{
            Tags         = @('Azure', 'Diagram', 'ResourceGraph', 'Architecture', 'ReadOnly')
            LicenseUri   = 'https://opensource.org/licenses/MIT'
            ProjectUri   = 'https://github.com/ashwnn/better-az2diagram'
            ReleaseNotes = 'Initial release.'
        }
    }
}
