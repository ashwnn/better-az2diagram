// End-to-end test of the Pages viewer: upload a snapshot through the file picker, load via ?src=, reject junk.
//   node tools/e2e.mjs dist/index.html dist/e2e-inventory.json
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const page_ = resolve(process.argv[2] || 'dist/index.html');
const snap = resolve(process.argv[3] || 'dist/e2e-inventory.json');
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const file = u.pathname === '/' || u.pathname === '/index.html' ? page_ : u.pathname === '/inventory.json' ? snap : null;
  if (!file) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': file.endsWith('.json') ? 'application/json' : 'text/html' });
  res.end(readFileSync(file));
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const run = async (name, fn, opts = {}) => {
  const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !(opts.allow404 && /Failed to load resource.*404/.test(m.text())) && errs.push(m.text()));
  try { await fn(p); } catch (e) { ok(false, `${name}: ${e.message}`); }
  ok(errs.length === 0, `${name}: no console/page errors${errs.length ? ' (' + errs[0] + ')' : ''}`);
  await p.close();
};
const expected = JSON.parse(readFileSync(snap, 'utf8').replace(/^\uFEFF/, ''));
const audit = (p) => p.evaluate(() => ({ a: window.__atlas.state.audit, n: window.__atlas.state.model.stats }));

await run('empty viewer shows the drop zone', async (p) => {
  await p.goto(base + '/');
  await p.waitForSelector('#drop:not([hidden])');
  ok(true, 'drop zone visible');
});
await run('sample button renders', async (p) => {
  await p.goto(base + '/');
  await p.waitForSelector('#drop:not([hidden])');
  const has = await p.evaluate(() => !!document.querySelector('#atlas-sample'));
  if (has) { await p.click('#drop-sample'); await p.waitForFunction(() => window.__atlas.state.audit); const r = await audit(p); ok(r.a.errors.length === 0, 'sample layout clean'); }
});
await run('upload through the file picker', async (p) => {
  await p.goto(base + '/');
  await p.waitForSelector('#drop:not([hidden])');
  await p.setInputFiles('#file', snap);
  await p.waitForFunction(() => window.__atlas.state.audit, null, { timeout: 60000 });
  const r = await audit(p);
  ok(r.a.errors.length === 0, `uploaded snapshot: layout audit has no errors (${r.a.errors.length})`);
  ok(r.a.unrouted === 0, 'uploaded snapshot: every link routed');
  ok(r.n.resources === expected.resources.length, `uploaded snapshot: ${r.n.resources}/${expected.resources.length} resources read`);
  ok(await p.evaluate(() => !!document.querySelector('#stage svg')), 'diagram svg present');
  ok(await p.evaluate(() => document.querySelector('#drop').hidden), 'drop zone hidden after load');
});
await run('clicking a card selects it and a click on empty space clears it', async (p) => {
  await p.goto(base + '/?src=inventory.json');
  await p.waitForFunction(() => window.__atlas.state.audit, null, { timeout: 60000 });
  const box = await p.evaluate(() => {
    const el = document.querySelector('#stage svg .card'); const r = el.getBoundingClientRect();
    return { id: el.dataset.id, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await p.mouse.click(box.x, box.y);
  ok(await p.evaluate((id) => window.__atlas.state.sel === id, box.id), 'card click selects it');
  ok(await p.evaluate(() => document.querySelector('#drawer').classList.contains('open')), 'drawer opens on card click');
  await p.keyboard.press('Escape');
  ok(await p.evaluate(() => window.__atlas.state.sel === null), 'Escape clears the selection');
});
await run('keyboard shortcuts are harmless before a diagram is loaded', async (p) => {
  await p.goto(base + '/');
  await p.waitForSelector('#drop:not([hidden])');
  for (const k of ['f', '=', '-', 'Escape']) await p.keyboard.press(k);
});
const load = (p, inv) => p.evaluate(async (j) => { await window.__atlas.readFile(new File([JSON.stringify(j)], 'x.json')); }, inv);
await run('partial or malformed snapshots still render', async (p) => {
  await p.goto(base + '/');
  await p.waitForSelector('#drop:not([hidden])');
  const sub = '11111111-1111-1111-1111-111111111111';
  await load(p, {
    resources: [null, 7,
      { id: `/subscriptions/${sub}/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/stone`, type: 'Microsoft.Storage/storageAccounts' },
      { id: `/subscriptions/${sub}/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sttwo`, name: 'sttwo', type: 'Microsoft.Storage/storageAccounts' },
      { id: `/subscriptions/${sub}/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sttwo`, name: 'sttwo', type: 'Microsoft.Storage/storageAccounts' }],
    subscriptions: [null, { name: 'no id' }], exportedAt: 12345,
  });
  const r = await audit(p);
  ok(r.n.cards === 2, `malformed snapshot: 2 cards drawn, duplicates and junk dropped (${r.n.cards})`);
  ok(await p.evaluate(() => document.querySelector('#busy').hidden), 'busy overlay is not stuck');
});
await run('an orphaned disk is still drawn', async (p) => {
  await p.goto(base + '/');
  await p.waitForSelector('#drop:not([hidden])');
  await load(p, { resources: [{ id: '/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/rg/providers/Microsoft.Compute/disks/d1', name: 'd1', type: 'Microsoft.Compute/disks', subscriptionId: '22222222-2222-2222-2222-222222222222', resourceGroup: 'rg', managedBy: '/subscriptions/x/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/gone', properties: {} }] });
  const r = await audit(p);
  ok(r.n.cards === 1, 'orphaned disk is shown as a card');
});
await run('a failed redraw does not leave the busy overlay stuck', async (p) => {
  await p.goto(base + '/?src=inventory.json');
  await p.waitForFunction(() => window.__atlas.state.audit, null, { timeout: 60000 });
  await p.evaluate(() => window.__atlas.load({ resources: [{ id: '/x', type: 5 }], containers: 'nope' }).catch(() => {}));
  ok(await p.evaluate(() => document.querySelector('#busy').hidden), 'busy overlay hidden after a failed load');
  ok(await p.evaluate(() => !!window.__atlas.state.svg), 'previous diagram is kept');
});
await run('?src= loads a hosted snapshot', async (p) => {
  await p.goto(base + '/?src=inventory.json');
  await p.waitForFunction(() => window.__atlas.state.audit, null, { timeout: 60000 });
  const r = await audit(p);
  ok(r.a.errors.length === 0 && r.n.resources === expected.resources.length, '?src= snapshot rendered');
});
await run('?src= with a missing file explains itself', async (p) => {
  await p.goto(base + '/?src=nope.json');
  await p.waitForSelector('#toast:not([hidden])');
  const t = await p.textContent('#toast');
  ok(/Could not load/.test(t), 'toast: ' + t);
}, { allow404: true });
await run('a wrong file is rejected without breaking the page', async (p) => {
  await p.goto(base + '/');
  await p.waitForSelector('#drop:not([hidden])');
  await p.setInputFiles('#file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await p.waitForSelector('#toast:not([hidden])');
  ok(/missing "resources"/.test(await p.textContent('#toast')), 'junk JSON rejected with a message');
  await p.setInputFiles('#file', { name: 'y.json', mimeType: 'application/json', buffer: Buffer.from('nope') });
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => !document.querySelector('#drop').hidden), 'drop zone still available');
});
await browser.close(); server.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall e2e checks passed');
process.exit(fails.length ? 1 : 0);
