// Turns a read-only Azure Resource Graph snapshot into a diagram model:
// a container tree (subscription > vnet > subnet / resource group), leaf cards and typed edges.
// Everything here is pure local computation. No network access of any kind.

const L = (s) => (s == null ? '' : String(s)).toLowerCase();
const T = (r) => L(r.type);
const last = (id) => String(id || '').split('/').pop();

export const FAMILIES = {
  network: { label: 'Network connectivity', dash: null, width: 2.25, arrow: 'both', on: true },
  privatelink: { label: 'Private link', dash: '0.1 6', width: 2.25, arrow: 'end', on: true, cap: 'round' },
  traffic: { label: 'Backend traffic', dash: null, width: 1.9, arrow: 'end', on: true },
  monitoring: { label: 'Telemetry', dash: '8 5', width: 1.6, arrow: 'end', on: true },
  dns: { label: 'Private DNS links', dash: '2 5', width: 1.4, arrow: 'none', on: false, cap: 'round' },
  identity: { label: 'Identity and access', dash: '10 4 2 4', width: 1.6, arrow: 'end', on: false },
};

const ROLE_NAMES = {
  'acdd72a7-3385-48ef-bd42-f606fba81ae7': 'Reader',
  'b24988ac-6180-42a0-ab88-20f7382dd24c': 'Contributor',
  '8e3af657-a8ff-443c-a75c-2fe8c4bcb635': 'Owner',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d': 'AcrPull',
  '4633458b-17de-408a-b874-0445c86b69e6': 'Key Vault Secrets User',
  'ba92f5b4-2d11-453d-a403-e96b0029c9fe': 'Storage Blob Data Contributor',
  '4d97b98b-1d4f-4787-a291-c67834d212e7': 'Network Contributor',
  '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1': 'Storage Blob Data Reader',
};

const TYPE_LABELS = {
  'microsoft.compute/virtualmachines': 'Virtual machine',
  'microsoft.compute/virtualmachinescalesets': 'VM scale set',
  'microsoft.compute/disks': 'Managed disk',
  'microsoft.containerservice/managedclusters': 'AKS cluster',
  'microsoft.containerregistry/registries': 'Container registry',
  'microsoft.web/sites': 'App Service',
  'microsoft.web/serverfarms': 'App Service plan',
  'microsoft.network/virtualnetworkgateways': 'VPN / ER gateway',
  'microsoft.network/localnetworkgateways': 'Local network gateway',
  'microsoft.network/azurefirewalls': 'Azure Firewall',
  'microsoft.network/bastionhosts': 'Bastion',
  'microsoft.network/applicationgateways': 'Application Gateway',
  'microsoft.network/loadbalancers': 'Load balancer',
  'microsoft.network/privateendpoints': 'Private endpoint',
  'microsoft.network/privatednszones': 'Private DNS zone',
  'microsoft.network/publicipaddresses': 'Public IP',
  'microsoft.network/networksecuritygroups': 'NSG',
  'microsoft.network/routetables': 'Route table',
  'microsoft.sql/servers': 'SQL server',
  'microsoft.sql/managedinstances': 'SQL managed instance',
  'microsoft.storage/storageaccounts': 'Storage account',
  'microsoft.keyvault/vaults': 'Key vault',
  'microsoft.documentdb/databaseaccounts': 'Cosmos DB',
  'microsoft.operationalinsights/workspaces': 'Log Analytics',
  'microsoft.insights/components': 'Application Insights',
  'microsoft.managedidentity/userassignedidentities': 'Managed identity',
  'microsoft.cdn/profiles': 'Front Door / CDN',
  'microsoft.servicebus/namespaces': 'Service Bus',
  'microsoft.eventhub/namespaces': 'Event Hubs',
  'microsoft.cache/redis': 'Redis cache',
};

// Ordering inside a subnet / group: edge and network services first, data, then compute.
const RANK = [
  /azurefirewalls|virtualnetworkgateways|bastionhosts|applicationgateways|loadbalancers|frontdoor|cdn\/profiles/,
  /virtualmachines|scalesets|managedclusters|managedenvironments|containerapps|\/sites$/,
  /sql|storage|keyvault|documentdb|cache|registries/,
  /privateendpoints/,
];
const rankOf = (t) => { const i = RANK.findIndex((re) => re.test(t)); return i < 0 ? 2 : i; };

export function prettyType(t) {
  if (TYPE_LABELS[t]) return TYPE_LABELS[t];
  const tail = t.split('/').slice(1).join(' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return tail ? tail.charAt(0).toUpperCase() + tail.slice(1) : t;
}

function deepStrings(o, out = [], depth = 0) {
  if (o == null || depth > 8) return out;
  if (typeof o === 'string') out.push(o);
  else if (Array.isArray(o)) o.forEach((x) => deepStrings(x, out, depth + 1));
  else if (typeof o === 'object') Object.values(o).forEach((x) => deepStrings(x, out, depth + 1));
  return out;
}

export function buildModel(inv, opts = {}) {
  const o = { rgMode: 'loose', identity: false, ...opts }; // rgMode: 'loose' | 'all' | 'off'
  const resources = inv.resources || [];
  const byId = new Map(resources.map((r) => [L(r.id), r]));

  // ------------------------------------------------------------------ subscriptions + resource groups
  const subs = new Map();
  const addSub = (id, name) => { id = L(id); if (id && !subs.has(id)) subs.set(id, { id, name: name || id.slice(0, 8) }); else if (name && subs.get(id)) subs.get(id).name = name; };
  (inv.subscriptions || []).forEach((s) => addSub(s.id, s.name));
  (inv.containers || []).filter((c) => T(c) === 'microsoft.resources/subscriptions').forEach((c) => addSub(c.subscriptionId || last(c.id), c.name));
  resources.forEach((r) => addSub(r.subscriptionId));

  // ------------------------------------------------------------------ vnets + subnets
  const vnetRes = resources.filter((r) => T(r) === 'microsoft.network/virtualnetworks');
  const subnets = new Map();
  for (const v of vnetRes) {
    for (const s of v.properties?.subnets || []) {
      const p = s.properties || {};
      subnets.set(L(s.id), {
        id: L(s.id), name: s.name, vnetId: L(v.id),
        prefix: p.addressPrefix || (p.addressPrefixes || []).join(', '),
        nsgId: L(p.networkSecurityGroup?.id), rtId: L(p.routeTable?.id),
        delegations: (p.delegations || []).map((d) => last(d.properties?.serviceName || '')).filter(Boolean),
      });
    }
  }

  const nics = new Map(resources.filter((r) => T(r) === 'microsoft.network/networkinterfaces').map((r) => [L(r.id), r]));

  const subnetOf = (r) => {
    const t = T(r), p = r.properties || {};
    let s = null;
    switch (t) {
      case 'microsoft.compute/virtualmachines':
        for (const n of p.networkProfile?.networkInterfaces || []) {
          s = nics.get(L(n.id))?.properties?.ipConfigurations?.[0]?.properties?.subnet?.id;
          if (s) break;
        }
        break;
      case 'microsoft.compute/virtualmachinescalesets':
        for (const c of p.virtualMachineProfile?.networkProfile?.networkInterfaceConfigurations || [])
          for (const ipc of c.properties?.ipConfigurations || []) { s = ipc.properties?.subnet?.id; if (s) break; }
        break;
      case 'microsoft.network/privateendpoints': s = p.subnet?.id; break;
      case 'microsoft.network/azurefirewalls':
      case 'microsoft.network/bastionhosts':
      case 'microsoft.network/virtualnetworkgateways':
        s = p.ipConfigurations?.[0]?.properties?.subnet?.id; break;
      case 'microsoft.network/applicationgateways': s = p.gatewayIPConfigurations?.[0]?.properties?.subnet?.id; break;
      case 'microsoft.network/loadbalancers': s = (p.frontendIPConfigurations || []).map((f) => f.properties?.subnet?.id).find(Boolean); break;
      case 'microsoft.containerservice/managedclusters': s = p.agentPoolProfiles?.[0]?.vnetSubnetID; break;
      case 'microsoft.sql/managedinstances': s = p.subnetId; break;
      case 'microsoft.web/sites': s = p.virtualNetworkSubnetId; break;
      case 'microsoft.app/managedenvironments': s = p.vnetConfiguration?.infrastructureSubnetId; break;
      default: s = p.subnet?.id;
    }
    s = L(s);
    return subnets.has(s) ? s : null;
  };

  // ------------------------------------------------------------------ what is a card, what is folded in
  const absorbedInto = new Map(); // resource id -> owner entity id (null = folded with no single owner)
  const hiddenEdgeOnly = new Set();
  const used = { nsg: new Set(), rt: new Set(), policy: new Set(), pip: new Map(), plan: new Map(), sqlDbs: new Map(), disks: new Map(), nicOwner: new Map() };

  subnets.forEach((s) => { if (s.nsgId) used.nsg.add(s.nsgId); if (s.rtId) used.rt.add(s.rtId); });
  nics.forEach((n, id) => {
    const nsg = L(n.properties?.networkSecurityGroup?.id); if (nsg) used.nsg.add(nsg);
    const vm = L(n.properties?.virtualMachine?.id); if (vm) used.nicOwner.set(id, vm);
  });

  for (const r of resources) {
    const t = T(r), id = L(r.id), p = r.properties || {};
    if (t === 'microsoft.network/privatednszones/virtualnetworklinks' || t === 'microsoft.network/connections') hiddenEdgeOnly.add(id);
    if (t === 'microsoft.network/networkinterfaces') absorbedInto.set(id, used.nicOwner.get(id) || null);
    if (t === 'microsoft.compute/disks' && (r.managedBy || p.managedBy)) {
      const vm = L(r.managedBy || p.managedBy); absorbedInto.set(id, vm);
      used.disks.set(vm, (used.disks.get(vm) || 0) + (Number(p.diskSizeGB) || 0));
    }
    if (t === 'microsoft.sql/servers/databases') {
      const srv = L(r.id.split(/\/databases\//i)[0]); absorbedInto.set(id, srv);
      (used.sqlDbs.get(srv) || used.sqlDbs.set(srv, []).get(srv)).push(r.name);
    }
    if (t === 'microsoft.web/sites' && p.serverFarmId) used.plan.set(L(p.serverFarmId), (used.plan.get(L(p.serverFarmId)) || 0) + 1);
    const pol = p.firewallPolicy?.id; if (pol) used.policy.add(L(pol));
  }
  // public IPs: attach to whichever resource references them
  for (const r of resources) {
    const t = T(r);
    if (t === 'microsoft.network/publicipaddresses') continue;
    const owner = t === 'microsoft.network/networkinterfaces' ? used.nicOwner.get(L(r.id)) : L(r.id);
    if (!owner) continue;
    for (const s of deepStrings(r.properties)) {
      if (/\/publicipaddresses\//i.test(s)) { const key = L(s); if (byId.has(key)) used.pip.set(key, owner); }
    }
  }
  for (const [pipId, owner] of used.pip) absorbedInto.set(pipId, owner);
  used.nsg.forEach((id) => { if (byId.has(id)) absorbedInto.set(id, null); });
  used.rt.forEach((id) => { if (byId.has(id)) absorbedInto.set(id, null); });
  used.policy.forEach((id) => { if (byId.has(id)) absorbedInto.set(id, null); });
  used.plan.forEach((_, id) => { if (byId.has(id)) absorbedInto.set(id, null); });
  // a resource folded into an owner that is not in the export (for example a disk of a VM in another scope) stays a card of its own
  for (const [rid, owner] of [...absorbedInto]) if (owner && !byId.has(owner)) absorbedInto.delete(rid);

  const isHiddenType = (r) => {
    const t = T(r);
    if (t === 'microsoft.network/virtualnetworks') return true; // becomes a container
    if (!o.identity && t === 'microsoft.managedidentity/userassignedidentities') return true;
    return false;
  };

  // ------------------------------------------------------------------ containers
  const containers = new Map();
  const mk = (id, kind, title, extra = {}) => { const c = { id, kind, title, children: [], chips: [], ...extra }; containers.set(id, c); return c; };
  const subC = new Map();
  [...subs.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach((s) => {
    subC.set(s.id, mk('sub:' + s.id, 'subscription', s.name, { subtitle: s.id.slice(0, 8), icon: 'microsoft.resources/subscriptions' }));
  });
  const rgC = new Map();
  const rgContainer = (sub, rg) => {
    const key = `rg:${sub}|${L(rg)}`;
    if (rgC.has(key)) return rgC.get(key);
    const c = mk(key, 'rg', rg, { icon: 'microsoft.resources/subscriptions/resourcegroups' });
    rgC.set(key, c);
    return c;
  };
  const attach = (parent, child) => { child.parent = parent.id; parent.children.push(child); };
  const slotFor = (sub, rg) => (o.rgMode === 'all' ? rgContainer(sub, rg) : subC.get(sub));

  const vnetC = new Map();
  for (const v of vnetRes) {
    const sub = L(v.subscriptionId);
    const c = mk(L(v.id), 'vnet', v.name, {
      icon: 'microsoft.network/virtualnetworks', res: v,
      subtitle: `${v.resourceGroup} · ${v.location}`,
      chips: (v.properties?.addressSpace?.addressPrefixes || []).map((p) => ({ text: p, tone: 'blue' })),
    });
    vnetC.set(c.id, c);
  }
  const snetC = new Map();
  const dnsLinks = new Map();
  for (const r of resources) if (T(r) === 'microsoft.network/privatednszones/virtualnetworklinks') {
    const v = L(r.properties?.virtualNetwork?.id); dnsLinks.set(v, (dnsLinks.get(v) || 0) + 1);
  }
  vnetC.forEach((c) => { if (dnsLinks.get(c.id)) c.chips.push({ text: `${dnsLinks.get(c.id)} DNS zone${dnsLinks.get(c.id) > 1 ? 's' : ''}`, tone: 'slate', icon: 'microsoft.network/privatednszones' }); });
  [...subnets.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach((s) => {
    const nsg = byId.get(s.nsgId), rt = byId.get(s.rtId);
    const chips = [];
    if (s.delegations.length) chips.push({ text: s.delegations[0], tone: 'slate' });
    if (nsg) chips.push({ text: nsg.name, tone: 'amber', icon: 'microsoft.network/networksecuritygroups', ref: L(nsg.id) });
    if (rt) chips.push({ text: rt.name, tone: 'violet', icon: 'microsoft.network/routetables', ref: L(rt.id) });
    const c = mk(s.id, 'subnet', s.name, { icon: 'microsoft.network/virtualnetworks/subnets', subtitle: s.prefix, chips, subnet: s });
    snetC.set(s.id, c);
    const parent = vnetC.get(s.vnetId);
    if (parent) attach(parent, c);
  });

  // ------------------------------------------------------------------ cards
  const nodes = new Map();
  const describe = (r) => {
    const t = T(r), p = r.properties || {}, sku = r.sku || {};
    const plan = byId.get(L(p.serverFarmId));
    const kv = [];
    switch (t) {
      case 'microsoft.compute/virtualmachines': {
        const nic = nics.get(L(p.networkProfile?.networkInterfaces?.[0]?.id));
        const ip = nic?.properties?.ipConfigurations?.[0]?.properties?.privateIPAddress;
        return [p.hardwareProfile?.vmSize, ip].filter(Boolean).join(' · ') || 'Virtual machine';
      }
      case 'microsoft.compute/virtualmachinescalesets': return `${sku.name || 'VMSS'}${sku.capacity != null ? ' × ' + sku.capacity : ''}`;
      case 'microsoft.containerservice/managedclusters': {
        const n = (p.agentPoolProfiles || []).reduce((a, x) => a + (x.count || 0), 0);
        return `Kubernetes ${p.kubernetesVersion || ''}${n ? ' · ' + n + ' nodes' : ''}`.trim();
      }
      case 'microsoft.web/sites': {
        const kind = L(r.kind).includes('functionapp') ? 'Function app' : 'Web app';
        return [kind, plan?.sku?.name].filter(Boolean).join(' · ');
      }
      case 'microsoft.sql/servers': { const d = used.sqlDbs.get(L(r.id)) || []; return d.length ? `${d.length} database${d.length > 1 ? 's' : ''}` : 'SQL server'; }
      case 'microsoft.sql/managedinstances': return `Managed instance${p.vCores ? ' · ' + p.vCores + ' vCores' : ''}`;
      case 'microsoft.storage/storageaccounts': return [sku.name, r.kind].filter(Boolean).join(' · ');
      case 'microsoft.keyvault/vaults': return `Key vault${sku.name ? ' · ' + sku.name : ''}`;
      case 'microsoft.network/privateendpoints': {
        const c = p.privateLinkServiceConnections?.[0] || p.manualPrivateLinkServiceConnections?.[0];
        const target = byId.get(L(c?.properties?.privateLinkServiceId));
        return `${c?.properties?.groupIds?.[0] || 'Private link'} → ${target ? target.name : 'external'}`;
      }
      case 'microsoft.network/azurefirewalls': return `Firewall · ${sku.tier || p.sku?.tier || ''}`.trim();
      case 'microsoft.network/bastionhosts': return `Bastion · ${sku.name || ''}`.trim();
      case 'microsoft.network/virtualnetworkgateways': return [p.gatewayType, p.sku?.name].filter(Boolean).join(' · ');
      case 'microsoft.network/localnetworkgateways': return (p.localNetworkAddressSpace?.addressPrefixes || []).join(', ') || 'On-premises';
      case 'microsoft.network/applicationgateways': return `App Gateway · ${sku.name || ''}`.trim();
      case 'microsoft.network/loadbalancers': {
        const internal = (p.frontendIPConfigurations || []).some((f) => f.properties?.subnet);
        return `${internal ? 'Internal' : 'Public'} load balancer`;
      }
      case 'microsoft.network/privatednszones': return `${p.numberOfRecordSets ?? 0} record sets`;
      case 'microsoft.operationalinsights/workspaces': return `Log Analytics · ${p.retentionInDays || ''}d`;
      case 'microsoft.containerregistry/registries': return `Registry · ${sku.name || ''}`.trim();
      case 'microsoft.documentdb/databaseaccounts': return 'Cosmos DB';
      case 'microsoft.cdn/profiles': return sku.name ? sku.name.replace(/_/g, ' ') : 'Front Door';
      default: return prettyType(t) + (sku.name ? ` · ${sku.name}` : '');
    }
  };

  const badgesFor = (r) => {
    const b = [], t = T(r), p = r.properties || {}, id = L(r.id);
    const pips = [...used.pip].filter(([, owner]) => owner === id).map(([pip]) => byId.get(pip)).filter(Boolean);
    if (pips.length) b.push({ kind: 'public', text: pips.map((x) => x.properties?.ipAddress || x.name).join(', '), tip: 'Public IP' });
    if (L(p.publicNetworkAccess) === 'disabled') b.push({ kind: 'private', tip: 'Public network access disabled' });
    if (p.firewallPolicy?.id) b.push({ kind: 'policy', tip: 'Policy: ' + last(p.firewallPolicy.id) });
    if (t === 'microsoft.compute/disks' && !r.managedBy) b.push({ kind: 'warn', tip: 'Unattached disk' });
    return b;
  };

  for (const r of resources) {
    const id = L(r.id);
    if (isHiddenType(r) || hiddenEdgeOnly.has(id) || absorbedInto.has(id)) continue;
    const t = T(r);
    nodes.set(id, {
      id, kind: 'node', res: r, type: t, title: r.name, subtitle: describe(r),
      icon: t === 'microsoft.web/sites' && L(r.kind).includes('functionapp') ? 'microsoft.web/sites#functionapp'
        : t === 'microsoft.cognitiveservices/accounts' && L(r.kind).includes('openai') ? 'microsoft.cognitiveservices/accounts#openai' : t,
      badges: badgesFor(r), rank: rankOf(t),
    });
  }

  // ------------------------------------------------------------------ hierarchy
  vnetC.forEach((c) => attach(slotFor(L(c.res.subscriptionId), c.res.resourceGroup), c));
  const sortKids = (arr) => arr.sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9) || a.title.localeCompare(b.title));
  nodes.forEach((n) => {
    const sn = subnetOf(n.res);
    const parent = sn ? snetC.get(sn) : (o.rgMode === 'off' ? subC.get(L(n.res.subscriptionId)) : rgContainer(L(n.res.subscriptionId), n.res.resourceGroup));
    n.subnetId = sn || null;
    attach(parent || subC.get(L(n.res.subscriptionId)), n);
  });
  rgC.forEach((c) => { if (!c.parent) attach(subC.get(c.id.slice(3).split('|')[0]), c); });
  const roots = [...subC.values()].filter((c) => c.children.length);
  containers.forEach((c) => {
    if (c.kind === 'subnet') sortKids(c.children);
    else if (c.kind === 'rg') sortKids(c.children);
  });
  roots.forEach((r) => r.children.sort((a, b) => {
    const k = (x) => (x.kind === 'vnet' ? 0 : 1);
    return k(a) - k(b) || a.title.localeCompare(b.title);
  }));

  // ------------------------------------------------------------------ edges
  const entityOf = (rawId) => {
    let id = L(rawId);
    if (!id) return null;
    id = id.replace(/\/(subnets|backendaddresspools|frontendipconfigurations)\/.*/i, (m) => (m.startsWith('/subnets') ? m : ''));
    if (snetC.has(id) || vnetC.has(id) || nodes.has(id)) return id;
    if (absorbedInto.has(id)) { const owner = absorbedInto.get(id); return owner ? entityOf(owner) : null; }
    return null;
  };
  const edges = [], seen = new Set();
  const addEdge = (a, b, family, kind, extra = {}) => {
    if (!a || !b || a === b) return;
    const sym = FAMILIES[family].arrow === 'both' || FAMILIES[family].arrow === 'none';
    const key = sym ? [family, kind, ...[a, b].sort()].join('|') : [family, kind, extra.label || '', a, b].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ id: 'e' + edges.length, a, b, family, kind, ...extra });
  };

  for (const r of resources) {
    const t = T(r), p = r.properties || {}, id = L(r.id);
    if (t === 'microsoft.network/virtualnetworks') {
      for (const pe of p.virtualNetworkPeerings || []) {
        const remote = L(pe.properties?.remoteVirtualNetwork?.id);
        addEdge(id, vnetC.has(remote) ? remote : null, 'network', 'peering', {
          label: 'Peering', state: pe.properties?.peeringState && pe.properties.peeringState !== 'Connected' ? 'warn' : 'ok',
        });
      }
    }
    if (t === 'microsoft.network/privateendpoints') {
      for (const c of [...(p.privateLinkServiceConnections || []), ...(p.manualPrivateLinkServiceConnections || [])])
        addEdge(id, entityOf(c.properties?.privateLinkServiceId), 'privatelink', 'privatelink', { group: c.properties?.groupIds?.[0] });
    }
    if (t === 'microsoft.network/connections') {
      const gw = entityOf(p.virtualNetworkGateway1?.id), peer = entityOf(p.localNetworkGateway2?.id || p.virtualNetworkGateway2?.id || p.peer?.id);
      addEdge(gw, peer, 'network', 'vpn', {
        label: p.connectionType === 'ExpressRoute' ? 'ExpressRoute' : p.connectionType === 'Vnet2Vnet' ? 'VNet-to-VNet' : 'Site-to-site VPN',
        state: p.connectionStatus && p.connectionStatus !== 'Connected' ? 'warn' : 'ok',
      });
    }
    if (t === 'microsoft.network/privatednszones/virtualnetworklinks') {
      addEdge(entityOf(r.id.split(/\/virtualnetworklinks\//i)[0]), vnetC.has(L(p.virtualNetwork?.id)) ? L(p.virtualNetwork.id) : null, 'dns', 'dnslink');
    }
    if (t === 'microsoft.insights/components' && (p.WorkspaceResourceId || p.workspaceResourceId)) {
      addEdge(entityOf(r.id), entityOf(p.WorkspaceResourceId || p.workspaceResourceId), 'monitoring', 'telemetry');
    }
    // load balancer / application gateway backend pools
    const cfgs = [];
    if (t === 'microsoft.compute/virtualmachinescalesets')
      for (const c of p.virtualMachineProfile?.networkProfile?.networkInterfaceConfigurations || []) cfgs.push(...(c.properties?.ipConfigurations || []));
    if (t === 'microsoft.network/networkinterfaces') cfgs.push(...(p.ipConfigurations || []));
    for (const c of cfgs) {
      const target = t === 'microsoft.network/networkinterfaces' ? entityOf(p.virtualMachine?.id) : id;
      for (const pool of [...(c.properties?.loadBalancerBackendAddressPools || []), ...(c.properties?.applicationGatewayBackendAddressPools || [])])
        addEdge(entityOf(String(pool.id).split(/\/backendaddresspools\//i)[0]), target, 'traffic', 'backend');
    }
    // user-assigned identities
    for (const uai of Object.keys(r.identity?.userAssignedIdentities || {}))
      addEdge(entityOf(uai), entityOf(r.id), 'identity', 'identity');
  }
  // role assignments for service principals (identity layer)
  const principals = new Map();
  for (const r of resources) {
    const pid = L(r.identity?.principalId || (T(r) === 'microsoft.managedidentity/userassignedidentities' ? r.properties?.principalId : ''));
    if (pid) principals.set(pid, r.id);
  }
  for (const ra of inv.roleAssignments || []) {
    const p = ra.properties || {};
    const owner = principals.get(L(p.principalId));
    const scope = L(p.scope);
    if (!owner || !byId.has(scope)) continue;
    const role = ROLE_NAMES[L(last(p.roleDefinitionId))] || 'role ' + last(p.roleDefinitionId).slice(0, 8);
    addEdge(entityOf(owner), entityOf(scope), 'identity', 'role', { label: role });
  }

  const stats = {
    resources: resources.length, cards: nodes.size, folded: absorbedInto.size, edges: edges.length,
    subscriptions: roots.length, vnets: vnetC.size,
  };
  return { roots, containers, nodes, edges, subnets, stats, byId, used, absorbedInto, meta: { exportedAt: inv.exportedAt, tool: inv.tool } };
}
