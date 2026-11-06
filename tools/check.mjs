// Headless QA: opens a built page, reports console errors and the layout audit, takes screenshots.
//   node tools/check.mjs dist/inventory.html [outPrefix] [--dark]
// Exit code 1 when the audit finds a problem (so it can gate a build / CI).
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const file = resolve(process.argv[2] || 'dist/inventory.html');
const prefix = process.argv[3] || '/tmp/atlas';
const dark = process.argv.includes('--dark');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light' });
const problems = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`console ${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
await page.goto('file://' + file);
await page.waitForFunction(() => window.__atlas?.state?.audit, null, { timeout: 60000 });
await page.waitForTimeout(600);
const res = await page.evaluate(() => {
  const s = window.__atlas.state;
  return { audit: s.audit, stats: s.model.stats, size: s.size, routes: [...s.routing.routes.values()].reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {}) };
});
console.log(JSON.stringify(res, null, 1));
await page.screenshot({ path: `${prefix}-fit.png` });
// full-resolution render of the whole diagram via the SVG export
const svg = await page.evaluate(() => window.__atlas.exportSVGString());
const dims = await page.evaluate(() => window.__atlas.state.size);
await page.setViewportSize({ width: Math.min(4000, dims.W), height: Math.min(3000, dims.H) });
await page.setContent(`<body style="margin:0">${svg.replace(/^<\?xml[^>]*>/, '')}</body>`);
await page.screenshot({ path: `${prefix}-full.png`, fullPage: true });
await browser.close();
if (problems.length) console.log('PROBLEMS:\n' + problems.join('\n'));
process.exit(res.audit.errors.length || problems.length ? 1 : 0);
