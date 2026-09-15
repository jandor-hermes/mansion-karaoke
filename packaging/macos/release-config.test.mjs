import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(path.join(root, '.github/workflows/macos-app.yml'), 'utf8');
const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
const friendSetup = readFileSync(path.join(root, 'FRIEND_SETUP.md'), 'utf8');

test('workflow installs the root and standalone Firefox dependency graphs', () => {
  assert.match(workflow, /run: \|\n\s+bun install --no-save\n\s+bun install --cwd players\/firefox-extension --no-save/);
  assert.doesNotMatch(workflow, /bun install --frozen-lockfile/);
});

test('workflow requires the exact thin architecture for both executables', () => {
  const architectureAssertions = workflow.match(/\[\[ "\$\(lipo -archs '[^']+'\)" == '\$\{\{ matrix\.arch \}\}' \]\]/g) ?? [];
  assert.equal(architectureAssertions.length, 2);
  assert.doesNotMatch(workflow, /file .*grep.*matrix\.arch/);
});

test('release step can safely rerun for an existing tag', () => {
  assert.match(workflow, /gh release view "\$GITHUB_REF_NAME"/);
  assert.match(workflow, /gh release upload "\$GITHUB_REF_NAME"[\s\S]*--clobber/);
});

test('README accurately describes the private-beta signature', () => {
  assert.match(readme, /ad-hoc signed, not Developer ID signed, and not notarized/);
  assert.doesNotMatch(readme, /app is unsigned/);
});

test('friend setup reveals the extension before opening the file picker', () => {
  const reveal = friendSetup.indexOf('Select **Reveal Extension**');
  const picker = friendSetup.indexOf('Select **Load Temporary Add-on…**');
  assert.ok(reveal >= 0 && picker >= 0 && reveal < picker);
});
