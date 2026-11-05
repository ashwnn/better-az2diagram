// Text measurement and wrapping. Boxes are sized from these numbers, so text can never be clipped.
export const FF = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const SAFETY = 1.05; // slack so a slightly different fallback font in another viewer still fits

let ctx = null;
const cache = new Map();

export function measure(text, size, weight = 400, family = FF) {
  const key = `${weight}|${size}|${family}|${text}`;
  let w = cache.get(key);
  if (w == null) {
    ctx = ctx || document.createElement('canvas').getContext('2d');
    ctx.font = `${weight} ${size}px ${family}`;
    w = ctx.measureText(text).width * SAFETY;
    cache.set(key, w);
  }
  return w;
}

// Break at natural boundaries (spaces, dots, dashes, slashes, underscores) and hard-split
// any single token that is still too wide. Never truncates and never adds an ellipsis.
export function wrap(text, size, weight, maxW, family = FF) {
  text = String(text ?? '');
  if (!text) return [''];
  const tokens = text.match(/[^\s._\-/:]+[\s._\-/:]*|[\s._\-/:]+/g) || [text];
  const lines = [];
  let cur = '';
  const push = () => { if (cur.trim().length) lines.push(cur.replace(/\s+$/, '')); cur = ''; };
  for (let tok of tokens) {
    while (measure(tok.replace(/\s+$/, ''), size, weight, family) > maxW) {
      // hard split an oversized token
      let n = tok.length;
      while (n > 1 && measure(tok.slice(0, n), size, weight, family) > maxW) n--;
      if (cur) push();
      lines.push(tok.slice(0, n));
      tok = tok.slice(n);
      if (!tok) break;
    }
    if (!tok) continue;
    if (cur && measure((cur + tok).replace(/\s+$/, ''), size, weight, family) > maxW) push();
    cur += tok;
  }
  push();
  return lines.length ? lines : [text];
}

export const maxLineWidth = (lines, size, weight, family = FF) =>
  Math.max(0, ...lines.map((l) => measure(l, size, weight, family)));
