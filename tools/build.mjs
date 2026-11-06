// Bundles the app into ONE self-contained HTML file (no network needed to open it).
//   node tools/build.mjs                      -> dist/index.html   (viewer, drop a snapshot or try the sample)
//   node tools/build.mjs inventory.json       -> dist/inventory.html (snapshot embedded, opens straight to the diagram)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2];

const js = await build({
  entryPoints: [join(root, 'src/main.js')], bundle: true, minify: true, write: false,
  format: 'iife', target: 'es2020', legalComments: 'none', loader: { '.json': 'json' },
});
const code = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(root, 'src/style.css'), 'utf8');
let html = readFileSync(join(root, 'src/template.html'), 'utf8');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const tag = (id, json) => `<script type="application/json" id="${id}">${json.replace(/</g, '\\u003c')}</script>`;

let out;
if (input) {
  const data = JSON.stringify(readJson(input));
  html = html.replace('<!--__DATA__-->', () => tag('atlas-data', data)).replace('<!--__SAMPLE__-->', '');
  out = join(root, 'dist', basename(input).replace(/\.json$/i, '') + '.html');
} else {
  const sample = JSON.stringify(readJson(join(root, 'sample/inventory.json')));
  html = html.replace('<!--__DATA__-->', '').replace('<!--__SAMPLE__-->', () => tag('atlas-sample', sample));
  out = join(root, 'dist', 'index.html');
}
html = html.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => code);
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
