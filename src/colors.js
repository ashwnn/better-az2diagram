// Per-link colours. The dash pattern says WHAT a link is (peering, private link, telemetry...), the colour says WHICH
// link it is. Colours are picked by greedy graph colouring so that two links that touch, cross or run side by side
// (or that share a card) never get the same colour, which keeps bundled lines traceable end to end.
export const PALETTE = 12;

// Palette order is chosen so that consecutive colours are far apart in hue.
export const EDGE_COLORS = {
  light: ['#2563eb', '#ea580c', '#16a34a', '#9333ea', '#ec4899', '#0891b2', '#ca8a04', '#4f46e5', '#92400e', '#65a30d', '#0d9488', '#475569'],
  dark: ['#60a5fa', '#fb923c', '#4ade80', '#c084fc', '#f472b6', '#22d3ee', '#facc15', '#818cf8', '#d4a373', '#a3e635', '#2dd4bf', '#94a3b8'],
};

const NEAR = 14; // lines closer than this (or crossing) count as "sharing a corridor"

export function assignColors(model, routing) {
  const edges = model.edges.filter((e) => e.state !== 'warn' && routing.routes.get(e.id)?.pts?.length > 1);
  const idx = new Map(edges.map((e, i) => [e.id, i]));
  const segs = [];
  edges.forEach((e, i) => {
    const pts = routing.routes.get(e.id).pts;
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k - 1], q = pts[k];
      segs.push({ i, x0: Math.min(p.x, q.x) - NEAR / 2, x1: Math.max(p.x, q.x) + NEAR / 2, y0: Math.min(p.y, q.y) - NEAR / 2, y1: Math.max(p.y, q.y) + NEAR / 2 });
    }
  });
  const adj = edges.map(() => new Set());
  const link = (a, b) => { if (a !== b) { adj[a].add(b); adj[b].add(a); } };
  // sweep over x so the pair test stays cheap on big diagrams
  segs.sort((a, b) => a.x0 - b.x0);
  for (let a = 0; a < segs.length; a++) {
    for (let b = a + 1; b < segs.length && segs[b].x0 <= segs[a].x1; b++) {
      if (segs[a].i !== segs[b].i && segs[b].y0 <= segs[a].y1 && segs[a].y0 <= segs[b].y1) link(segs[a].i, segs[b].i);
    }
  }
  // links that share a card are always told apart, even when they leave on opposite sides
  const byEnd = new Map();
  edges.forEach((e, i) => [e.a, e.b].forEach((id) => (byEnd.get(id) || byEnd.set(id, []).get(id)).push(i)));
  byEnd.forEach((list) => { for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) link(list[a], list[b]); });

  // Welsh-Powell: most constrained links first
  const order = edges.map((_, i) => i).sort((a, b) => adj[b].size - adj[a].size || a - b);
  const color = new Array(edges.length).fill(-1);
  const globalUse = new Array(PALETTE).fill(0);
  for (const i of order) {
    const taken = new Array(PALETTE).fill(0);
    adj[i].forEach((n) => { if (color[n] >= 0) taken[color[n]]++; });
    let best = -1;
    for (let c = 0; c < PALETTE; c++) if (!taken[c] && (best < 0 || globalUse[c] < globalUse[best])) best = c;
    if (best < 0) best = taken.indexOf(Math.min(...taken)); // more neighbours than colours: reuse the rarest nearby colour
    color[i] = best; globalUse[best]++;
  }
  return new Map(edges.map((e) => [e.id, color[idx.get(e.id)]]));
}
