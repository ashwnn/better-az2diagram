// In-canvas legend (top left). It is part of the SVG, so it appears in every export too.
// Only entries that exist in the current diagram are listed.
import { h, GLYPH, BADGE_TIP, arrowPath } from './render.js';
import { FAMILIES } from './model.js';
import { measure } from './text.js';
import { EDGE_COLORS } from './colors.js';

export const LEGEND = { x: 70, y: 28 };
const ROW = 22, PAD = 14, TITLE = 24, GAP = 30, SAMPLE = 50;
const KIND_LABEL = { subscription: 'Subscription', vnet: 'Virtual network', subnet: 'Subnet', rg: 'Resource group' };
const BADGE_LABEL = { public: 'Public IP', private: 'Public access disabled', policy: 'Policy attached', warn: 'Needs attention' };

// A line sample that mirrors how the real edge is drawn (same dash, width, caps, arrow and origin dot).
function lineSample(x, cy, fam, { dash = fam.dash, cls = '' } = {}) {
  const g = h('g', { class: cls });
  const size = 6.5 + fam.width * 1.7, x0 = x + 4, x1 = x + SAMPLE - 4;
  const wantEnd = fam.arrow === 'end' || fam.arrow === 'both', wantStart = fam.arrow === 'both';
  const a = wantStart ? x0 + size * 0.8 : x0, b = wantEnd ? x1 - size * 0.8 : x1;
  g.append(h('path', { class: 'line lg-line', d: `M${a} ${cy}H${b}`, fill: 'none', 'stroke-width': fam.width, 'stroke-dasharray': dash, 'stroke-linecap': fam.cap || 'butt' }));
  if (wantEnd) g.append(h('path', { class: 'arrow lg-fill', d: arrowPath({ x: x1, y: cy }, { x: x0, y: cy }, size) }));
  if (wantStart) g.append(h('path', { class: 'arrow lg-fill', d: arrowPath({ x: x0, y: cy }, { x: x1, y: cy }, size) }));
  const r = fam.width * 0.8 + 1.6;
  if (fam.arrow === 'end') g.append(h('circle', { class: 'org lg-fill', cx: x0 + r * 0.6, cy, r }));
  if (fam.arrow === 'none') { g.append(h('circle', { class: 'org lg-fill', cx: x0 + r * 0.6, cy, r })); g.append(h('circle', { class: 'org lg-fill', cx: x1 - r * 0.6, cy, r })); }
  return g;
}

export function buildLegend(model, fams = null) {
  const present = {};
  model.edges.forEach((e) => { present[e.family] = (present[e.family] || 0) + 1; });
  const warnCount = model.edges.filter((e) => e.state === 'warn').length;
  const badges = new Set();
  model.nodes.forEach((n) => n.badges.forEach((b) => badges.add(b.kind)));
  const kinds = new Set();
  model.containers.forEach((c) => kinds.add(c.kind));

  const cols = [];
  const links = Object.keys(FAMILIES).filter((k) => present[k]).map((k) => ({
    text: FAMILIES[k].label, on: !fams || fams[k], draw: (x, cy) => lineSample(x, cy, FAMILIES[k]),
  }));
  if (warnCount) links.push({ text: 'Not healthy', on: true, draw: (x, cy) => lineSample(x, cy, { ...FAMILIES.network, arrow: 'end', width: 1.9 }, { dash: '6 4', cls: 'lg-warn' }) });
  if (links.length) cols.push({ title: 'LINKS', rows: links });

  const read = [];
  if (model.edges.length) {
    read.push({ text: 'Starts at the dot, points to the target', on: true, draw: (x, cy) => lineSample(x, cy, { ...FAMILIES.traffic, width: 1.9, arrow: 'end' }) });
    read.push({
      text: 'Each link has its own colour', on: true,
      draw: (x, cy) => {
        const g = h('g', {});
        [0, 1, 2, 3].forEach((i) => g.append(h('g', { class: 'ec' + i }, h('path', { class: 'line', d: `M${x + 4 + i * 11} ${cy}h8`, fill: 'none', 'stroke-width': 3, 'stroke-linecap': 'round' }))));
        return g;
      },
    });
  }
  ['public', 'private', 'policy', 'warn'].filter((k) => badges.has(k)).forEach((k) => read.push({
    text: BADGE_LABEL[k], on: true,
    draw: (x, cy) => {
      const g = h('g', { class: `bd ${k}` });
      g.append(h('circle', { cx: x + 14, cy, r: 9 }));
      g.append(h('path', { d: GLYPH[k], transform: `translate(${x + 14 - 8} ${cy - 8})` }));
      g.append(h('title', {}, BADGE_TIP[k]));
      return g;
    },
  }));
  if (read.length) cols.push({ title: 'READING THE DIAGRAM', rows: read });

  const conts = ['subscription', 'vnet', 'subnet', 'rg'].filter((k) => kinds.has(k)).map((k) => ({
    text: KIND_LABEL[k], on: true,
    draw: (x, cy) => h('g', { class: `ct ct-${k}` }, h('rect', { class: 'box', x: x + 4, y: cy - 8, width: 30, height: 16, rx: 4 })),
  }));
  if (conts.length) cols.push({ title: 'CONTAINERS', rows: conts });

  // sizes come from the full list so the reserved area never changes when a link type is switched off
  const widths = cols.map((c) => Math.max(measure(c.title, 10, 700) + 24, ...c.rows.map((r) => SAMPLE + 8 + measure(r.text, 11.5, 400))));
  const rows = Math.max(0, ...cols.map((c) => c.rows.length));
  const w = Math.ceil(PAD * 2 + widths.reduce((a, x) => a + x, 0) + GAP * Math.max(0, cols.length - 1));
  const hgt = Math.ceil(PAD + TITLE + rows * ROW + PAD - 4);

  const g = h('g', { class: 'legend', transform: `translate(${LEGEND.x} ${LEGEND.y})` });
  g.append(h('rect', { class: 'lg-box', x: 0, y: 0, width: w, height: hgt, rx: 14 }));
  let cx = PAD;
  cols.forEach((c, i) => {
    g.append(h('text', { class: 'lt', x: cx, y: PAD + 8 }, c.title));
    let y = PAD + TITLE;
    for (const r of c.rows) {
      if (r.on) {
        g.append(r.draw(cx, y + ROW / 2 - 2));
        g.append(h('text', { x: cx + SAMPLE + 8, y: y + ROW / 2 + 2 }, r.text));
      }
      y += ROW;
    }
    cx += widths[i] + GAP;
  });
  return { g, w, h: hgt, empty: !cols.length };
}

export const legendSize = (model) => { const l = buildLegend(model); return { w: l.empty ? 0 : l.w, h: l.empty ? 0 : l.h }; };
