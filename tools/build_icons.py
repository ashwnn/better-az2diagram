#!/usr/bin/env python3
"""Normalise the official Microsoft Azure Architecture Icons into a compact JSON bundle.

Usage:
    python3 tools/build_icons.py <path-to>/Azure_Public_Service_Icons/Icons

Outputs:
    icons/icons.json   {slug: {"vb": "0 0 18 18", "body": "<svg inner markup, ids namespaced>"}}
    icons/typemap.json {armTypeLower: slug}

Only icons referenced by the type map are bundled, so the final HTML stays small.
Icons are used unmodified (no crop, recolour or distortion) as required by Microsoft's terms:
https://learn.microsoft.com/azure/architecture/icons/
"""
import json
import re
import sys
from pathlib import Path

# ARM resource type (lowercase) -> icon base name from the official pack.
TYPE_MAP = {
    # compute
    "microsoft.compute/virtualmachines": "Virtual-Machine",
    "microsoft.compute/virtualmachinescalesets": "VM-Scale-Sets",
    "microsoft.compute/disks": "Disks",
    "microsoft.compute/snapshots": "Disks-Snapshots",
    "microsoft.compute/availabilitysets": "Availability-Sets",
    "microsoft.compute/images": "Images",
    "microsoft.compute/galleries": "Azure-Compute-Galleries",
    "microsoft.compute/sshpublickeys": "SSH-Keys",
    "microsoft.compute/diskencryptionsets": "Disk-Encryption-Sets",
    "microsoft.compute/hostgroups": "Host-Groups",
    # containers
    "microsoft.containerservice/managedclusters": "Kubernetes-Services",
    "microsoft.containerregistry/registries": "Container-Registries",
    "microsoft.containerinstance/containergroups": "Container-Instances",
    "microsoft.app/managedenvironments": "Container-Apps-Environments",
    "microsoft.app/containerapps": "Worker-Container-App",
    "microsoft.batch/batchaccounts": "Batch-Accounts",
    # web
    "microsoft.web/sites": "App-Services",
    "microsoft.web/sites#functionapp": "Function-Apps",
    "microsoft.web/serverfarms": "App-Service-Plans",
    "microsoft.web/staticsites": "Static-Apps",
    "microsoft.web/hostingenvironments": "App-Service-Environments",
    "microsoft.web/certificates": "App-Service-Certificates",
    "microsoft.apimanagement/service": "API-Management-Services",
    "microsoft.signalrservice/signalr": "SignalR",
    # networking
    "microsoft.network/virtualnetworks": "Virtual-Networks",
    "microsoft.network/virtualnetworks/subnets": "Subnet",
    "microsoft.network/networkinterfaces": "Network-Interfaces",
    "microsoft.network/networksecuritygroups": "Network-Security-Groups",
    "microsoft.network/routetables": "Route-Tables",
    "microsoft.network/publicipaddresses": "Public-IP-Addresses",
    "microsoft.network/publicipprefixes": "Public-IP-Prefixes",
    "microsoft.network/loadbalancers": "Load-Balancers",
    "microsoft.network/applicationgateways": "Application-Gateways",
    "microsoft.network/azurefirewalls": "Firewalls",
    "microsoft.network/firewallpolicies": "Azure-Firewall-Policy",
    "microsoft.network/bastionhosts": "Bastions",
    "microsoft.network/virtualnetworkgateways": "Virtual-Network-Gateways",
    "microsoft.network/localnetworkgateways": "Local-Network-Gateways",
    "microsoft.network/connections": "Connections",
    "microsoft.network/expressroutecircuits": "ExpressRoute-Circuits",
    "microsoft.network/privateendpoints": "Private-Endpoints",
    "microsoft.network/privatelinkservices": "Private-Link-Services",
    "microsoft.network/privatednszones": "DNS-Zones",
    "microsoft.network/dnszones": "DNS-Zones",
    "microsoft.network/dnsresolvers": "DNS-Private-Resolver",
    "microsoft.network/natgateways": "NAT",
    "microsoft.network/frontdoors": "Front-Door-and-CDN-Profiles",
    "microsoft.network/trafficmanagerprofiles": "Traffic-Manager-Profiles",
    "microsoft.network/networkwatchers": "Network-Watcher",
    "microsoft.network/ddosprotectionplans": "DDoS-Protection-Plans",
    "microsoft.network/applicationsecuritygroups": "Application-Security-Groups",
    "microsoft.network/virtualwans": "Virtual-WANs",
    "microsoft.network/virtualhubs": "Virtual-WAN-Hub",
    "microsoft.network/ipgroups": "IP-Groups",
    "microsoft.network/networkmanagers": "Network-Managers",
    "microsoft.network/frontdoorwebapplicationfirewallpolicies": "Web-Application-Firewall-Policies(WAF)",
    "microsoft.network/applicationgatewaywebapplicationfirewallpolicies": "Web-Application-Firewall-Policies(WAF)",
    "microsoft.cdn/profiles": "Front-Door-and-CDN-Profiles",
    # data
    "microsoft.sql/servers": "SQL-Server",
    "microsoft.sql/servers/databases": "SQL-Database",
    "microsoft.sql/managedinstances": "SQL-Managed-Instance",
    "microsoft.sql/servers/elasticpools": "SQL-Elastic-Pools",
    "microsoft.dbforpostgresql/flexibleservers": "Azure-Database-PostgreSQL-Server",
    "microsoft.dbformysql/flexibleservers": "Azure-Database-MySQL-Server",
    "microsoft.documentdb/databaseaccounts": "Azure-Cosmos-DB",
    "microsoft.cache/redis": "Cache-Redis",
    "microsoft.cache/redisenterprise": "Azure-Managed-Redis",
    "microsoft.storage/storageaccounts": "Storage-Accounts",
    "microsoft.kusto/clusters": "Azure-Data-Explorer-Clusters",
    "microsoft.synapse/workspaces": "Azure-Synapse-Analytics",
    "microsoft.databricks/workspaces": "Azure-Databricks",
    "microsoft.datafactory/factories": "Data-Factories",
    # security + identity
    "microsoft.keyvault/vaults": "Key-Vaults",
    "microsoft.keyvault/managedhsms": "Dedicated-HSM",
    "microsoft.managedidentity/userassignedidentities": "Managed-Identities",
    # monitoring + management
    "microsoft.operationalinsights/workspaces": "Log-Analytics-Workspaces",
    "microsoft.insights/components": "Application-Insights",
    "microsoft.insights/datacollectionrules": "Data-Collection-Rules",
    "microsoft.insights/actiongroups": "Alerts",
    "microsoft.insights/metricalerts": "Alerts",
    "microsoft.insights/autoscalesettings": "Auto-Scale",
    "microsoft.insights/workbooks": "Azure-Workbooks",
    "microsoft.automation/automationaccounts": "Automation-Accounts",
    "microsoft.recoveryservices/vaults": "Recovery-Services-Vaults",
    "microsoft.dataprotection/backupvaults": "Backup-Vault",
    "microsoft.maintenance/maintenanceconfigurations": "Maintenance-Configuration",
    "microsoft.operationsmanagement/solutions": "Solutions",
    # integration + ai
    "microsoft.servicebus/namespaces": "Azure-Service-Bus",
    "microsoft.eventhub/namespaces": "Event-Hubs",
    "microsoft.eventgrid/topics": "Event-Grid-Topics",
    "microsoft.eventgrid/systemtopics": "System-Topic",
    "microsoft.eventgrid/domains": "Event-Grid-Domains",
    "microsoft.logic/workflows": "Logic-Apps",
    "microsoft.cognitiveservices/accounts": "Cognitive-Services",
    "microsoft.cognitiveservices/accounts#openai": "Azure-OpenAI",
    "microsoft.search/searchservices": "Cognitive-Search",
    "microsoft.machinelearningservices/workspaces": "Azure-Machine-Learning",
    # desktop
    "microsoft.desktopvirtualization/hostpools": "Host-Pools",
    "microsoft.desktopvirtualization/applicationgroups": "Application-Group",
    "microsoft.desktopvirtualization/workspaces": "Azure-Virtual-Desktop",
    # containers of the hierarchy itself
    "microsoft.resources/subscriptions": "Subscriptions",
    "microsoft.resources/subscriptions/resourcegroups": "Resource-Groups",
    # fallback
    "_generic": "All-Resources",
    "_internet": "Globe-Success",
    "_onprem": "Server-Farm",
}

CATEGORY_PRIORITY = [
    "networking", "compute", "containers", "databases", "storage", "security", "web",
    "app services", "analytics", "integration", "identity", "management + governance",
    "monitor", "devops", "other", "general", "ai + machine learning", "iot",
]


def slugify(name: str) -> str:
    s = name.lower().replace("(", "").replace(")", "").replace("+", "plus")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def index_pack(root: Path) -> dict:
    """base name -> file, preferring categories by CATEGORY_PRIORITY."""
    found = {}
    for cat_rank, cat in enumerate(CATEGORY_PRIORITY + ["new icons", "menu", "azure ecosystem"]):
        d = root / cat
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.svg")):
            base = re.sub(r"^\d+\s*-icon-service-", "", f.stem)
            found.setdefault(base, f)
    return found


def namespace_ids(svg: str, slug: str) -> str:
    ids = set(re.findall(r'\bid="([^"]+)"', svg))
    for i in ids:
        esc = re.escape(i)
        svg = re.sub(rf'\bid="{esc}"', f'id="{slug}-{i}"', svg)
        svg = re.sub(rf'url\(#{esc}\)', f'url(#{slug}-{i})', svg)
        svg = re.sub(rf'(xlink:)?href="#{esc}"', lambda m: f'{m.group(1) or ""}href="#{slug}-{i}"', svg)
    # class names inside <style> blocks collide across icons: prefix them
    if "<style" in svg:
        classes = set(re.findall(r'\.([A-Za-z][\w-]*)\s*[{,]', svg))
        for c in classes:
            svg = re.sub(rf'\.{re.escape(c)}(?=\s*[{{,])', f'.{slug}-{c}', svg)
            svg = re.sub(rf'class="{re.escape(c)}"', f'class="{slug}-{c}"', svg)
    return svg


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    root = Path(sys.argv[1])
    if not root.is_dir():
        print(f"not a directory: {root}")
        return 2
    pack = index_pack(root)
    out_dir = Path(__file__).resolve().parent.parent / "icons"
    out_dir.mkdir(exist_ok=True)

    icons, typemap, missing = {}, {}, []
    for arm, base in TYPE_MAP.items():
        f = pack.get(base)
        if not f:
            missing.append((arm, base))
            continue
        slug = slugify(base)
        typemap[arm] = slug
        if slug in icons:
            continue
        svg = f.read_text(encoding="utf-8")
        m = re.search(r"<svg\b[^>]*>(.*)</svg>\s*$", svg, re.S)
        if not m:
            missing.append((arm, base + " (unparseable)"))
            continue
        vb = re.search(r'viewBox="([^"]+)"', svg)
        body = m.group(1)
        body = re.sub(r"<title>.*?</title>", "", body, flags=re.S)
        body = namespace_ids(body, slug)
        body = re.sub(r">\s+<", "><", body).strip()
        icons[slug] = {"vb": vb.group(1) if vb else "0 0 18 18", "body": body}

    (out_dir / "icons.json").write_text(json.dumps(icons, separators=(",", ":")), encoding="utf-8")
    (out_dir / "typemap.json").write_text(json.dumps(typemap, indent=1, sort_keys=True), encoding="utf-8")
    size_kb = (out_dir / "icons.json").stat().st_size / 1024
    print(f"icons bundled: {len(icons)} ({size_kb:.0f} KB), types mapped: {len(typemap)}")
    if missing:
        print("UNRESOLVED:")
        for arm, base in missing:
            print(f"  {arm} -> {base}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
