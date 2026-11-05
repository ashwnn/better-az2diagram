import { buildModel, FAMILIES, prettyType } from './model.js';
import { computeLayout } from './layout.js';
import { routeAll } from './router.js';
import { renderDiagram, labelMetrics, SVG_CSS, iconSlug } from './render.js';
import { auditGeometry, auditText } from './audit.js';
import ICONS from '../icons/icons.json';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safe = (fn, d) => { try { return fn(); } catch { return d; } };

const state = {
  inv: null, opts: { rgMode: 'loose', identity: false }, fams: Object.fromEntries(Object.entries(FAMILIES).map(([k, v]) => [k, v.on])),
  model: null, layout: null, routing: null, svg: null, viewport: null, view: { k: 1, x: 0, y: 0 }, sel: null, audit: null, incident: new Map(),
};

// ------------------------------------------------------------------ theme
document.head.append(Object.assign(document.createElement('style'), { textContent: SVG_CSS }));
const root = document.documentElement;
function setTheme(t) { root.dataset.theme = t; safe(() => localStorage.setItem('atlas-theme', t)); }
setTheme(safe(() => localStorage.getItem('atlas-theme'), null) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

// ------------------------------------------------------------------ loading
async function load(inv, { keepView = false } = {}) {
  state.inv = inv;
  const t0 = performance.now();
  $('#busy').hidden = false;
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const model = buildModel(inv, state.opts);
  if (!model.roots.length) { $('#busy').hidden = true; toast('No resources found in this file.'); return; }
  const layout = await computeLayout(model);
  const routing = routeAll(model, layout, labelMetrics);
  const { svg, viewport, size } = renderDiagram(model, layout, routing);
  Object.assign(state, { model, layout, routing, svg, viewport, size });
  state.incident = new Map();
  model.edges.forEach((e) => { [e.a, e.b].forEach((id) => (state.incident.get(id) || state.incident.set(id, []).get(id)).push(e)); });

  svg.removeAttribute('viewBox'); svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
  const stage = $('#stage'); stage.replaceChildren(svg);
  applyFamilies();
  bindDiagram();
  const geo = auditGeometry(model, layout, routing);
  const txt = auditText(svg);
  state.audit = { errors: [...geo.errors, ...txt], warnings: geo.warnings, unrouted: geo.unrouted, ms: Math.round(performance.now() - t0) };
  if (!keepView) fit(false);
  else applyView();
  updateChrome();
  $('#busy').hidden = true;
  $('#drop').hidden = true;
  state.sel = null; closeDrawer();
}

// ------------------------------------------------------------------ view (pan / zoom)
function applyView() { const v = state.view; state.viewport.setAttribute('transform', `translate(${v.x} ${v.y}) scale(${v.k})`); }
function fit(animate = true) {
  const st = $('#stage').getBoundingClientRect(), { W, H } = state.size, m = 56;
  const k = Math.min((st.width - m * 2) / W, (st.height - m * 2 - 40) / H, 1.15);
  state.view = { k, x: (st.width - W * k) / 2, y: (st.height - H * k) / 2 + 24 };
  if (animate) { state.viewport.style.transition = 'transform .35s ease'; setTimeout(() => (state.viewport.style.transition = ''), 400); }
  applyView();
}
function zoomAt(f, px, py) {
  const v = state.view, k = Math.min(3, Math.max(0.08, v.k * f)), r = k / v.k;
  state.view = { k, x: px - (px - v.x) * r, y: py - (py - v.y) * r };
  applyView();
}
function centerOn(id) {
  const r = state.layout.rects.get(id); if (!r) return;
  const st = $('#stage').getBoundingClientRect(), k = Math.max(state.view.k, 0.9);
  state.view = { k, x: st.width / 2 - (r.x + r.w / 2) * k, y: st.height / 2 - (r.y + r.h / 2) * k };
  state.viewport.style.transition = 'transform .4s ease'; applyView(); setTimeout(() => (state.viewport.style.transition = ''), 450);
}

const stage = $('#stage');
let drag = null;
stage.addEventListener('wheel', (e) => { e.preventDefault(); if (!state.svg) return; const b = stage.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - b.left, e.clientY - b.top); }, { passive: false });
stage.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, vx: state.view.x, vy: state.view.y, moved: false }; stage.setPointerCapture(e.pointerId); });
stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true; stage.classList.add('panning');
  state.view.x = drag.vx + dx; state.view.y = drag.vy + dy; applyView();
});
stage.addEventListener('pointerup', (e) => {
  const moved = drag?.moved; drag = null; stage.classList.remove('panning');
  if (moved) return;
  const t = e.target.closest?.('.card, .edge, .mk');
  if (t?.classList.contains('card')) select(t.dataset.id);
  else if (t?.classList.contains('edge')) select(null, t.dataset.id);
  else clearSelection();
});

// ------------------------------------------------------------------ focus / hover
function related(id, edgeId) {
  const ents = new Set(), edges = new Set();
  if (edgeId) { const e = state.model.edges.find((x) => x.id === edgeId); if (e) { edges.add(e.id); ents.add(e.a); ents.add(e.b); } }
  else if (id) { ents.add(id); (state.incident.get(id) || []).forEach((e) => { edges.add(e.id); ents.add(e.a); ents.add(e.b); }); }
  const anc = new Set();
  ents.forEach((x) => { for (let p = state.layout.rects.get(x); p; p = state.layout.rects.get(p.parent)) anc.add(p.id); });
  return { ents, edges, anc };
}
function setFocus(id, edgeId) {
  const svg = state.svg; if (!svg) return;
  svg.querySelectorAll('.rel').forEach((n) => n.classList.remove('rel'));
  if (!id && !edgeId) { svg.classList.remove('focus'); return; }
  const r = related(id, edgeId);
  svg.classList.add('focus');
  svg.querySelectorAll('.card, .ct').forEach((n) => { if (r.ents.has(n.dataset.id) || r.anc.has(n.dataset.id)) n.classList.add('rel'); });
  svg.querySelectorAll('.edge').forEach((n) => { if (r.edges.has(n.dataset.id)) n.classList.add('rel'); });
  svg.querySelectorAll('.mk').forEach((n) => { if (r.edges.has(n.dataset.e)) n.classList.add('rel'); });
}
function bindDiagram() {
  state.svg.addEventListener('pointerover', (e) => {
    if (state.sel || drag?.moved) return;
    const t = e.target.closest('.card, .edge, .mk');
    if (!t) return;
    if (t.classList.contains('card')) setFocus(t.dataset.id); else if (t.classList.contains('edge')) setFocus(null, t.dataset.id); else setFocus(null, t.dataset.e);
  });
  state.svg.addEventListener('pointerout', (e) => { if (!state.sel && !e.relatedTarget?.closest?.('.card, .edge, .mk')) setFocus(null); });
}
function select(id, edgeId) {
  state.svg.querySelectorAll('.card.sel').forEach((n) => n.classList.remove('sel'));
  state.sel = id || edgeId;
  setFocus(id, edgeId);
  if (id) { state.svg.querySelector(`.card[data-id="${CSS.escape(id)}"]`)?.classList.add('sel'); openDrawer(id); }
  else if (edgeId) openEdge(edgeId);
}
function clearSelection() { state.sel = null; state.svg?.querySelectorAll('.card.sel').forEach((n) => n.classList.remove('sel')); setFocus(null); closeDrawer(); }

// ------------------------------------------------------------------ drawer
const portalUrl = (id) => 'https://portal.azure.com/#@/resource' + id;
function nameOf(id) { return state.layout.rects.get(id)?.model?.title || id; }
function connectionsHTML(id) {
  const list = state.incident.get(id) || [];
  if (!list.length) return '';
  return `<h4>Connections</h4><ul class="conn">${list.map((e) => {
    const other = e.a === id ? e.b : e.a;
    const routed = state.routing.routes.get(e.id)?.status !== 'unrouted';
    return `<li><button data-go="${esc(other)}"><i class="sw fam-${e.family}"></i><span>${esc(FAMILIES[e.family].label)}${e.label ? ' · ' + esc(e.label) : ''}</span><b>${esc(nameOf(other))}</b>${routed ? '' : '<em>not drawn</em>'}</button></li>`;
  }).join('')}</ul>`;
}
function openDrawer(id) {
  const r = state.layout.rects.get(id), m = r.model;
  let html = '';
  if (r.kind === 'node') {
    const res = m.res;
    const sub = state.model.byId && state.inv.subscriptions?.find((s) => s.id.toLowerCase() === String(res.subscriptionId).toLowerCase())?.name;
    const kv = [['Type', prettyType(m.type)], ['Resource group', res.resourceGroup], ['Subscription', sub || res.subscriptionId], ['Location', res.location], ['SKU', res.sku?.name || res.sku?.tier], ['Kind', res.kind]];
    ['publicNetworkAccess', 'provisioningState', 'kubernetesVersion', 'defaultHostName', 'fullyQualifiedDomainName', 'vaultUri', 'loginServer', 'documentEndpoint', 'gatewayType', 'vpnType', 'connectionStatus'].forEach((k) => { const v = res.properties?.[k]; if (v != null && typeof v !== 'object') kv.push([k.replace(/([A-Z])/g, ' $1').toLowerCase(), v]); });
    const pips = m.badges.find((b) => b.kind === 'public'); if (pips) kv.push(['Public IP', pips.text]);
    const folded = [...state.model.absorbedInto].filter(([, o]) => o === id).map(([rid]) => state.model.byId.get(rid)).filter(Boolean);
    const tags = Object.entries(res.tags || {});
    html = `<div class="d-head"><svg class="d-ic"><use href="#ic-${iconSlug(m.icon)}"/></svg><div><h3>${esc(m.title)}</h3><p>${esc(m.subtitle || '')}</p></div></div>
      <dl>${kv.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${connectionsHTML(id)}
      ${folded.length ? `<h4>Included in this card</h4><ul class="plain">${folded.map((f) => `<li>${esc(f.name)} <span>${esc(prettyType(f.type.toLowerCase()))}</span></li>`).join('')}</ul>` : ''}
      ${tags.length ? `<h4>Tags</h4><div class="tags">${tags.map(([k, v]) => `<span>${esc(k)}: ${esc(v)}</span>`).join('')}</div>` : ''}
      <h4>Resource ID</h4><code class="rid">${esc(res.id)}</code>
      <div class="d-actions"><button data-copy="${esc(res.id)}">Copy ID</button><a href="${esc(portalUrl(res.id))}" target="_blank" rel="noopener noreferrer">Open in Azure portal</a></div>`;
  } else {
    const kids = m.children.length;
    html = `<div class="d-head"><svg class="d-ic"><use href="#ic-${iconSlug(m.icon)}"/></svg><div><h3>${esc(m.title)}</h3><p>${esc(m.subtitle || '')}</p></div></div>
      <dl><dt>Kind</dt><dd>${esc(m.kind)}</dd><dt>Contains</dt><dd>${kids} item${kids === 1 ? '' : 's'}</dd>${m.chips.map((c) => `<dt>${esc(c.icon ? 'Associated' : 'Range')}</dt><dd>${esc(c.text)}</dd>`).join('')}</dl>${connectionsHTML(id)}`;
  }
  $('#drawer-body').innerHTML = html;
  $('#drawer').classList.add('open');
}
function openEdge(edgeId) {
  const e = state.model.edges.find((x) => x.id === edgeId), f = FAMILIES[e.family];
  const routed = state.routing.routes.get(e.id)?.status !== 'unrouted';
  $('#drawer-body').innerHTML = `<div class="d-head"><i class="sw big fam-${e.family}"></i><div><h3>${esc(f.label)}</h3><p>${esc(e.label || e.kind)}</p></div></div>
    <dl><dt>From</dt><dd><button class="lnk" data-go="${esc(e.a)}">${esc(nameOf(e.a))}</button></dd><dt>To</dt><dd><button class="lnk" data-go="${esc(e.b)}">${esc(nameOf(e.b))}</button></dd>
    ${e.state === 'warn' ? '<dt>State</dt><dd>Not healthy</dd>' : ''}${routed ? '' : '<dt>Drawing</dt><dd>No clean path was available, so no line is drawn.</dd>'}</dl>`;
  $('#drawer').classList.add('open');
}
function closeDrawer() { $('#drawer').classList.remove('open'); }
$('#drawer').addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]'); if (go) { const id = go.dataset.go; centerOn(id); if (state.layout.rects.get(id)?.kind === 'node') select(id); return; }
  const cp = e.target.closest('[data-copy]'); if (cp) { safe(() => navigator.clipboard.writeText(cp.dataset.copy)); cp.textContent = 'Copied'; setTimeout(() => (cp.textContent = 'Copy ID'), 1200); }
  if (e.target.closest('#drawer-close')) clearSelection();
});

// ------------------------------------------------------------------ legend + options
function buildLegend() {
  const counts = {}; state.model.edges.forEach((e) => (counts[e.family] = (counts[e.family] || 0) + 1));
  $('#fams').innerHTML = Object.entries(FAMILIES).map(([k, f]) => {
    const c = counts[k] || 0;
    return `<label class="fam ${c ? '' : 'none'}"><input type="checkbox" data-fam="${k}" ${state.fams[k] ? 'checked' : ''} ${c ? '' : 'disabled'}>
      <svg width="34" height="10" class="sample fam-${k}"><line x1="2" y1="5" x2="32" y2="5" stroke-width="${f.width}" ${f.dash ? `stroke-dasharray="${f.dash}"` : ''} stroke-linecap="${f.cap || 'butt'}"/></svg>
      <span>${esc(f.label)}</span><b>${c}</b></label>`;
  }).join('');
}
function applyFamilies() { Object.entries(state.fams).forEach(([k, on]) => state.svg.classList.toggle('hide-fam-' + k, !on)); buildLegend(); }
$('#fams').addEventListener('change', (e) => { const k = e.target.dataset.fam; if (k) { state.fams[k] = e.target.checked; state.svg.classList.toggle('hide-fam-' + k, !e.target.checked); } });
$('#opt-rg').addEventListener('change', (e) => { state.opts.rgMode = e.target.value; load(state.inv); });
$('#opt-id').addEventListener('change', (e) => { state.opts.identity = e.target.checked; if (e.target.checked) { state.fams.identity = true; } load(state.inv); });

// ------------------------------------------------------------------ search
$('#q').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase(), svg = state.svg; if (!svg) return;
  svg.classList.toggle('searching', !!q);
  svg.querySelectorAll('.card').forEach((n) => {
    const m = state.model.nodes.get(n.dataset.id);
    const hay = [m.title, m.subtitle, m.type, m.res.resourceGroup, m.res.location, ...Object.entries(m.res.tags || {}).flat(), ...m.badges.map((b) => b.text || '')].join(' ').toLowerCase();
    n.classList.toggle('match', !!q && hay.includes(q));
  });
});
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const m = state.svg?.querySelector('.card.match'); if (m) centerOn(m.dataset.id); } if (e.key === 'Escape') { e.target.value = ''; e.target.dispatchEvent(new Event('input')); e.target.blur(); } });

// ------------------------------------------------------------------ export
function resolvedCSS() {
  const cs = getComputedStyle(root);
  return SVG_CSS.replace(/var\((--[\w-]+)\)/g, (_, n) => cs.getPropertyValue(n).trim() || '#000');
}
function exportSVGString({ background = true } = {}) {
  const c = state.svg.cloneNode(true);
  const { W, H } = state.size;
  c.setAttribute('viewBox', `0 0 ${W} ${H}`); c.setAttribute('width', W); c.setAttribute('height', H);
  c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  c.classList.remove('focus', 'searching');
  c.querySelector('#viewport').removeAttribute('transform');
  c.querySelectorAll('.rel,.sel,.match').forEach((n) => n.classList.remove('rel', 'sel', 'match'));
  Object.entries(state.fams).forEach(([k, on]) => { if (!on) c.querySelectorAll('.fam-' + k).forEach((n) => n.remove()); });
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = resolvedCSS();
  c.insertBefore(style, c.firstChild);
  if (background) {
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', W); bg.setAttribute('height', H); bg.setAttribute('fill', getComputedStyle(root).getPropertyValue('--bg').trim());
    c.insertBefore(bg, c.querySelector('#viewport'));
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(c);
}
function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
function exportSVG() { download('azure-atlas.svg', new Blob([exportSVGString()], { type: 'image/svg+xml' })); }
async function exportPNG() {
  const { W, H } = state.size, s = Math.min(2, 8000 / Math.max(W, H));
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([exportSVGString()], { type: 'image/svg+xml' }));
  await img.decode();
  const cv = document.createElement('canvas'); cv.width = Math.round(W * s); cv.height = Math.round(H * s);
  const cx = cv.getContext('2d'); cx.scale(s, s); cx.drawImage(img, 0, 0, W, H);
  cv.toBlob((b) => download('azure-atlas.png', b), 'image/png');
}
$('#b-svg').onclick = exportSVG; $('#b-png').onclick = exportPNG;

// ------------------------------------------------------------------ chrome
function updateChrome() {
  const m = state.model, a = state.audit;
  $('#meta').textContent = `${m.stats.subscriptions} subscription${m.stats.subscriptions === 1 ? '' : 's'} · ${m.stats.cards} cards from ${m.stats.resources} resources · ${m.stats.edges} links` + (m.meta.exportedAt ? ` · snapshot ${m.meta.exportedAt.slice(0, 10)}` : '');
  const pill = $('#check');
  const bad = a.errors.length;
  pill.className = bad ? 'bad' : a.warnings.length ? 'warn' : 'ok';
  pill.textContent = bad ? `Layout check: ${bad} problem${bad > 1 ? 's' : ''}` : a.warnings.length ? `Layout check: clean, ${a.warnings.length} note${a.warnings.length > 1 ? 's' : ''}` : 'Layout check: clean';
  pill.title = [...a.errors, ...a.warnings].slice(0, 12).join('\n') || 'No line crosses an object and no text is clipped.';
  document.title = 'Azure Atlas';
}
$('#check').onclick = () => { const a = state.audit; toast([...a.errors, ...a.warnings].slice(0, 8).join('\n') || 'No line crosses a card or header, and every text fits its box.', 6000); };
let toastT; function toast(msg, ms = 3000) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms); }
$('#b-fit').onclick = () => fit(true);
$('#b-in').onclick = () => { const b = stage.getBoundingClientRect(); zoomAt(1.3, b.width / 2, b.height / 2); };
$('#b-out').onclick = () => { const b = stage.getBoundingClientRect(); zoomAt(1 / 1.3, b.width / 2, b.height / 2); };
$('#b-theme').onclick = () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
$('#b-open').onclick = () => $('#file').click();
$('#file').addEventListener('change', (e) => e.target.files[0] && readFile(e.target.files[0]));
$('#drop-open').onclick = () => $('#file').click();
$('#drop-sample').onclick = () => { const s = $('#atlas-sample'); if (s) load(JSON.parse(s.textContent)); };
function checkSnapshot(inv) {
  if (!inv || typeof inv !== 'object' || Array.isArray(inv)) throw new Error('not an export file (expected a JSON object)');
  if (inv.schema && !String(inv.schema).startsWith('azure-atlas/1')) throw new Error(`unsupported schema "${inv.schema}"`);
  if (!Array.isArray(inv.resources)) throw new Error('missing "resources" array');
  inv.containers = inv.containers || []; inv.subscriptions = inv.subscriptions || []; inv.roleAssignments = inv.roleAssignments || [];
  return inv;
}
async function readFile(f) {
  try { await load(checkSnapshot(JSON.parse(await f.text()))); }
  catch (err) { toast('Could not read that file: ' + err.message, 5000); $('#busy').hidden = true; }
}
// ?src=inventory.json loads an export hosted next to the page (same origin or CORS-enabled). Still client-side only.
async function loadFromUrl(src) {
  try {
    const u = new URL(src, location.href);
    if (!/^https?:$/.test(u.protocol)) throw new Error('only http(s) URLs are allowed');
    const r = await fetch(u, { credentials: 'omit' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await load(checkSnapshot(await r.json()));
  } catch (err) { toast('Could not load ' + src + ': ' + err.message, 6000); $('#drop').hidden = false; $('#busy').hidden = true; }
}
['dragover', 'dragenter'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement) document.body.classList.remove('dragging'); if (ev === 'drop' && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); }));
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input,select,textarea')) return;
  if (e.key === 'f') fit(true); else if (e.key === 't') $('#b-theme').click(); else if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
  else if (e.key === 'Escape') clearSelection(); else if (e.key === '+' || e.key === '=') $('#b-in').click(); else if (e.key === '-') $('#b-out').click();
});
addEventListener('resize', () => state.svg && fit(false));

// test hooks (also useful from the console)
window.__atlas = { state, load, readFile, checkSnapshot, audit: () => state.audit, exportSVGString, fit, select, setFamilies: (f) => { Object.assign(state.fams, f); applyFamilies(); } };

// ------------------------------------------------------------------ boot
(async () => {
  await (document.fonts?.ready || Promise.resolve());
  const embedded = $('#atlas-data');
  const src = new URLSearchParams(location.search).get('src');
  if (embedded) await load(JSON.parse(embedded.textContent));
  else if (src) await loadFromUrl(src);
  else $('#drop').hidden = false;
})();
