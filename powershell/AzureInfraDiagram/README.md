# AzureInfraDiagram (PowerShell module)

Read-only exporter for **Another Azure Infrastructure to Diagram**. It saves one JSON snapshot of your
Azure estate. Open that file in the viewer and the diagram is computed in your browser.

## Requirements
- PowerShell 5.1 or 7+
- Either `Az.Accounts` + `Az.ResourceGraph` (`Install-Module Az.ResourceGraph`) or the Azure CLI with
  `az extension add --name resource-graph`
- A signed-in session (`Connect-AzAccount` or `az login`). A **Reader** role is enough.

## Use
```powershell
Import-Module ./powershell/AzureInfraDiagram
Connect-AzAccount
Export-AzureInfraSnapshot -Path ./inventory.json          # all enabled subscriptions
Test-AzureInfraSnapshot  -Path ./inventory.json           # optional sanity check
```
Options: `-SubscriptionId <guid[]>`, `-SkipRoleAssignments`, `-Backend Auto|AzModule|AzCli`, `-PassThru`, `-Verbose`.

## What it calls
About three paged Azure Resource Graph queries (resources, subscriptions and resource groups, service principal
role assignments), plus one subscription listing. Nothing else.
- Az backend: `Get-AzSubscription`, `Search-AzGraph`.
- CLI backend: `az account list|show`, `az graph query`. Any other `az` command is refused by an allowlist.

The snapshot contains resource names, IDs and IP addresses. Keep it private.
