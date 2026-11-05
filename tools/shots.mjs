// Renders presentation crops of a built page (overview + close-ups), light or dark.
//   node tools/shots.mjs dist/inventory.html outDir [--dark]
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const file = resolve(process.argv[2]), out = process.argv[3], dark = process.argv.includes('--dark');
const tag = dark ? 'dark' : 'light';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: dark ? 'dark' : 'light' });
await p.goto('file://' + file);
await p.waitForFunction(() => window.__atlas?.state?.audit);

const data = await p.evaluate(() => {
  const s = window.__atlas.state;
  const subs = [...s.layout.rects.values()].filter((r) => r.kind === 'subscription').map((r) => ({ t: r.model.title, x: r.x, y: r.y, w: r.w, h: r.h }));
  const find = (id) => { const r = [...s.layout.rects.values()].find((x) => x.model.title === id); return r && { x: r.x, y: r.y, w: r.w, h: r.h }; };
  return { svg: window.__atlas.exportSVGString(), size: s.size, subs, app: find('vnet-spoke-app'), data: find('vnet-spoke-data'), rgdata: find('rg-app-prod-data'), rgcomp: find('rg-app-prod-compute'), hub: find('vnet-hub-cc') };
});
await p.setViewportSize({ width: Math.ceil(data.size.W), height: Math.ceil(data.size.H) });
await p.setContent(`<body style="margin:0;background:#000">${data.svg.replace(/^<\?xml[^>]*>/, '')}</body>`);
const pad = 40, clip = (r) => ({ x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: Math.min(data.size.W, r.w + 2 * pad), height: Math.min(data.size.H, r.h + 2 * pad) });
const union = (...rs) => { const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y)); return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y }; };
const hubSub = data.subs.find((s) => /Connectivity/.test(s.t)), spokeSub = data.subs.find((s) => /Landing/.test(s.t));
const shots = {
  overview: { x: 0, y: 0, w: data.size.W, h: data.size.H, scale: 1 },
  hub: { ...union(data.hub, hubSub), scale: 2 },
  'spoke-app': { ...union(data.app), scale: 2 },
  'spoke-data': { ...union(data.rgdata, data.rgcomp, data.data), scale: 2 },
};
for (const [name, r] of Object.entries(shots)) {
  const pg = await b.newPage({ viewport: { width: Math.ceil(data.size.W), height: Math.ceil(data.size.H) }, deviceScaleFactor: r.scale });
  await pg.setContent(`<body style="margin:0;background:#000">${data.svg.replace(/^<\?xml[^>]*>/, '')}</body>`);
  await pg.screenshot({ path: `${out}/${tag}-${name}.png`, clip: name === 'overview' ? { x: 0, y: 0, width: data.size.W, height: data.size.H } : clip(r) });
  await pg.close();
}
await b.close();
console.log('ok');
