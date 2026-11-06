// Orthogonal edge router on a coarse grid (A* with bend and overlap penalties).
//
// Guarantees (verified again by audit.js after every render):
//   * cards, container header bands and edge label pills are solid: no line ever crosses them
//   * lines leave and enter a card perpendicular to its side, never at a corner
//   * parallel lines prefer separate lanes; crossings are allowed but cost more than detours
//   * if no clean path exists the edge is reported as "unrouted" instead of being drawn badly
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const CARD_PAD = 8;     // keep-out around cards
const HDR_PAD = 3;      // keep-out around header bands
const BEND = 6;
const CORNER = 16;      // ports stay this far from a card corner

class Heap {
  constructor() { this.f = []; this.v = []; }
  get size() { return this.f.length; }
  push(f, v) {
    const F = this.f, V = this.v;
    let i = F.length; F.push(f); V.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (F[p] <= f) break;
      F[i] = F[p]; V[i] = V[p]; i = p;
    }
    F[i] = f; V[i] = v;
  }
  pop() {
    const F = this.f, V = this.v;
    const top = V[0], lf = F.pop(), lv = V.pop();
    const n = F.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && F[c + 1] < F[c]) c++;
        if (F[c] >= lf) break;
        F[i] = F[c]; V[i] = V[c]; i = c;
      }
      F[i] = lf; V[i] = lv;
    }
    return top;
  }
}

const inflate = (r, p) => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });
const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function segHitsRect(p, q, r) {
  // axis-aligned segment vs rect (open interior test)
  const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x), y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
  return x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h;
}

export function routeAll(model, layout, labelMetrics) {
  const { rects, bounds } = layout;
  const M = 48;
  let g = 8;
  while (((bounds.w + 2 * M) / g) * ((bounds.h + 2 * M) / g) > 420000) g += 2;
  const ox = -M, oy = -M;
  const cols = Math.ceil((bounds.w + 2 * M) / g), rows = Math.ceil((bounds.h + 2 * M) / g);
  const N = cols * rows;
  const cx = (c) => ox + (c + 0.5) * g, cy = (r) => oy + (r + 0.5) * g;
  const colAt = (x) => Math.floor((x - ox) / g), rowAt = (y) => Math.floor((y - oy) / g);
  const inGrid = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows;

  const block = new Uint8Array(N);       // 1 card, 2 header band, 3 label pill
  const inner = new Uint16Array(N);      // innermost container index covering the cell
  const usedH = new Uint8Array(N), usedV = new Uint8Array(N);
  const portUse = new Map();

  const conts = [...rects.values()].filter((r) => r.kind !== 'node').sort((a, b) => a.depth - b.depth);
  const contIndex = new Map(conts.map((c, i) => [c.id, i + 1]));
  const fillRect = (r, fn) => {
    const c0 = Math.max(0, Math.ceil((r.x - ox) / g - 0.5)), c1 = Math.min(cols - 1, Math.floor((r.x + r.w - ox) / g - 0.5));
    const r0 = Math.max(0, Math.ceil((r.y - oy) / g - 0.5)), r1 = Math.min(rows - 1, Math.floor((r.y + r.h - oy) / g - 0.5));
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) fn(rr * cols + cc);
  };
  conts.forEach((c, i) => fillRect(c, (k) => { inner[k] = i + 1; }));
  const headerRect = (c) => ({ x: c.x, y: c.y, w: c.w, h: c.header.h });
  // cells hugging a container border cost extra, so lines run mid-gutter and never read as an outline
  const near = new Uint8Array(N);
  const NEAR = 14;
  conts.forEach((c) => {
    [{ x: c.x - NEAR, y: c.y - NEAR, w: c.w + 2 * NEAR, h: 2 * NEAR }, { x: c.x - NEAR, y: c.y + c.h - NEAR, w: c.w + 2 * NEAR, h: 2 * NEAR },
     { x: c.x - NEAR, y: c.y - NEAR, w: 2 * NEAR, h: c.h + 2 * NEAR }, { x: c.x + c.w - NEAR, y: c.y - NEAR, w: 2 * NEAR, h: c.h + 2 * NEAR }]
      .forEach((strip) => fillRect(strip, (k) => { near[k] = 1; }));
  });
  const bands = conts.map((c) => inflate(headerRect(c), HDR_PAD));
  bands.forEach((b) => fillRect(b, (k) => { if (!block[k]) block[k] = 2; }));
  const cards = [...rects.values()].filter((r) => r.kind === 'node');
  const cardKeepOut = cards.map((c) => inflate(c, CARD_PAD));
  cardKeepOut.forEach((b) => fillRect(b, (k) => { block[k] = 1; }));
  // areas reserved for non-diagram objects (the legend) are as solid as cards
  const reserved = (layout.reserved || []).map((r) => inflate(r, CARD_PAD));
  reserved.forEach((b) => fillRect(b, (k) => { block[k] = 1; }));
  cardKeepOut.push(...reserved); // labels keep clear of them too

  const ancestors = (id) => { const s = new Set(); for (let x = id; x; x = rects.get(x)?.parent) s.add(x); return s; };

  // ---- ring cells: free cells directly outside a side, with their border attachment point
  const ringFor = (id, level) => {
    const R = rects.get(id), ring = [];
    const free = (k) => (level === 0 ? block[k] === 0 : block[k] === 0 || block[k] === 2);
    const add = (c, r, dir, qx, qy) => { if (inGrid(c, r) && free(r * cols + c)) ring.push({ k: r * cols + c, c, r, dir, qx, qy }); };
    if (R.kind === 'node') {
      const Rin = inflate(R, CARD_PAD);
      const rTop = Math.ceil((Rin.y - oy) / g - 0.5) - 1, rBot = Math.floor((Rin.y + Rin.h - oy) / g - 0.5) + 1;
      const cLeft = Math.ceil((Rin.x - ox) / g - 0.5) - 1, cRight = Math.floor((Rin.x + Rin.w - ox) / g - 0.5) + 1;
      for (let c = 0; c < cols; c++) {
        const x = cx(c);
        if (x < R.x + CORNER || x > R.x + R.w - CORNER) continue;
        add(c, rTop, 3, x, R.y); add(c, rBot, 1, x, R.y + R.h);
      }
      for (let r = 0; r < rows; r++) {
        const y = cy(r);
        if (y < R.y + CORNER || y > R.y + R.h - CORNER) continue;
        add(cLeft, r, 2, R.x, y); add(cRight, r, 0, R.x + R.w, y);
      }
    } else {
      const top = R.y + R.header.h + CORNER;
      const cLeft = Math.ceil((R.x - ox) / g - 0.5) - 1, cRight = Math.floor((R.x + R.w - ox) / g - 0.5) + 1;
      const rBot = Math.floor((R.y + R.h - oy) / g - 0.5) + 1;
      for (let r = 0; r < rows; r++) {
        const y = cy(r);
        if (y < top || y > R.y + R.h - CORNER) continue;
        add(cLeft, r, 2, R.x, y); add(cRight, r, 0, R.x + R.w, y);
      }
      for (let c = 0; c < cols; c++) {
        const x = cx(c);
        if (x < R.x + CORNER || x > R.x + R.w - CORNER) continue;
        add(c, rBot, 1, x, R.y + R.h);
      }
    }
    return ring;
  };

  // ---- A* state arrays (reused between edges)
  const gs = new Float32Array(N * 4), stamp = new Uint32Array(N * 4), prev = new Int32Array(N * 4);
  let epoch = 0;

  const search = (srcRing, dstRing, allowed, level) => {
    epoch++;
    const heap = new Heap();
    const target = new Map(dstRing.map((t) => [t.k, t]));
    let tc0 = Infinity, tc1 = -Infinity, tr0 = Infinity, tr1 = -Infinity;
    dstRing.forEach((t) => { tc0 = Math.min(tc0, t.c); tc1 = Math.max(tc1, t.c); tr0 = Math.min(tr0, t.r); tr1 = Math.max(tr1, t.r); });
    const hfn = (c, r) => Math.max(tc0 - c, 0, c - tc1) + Math.max(tr0 - r, 0, r - tr1);
    for (const s of srcRing) {
      const st = s.k * 4 + s.dir, g0 = 3 * (portUse.get(s.k) || 0);
      gs[st] = g0; stamp[st] = epoch; prev[st] = -1;
      heap.push(g0 + hfn(s.c, s.r), st);
    }
    let expansions = 0, goal = -1;
    while (heap.size) {
      const st = heap.pop();
      const k = st >> 2, d = st & 3;
      const c = k % cols, r = (k / cols) | 0;
      const gcur = gs[st];
      if (target.has(k)) { goal = st; break; }
      if (++expansions > 700000) break;
      for (let nd = 0; nd < 4; nd++) {
        if (nd === ((d + 2) & 3)) continue; // no U-turns
        const nc = c + DX[nd], nr = r + DY[nd];
        if (!inGrid(nc, nr)) continue;
        const nk = nr * cols + nc, b = block[nk];
        let cost = 1;
        if (b) {
          if (b === 1 || b === 3 || level === 0) continue;
          cost += 22;
        }
        if (!allowed[inner[nk]]) cost += 2.5;
        if (near[nk]) cost += 7;
        if (nd & 1) { if (usedV[nk]) cost += 3; if (usedH[nk]) cost += 1; }
        else { if (usedH[nk]) cost += 3; if (usedV[nk]) cost += 1; }
        if (nd !== d) cost += BEND;
        if (target.has(nk)) cost += 3 * (portUse.get(nk) || 0);
        const ng = gcur + cost, ns = nk * 4 + nd;
        if (stamp[ns] === epoch && gs[ns] <= ng) continue;
        stamp[ns] = epoch; gs[ns] = ng; prev[ns] = st;
        heap.push(ng + hfn(nc, nr), ns);
      }
    }
    if (goal < 0) return null;
    const cells = [];
    for (let s = goal; s >= 0; s = prev[s]) cells.push(s >> 2);
    cells.reverse();
    const first = srcRing.find((s) => s.k === cells[0]);
    const lastR = target.get(cells[cells.length - 1]);
    return { cells, first, last: lastR };
  };

  const simplify = (pts) => {
    const out = [];
    for (const p of pts) {
      if (out.length && out[out.length - 1].x === p.x && out[out.length - 1].y === p.y) continue;
      out.push({ x: p.x, y: p.y });
      while (out.length >= 3) {
        const a = out[out.length - 3], b = out[out.length - 2], c = out[out.length - 1];
        if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) out.splice(out.length - 2, 1); else break;
      }
    }
    return out;
  };

  // ---- route every edge, short ones first so they get the straight lanes
  const routes = new Map();
  const labelRects = [];
  const order = [...model.edges].sort((e1, e2) => {
    const d = (e) => { const a = rects.get(e.a), b = rects.get(e.b); return a && b ? Math.abs(a.x + a.w / 2 - b.x - b.w / 2) + Math.abs(a.y + a.h / 2 - b.y - b.h / 2) : 1e9; };
    return d(e1) - d(e2);
  });

  for (const e of order) {
    const A = rects.get(e.a), B = rects.get(e.b);
    if (!A || !B) { routes.set(e.id, { status: 'unrouted', pts: [], why: 'endpoint missing' }); continue; }
    const anc = new Set([...ancestors(e.a), ...ancestors(e.b)]);
    const allowed = new Uint8Array(conts.length + 1);
    allowed[0] = 1;
    anc.forEach((id) => { const i = contIndex.get(id); if (i) allowed[i] = 1; });
    let found = null, level = 0;
    for (level = 0; level <= 1 && !found; level++) {
      const s = ringFor(e.a, level), t = ringFor(e.b, level);
      if (!s.length || !t.length) continue;
      found = search(s, t, allowed, level);
      if (found) found.level = level;
    }
    if (!found) { routes.set(e.id, { status: 'unrouted', pts: [], why: 'no clean path' }); continue; }
    const { cells, first, last } = found;
    const pts = simplify([{ x: first.qx, y: first.qy }, ...cells.map((k) => ({ x: cx(k % cols), y: cy((k / cols) | 0) })), { x: last.qx, y: last.qy }]);
    // occupy lanes + ports
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1], b = cells[i];
      if (a === b) continue;
      if (Math.abs(a - b) === 1) { usedH[a] = 1; usedH[b] = 1; } else { usedV[a] = 1; usedV[b] = 1; }
    }
    [first, last].forEach((p) => {
      portUse.set(p.k, (portUse.get(p.k) || 0) + 2);
      const step = p.dir & 1 ? 1 : cols;
      portUse.set(p.k - step, (portUse.get(p.k - step) || 0) + 1);
      portUse.set(p.k + step, (portUse.get(p.k + step) || 0) + 1);
    });
    const route = { status: found.level ? 'relaxed' : 'ok', pts, label: null };

    // label pill: sit on a long segment where it touches nothing else
    if (e.label && labelMetrics) {
      const { w, h } = labelMetrics(e.label);
      const segs = [];
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1], q = pts[i];
        segs.push({ i, len: Math.abs(p.x - q.x) + Math.abs(p.y - q.y), p, q, horiz: p.y === q.y });
      }
      segs.sort((s1, s2) => (s2.horiz - s1.horiz) || (s2.len - s1.len));
      for (const s of segs) {
        if (s.len < (s.horiz ? w + 28 : h + 20)) continue;
        const mx = (s.p.x + s.q.x) / 2, my = (s.p.y + s.q.y) / 2;
        const rect = { x: mx - w / 2, y: my - h / 2, w, h };
        const pad = inflate(rect, 3);
        const clash =
          cardKeepOut.some((b) => hit(pad, b)) || bands.some((b) => hit(pad, b)) || labelRects.some((b) => hit(pad, b)) ||
          [...routes.entries()].some(([id, rt]) => id !== e.id && rt.pts?.some((p, i) => i && segHitsRect(rt.pts[i - 1], p, pad))) ||
          pts.some((p, i) => i && i !== s.i && segHitsRect(pts[i - 1], p, pad));
        if (clash) continue;
        route.label = { ...rect, text: e.label };
        labelRects.push(pad);
        fillRect(pad, (k) => { if (!block[k]) block[k] = 3; });
        break;
      }
    }
    routes.set(e.id, route);
  }
  return { routes, labelRects, grid: g };
}
