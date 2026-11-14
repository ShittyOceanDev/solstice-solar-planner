import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const web = new URL('../web/', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
const options = {
  absWorkingDir: fileURLToPath(web),
  alias: {three: fileURLToPath(new URL('vendor/three.module.js', web))},
  bundle: true,
  minify: true,
  charset: 'utf8',
  write: false,
};

const portableRuntime = {
  name: 'portable-runtime',
  setup(builder) {
    builder.onLoad({filter: /[\\/]runtime\.js$/}, () => ({
      contents: 'export const HOSTED = false;\nexport const BROWSER_DOWNLOADS = true;\n',
    }));
  },
};

function read(name) {
  return readFile(new URL(name, web), 'utf8');
}

async function bundle(entry, format, plugins = []) {
  const {outputFiles} = await build({...options, entryPoints: [entry], format, plugins});
  return outputFiles[0].text.trim();
}

function replace(html, pattern, replacement) {
  if (!pattern.test(html)) throw Error(`Could not find ${pattern} in the page template.`);
  return html.replace(pattern, () => replacement);
}

const [template, styles, onboarding, license, vendorLicense, app, worker] = await Promise.all([
  read('index.html'), read('styles.css'), read('onboarding.css'),
  readFile(new URL('../LICENSE', import.meta.url), 'utf8'), read('vendor/LICENSE'),
  bundle('app.js', 'esm', [portableRuntime]), bundle('worker.js', 'iife'),
]);

const script = `\n${app}\n`;
const hash = createHash('sha256').update(script).digest('base64');
const policy = [
  "default-src 'none'",
  `script-src 'sha256-${hash}'`,
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'worker-src blob:',
  'connect-src https://archive-api.open-meteo.com https://overpass.private.coffee https://overpass-api.de https://api.openstreetmap.org',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

let html = replace(template, /<link rel="icon"/, `<meta http-equiv="Content-Security-Policy" content="${policy}">\n  <link rel="icon"`);
html = replace(html, /<link rel="stylesheet" href="\/styles\.css">/, `<style>\n${styles}</style>`);
html = replace(html, /<link rel="stylesheet" href="\/onboarding\.css">/, `<style>\n${onboarding}</style>`);
html = replace(html, /<script type="importmap">[^<]*<\/script>\s*/, '');
html = replace(html, /class="brand" href="\/"/, 'class="brand" href="#"');
html = replace(html, /<script type="module" src="\/app\.js\?[^"\s]+"><\/script>/,
  `<!-- Solstice solar planner\n${license.trim()}\n-->\n  ` +
  `<!-- Three.js and OrbitControls\n${vendorLicense.trim()}\n-->\n  ` +
  `<script id="portable-worker" type="text/plain">\n${worker}\n</script>\n  ` +
  `<script type="module">${script}</script>`);

await mkdir(dist, {recursive: true});
await writeFile(new URL('solstice-portable.html', dist), html);
console.log(`dist/solstice-portable.html (${Buffer.byteLength(html).toLocaleString('en-US')} bytes)`);
