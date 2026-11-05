# Another Azure Infrastructure to Diagram

Turn a read-only snapshot of your Azure estate into a clean, icon-rich architecture diagram. Everything after the export runs **in your browser**: no server, no Azure calls, nothing uploaded.

**Live viewer:** https://ashwnn.github.io/better-az2diagram/ (drop your `inventory.json` on it, or press "Try the sample")

![Overview, light](docs/img/overview-light.png)

<details>
<summary>Dark theme</summary>

![Overview, dark](docs/img/overview-dark.png)

</details>

## How it works

```
 PowerShell module            GitHub Pages viewer (static HTML)
 Export-AzureInfraSnapshot -> inventory.json -> drop it on the page -> diagram, computed client-side
 (read-only, ~3 queries)      (one file)         (layout, routing, drawing, audit)
```

1. **Export** with the separate PowerShell module in [`powershell/AzureInfraDiagram`](powershell/AzureInfraDiagram). It runs a handful of paged Azure Resource Graph queries and writes one JSON file.
2. **Open** the viewer (the GitHub Pages site, or `dist/index.html` built locally) and drop the file on it. You can also host the file next to the page and open `?src=inventory.json`.
3. **Explore**: pan and zoom, hover to highlight connections, click for details, search, toggle line families, export SVG or PNG.

## Quick start

```powershell
# 1. Export (Reader access is enough). Needs Az.ResourceGraph or the Azure CLI with the resource-graph extension.
Import-Module ./powershell/AzureInfraDiagram
Connect-AzAccount
Export-AzureInfraSnapshot -Path ./inventory.json
```

2. Open https://ashwnn.github.io/better-az2diagram/ and drop `inventory.json` onto it.

The snapshot holds resource names, IDs and IP addresses. Keep it private. `inventory.json` is git-ignored so it is not committed by accident. Because the viewer is purely client-side, opening your file on the public site never sends it anywhere. To be certain, build the viewer yourself and open it offline (see Development).

## What you get

| | |
|---|---|
| ![Hub](docs/img/hub.png) | ![App spoke](docs/img/spoke-app.png) |
| Hub network with gateway, firewall, bastion and the VPN to on-premises | Spoke with subnets as tidy grids, NSG and route table chips, public IPs, private endpoints |
| ![Data spoke](docs/img/spoke-data.png) | ![App spoke, dark](docs/img/spoke-app-dark.png) |
| Resource groups, SQL Managed Instance and linked services | Same diagram in the dark theme |

- Nested containers: subscription, virtual network, subnet, resource group.
- Official Azure Architecture Icons, 101 of them, drawn unmodified.
- Typed lines with different styles: peering, VPN and ExpressRoute, private link, load balancer and Application Gateway backends, monitoring, plus optional DNS links and managed identity role assignments.
- Noise is folded away: NICs, disks, SQL databases, NSGs and route tables become badges or chips instead of cards.

### Lines never cross objects, text is never cut off

These were the two things existing tools got wrong, so they are enforced rather than hoped for:

- Text is measured with the real font and wrapped. Cards and headers are sized from the measured text. Text is never truncated.
- Lines are routed around every card, header and label with an obstacle-aware orthogonal router. An edge that cannot be drawn cleanly becomes a small marker tag, never a bad line.
- An independent audit re-checks the final geometry (lines vs cards, headers and labels, containment, overlaps, text fit) and shows a "Layout check" pill. `npm run qa` exits non-zero on any error, so CI gates on it.

## Read-only by design

The exporter only calls `Get-AzSubscription` and `Search-AzGraph` (or `az account list|show` and `az graph query` for the CLI backend, where every other `az` command is refused by an allowlist). Subscription IDs are validated as GUIDs. Sign in with a Reader-only identity and Azure itself will refuse any write. See the [module README](powershell/AzureInfraDiagram/README.md).

## Development

```bash
npm ci
npm run build                 # dist/index.html: the viewer (what GitHub Pages serves)
npm run build:sample          # dist/inventory.html: sample baked in
npm run qa                    # headless layout audit + screenshots (needs: npx playwright install chromium)
pwsh ./powershell/tests/e2e-export.ps1 -Out dist/e2e-inventory.json
npm run e2e                   # upload / ?src= / bad-file tests in a real browser
pwsh -c "Invoke-Pester ./powershell/tests"
```

`tools/make_sample.py` regenerates the fictional demo inventory. `tools/build_icons.py` rebuilds the icon bundle from Microsoft's icon zip.

### Publishing your own copy
Fork the repo, then in **Settings > Pages** set the source to **GitHub Actions**. Every push to `main` builds and deploys the viewer. Committing a snapshot to a private fork and opening `?src=` works too, but remember Pages sites are public even for private repos on most plans.

## Limitations

- Layout is automatic. Very large estates (thousands of resources) render but take longer, and you will want to filter by subscription at export time.
- Some resource types fall back to a generic icon. Add a mapping in `tools/build_icons.py`.
- Edges are inferred from resource properties (peerings, private endpoints, backend pools and so on), so connections that only exist in application code or NSG rules are not drawn.

## Licence

MIT, see [LICENSE](LICENSE). Third-party components, including Microsoft's Azure Architecture Icons (their own terms) and elkjs (EPL-2.0), are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
