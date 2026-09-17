import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(path.join(root, '.github/workflows/macos-app.yml'), 'utf8');
const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
const friendSetup = readFileSync(path.join(root, 'FRIEND_SETUP.md'), 'utf8');
const launcher = readFileSync(path.join(root, 'packaging/macos/Launcher.swift'), 'utf8');
const buildScript = path.join(root, 'packaging/macos/build-app.sh');

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

test('friend setup prefers the easy manifest path and documents a fallback', () => {
  const easyPath = friendSetup.indexOf('Desktop/Mansion Karaoke Extension/manifest.json');
  const picker = friendSetup.indexOf('Select **Load Temporary Add-on…**');
  const fallback = friendSetup.indexOf('select **Reveal Extension** or **Copy Manifest Path**');
  assert.ok(picker >= 0 && easyPath > picker);
  assert.ok(fallback > picker);
});

test('Firefox setup sends the raw internal page through the Firefox executable', () => {
  assert.match(launcher, /appendingPathComponent\("Contents\/MacOS\/firefox"\)/);
  assert.match(launcher, /process\.arguments = \["--new-tab", "about:debugging#\/runtime\/this-firefox"\]/);
  assert.doesNotMatch(launcher, /openApplication\(at: firefox/);
});

test('port conflicts have actionable launcher copy', () => {
  assert.ok(launcher.includes('Port \\(controllerPort) is already in use'));
  assert.match(launcher, /Quit the other controller/);
  assert.match(launcher, /controllerFailureMessage\(from:/);
});

test('build script validates an explicitly selected pinned Bun', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mansion-bun-'));
  const bun = path.join(dir, 'bun');
  writeFileSync(bun, '#!/bin/sh\nprintf "1.3.13\\n"\n');
  chmodSync(bun, 0o755);
  try {
    const result = spawnSync('/bin/bash', [buildScript, '--check-bun'], {
      env: { ...process.env, BUN_BIN: bun }, encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Using Bun:/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('build script rejects a Bun version other than the release pin', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mansion-bun-'));
  const bun = path.join(dir, 'bun');
  writeFileSync(bun, '#!/bin/sh\nprintf "1.4.2\\n"\n');
  chmodSync(bun, 0o755);
  try {
    const result = spawnSync('/bin/bash', [buildScript, '--check-bun'], {
      env: { ...process.env, BUN_BIN: bun }, encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires Bun 1\.3\.13/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('launcher exposes a stable user-owned manifest path with copy-path fallback', () => {
  assert.match(launcher, /Desktop.*Mansion Karaoke Extension/s);
  assert.match(launcher, /createSymbolicLink/);
  assert.match(launcher, /isSymbolicLink/);
  assert.match(launcher, /withIntermediateDirectories: false/);
  assert.match(launcher, /Copy Manifest Path/);
  assert.match(launcher, /#selector\(copyManifestPath\)/);
  assert.doesNotMatch(launcher, /Bundle\.main\.bundleURL.*write|write.*Bundle\.main\.bundleURL/s);
});
