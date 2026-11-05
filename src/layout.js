// Layout: sizes every card and header from measured text, then lets ELK place the nested
// containers (subscription > vnet > subnet / resource group). Edges are routed separately
// (see router.js) so that they can be guaranteed not to touch any object.
import ELK from 'elkjs/lib/elk.bundled.js';
import { measure, wrap, maxLineWidth, MONO } from './text.js';

export const CARD = { w: 248, minH: 64, padX: 12, padY: 12, tile: 40, gap: 12, badge: 22, tfont: 13, sfont: 11.5, tlh: 17, slh: 15 };
const PAD = { side: 28, bottom: 26 };
const HDR = { padX: 16, padTop: 12, padBottom: 10, chipH: 22, chipGap: 6, icon: 20 };

const HEADER_STYLE = {
  subscription: { size: 15, weight: 700, sub: 11.5, min: 300 },
  vnet: { size: 14, weight: 650, sub: 11.5, min: 260, mono: true },
  subnet: { size: 12.5, weight: 650, sub: 11, min: 220, mono: true },
  rg: { size: 12.5, weight: 650, sub: 11, min: 220 },
};

export function layoutCard(n) {
  const hasBadges = n.badges.some((b) => b.kind !== 'public');
  const tw = CARD.w - CARD.padX * 2 - CARD.tile - CARD.gap - (hasBadges ? CARD.badge : 0);
  const titleLines = wrap(n.title, CARD.tfont, 600, tw);
  const subLines = wrap(n.subtitle || '', CARD.sfont, 400, tw);
  const pub = n.badges.find((b) => b.kind === 'public');
  const pubLines = pub ? wrap('Public ' + pub.text, CARD.sfont, 500, tw, MONO) : [];
  const textH = titleLines.length * CARD.tlh + (subLines.length && subLines[0] ? 3 + subLines.length * CARD.slh : 0) + (pubLines.length ? 2 + pubLines.length * CARD.slh : 0);
  const h = Math.max(CARD.minH, Math.ceil(textH + CARD.padY * 2));
  return { w: CARD.w, h, titleLines, subLines, pubLines, tw, textX: CARD.padX + CARD.tile + CARD.gap, textH };
}

export function layoutHeader(c) {
  const st = HEADER_STYLE[c.kind];
  const iconW = HDR.icon + 10;
  const chips = c.chips.map((ch) => ({ ...ch, w: Math.ceil(measure(ch.text, 11, 600) + 18 + (ch.icon ? 16 : 0)) }));
  const chipsOneRow = chips.reduce((a, ch) => a + ch.w + HDR.chipGap, 0) - HDR.chipGap;
  const titleW = measure(c.title, st.size, st.weight);
  const natural = Math.max(HDR.padX * 2 + iconW + titleW + (c.kind === 'subnet' && c.subtitle ? 16 + measure(c.subtitle, st.sub, 500, MONO) : 0), HDR.padX * 2 + (chips.length ? chipsOneRow : 0));
  const wrapW = Math.ceil(Math.min(Math.max(natural, st.min), 520));
  const innerW = wrapW - HDR.padX * 2;
  const titleLines = wrap(c.title, st.size, st.weight, innerW - iconW);
  // subnets show the CIDR inline when it fits, otherwise on its own line
  const inline = c.kind === 'subnet' && c.subtitle && titleLines.length === 1 &&
    HDR.padX * 2 + iconW + measure(c.title, st.size, st.weight) + 16 + measure(c.subtitle, st.sub, 500, MONO) <= wrapW;
  const subLines = c.subtitle && !inline ? wrap(c.subtitle, st.sub, 400, innerW - iconW, st.mono ? MONO : undefined) : [];
  // chips wrap into rows
  const rows = [];
  let x = 0, row = [];
  for (const ch of chips) {
    if (x + ch.w > innerW && row.length) { rows.push(row); row = []; x = 0; }
    ch.x = x; ch.row = rows.length; row.push(ch); x += ch.w + HDR.chipGap;
  }
  if (row.length) rows.push(row);
  const lh = Math.round(st.size * 1.35);
  let y = HDR.padTop;
  const titleY = y; y += titleLines.length * lh;
  const subY = y; y += subLines.length ? subLines.length * 15 + 1 : 0;
  const chipsY = y + (chips.length ? 8 : 0);
  y = chipsY + (rows.length ? rows.length * HDR.chipH + (rows.length - 1) * HDR.chipGap : 0);
  const h = Math.ceil(y + HDR.padBottom);
  return { st, w: wrapW, h, titleLines, subLines, inline, lh, titleY, subY, chipsY, chips, iconW, padX: HDR.padX, chipH: HDR.chipH };
}

const kindOptions = {
  subscription: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.layered.spacing.nodeNodeBetweenLayers': '72', 'elk.spacing.nodeNode': '44', 'elk.spacing.componentComponent': '44', 'elk.aspectRatio': '1.6', 'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES' },
  rg: { 'elk.algorithm': 'box', 'elk.spacing.nodeNode': '28', 'elk.aspectRatio': '2.2', 'elk.box.packingMode': 'SIMPLE' },
  vnet: { 'elk.algorithm': 'box', 'elk.spacing.nodeNode': '30', 'elk.aspectRatio': '1.5', 'elk.box.packingMode': 'SIMPLE' },
  subnet: { 'elk.algorithm': 'box', 'elk.spacing.nodeNode': '28', 'elk.aspectRatio': '2.6', 'elk.box.packingMode': 'SIMPLE' },
};

const elk = new ELK();

export async function computeLayout(model) {
  const info = new Map();   // id -> {kind, parent, depth, header?, card?}
  const parentOf = new Map();
  const walk = (c, parent, depth) => {
    parentOf.set(c.id, parent);
    if (c.kind === 'node') { info.set(c.id, { kind: 'node', parent, depth, card: layoutCard(c), model: c }); return; }
    info.set(c.id, { kind: c.kind, parent, depth, header: layoutHeader(c), model: c });
    c.children.forEach((k) => walk(k, c.id, depth + 1));
  };
  model.roots.forEach((r) => walk(r, null, 1));

  const chain = (id) => { const out = []; for (let x = id; x; x = parentOf.get(x)) out.unshift(x); return out; };

  // Containers that only hold cards (subnets, plain resource groups) are laid out as tidy grids.
  const GAP = 28;
  const grids = new Map(); // containerId -> {w, h, pos: Map(childId -> {x, y})}
  const planGrid = (c) => {
    const hdr = info.get(c.id).header, kids = c.children, n = kids.length;
    if (!n) return { w: hdr.w, h: hdr.h + 20, pos: new Map() };
    const cols = n <= 2 ? 1 : n <= 6 ? 2 : 3;
    const pos = new Map();
    let y = hdr.h + 24, maxX = 0;
    for (let r = 0; r * cols < n; r++) {
      const row = kids.slice(r * cols, r * cols + cols);
      const rh = Math.max(...row.map((k) => info.get(k.id).card.h));
      row.forEach((k, i) => { pos.set(k.id, { x: PAD.side + i * (CARD.w + GAP), y }); maxX = Math.max(maxX, PAD.side + (i + 1) * CARD.w + i * GAP); });
      y += rh + GAP;
    }
    return { w: Math.max(hdr.w, maxX + PAD.side), h: y - GAP + PAD.bottom, pos };
  };
  const isGrid = (c) => (c.kind === 'subnet' || c.kind === 'rg') && c.children.every((k) => k.kind === 'node');
  const gridWalk = (c) => { if (c.kind === 'node') return; if (isGrid(c)) grids.set(c.id, planGrid(c)); else c.children.forEach(gridWalk); };
  model.roots.forEach(gridWalk);

  // lift structural model edges to sibling pairs so ELK's layered pass can order subscriptions / groups
  const ORDERING = new Set(['network', 'privatelink', 'traffic']);
  const lifted = new Map(); // containerId|'root' -> Set("a>b")
  for (const e of model.edges) {
    if (!ORDERING.has(e.family)) continue;
    const ca = chain(e.a), cb = chain(e.b);
    let i = 0;
    while (i < ca.length && i < cb.length && ca[i] === cb[i]) i++;
    const lca = i === 0 ? 'root' : ca[i - 1];
    if (ca[i] && cb[i] && ca[i] !== cb[i]) {
      const set = lifted.get(lca) || lifted.set(lca, new Set()).get(lca);
      set.add(ca[i] + '>' + cb[i]);
    }
  }
  const mkEdges = (key) => [...(lifted.get(key) || [])].map((s, i) => { const [a, b] = s.split('>'); return { id: `${key}:l${i}`, sources: [a], targets: [b] }; });

  const toElk = (c) => {
    const inf = info.get(c.id);
    if (inf.kind === 'node') return { id: c.id, width: inf.card.w, height: inf.card.h };
    if (grids.has(c.id)) return { id: c.id, width: grids.get(c.id).w, height: grids.get(c.id).h };
    const hdr = inf.header;
    const n = {
      id: c.id,
      layoutOptions: {
        ...kindOptions[c.kind],
        // 24px below the header band keeps a clear lane for lines above the first row of cards
        'elk.padding': `[top=${hdr.h + 24},left=${PAD.side},bottom=${PAD.bottom},right=${PAD.side}]`,
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
        'elk.nodeSize.minimum': `(${hdr.w},${hdr.h + 44})`,
      },
      children: c.children.map((k, i) => { const e = toElk(k); e.layoutOptions = { ...(e.layoutOptions || {}), 'elk.priority': String(1000 - i) }; return e; }),
    };
    if (c.kind === 'subscription') n.edges = mkEdges(c.id);
    return n;
  };
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.padding': '[top=70,left=70,bottom=70,right=70]',
      'elk.layered.spacing.nodeNodeBetweenLayers': '120', 'elk.spacing.nodeNode': '60', 'elk.spacing.componentComponent': '60',
      'elk.aspectRatio': '1.8', 'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: model.roots.map(toElk),
    edges: mkEdges('root'),
  };
  const out = await elk.layout(graph);

  const rects = new Map();
  const place = (n, ox, oy) => {
    const x = ox + (n.x || 0), y = oy + (n.y || 0);
    if (n.id !== 'root') {
      const inf = info.get(n.id);
      rects.set(n.id, { id: n.id, x, y, w: n.width, h: n.height, kind: inf.kind, depth: inf.depth, parent: inf.parent, header: inf.header, card: inf.card, model: inf.model });
    }
    (n.children || []).forEach((k) => place(k, n.id === 'root' ? 0 : x, n.id === 'root' ? 0 : y));
    const grid = grids.get(n.id);
    if (grid) {
      for (const [kid, p] of grid.pos) {
        const inf = info.get(kid);
        rects.set(kid, { id: kid, x: x + p.x, y: y + p.y, w: inf.card.w, h: inf.card.h, kind: 'node', depth: inf.depth, parent: n.id, header: null, card: inf.card, model: inf.model });
      }
    }
  };
  place(out, 0, 0);
  const bounds = { w: out.width, h: out.height };
  return { rects, bounds, info };
}
