#!/usr/bin/env python3
"""Generate sample/inventory.json: a fictional hub-and-spoke estate shaped like real
Azure Resource Graph output (same property names the real ARM resources expose).
No real tenant data is involved; all GUIDs are derived from fixed names.
"""
import json
import uuid
from pathlib import Path

NS = uuid.UUID("11111111-2222-3333-4444-555555555555")
guid = lambda s: str(uuid.uuid5(NS, s))

SUB_HUB = guid("sub-connectivity")
SUB_PROD = guid("sub-landing-prod")
TENANT = guid("tenant")
LOC = "canadacentral"

resources, containers = [], []


def rid(sub, rg, prov, *parts):
    return f"/subscriptions/{sub}/resourceGroups/{rg}/providers/{prov}/" + "/".join(parts)


def add(sub, rg, prov, kind_path, name, props=None, sku=None, kind=None, identity=None, tags=None, loc=LOC, rtype=None):
    """kind_path is the type tail e.g. 'virtualNetworks'. name may be 'parent/child'."""
    ttype = rtype or f"{prov}/{kind_path}"
    segs = kind_path.split("/")
    names = name.split("/")
    path = []
    for s, n in zip(segs, names):
        path += [s, n]
    r = {
        "id": rid(sub, rg, prov, *path),
        "name": names[-1] if "/" not in name else name.split("/")[-1],
        "type": ttype.lower(),
        "location": loc,
        "resourceGroup": rg,
        "subscriptionId": sub,
        "tags": tags or {},
        "properties": props or {},
    }
    if sku: r["sku"] = sku
    if kind: r["kind"] = kind
    if identity: r["identity"] = identity
    resources.append(r)
    return r["id"]


def sid(vnet_id, subnet):
    return f"{vnet_id}/subnets/{subnet}"


# ----------------------------------------------------------------------------- containers
containers += [
    {"id": f"/subscriptions/{SUB_HUB}", "name": "Contoso Connectivity", "type": "microsoft.resources/subscriptions",
     "subscriptionId": SUB_HUB, "tags": {}, "properties": {"state": "Enabled"}},
    {"id": f"/subscriptions/{SUB_PROD}", "name": "Contoso Landing Zone Prod", "type": "microsoft.resources/subscriptions",
     "subscriptionId": SUB_PROD, "tags": {}, "properties": {"state": "Enabled"}},
]
for sub, rg in [(SUB_HUB, "rg-hub-net"), (SUB_HUB, "rg-hub-mgmt"), (SUB_HUB, "rg-hub-dns"),
                (SUB_PROD, "rg-app-prod-net"), (SUB_PROD, "rg-app-prod-compute"), (SUB_PROD, "rg-app-prod-data"),
                (SUB_PROD, "rg-data-prod"), (SUB_PROD, "rg-edge")]:
    containers.append({"id": f"/subscriptions/{sub}/resourceGroups/{rg}", "name": rg,
                       "type": "microsoft.resources/subscriptions/resourcegroups", "location": LOC,
                       "subscriptionId": sub, "resourceGroup": rg, "tags": {}, "properties": {}})

# ----------------------------------------------------------------------------- identities
def uai(sub, rg, name):
    return add(sub, rg, "Microsoft.ManagedIdentity", "userAssignedIdentities", name,
               {"principalId": guid("pid-" + name), "clientId": guid("cid-" + name), "tenantId": TENANT})

id_app = uai(SUB_PROD, "rg-app-prod-compute", "id-app-portal")
id_aks = uai(SUB_PROD, "rg-app-prod-compute", "id-aks-prod")
uai_map = lambda *ids: {"type": "UserAssigned", "userAssignedIdentities": {i: {"principalId": guid("p" + i), "clientId": guid("c" + i)} for i in ids}}

# ----------------------------------------------------------------------------- monitoring
law = add(SUB_HUB, "rg-hub-mgmt", "Microsoft.OperationalInsights", "workspaces", "law-contoso-hub",
          {"sku": {"name": "PerGB2018"}, "retentionInDays": 90}, sku={"name": "PerGB2018"})

# ----------------------------------------------------------------------------- hub network
hub_rg = "rg-hub-net"
nsg_mgmt = add(SUB_HUB, "rg-hub-mgmt", "Microsoft.Network", "networkSecurityGroups", "nsg-hub-mgmt",
               {"securityRules": [{"name": "allow-bastion-ssh"}, {"name": "deny-all-in"}]})
rt_mgmt = add(SUB_HUB, "rg-hub-mgmt", "Microsoft.Network", "routeTables", "rt-hub-mgmt",
              {"routes": [{"name": "default-to-fw", "properties": {"addressPrefix": "0.0.0.0/0", "nextHopType": "VirtualAppliance", "nextHopIpAddress": "10.0.0.4"}}]})
vnet_hub_id = rid(SUB_HUB, hub_rg, "Microsoft.Network", "virtualNetworks", "vnet-hub-cc")
vnet_app_id = rid(SUB_PROD, "rg-app-prod-net", "Microsoft.Network", "virtualNetworks", "vnet-spoke-app")
vnet_data_id = rid(SUB_PROD, "rg-data-prod", "Microsoft.Network", "virtualNetworks", "vnet-spoke-data")


def subnet(vnet_id, name, prefix, nsg=None, rt=None, delegation=None):
    p = {"addressPrefix": prefix, "provisioningState": "Succeeded"}
    if nsg: p["networkSecurityGroup"] = {"id": nsg}
    if rt: p["routeTable"] = {"id": rt}
    if delegation: p["delegations"] = [{"name": "d", "properties": {"serviceName": delegation}}]
    return {"id": sid(vnet_id, name), "name": name, "type": "Microsoft.Network/virtualNetworks/subnets", "properties": p}


def peering(local_name, remote_id):
    return {"name": f"peer-{local_name}", "properties": {"remoteVirtualNetwork": {"id": remote_id},
            "peeringState": "Connected", "allowForwardedTraffic": True, "allowGatewayTransit": True}}


add(SUB_HUB, hub_rg, "Microsoft.Network", "virtualNetworks", "vnet-hub-cc", {
    "addressSpace": {"addressPrefixes": ["10.0.0.0/22"]},
    "subnets": [
        subnet(vnet_hub_id, "AzureFirewallSubnet", "10.0.0.0/26"),
        subnet(vnet_hub_id, "AzureBastionSubnet", "10.0.0.64/26"),
        subnet(vnet_hub_id, "GatewaySubnet", "10.0.1.0/27"),
        subnet(vnet_hub_id, "snet-mgmt", "10.0.3.0/24", nsg_mgmt, rt_mgmt),
    ],
    "virtualNetworkPeerings": [peering("hub-app", vnet_app_id), peering("hub-data", vnet_data_id)],
})


def pip(sub, rg, name, ip):
    return add(sub, rg, "Microsoft.Network", "publicIPAddresses", name,
               {"ipAddress": ip, "publicIPAllocationMethod": "Static"}, sku={"name": "Standard"})


pip_fw = pip(SUB_HUB, hub_rg, "pip-afw-hub", "20.48.10.11")
pip_bas = pip(SUB_HUB, hub_rg, "pip-bas-hub", "20.48.10.12")
pip_vgw = pip(SUB_HUB, hub_rg, "pip-vgw-hub", "20.48.10.13")
fw_pol = add(SUB_HUB, hub_rg, "Microsoft.Network", "firewallPolicies", "afwp-hub", {"sku": {"tier": "Premium"}}, sku=None)
add(SUB_HUB, hub_rg, "Microsoft.Network", "azureFirewalls", "afw-hub-cc", {
    "ipConfigurations": [{"name": "ipc", "properties": {"subnet": {"id": sid(vnet_hub_id, "AzureFirewallSubnet")}, "publicIPAddress": {"id": pip_fw}, "privateIPAddress": "10.0.0.4"}}],
    "firewallPolicy": {"id": fw_pol}, "sku": {"name": "AZFW_VNet", "tier": "Premium"}})
add(SUB_HUB, hub_rg, "Microsoft.Network", "bastionHosts", "bas-hub-cc", {
    "ipConfigurations": [{"name": "ipc", "properties": {"subnet": {"id": sid(vnet_hub_id, "AzureBastionSubnet")}, "publicIPAddress": {"id": pip_bas}}}]},
    sku={"name": "Standard"})
vgw = add(SUB_HUB, hub_rg, "Microsoft.Network", "virtualNetworkGateways", "vgw-hub-cc", {
    "ipConfigurations": [{"name": "ipc", "properties": {"subnet": {"id": sid(vnet_hub_id, "GatewaySubnet")}, "publicIPAddress": {"id": pip_vgw}}}],
    "gatewayType": "Vpn", "vpnType": "RouteBased", "sku": {"name": "VpnGw2AZ", "tier": "VpnGw2AZ"}})
lng = add(SUB_HUB, hub_rg, "Microsoft.Network", "localNetworkGateways", "lng-vancouver-dc", {
    "gatewayIpAddress": "203.0.113.10", "localNetworkAddressSpace": {"addressPrefixes": ["192.168.0.0/16"]}})
add(SUB_HUB, hub_rg, "Microsoft.Network", "connections", "cn-hub-to-vancouver", {
    "connectionType": "IPsec", "connectionStatus": "Connected",
    "virtualNetworkGateway1": {"id": vgw}, "localNetworkGateway2": {"id": lng}})

# jump host
pip_nic_id = rid(SUB_HUB, "rg-hub-mgmt", "Microsoft.Network", "networkInterfaces", "nic-vm-mgmt01")
disk_mgmt = add(SUB_HUB, "rg-hub-mgmt", "Microsoft.Compute", "disks", "vm-mgmt01_osdisk",
                {"diskSizeGB": 128, "managedBy": rid(SUB_HUB, "rg-hub-mgmt", "Microsoft.Compute", "virtualMachines", "vm-mgmt01")}, sku={"name": "Premium_LRS"})
add(SUB_HUB, "rg-hub-mgmt", "Microsoft.Network", "networkInterfaces", "nic-vm-mgmt01", {
    "ipConfigurations": [{"name": "ipc", "properties": {"subnet": {"id": sid(vnet_hub_id, "snet-mgmt")}, "privateIPAddress": "10.0.3.4"}}],
    "networkSecurityGroup": {"id": nsg_mgmt}, "virtualMachine": {"id": rid(SUB_HUB, "rg-hub-mgmt", "Microsoft.Compute", "virtualMachines", "vm-mgmt01")}})
add(SUB_HUB, "rg-hub-mgmt", "Microsoft.Compute", "virtualMachines", "vm-mgmt01", {
    "hardwareProfile": {"vmSize": "Standard_D2s_v5"},
    "storageProfile": {"osDisk": {"osType": "Linux", "managedDisk": {"id": disk_mgmt}}, "dataDisks": []},
    "networkProfile": {"networkInterfaces": [{"id": pip_nic_id}]}, "provisioningState": "Succeeded"})

# private dns zones + vnet links
dns_zones = {}
for z in ["privatelink.database.windows.net", "privatelink.blob.core.windows.net",
          "privatelink.vaultcore.azure.net", "privatelink.documents.azure.com"]:
    dns_zones[z] = add(SUB_HUB, "rg-hub-dns", "Microsoft.Network", "privateDnsZones", z,
                       {"numberOfRecordSets": 4, "numberOfVirtualNetworkLinks": 3}, loc="global")
    for vn_name, vn_id in [("hub", vnet_hub_id), ("app", vnet_app_id), ("data", vnet_data_id)]:
        add(SUB_HUB, "rg-hub-dns", "Microsoft.Network", "privateDnsZones/virtualNetworkLinks", f"{z}/link-{vn_name}",
            {"virtualNetwork": {"id": vn_id}, "registrationEnabled": False}, loc="global")

# ----------------------------------------------------------------------------- app spoke
APP_NET = "rg-app-prod-net"
nsg_web = add(SUB_PROD, APP_NET, "Microsoft.Network", "networkSecurityGroups", "nsg-snet-web", {"securityRules": [{"name": "allow-https"}]})
nsg_aks = add(SUB_PROD, APP_NET, "Microsoft.Network", "networkSecurityGroups", "nsg-snet-aks", {"securityRules": [{"name": "allow-lb"}]})
nsg_pe = add(SUB_PROD, APP_NET, "Microsoft.Network", "networkSecurityGroups", "nsg-snet-pe", {"securityRules": []})
rt_spoke = add(SUB_PROD, APP_NET, "Microsoft.Network", "routeTables", "rt-spoke-default", {
    "routes": [{"name": "default", "properties": {"addressPrefix": "0.0.0.0/0", "nextHopType": "VirtualAppliance", "nextHopIpAddress": "10.0.0.4"}}]})

add(SUB_PROD, APP_NET, "Microsoft.Network", "virtualNetworks", "vnet-spoke-app", {
    "addressSpace": {"addressPrefixes": ["10.10.0.0/22"]},
    "subnets": [
        subnet(vnet_app_id, "snet-appgw", "10.10.0.0/24"),
        subnet(vnet_app_id, "snet-web", "10.10.1.0/24", nsg_web, rt_spoke),
        subnet(vnet_app_id, "snet-aks", "10.10.2.0/23", nsg_aks, rt_spoke),
        subnet(vnet_app_id, "snet-pe", "10.10.3.0/26", nsg_pe),
        subnet(vnet_app_id, "snet-appsvc", "10.10.3.64/27", None, rt_spoke, "Microsoft.Web/serverFarms"),
    ],
    "virtualNetworkPeerings": [peering("app-hub", vnet_hub_id)],
})

pip_agw = pip(SUB_PROD, APP_NET, "pip-agw-app", "20.151.4.20")
waf = add(SUB_PROD, APP_NET, "Microsoft.Network", "ApplicationGatewayWebApplicationFirewallPolicies", "waf-app-prod", {"policySettings": {"mode": "Prevention"}})
agw = add(SUB_PROD, APP_NET, "Microsoft.Network", "applicationGateways", "agw-app-prod", {
    "gatewayIPConfigurations": [{"name": "gw", "properties": {"subnet": {"id": sid(vnet_app_id, "snet-appgw")}}}],
    "frontendIPConfigurations": [{"name": "pub", "properties": {"publicIPAddress": {"id": pip_agw}}}],
    "firewallPolicy": {"id": waf}, "backendAddressPools": [{"name": "pool-web"}]},
    sku={"name": "WAF_v2", "tier": "WAF_v2"})
lb = rid(SUB_PROD, APP_NET, "Microsoft.Network", "loadBalancers", "lbi-web")
add(SUB_PROD, APP_NET, "Microsoft.Network", "loadBalancers", "lbi-web", {
    "frontendIPConfigurations": [{"name": "fe", "properties": {"subnet": {"id": sid(vnet_app_id, "snet-web")}, "privateIPAddress": "10.10.1.10"}}],
    "backendAddressPools": [{"id": lb + "/backendAddressPools/pool-web", "name": "pool-web"}]}, sku={"name": "Standard"})

# VM scale set behind AppGW + internal LB
add(SUB_PROD, "rg-app-prod-compute", "Microsoft.Compute", "virtualMachineScaleSets", "vmss-web-prod", {
    "virtualMachineProfile": {"networkProfile": {"networkInterfaceConfigurations": [{"name": "nic", "properties": {"ipConfigurations": [{"name": "ipc", "properties": {
        "subnet": {"id": sid(vnet_app_id, "snet-web")},
        "applicationGatewayBackendAddressPools": [{"id": agw + "/backendAddressPools/pool-web"}],
        "loadBalancerBackendAddressPools": [{"id": lb + "/backendAddressPools/pool-web"}]}}]}}]},
        "storageProfile": {"osDisk": {"osType": "Linux"}}},
    "orchestrationMode": "Flexible"}, sku={"name": "Standard_D4s_v5", "capacity": 3})

# AKS
add(SUB_PROD, "rg-app-prod-compute", "Microsoft.ContainerService", "managedClusters", "aks-app-prod", {
    "kubernetesVersion": "1.31.2", "dnsPrefix": "aks-app-prod",
    "agentPoolProfiles": [{"name": "system", "count": 3, "vmSize": "Standard_D4s_v5", "vnetSubnetID": sid(vnet_app_id, "snet-aks")},
                          {"name": "user", "count": 4, "vmSize": "Standard_D8s_v5", "vnetSubnetID": sid(vnet_app_id, "snet-aks")}],
    "networkProfile": {"networkPlugin": "azure", "networkPolicy": "cilium"}},
    sku={"name": "Base", "tier": "Standard"}, identity=uai_map(id_aks))
acr = add(SUB_PROD, "rg-app-prod-compute", "Microsoft.ContainerRegistry", "registries", "acrcontosoprod",
          {"loginServer": "acrcontosoprod.azurecr.io", "publicNetworkAccess": "Disabled"}, sku={"name": "Premium"})

# App Service + Functions with VNet integration
asp = add(SUB_PROD, "rg-app-prod-compute", "Microsoft.Web", "serverfarms", "asp-app-prod", {"reserved": True}, sku={"name": "P1v3", "tier": "PremiumV3"}, kind="linux")
add(SUB_PROD, "rg-app-prod-compute", "Microsoft.Web", "sites", "app-portal-prod", {
    "serverFarmId": asp, "virtualNetworkSubnetId": sid(vnet_app_id, "snet-appsvc"), "defaultHostName": "app-portal-prod.azurewebsites.net",
    "httpsOnly": True}, kind="app,linux", identity=uai_map(id_app))
add(SUB_PROD, "rg-app-prod-compute", "Microsoft.Web", "sites", "func-orders-prod", {
    "serverFarmId": asp, "virtualNetworkSubnetId": sid(vnet_app_id, "snet-appsvc"), "defaultHostName": "func-orders-prod.azurewebsites.net"},
    kind="functionapp,linux", identity=uai_map(id_app))
add(SUB_PROD, "rg-app-prod-compute", "Microsoft.Insights", "components", "appi-app-prod",
    {"WorkspaceResourceId": law, "Application_Type": "web"}, kind="web")

# data services + private endpoints
sql = add(SUB_PROD, "rg-app-prod-data", "Microsoft.Sql", "servers", "sql-contoso-prod",
          {"fullyQualifiedDomainName": "sql-contoso-prod.database.windows.net", "publicNetworkAccess": "Disabled", "version": "12.0"}, kind="v12.0")
add(SUB_PROD, "rg-app-prod-data", "Microsoft.Sql", "servers/databases", "sql-contoso-prod/sqldb-orders", {"maxSizeBytes": 268435456000}, sku={"name": "GP_Gen5", "tier": "GeneralPurpose", "capacity": 4})
add(SUB_PROD, "rg-app-prod-data", "Microsoft.Sql", "servers/databases", "sql-contoso-prod/sqldb-catalog", {"maxSizeBytes": 107374182400}, sku={"name": "GP_S_Gen5", "tier": "GeneralPurpose", "capacity": 2})
st = add(SUB_PROD, "rg-app-prod-data", "Microsoft.Storage", "storageAccounts", "stcontosoprod01",
         {"primaryEndpoints": {"blob": "https://stcontosoprod01.blob.core.windows.net/"}, "publicNetworkAccess": "Disabled"},
         sku={"name": "Standard_GZRS"}, kind="StorageV2")
kv = add(SUB_PROD, "rg-app-prod-data", "Microsoft.KeyVault", "vaults", "kv-contoso-prod",
         {"vaultUri": "https://kv-contoso-prod.vault.azure.net/", "enableRbacAuthorization": True}, sku={"name": "premium"})
cosmos = add(SUB_PROD, "rg-app-prod-data", "Microsoft.DocumentDB", "databaseAccounts", "cosmos-orders-prod",
             {"documentEndpoint": "https://cosmos-orders-prod.documents.azure.com:443/", "publicNetworkAccess": "Disabled"}, kind="GlobalDocumentDB")


def pe(sub, rg, name, vnet_id, snet, target, group, ip):
    pe_id = rid(sub, rg, "Microsoft.Network", "privateEndpoints", name)
    add(sub, rg, "Microsoft.Network", "privateEndpoints", name, {
        "subnet": {"id": sid(vnet_id, snet)},
        "privateLinkServiceConnections": [{"name": name, "properties": {"privateLinkServiceId": target, "groupIds": [group]}}],
        "customDnsConfigs": [{"ipAddresses": [ip]}]})


pe(SUB_PROD, APP_NET, "pe-sql-prod", vnet_app_id, "snet-pe", sql, "sqlServer", "10.10.3.4")
pe(SUB_PROD, APP_NET, "pe-blob-prod", vnet_app_id, "snet-pe", st, "blob", "10.10.3.5")
pe(SUB_PROD, APP_NET, "pe-kv-prod", vnet_app_id, "snet-pe", kv, "vault", "10.10.3.6")
pe(SUB_PROD, APP_NET, "pe-cosmos-prod", vnet_app_id, "snet-pe", cosmos, "Sql", "10.10.3.7")
pe(SUB_PROD, APP_NET, "pe-acr-prod", vnet_app_id, "snet-pe", acr, "registry", "10.10.3.8")

# ----------------------------------------------------------------------------- data spoke
nsg_mi = add(SUB_PROD, "rg-data-prod", "Microsoft.Network", "networkSecurityGroups", "nsg-snet-sqlmi", {"securityRules": [{"name": "mi-mgmt"}]})
add(SUB_PROD, "rg-data-prod", "Microsoft.Network", "virtualNetworks", "vnet-spoke-data", {
    "addressSpace": {"addressPrefixes": ["10.20.0.0/24"]},
    "subnets": [subnet(vnet_data_id, "snet-sqlmi", "10.20.0.0/27", nsg_mi, rt_spoke, "Microsoft.Sql/managedInstances"),
                subnet(vnet_data_id, "snet-pe", "10.20.0.64/26")],
    "virtualNetworkPeerings": [peering("data-hub", vnet_hub_id)]})
mi = add(SUB_PROD, "rg-data-prod", "Microsoft.Sql", "managedInstances", "sqlmi-core-prod", {
    "subnetId": sid(vnet_data_id, "snet-sqlmi"), "vCores": 8, "fullyQualifiedDomainName": "sqlmi-core-prod.abc123.database.windows.net"},
    sku={"name": "GP_Gen5", "tier": "GeneralPurpose"})

# ----------------------------------------------------------------------------- edge (no vnet)
add(SUB_PROD, "rg-edge", "Microsoft.Cdn", "profiles", "afd-contoso", {"frontDoorId": guid("afd")}, sku={"name": "Premium_AzureFrontDoor"}, loc="global")

# ----------------------------------------------------------------------------- role assignments
ROLE = {"acrpull": "7f951dda-4ed3-4680-a7ca-43fe172d538d", "kvsecrets": "4633458b-17de-408a-b874-0445c86b69e6",
        "blobcontrib": "ba92f5b4-2d11-453d-a403-e96b0029c9fe"}
def ra(principal_name, scope, role):
    return {"id": f"{scope}/providers/Microsoft.Authorization/roleAssignments/{guid(principal_name + scope + role)}",
            "properties": {"principalId": guid("pid-" + principal_name), "principalType": "ServicePrincipal", "scope": scope,
                           "roleDefinitionId": f"/providers/Microsoft.Authorization/roleDefinitions/{ROLE[role]}"}}
role_assignments = [ra("id-aks-prod", acr, "acrpull"), ra("id-app-portal", kv, "kvsecrets"), ra("id-app-portal", st, "blobcontrib")]

out = {
    "schema": "azure-atlas/1",
    "exportedAt": "2026-11-05T09:00:00Z",
    "tool": "sample generator",
    "subscriptions": [{"id": SUB_HUB, "name": "Contoso Connectivity", "tenantId": TENANT},
                      {"id": SUB_PROD, "name": "Contoso Landing Zone Prod", "tenantId": TENANT}],
    "containers": containers,
    "resources": resources,
    "roleAssignments": role_assignments,
}
dest = Path(__file__).resolve().parent.parent / "sample" / "inventory.json"
dest.parent.mkdir(exist_ok=True)
dest.write_text(json.dumps(out, indent=1))
print(f"wrote {dest} with {len(resources)} resources, {len(containers)} containers, {len(role_assignments)} role assignments")
