import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionDir = fileURLToPath(new URL('..', import.meta.url));
const distDir = path.join(extensionDir, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));

const referenced = [
  ...(manifest.background?.scripts ?? []),
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
  ...(manifest.web_accessible_resources ?? []),
  ...(manifest.options_ui?.page ? [manifest.options_ui.page] : []),
  ...(manifest.browser_action?.default_popup ? [manifest.browser_action.default_popup] : []),
  'display.html',
  'display.js',
  'popup.js',
];
assert.ok(referenced.length > 0, 'manifest must reference generated assets');
assert.ok(manifest.options_ui?.page, 'manifest must reference the options page');
assert.ok(fs.existsSync(path.join(distDir, manifest.options_ui.page)), 'missing generated options page');
assert.ok(fs.existsSync(path.join(distDir, 'display.html')), 'missing generated display page');
assert.ok(fs.existsSync(path.join(distDir, 'popup.js')), 'missing generated popup script');
for (const relativePath of referenced) {
  assert.ok(!path.isAbsolute(relativePath), `manifest path must be relative: ${relativePath}`);
  assert.ok(fs.existsSync(path.join(distDir, relativePath)), `missing generated asset: ${relativePath}`);
}

const generated = referenced.map((relativePath) => fs.readFileSync(path.join(distDir, relativePath), 'utf8')).join('\n');
for (const secretPattern of [/session-token/i, /bearer\s+[A-Za-z0-9._~-]{12,}/i, /(?:api[_-]?key|password|secret)\s*[:=]\s*['"][^'"]+['"]/i]) {
  assert.ok(!secretPattern.test(generated), `possible embedded secret: ${secretPattern}`);
}
assert.match(generated, /Authorization/);
console.log(`verified ${referenced.length} manifest assets in ${path.relative(process.cwd(), distDir)}; no embedded secrets detected`);
