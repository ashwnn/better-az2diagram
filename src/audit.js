// Independent geometry audit. It does not trust the router or the layout: it re-checks the final
// numbers. A diagram with errors is never silently shown as "clean".
import { segHitsRect } from './router.js';

const shrink = (r, p) => ({ x: r.x + p, y: r.y + p, w: Math.max(0, r.w - 2 * p), h: Math.max(0, r.h - 2 * p) });
const grow = (r, p) => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });
const hit = (a, b) => a.x < b.x + b.w - 0.01 && a.x + a.w > b.x + 0.01 && a.y < b.y + b.h - 0.01 && a.y + a.h > b.y + 0.01;

export function auditGeometry(model, layout, routing) {
  const errors = [], warnings = [];
  const { rects } = layout;
  const all = [...rects.values()];
  const cards = all.filter((r) => r.kind === 'node');
  const conts = all.filter((r) => r.kind !== 'node');
  const name = (id) => rects.get(id)?.model?.title || id;

  // 1. no line segment may touch a card (other than the ends it attaches to), a header band, or a foreign label
  for (const e of model.edges) {
    const rt = routing.routes.get(e.id);
    if (!rt || rt.status === 'unrouted') continue;
    const pts = rt.pts;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      if (p.x !== q.x && p.y !== q.y) errors.push(`diagonal segment in ${e.kind} edge ${name(e.a)} -> ${name(e.b)}`);
      for (const c of cards) {
        const own = c.id === e.a || c.id === e.b;
        // own endpoint cards may be touched at the border only (shrunk interior must stay clear)
        const zone = own ? shrink(c, 1) : grow(c, 3);
        if (segHitsRect(p, q, zone)) errors.push(`${e.kind} edge ${name(e.a)} -> ${name(e.b)} crosses card "${c.model.title}"`);
      }
      for (const c of conts) {
        const band = shrink({ x: c.x, y: c.y, w: c.w, h: c.header.h }, 1);
        if (segHitsRect(p, q, band)) errors.push(`${e.kind} edge ${name(e.a)} -> ${name(e.b)} crosses the header of "${c.model.title}"`);
      }
      for (const r of layout.reserved || []) if (segHitsRect(p, q, r)) errors.push(`${e.kind} edge ${name(e.a)} -> ${name(e.b)} crosses the legend`);
      for (const other of model.edges) {
        const lab = routing.routes.get(other.id)?.label;
        if (lab && other.id !== e.id && segHitsRect(p, q, lab)) errors.push(`${e.kind} edge ${name(e.a)} -> ${name(e.b)} crosses the label "${lab.text}"`);
      }
    }
    // the label of this edge must be on its own line and clear of every card
    if (rt.label) {
      for (const c of cards) if (hit(rt.label, c)) errors.push(`label "${rt.label.text}" overlaps card "${c.model.title}"`);
      for (const c of conts) if (hit(rt.label, { x: c.x, y: c.y, w: c.w, h: c.header.h })) errors.push(`label "${rt.label.text}" overlaps a header`);
    }
  }

  for (const r of layout.reserved || []) for (const c of all) if (hit(r, c)) errors.push(`the legend overlaps "${c.model.title}"`);

  // 2. containment and sibling overlap
  const kids = new Map();
  all.forEach((r) => { if (r.parent) (kids.get(r.parent) || kids.set(r.parent, []).get(r.parent)).push(r); });
  for (const [pid, list] of kids) {
    const P = rects.get(pid);
    const content = { x: P.x, y: P.y + P.header.h, w: P.w, h: P.h - P.header.h };
    for (const k of list) {
      if (k.x < content.x - 0.5 || k.y < content.y - 0.5 || k.x + k.w > content.x + content.w + 0.5 || k.y + k.h > content.y + content.h + 0.5)
        errors.push(`"${k.model.title}" sticks out of "${P.model.title}"`);
    }
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
      if (hit(list[i], list[j])) errors.push(`"${list[i].model.title}" overlaps "${list[j].model.title}"`);
  }
  // header must be wide enough for its own minimum content
  for (const c of conts) if (c.w + 0.5 < c.header.w) errors.push(`header of "${c.model.title}" is wider than its box`);

  // 2b. a line must not run along a container border (it would read as part of the frame)
  const HUG = 8, MINRUN = 24;
  for (const e of model.edges) {
    const rt = routing.routes.get(e.id);
    if (!rt?.pts) continue;
    for (let i = 1; i < rt.pts.length; i++) {
      const p = rt.pts[i - 1], q = rt.pts[i];
      const horiz = p.y === q.y;
      const lo = horiz ? Math.min(p.x, q.x) : Math.min(p.y, q.y), hi = horiz ? Math.max(p.x, q.x) : Math.max(p.y, q.y);
      for (const c of conts) {
        const borders = horiz ? [[c.y, c.x, c.x + c.w], [c.y + c.h, c.x, c.x + c.w]] : [[c.x, c.y, c.y + c.h], [c.x + c.w, c.y, c.y + c.h]];
        for (const [pos, a, b] of borders) {
          const d = Math.abs((horiz ? p.y : p.x) - pos);
          const run = Math.min(hi, b) - Math.max(lo, a);
          const own = c.id === e.a || c.id === e.b;
          if (!own && d < HUG && run > MINRUN) warnings.push(`${e.kind} edge ${name(e.a)} -> ${name(e.b)} runs along the border of "${c.model.title}"`);
        }
      }
    }
  }

  // 3. overlapping parallel lanes (a warning: lines remain readable but share a corridor)
  const segs = [];
  for (const e of model.edges) {
    const rt = routing.routes.get(e.id);
    if (!rt?.pts) continue;
    for (let i = 1; i < rt.pts.length; i++) segs.push({ e: e.id, p: rt.pts[i - 1], q: rt.pts[i] });
  }
  let overlaps = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const a = segs[i], b = segs[j];
    if (a.e === b.e) continue;
    const aH = a.p.y === a.q.y, bH = b.p.y === b.q.y;
    if (aH !== bH) continue;
    if (aH && a.p.y === b.p.y) {
      const ov = Math.min(Math.max(a.p.x, a.q.x), Math.max(b.p.x, b.q.x)) - Math.max(Math.min(a.p.x, a.q.x), Math.min(b.p.x, b.q.x));
      if (ov > 8) overlaps++;
    } else if (!aH && a.p.x === b.p.x) {
      const ov = Math.min(Math.max(a.p.y, a.q.y), Math.max(b.p.y, b.q.y)) - Math.max(Math.min(a.p.y, a.q.y), Math.min(b.p.y, b.q.y));
      if (ov > 8) overlaps++;
    }
  }
  if (overlaps) warnings.push(`${overlaps} overlapping line segment pair(s) share a lane`);

  // 4. edges that could not be drawn cleanly
  const unrouted = model.edges.filter((e) => routing.routes.get(e.id)?.status === 'unrouted');
  unrouted.forEach((e) => warnings.push(`not drawn (no clean path): ${e.kind} ${name(e.a)} -> ${name(e.b)}`));

  return { errors, warnings, unrouted: unrouted.length };
}

// DOM-level text check: every <text> that declares a maximum width must render inside it.
export function auditText(svg) {
  const errors = [];
  svg.querySelectorAll('text[data-maxw]').forEach((t) => {
    const max = parseFloat(t.getAttribute('data-maxw'));
    let w = 0;
    try { w = t.getBBox().width; } catch { return; }
    if (w > max + 0.75) errors.push(`text "${t.textContent.slice(0, 40)}" is ${Math.round(w)}px wide but only ${Math.round(max)}px is available`);
  });
  return errors;
}
