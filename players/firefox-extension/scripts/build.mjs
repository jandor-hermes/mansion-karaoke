import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const extensionDir = path.resolve(new URL('..', import.meta.url).pathname);
const rootDir = path.resolve(extensionDir, '..', '..');
const require = createRequire(import.meta.url);
let build;
try {
  ({ build } = require('esbuild'));
} catch {
  // Bun's linker keeps dependencies under .bun in this repository checkout.
  ({ build } = require(path.join(rootDir, 'node_modules/.bun/esbuild@0.28.1/node_modules/esbuild')));
}
const distDir = path.join(extensionDir, 'dist');

await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(distDir, { recursive: true });
for (const entry of ['background', 'content', 'options', 'page-bridge', 'display']) {
  await build({
    entryPoints: [path.join(extensionDir, 'src', `${entry}.ts`)],
    outfile: path.join(distDir, `${entry}.js`),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'firefox109',
    sourcemap: false,
    minify: false,
    logLevel: 'warning',
  });
}
await fs.copyFile(path.join(extensionDir, 'manifest.json'), path.join(distDir, 'manifest.json'));
await fs.copyFile(path.join(extensionDir, 'options.html'), path.join(distDir, 'options.html'));
await fs.copyFile(path.join(extensionDir, 'display.html'), path.join(distDir, 'display.html'));
console.log(`built Firefox extension into ${path.relative(process.cwd(), distDir)}`);
