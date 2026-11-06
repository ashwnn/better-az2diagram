// Figma-friendly SVG. Figma's SVG importer ignores most of what the normal export relies on (CSS classes, var(),
// <use>/<symbol>, pathLength, multi-line <tspan>), so this flattens the diagram into plain presentation attributes
// and gives every group a readable id, which Figma shows as the layer name. The result can be dropped on a Figma
// canvas, or pasted from the clipboard as SVG code, and every card, line, label and icon stays editable.
const SVGNS = 'http://www.w3.org/2000/svg';
const FONT = 'Inter';
const FONT_MONO = 'Roboto Mono';
const SHAPES = new Set(['rect', 'path', 'circle', 'line', 'ellipse', 'polygon', 'polyline']);

const hex2 = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
function paint(v) {
  if (!v || v === 'none') return null;
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (!m) return { c: v, a: 1 };
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return { c: '#' + p.slice(0, 3).map(hex2).join(''), a: p.length > 3 ? p[3] : 1 };
}
const num = (v) => +parseFloat(v).toFixed(3);

const suffixIds = (html, n) => html
  .replace(/\bid="([^"]+)"/g, (_, i) => `id="${i}-${n}"`)
  .replace(/url\(#([^)]+)\)/g, (_, i) => `url(#${i}-${n})`)
  .replace(/(xlink:)?href="#([^"]+)"/g, (_, x, i) => `${x || ''}href="#${i}-${n}"`);

function dropShadowFilter(id, r) {
  const f = document.createElementNS(SVGNS, 'filter');
  const set = { id, x: r.x - 24, y: r.y - 24, width: r.w + 48, height: r.h + 56, filterUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' };
  for (const k in set) f.setAttribute(k, set[k]);
  const shadow = (prev, dy, blur, op, out) => `<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>` +
    `<feOffset dy="${dy}"/><feGaussianBlur stdDeviation="${blur}"/><feComposite in2="hardAlpha" operator="out"/>` +
    `<feColorMatrix type="matrix" values="0 0 0 0 0.059 0 0 0 0 0.09 0 0 0 0 0.165 0 0 0 ${op} 0"/>` +
    `<feBlend mode="normal" in2="${prev}" result="${out}"/>`;
  f.innerHTML = `<feFlood flood-opacity="0" result="BackgroundImageFix"/>` + shadow('BackgroundImageFix', 1, 1.2, 0.07, 'effect1_dropShadow') +
    shadow('effect1_dropShadow', 6, 7, 0.06, 'effect2_dropShadow') + `<feBlend mode="normal" in="SourceGraphic" in2="effect2_dropShadow" result="shape"/>`;
  return f;
}

// svg: the live diagram svg. ctx: { size:{W,H}, background:string|null, fams, label(kind, dataId) -> layer name }
export function figmaSVGString(svg, ctx) {
  const { W, H } = ctx.size;
  const c = svg.cloneNode(true);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;width:10px;height:10px;overflow:hidden;visibility:hidden;pointer-events:none';
  host.append(c);
  document.body.append(host);
  try {
    c.setAttribute('viewBox', `0 0 ${W} ${H}`); c.setAttribute('width', W); c.setAttribute('height', H);
    c.classList.remove('focus', 'searching');
    c.querySelector('#viewport').removeAttribute('transform');
    c.querySelectorAll('.rel,.sel,.match').forEach((n) => n.classList.remove('rel', 'sel', 'match'));
    Object.entries(ctx.fams).forEach(([k, on]) => { if (!on) c.querySelectorAll('.fam-' + k).forEach((n) => n.remove()); });
    c.querySelectorAll('.hit, title').forEach((n) => n.remove());
    const defs = c.querySelector('defs');

    // 1. plain-text lines: one <text> per line (Figma does not honour tspan dy reliably)
    c.querySelectorAll('text').forEach((t) => {
      const spans = [...t.children].filter((k) => k.tagName === 'tspan');
      if (!spans.length) return;
      let y = parseFloat(t.getAttribute('y')) || 0;
      spans.forEach((sp, i) => {
        y += parseFloat(sp.getAttribute('dy')) || 0;
        const n = t.cloneNode(false);
        n.setAttribute('x', sp.getAttribute('x') ?? t.getAttribute('x')); n.setAttribute('y', y);
        n.textContent = sp.textContent;
        t.before(n);
      });
      t.remove();
    });

    // 2. <use> -> inline icon geometry
    let uid = 0;
    c.querySelectorAll('use').forEach((u) => {
      const sym = c.querySelector(`symbol[id="${CSS.escape((u.getAttribute('href') || '').slice(1))}"]`);
      if (!sym) { u.remove(); return; }
      const vb = (sym.getAttribute('viewBox') || '0 0 18 18').split(/\s+/).map(Number);
      const x = +u.getAttribute('x') || 0, y = +u.getAttribute('y') || 0, w = +u.getAttribute('width') || vb[2], hh = +u.getAttribute('height') || vb[3];
      const s = Math.min(w / vb[2], hh / vb[3]);
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('transform', `translate(${num(x + (w - vb[2] * s) / 2 - vb[0] * s)} ${num(y + (hh - vb[3] * s) / 2 - vb[1] * s)}) scale(${num(s)})`);
      g.setAttribute('data-icon', (u.getAttribute('href') || '').slice(4));
      g.innerHTML = suffixIds(sym.innerHTML, ++uid);
      u.replaceWith(g);
    });
    defs.querySelectorAll('symbol').forEach((s) => s.remove());
    defs.querySelectorAll('#shadow').forEach((s) => s.remove());

    // 3. per-card drop shadow in the exact form Figma reads back as a native "drop shadow" effect
    let sh = 0;
    c.querySelectorAll('.card[filter]').forEach((g) => {
      const r = g.querySelector('rect.body'); if (!r) return;
      const id = 'shadow-' + ++sh;
      defs.append(dropShadowFilter(id, { x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height') }));
      g.setAttribute('filter', `url(#${id})`);
    });

    // 4. dashed lines: bake pathLength into real dash lengths
    c.querySelectorAll('path[pathLength]').forEach((p) => {
      let k = 1;
      try { k = p.getTotalLength() / parseFloat(p.getAttribute('pathLength')); } catch { /* keep 1 */ }
      p.__dashScale = Number.isFinite(k) && k > 0 ? k : 1;
      p.removeAttribute('pathLength');
    });

    // 5. layer names (before classes are stripped)
    const used = new Set();
    // unique names for the objects people will look for; generic child layers (Line, Arrowhead...) may repeat
    const name = (el, base, unique = true) => { let n = base.replace(/[<>&"]/g, '').trim() || 'Layer', i = 1; if (unique) { while (used.has(n)) n = `${base} (${++i})`; used.add(n); } el.setAttribute('id', n); };
    c.querySelectorAll('[id]').forEach((el) => { if (!el.closest('defs')) el.removeAttribute('id'); });
    name(c.querySelector('#viewport') || c, 'Diagram');
    const layer = { containers: 'Containers', edges: 'Connections', cards: 'Resources', marks: 'Unrouted link markers', legend: 'Legend' };
    Object.entries(layer).forEach(([k, v]) => { const el = c.querySelector('g.' + k); if (el) name(el, v); });
    c.querySelectorAll('g.ct').forEach((g) => name(g, ctx.label('container', g.dataset.id)));
    c.querySelectorAll('g.card').forEach((g) => {
      name(g, ctx.label('card', g.dataset.id));
      g.querySelector('rect.body')?.setAttribute('data-n', 'Card');
    });
    c.querySelectorAll('g.edge').forEach((g) => name(g, ctx.label('edge', g.dataset.id)));
    c.querySelectorAll('g.mk').forEach((g) => name(g, ctx.label('mark', g.dataset.e)));
    c.querySelectorAll('g[data-icon]').forEach((g) => name(g, 'Icon - ' + g.getAttribute('data-icon'), false));
    c.querySelectorAll('g.chip').forEach((g) => name(g, 'Chip - ' + (g.querySelector('text')?.textContent || ''), false));
    c.querySelectorAll('rect.tile').forEach((r) => name(r, 'Icon tile', false));
    c.querySelectorAll('rect.body').forEach((r) => name(r, 'Card background', false));
    c.querySelectorAll('rect.box').forEach((r) => name(r, 'Container background', false));
    c.querySelectorAll('path.line').forEach((r) => name(r, 'Line', false));
    c.querySelectorAll('path.arrow').forEach((r) => name(r, 'Arrowhead', false));
    c.querySelectorAll('circle.org').forEach((r) => name(r, 'Start dot', false));
    c.querySelectorAll('g.lab').forEach((g) => name(g, 'Label - ' + (g.querySelector('text')?.textContent || ''), false));

    // 6. computed styles -> presentation attributes
    const all = [...c.querySelectorAll('*')].filter((el) => !el.closest('defs') && el !== c);
    for (const el of all) {
      const tag = el.tagName.toLowerCase();
      if (tag !== 'g' && tag !== 'text' && !SHAPES.has(tag)) continue;
      const cs = getComputedStyle(el);
      if (tag === 'g') { if (cs.opacity !== '1') el.setAttribute('opacity', cs.opacity); continue; }
      const own = (a) => el.getAttribute(a);
      if (!String(own('fill') || '').startsWith('url(')) {
        const f = paint(cs.fill);
        if (f) { el.setAttribute('fill', f.c); const fo = f.a * parseFloat(cs.fillOpacity); if (fo < 1) el.setAttribute('fill-opacity', num(fo)); } else el.setAttribute('fill', 'none');
      }
      if (tag !== 'text') {
        const s = paint(cs.stroke);
        if (s && !String(own('stroke') || '').startsWith('url(')) {
          el.setAttribute('stroke', s.c);
          const so = s.a * parseFloat(cs.strokeOpacity); if (so < 1) el.setAttribute('stroke-opacity', num(so));
          el.setAttribute('stroke-width', num(cs.strokeWidth));
          if (cs.strokeLinecap !== 'butt') el.setAttribute('stroke-linecap', cs.strokeLinecap);
          if (cs.strokeLinejoin !== 'miter') el.setAttribute('stroke-linejoin', cs.strokeLinejoin);
          if (cs.strokeDasharray && cs.strokeDasharray !== 'none') {
            const k = el.__dashScale || 1;
            el.setAttribute('stroke-dasharray', cs.strokeDasharray.split(/[\s,]+/).map((v) => num(parseFloat(v) * k)).join(' '));
          }
        } else if (!s) el.removeAttribute('stroke');
        if (cs.opacity !== '1') el.setAttribute('opacity', cs.opacity);
      } else {
        const mono = cs.fontFamily.includes('mono') || cs.fontFamily.includes('Mono') || el.classList.contains('mono');
        el.setAttribute('font-family', mono ? FONT_MONO : FONT);
        el.setAttribute('font-size', num(cs.fontSize));
        el.setAttribute('font-weight', Math.round((parseFloat(cs.fontWeight) || 400) / 100) * 100);
        if (cs.textAnchor && cs.textAnchor !== 'start') el.setAttribute('text-anchor', cs.textAnchor);
        if (cs.letterSpacing && cs.letterSpacing !== 'normal' && parseFloat(cs.letterSpacing)) el.setAttribute('letter-spacing', num(cs.letterSpacing));
        if (cs.opacity !== '1') el.setAttribute('opacity', cs.opacity);
      }
    }

    // 7. strip everything Figma would ignore or choke on
    c.querySelectorAll('*').forEach((el) => {
      el.removeAttribute('class'); el.removeAttribute('style'); el.removeAttribute('data-id'); el.removeAttribute('data-a'); el.removeAttribute('data-b');
      el.removeAttribute('data-e'); el.removeAttribute('data-maxw'); el.removeAttribute('data-icon'); el.removeAttribute('data-n');
      el.removeAttribute('data-w'); el.removeAttribute('data-h');
    });
    c.removeAttribute('class'); c.removeAttribute('data-w'); c.removeAttribute('data-h');
    c.setAttribute('xmlns', SVGNS);
    if (ctx.background) {
      const bg = document.createElementNS(SVGNS, 'rect');
      bg.setAttribute('id', 'Background'); bg.setAttribute('width', W); bg.setAttribute('height', H); bg.setAttribute('fill', ctx.background);
      c.insertBefore(bg, c.querySelector('defs').nextSibling);
    }
    if (!defs.children.length) defs.remove();
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(c);
  } finally {
    host.remove();
  }
}
