import ICONS from '../icons/icons.json';
import TYPEMAP from '../icons/typemap.json';
import { FAMILIES } from './model.js';
import { measure, MONO } from './text.js';
import { CARD } from './layout.js';
import { PALETTE } from './colors.js';

const NS = 'http://www.w3.org/2000/svg';
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null && attrs[k] !== false) el.setAttribute(k, attrs[k]);
  kids.flat(9).forEach((k) => { if (k != null) el.append(k.nodeType ? k : document.createTextNode(String(k))); });
  return el;
}

// All colours come from CSS custom properties so light, dark and export share one stylesheet.
export const SVG_CSS = `
.atlas{font-family:var(--ff);}
.atlas text{fill:var(--ink);}
.atlas .muted{fill:var(--ink2);}
.atlas .mono{font-family:var(--mono);}
.ct rect.box{stroke-width:1.25;}
.ct-subscription rect.box{fill:var(--sub-fill);stroke:var(--sub-stroke);}
.ct-vnet rect.box{fill:var(--vnet-fill);stroke:var(--vnet-stroke);}
.ct-subnet rect.box{fill:var(--snet-fill);stroke:var(--snet-stroke);}
.ct-rg rect.box{fill:var(--rg-fill);stroke:var(--rg-stroke);stroke-dasharray:5 5;}
.ct-vnet .ttl{fill:var(--vnet-ink);}
.chip rect{stroke:none;}
.chip text{font-size:11px;font-weight:600;}
.chip.blue rect{fill:var(--chip-blue-bg);} .chip.blue text{fill:var(--chip-blue-fg);}
.chip.amber rect{fill:var(--chip-amber-bg);} .chip.amber text{fill:var(--chip-amber-fg);}
.chip.violet rect{fill:var(--chip-violet-bg);} .chip.violet text{fill:var(--chip-violet-fg);}
.chip.slate rect{fill:var(--chip-slate-bg);} .chip.slate text{fill:var(--chip-slate-fg);}
.card rect.body{fill:var(--card);stroke:var(--card-stroke);stroke-width:1;}
.card rect.tile{fill:var(--tile);}
.card .t{font-size:13px;font-weight:600;}
.card .s{font-size:11.5px;fill:var(--ink2);}
.card .p{font-size:11.5px;font-weight:500;fill:var(--public);}
.card .bd circle{fill:var(--badge-bg);}
.card .bd path{fill:none;stroke:var(--badge-fg);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}
.card .bd.warn circle{fill:var(--warn-bg);} .card .bd.warn path{stroke:var(--warn);}
.card .bd.public circle{fill:var(--public-bg);} .card .bd.public path{stroke:var(--public);}
.card.sel rect.body{stroke:var(--accent);stroke-width:2;}
.edge .line{fill:none;stroke-linejoin:round;}
.edge .hit{fill:none;stroke:transparent;stroke-width:14;}
.edge .lab rect{fill:var(--card);stroke-width:1.25;}
.edge .lab text{font-size:10.5px;font-weight:650;}
.edge .line{stroke:var(--ink2);} .edge .arrow, .edge .org{fill:var(--ink2);}
.edge .lab rect{stroke:var(--ink2);} .edge .lab text{fill:var(--ink2);}
${Array.from({ length: PALETTE }, (_, i) => `.ec${i} .line{stroke:var(--ec${i});} .ec${i} .arrow, .ec${i} .org{fill:var(--ec${i});} .ec${i} .lab rect{stroke:var(--ec${i});} .ec${i} .lab text{fill:var(--ec${i});}`).join('\n')}
.edge.warn .line{stroke:var(--warn);} .edge.warn .arrow, .edge.warn .org{fill:var(--warn);} .edge.warn .lab rect{stroke:var(--warn);} .edge.warn .lab text{fill:var(--warn);}
.legend rect.lg-box{fill:var(--card);stroke:var(--card-stroke);stroke-width:1;}
.legend text{font-size:11.5px;} .legend .lt{font-size:10px;font-weight:700;letter-spacing:.09em;fill:var(--ink3);}
.legend .lg-line{fill:none;stroke:var(--ink2);stroke-linejoin:round;} .legend .lg-fill{fill:var(--ink2);}
.legend .bd circle{fill:var(--badge-bg);} .legend .bd path{fill:none;stroke:var(--badge-fg);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}
.legend .bd.warn circle{fill:var(--warn-bg);} .legend .bd.warn path{stroke:var(--warn);}
.legend .bd.public circle{fill:var(--public-bg);} .legend .bd.public path{stroke:var(--public);}
.legend .lg-warn .lg-line{stroke:var(--warn);} .legend .lg-warn .lg-fill{fill:var(--warn);}
.mk circle{stroke:var(--card);stroke-width:2;}
.mk.fam-network circle{fill:var(--fam-network);} .mk.fam-privatelink circle{fill:var(--fam-privatelink);} .mk.fam-traffic circle{fill:var(--fam-traffic);}
.mk.fam-monitoring circle{fill:var(--fam-monitoring);} .mk.fam-dns circle{fill:var(--fam-dns);} .mk.fam-identity circle{fill:var(--fam-identity);}
.mk path{fill:none;stroke:#fff;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;}
.atlas.hide-fam-network .fam-network, .atlas.hide-fam-privatelink .fam-privatelink, .atlas.hide-fam-traffic .fam-traffic,
.atlas.hide-fam-monitoring .fam-monitoring, .atlas.hide-fam-dns .fam-dns, .atlas.hide-fam-identity .fam-identity{display:none;}
.atlas.focus .card:not(.rel), .atlas.focus .edge:not(.rel), .atlas.focus .mk:not(.rel){opacity:.2;}
.atlas.focus .ct:not(.rel) .box{opacity:.55;}
.atlas.focus .edge.rel .line{stroke-width:3.2;}
.atlas.searching .card:not(.match){opacity:.25;}
.atlas.searching .card.match rect.body{stroke:var(--accent);stroke-width:2;}
.atlas .card, .atlas .edge{transition:opacity .12s;}
`;

export const GLYPH = {
  public: 'M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 0 0 0-11zM2.8 8h10.4M8 2.5c1.7 1.6 2.5 3.4 2.5 5.5S9.7 11.9 8 13.5M8 2.5C6.3 4.1 5.5 5.9 5.5 8S6.3 11.9 8 13.5',
  private: 'M5 7V5.5a3 3 0 0 1 6 0V7M4 7h8v6H4z',
  policy: 'M8 2l5 2v4c0 3-2.2 4.7-5 6c-2.8-1.3-5-3-5-6V4z',
  warn: 'M8 3.5v5M8 11.2v.1',
};
export const BADGE_TIP = { public: 'Public IP', private: 'Public network access disabled', policy: 'Policy attached', warn: 'Needs attention' };

export const iconSlug = (key) => TYPEMAP[key] || TYPEMAP[key.split('#')[0]] || 'all-resources';

const quadLen = (p, c, q) => {
  let len = 0, px = p.x, py = p.y;
  for (let i = 1; i <= 8; i++) {
    const t = i / 8, u = 1 - t, x = u * u * p.x + 2 * u * t * c.x + t * t * q.x, y = u * u * p.y + 2 * u * t * c.y + t * t * q.y;
    len += Math.hypot(x - px, y - py); px = x; py = y;
  }
  return len;
};
// Rounded orthogonal path. Returns the SVG path data and its true length (needed to end dash patterns cleanly).
function roundedPath(pts, r = 10) {
  if (pts.length < 2) return { d: '', len: 0 };
  let d = `M${pts[0].x} ${pts[0].y}`, len = 0, cur = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const p1 = { x: b.x + ((a.x - b.x) / l1) * rr, y: b.y + ((a.y - b.y) / l1) * rr };
    const p2 = { x: b.x + ((c.x - b.x) / l2) * rr, y: b.y + ((c.y - b.y) / l2) * rr };
    d += `L${p1.x} ${p1.y}Q${b.x} ${b.y} ${p2.x} ${p2.y}`;
    len += Math.hypot(p1.x - cur.x, p1.y - cur.y) + quadLen(p1, b, p2); cur = p2;
  }
  const z = pts[pts.length - 1];
  len += Math.hypot(z.x - cur.x, z.y - cur.y);
  return { d: d + `L${z.x} ${z.y}`, len };
}

export const arrowPath = (tip, from, size) => {
  const dx = tip.x - from.x, dy = tip.y - from.y, l = Math.hypot(dx, dy) || 1;
  const ux = dx / l, uy = dy / l, px = -uy, py = ux, back = size, half = size * 0.55;
  return `M${tip.x} ${tip.y}L${tip.x - ux * back + px * half} ${tip.y - uy * back + py * half}L${tip.x - ux * back - px * half} ${tip.y - uy * back - py * half}Z`;
};

export function labelMetrics(text) { return { w: Math.ceil(measure(text, 10.5, 650) + 18), h: 20 }; }

export function renderDiagram(model, layout, routing, colors = new Map()) {
  const used = new Set();
  const icon = (key, x, y, s, cls) => {
    const slug = iconSlug(key); used.add(slug);
    return h('use', { href: '#ic-' + slug, x, y, width: s, height: s, class: cls });
  };
  const rects = [...layout.rects.values()];
  const gContainers = h('g', { class: 'containers' });
  const gEdges = h('g', { class: 'edges' });
  const gCards = h('g', { class: 'cards' });
  const gMarks = h('g', { class: 'marks' });

  // ------------------------------------------------------------- containers (outer first)
  for (const c of rects.filter((r) => r.kind !== 'node').sort((a, b) => a.depth - b.depth)) {
    const hd = c.header, st = hd.st, m = c.model;
    const rx = { subscription: 22, vnet: 18, subnet: 14, rg: 14 }[c.kind];
    const g = h('g', { class: `ct ct-${c.kind}`, 'data-id': c.id });
    g.append(h('rect', { class: 'box', x: c.x, y: c.y, width: c.w, height: c.h, rx }));
    const tx = c.x + hd.padX + hd.iconW;
    g.append(icon(m.icon, c.x + hd.padX, c.y + 12 + (hd.lh - 20) / 2, 20));
    g.append(h('text', { class: 'ttl', x: tx, y: c.y + hd.titleY + hd.lh * 0.78, 'font-size': st.size, 'font-weight': st.weight, 'data-maxw': hd.w - hd.padX * 2 - hd.iconW },
      hd.titleLines.map((l, i) => h('tspan', { x: tx, dy: i ? hd.lh : 0 }, l))));
    if (hd.inline) {
      const w = measure(m.title, st.size, st.weight);
      const ix = tx + w + 14;
      g.append(h('text', { class: 'muted mono', x: ix, y: c.y + hd.titleY + hd.lh * 0.78, 'font-size': st.sub, 'font-weight': 500, 'data-maxw': hd.w - (ix - c.x) - hd.padX }, m.subtitle));
    } else if (hd.subLines.length) {
      g.append(h('text', { class: 'muted' + (st.mono ? ' mono' : ''), x: tx, y: c.y + hd.subY + 11, 'font-size': st.sub, 'data-maxw': hd.w - hd.padX * 2 - hd.iconW },
        hd.subLines.map((l, i) => h('tspan', { x: tx, dy: i ? 15 : 0 }, l))));
    }
    for (const ch of hd.chips) {
      const x = c.x + hd.padX + ch.x, y = c.y + hd.chipsY + ch.row * (hd.chipH + 6);
      const cg = h('g', { class: `chip ${ch.tone || 'slate'}` });
      cg.append(h('rect', { x, y, width: ch.w, height: hd.chipH, rx: hd.chipH / 2 }));
      if (ch.icon) cg.append(icon(ch.icon, x + 7, y + 4, 14));
      const tx2 = x + 9 + (ch.icon ? 16 : 0);
      cg.append(h('text', { x: tx2, y: y + 15, 'data-maxw': ch.w - 18 - (ch.icon ? 16 : 0) }, ch.text));
      g.append(cg);
    }
    gContainers.append(g);
  }

  // ------------------------------------------------------------- cards
  for (const c of rects.filter((r) => r.kind === 'node')) {
    const cd = c.card, m = c.model;
    const g = h('g', { class: 'card', 'data-id': c.id, filter: 'url(#shadow)' });
    g.append(h('rect', { class: 'body', x: c.x, y: c.y, width: c.w, height: c.h, rx: 13 }));
    const ty = c.y + (c.h - CARD.tile) / 2;
    g.append(h('rect', { class: 'tile', x: c.x + CARD.padX, y: ty, width: CARD.tile, height: CARD.tile, rx: 11 }));
    g.append(icon(m.icon, c.x + CARD.padX + 7, ty + 7, 26));
    const top = c.y + (c.h - cd.textH) / 2, tx = c.x + cd.textX;
    g.append(h('text', { class: 't', x: tx, y: top + 13, 'data-maxw': cd.tw }, cd.titleLines.map((l, i) => h('tspan', { x: tx, dy: i ? CARD.tlh : 0 }, l))));
    let yy = top + cd.titleLines.length * CARD.tlh + 3;
    if (cd.subLines.length && cd.subLines[0]) {
      g.append(h('text', { class: 's', x: tx, y: yy + 11, 'data-maxw': cd.tw }, cd.subLines.map((l, i) => h('tspan', { x: tx, dy: i ? CARD.slh : 0 }, l))));
      yy += cd.subLines.length * CARD.slh;
    }
    if (cd.pubLines.length) {
      g.append(h('text', { class: 'p mono', x: tx, y: yy + 13, 'data-maxw': cd.tw }, cd.pubLines.map((l, i) => h('tspan', { x: tx, dy: i ? CARD.slh : 0 }, l))));
    }
    m.badges.filter((b) => b.kind !== 'public').forEach((b, i) => {
      const bx = c.x + c.w - CARD.padX - 9, by = c.y + CARD.padY + 9 + i * 22;
      const bg = h('g', { class: `bd ${b.kind}` });
      bg.append(h('title', {}, b.tip || BADGE_TIP[b.kind]));
      bg.append(h('circle', { cx: bx, cy: by, r: 10 }));
      bg.append(h('path', { d: GLYPH[b.kind], transform: `translate(${bx - 8} ${by - 8})` }));
      g.append(bg);
    });
    g.append(h('title', {}, `${m.res.name}\n${m.type}\n${m.res.resourceGroup} · ${m.res.location}`));
    gCards.append(g);
  }

  // ------------------------------------------------------------- edges
  const byId = new Map(model.edges.map((e) => [e.id, e]));
  for (const e of model.edges) {
    const rt = routing.routes.get(e.id);
    const fam = FAMILIES[e.family];
    const A = layout.rects.get(e.a)?.model?.title, B = layout.rects.get(e.b)?.model?.title;
    if (!rt || rt.status === 'unrouted') {
      // never draw a bad line: mark both ends with a small tag instead
      [[e.a, e.b], [e.b, e.a]].forEach(([from, to]) => {
        const R = layout.rects.get(from), T = layout.rects.get(to);
        if (!R || !T) return;
        const dx = T.x + T.w / 2 - (R.x + R.w / 2), dy = T.y + T.h / 2 - (R.y + R.h / 2);
        let px, py, dir;
        if (R.kind === 'node') {
          if (Math.abs(dx) / R.w > Math.abs(dy) / R.h) { px = dx > 0 ? R.x + R.w : R.x; py = R.y + R.h / 2; dir = dx > 0 ? [1, 0] : [-1, 0]; }
          else { px = R.x + R.w / 2; py = dy > 0 ? R.y + R.h : R.y; dir = dy > 0 ? [0, 1] : [0, -1]; }
        } else { px = dx > 0 ? R.x + R.w : R.x; py = R.y + R.header.h + (R.h - R.header.h) / 2; dir = dx > 0 ? [1, 0] : [-1, 0]; }
        const mk = h('g', { class: `mk fam-${e.family}`, 'data-a': e.a, 'data-b': e.b, 'data-e': e.id });
        mk.append(h('title', {}, `${fam.label}: ${from === e.a ? A : B} → ${from === e.a ? B : A} (no clean path, see details)`));
        mk.append(h('circle', { cx: px, cy: py, r: 8 }));
        mk.append(h('path', { d: `M${px - dir[0] * 3 - dir[1] * 3} ${py - dir[1] * 3 - dir[0] * 3}L${px + dir[0] * 3} ${py + dir[1] * 3}L${px - dir[0] * 3 + dir[1] * 3} ${py - dir[1] * 3 + dir[0] * 3}` }));
        gMarks.append(mk);
      });
      continue;
    }
    const pts = rt.pts.map((p) => ({ ...p }));
    const warn = e.state === 'warn';
    const size = 6.5 + fam.width * 1.7;
    const wantEnd = fam.arrow === 'end' || fam.arrow === 'both', wantStart = fam.arrow === 'both';
    const n = pts.length;
    const arrows = [], dots = [];
    // Pull a line end back under its arrowhead. Short stubs (a card is often only ~10px from the corner) are
    // shortened too, otherwise the line stops short of the head and the arrow looks cut off.
    const shorten = (i, j) => {
      const dx = rt.pts[j].x - rt.pts[i].x, dy = rt.pts[j].y - rt.pts[i].y, l = Math.hypot(dx, dy);
      const limit = n === 2 && wantEnd && wantStart ? l / 2 : l;
      const cut = Math.max(0, Math.min(size * 0.8, limit - 0.5));
      pts[i] = { x: rt.pts[i].x + (dx / l) * cut, y: rt.pts[i].y + (dy / l) * cut };
    };
    if (wantEnd) { arrows.push(arrowPath(rt.pts[n - 1], rt.pts[n - 2], size)); shorten(n - 1, n - 2); }
    if (wantStart) { arrows.push(arrowPath(rt.pts[0], rt.pts[1], size)); shorten(0, 1); }
    // origin marker: a dot where a one-way link starts (and at both ends of an undirected link)
    const dotAt = (i, j) => {
      const dx = rt.pts[j].x - rt.pts[i].x, dy = rt.pts[j].y - rt.pts[i].y, l = Math.hypot(dx, dy) || 1, r = fam.width * 0.8 + 1.6;
      dots.push({ x: rt.pts[i].x + (dx / l) * r * 0.6, y: rt.pts[i].y + (dy / l) * r * 0.6, r });
    };
    if (fam.arrow === 'end') dotAt(0, 1);
    if (fam.arrow === 'none') { dotAt(0, 1); dotAt(n - 1, n - 2); }
    const { d, len } = roundedPath(pts);
    // end the dash pattern on a full dash so dotted and dashed lines always reach the arrowhead
    const dash = warn ? '6 4' : fam.dash;
    let pathLength = null;
    if (dash) {
      const arr = dash.split(' ').map(Number), period = arr.reduce((a, x) => a + x, 0) * (arr.length % 2 ? 2 : 1);
      pathLength = +(Math.max(1, Math.round((len - arr[0]) / period)) * period + arr[0]).toFixed(3);
    }
    const ci = colors.get(e.id);
    const g = h('g', { class: `edge fam-${e.family}${ci != null ? ' ec' + ci : ''}${warn ? ' warn' : ''}`, 'data-id': e.id, 'data-a': e.a, 'data-b': e.b });
    g.append(h('title', {}, `${fam.label}${e.label ? ' · ' + e.label : ''}\n${A} → ${B}`));
    g.append(h('path', { class: 'hit', d }));
    g.append(h('path', { class: 'line', d, 'stroke-width': fam.width, 'stroke-dasharray': dash, pathLength, 'stroke-linecap': fam.cap || 'butt' }));
    dots.forEach((o) => g.append(h('circle', { class: 'org', cx: o.x, cy: o.y, r: o.r })));
    arrows.forEach((a) => g.append(h('path', { class: 'arrow', d: a })));
    if (rt.label) {
      const L = rt.label, lg = h('g', { class: 'lab' });
      lg.append(h('rect', { x: L.x, y: L.y, width: L.w, height: L.h, rx: L.h / 2 }));
      lg.append(h('text', { x: L.x + L.w / 2, y: L.y + 14, 'text-anchor': 'middle', 'data-maxw': L.w - 14 }, L.text));
      g.append(lg);
    }
    gEdges.append(g);
  }

  // ------------------------------------------------------------- assemble
  const W = Math.ceil(layout.bounds.w), H = Math.ceil(layout.bounds.h);
  const defs = h('defs', {},
    h('filter', { id: 'shadow', x: '-10%', y: '-10%', width: '120%', height: '140%' },
      h('feDropShadow', { dx: 0, dy: 1, stdDeviation: 1.2, 'flood-color': '#0f172a', 'flood-opacity': 0.07 }),
      h('feDropShadow', { dx: 0, dy: 6, stdDeviation: 7, 'flood-color': '#0f172a', 'flood-opacity': 0.06 })));
  used.forEach((slug) => {
    const ic = ICONS[slug];
    if (!ic) return;
    const sym = h('symbol', { id: 'ic-' + slug, viewBox: ic.vb });
    sym.innerHTML = ic.body;
    defs.append(sym);
  });
  const viewport = h('g', { id: 'viewport' }, gContainers, gEdges, gCards, gMarks);
  const svg = h('svg', { xmlns: NS, class: 'atlas', width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'data-w': W, 'data-h': H }, defs, viewport);
  return { svg, viewport, size: { W, H } };
}
