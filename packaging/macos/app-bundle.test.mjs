import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const buildCwd = path.join(root, 'packaging', 'macos');
const output = path.join(buildCwd, `.test-output-${process.pid}`);
const app = path.join(output, 'Mansion Karaoke.app');
const launcher = path.join(app, 'Contents', 'MacOS', 'Mansion Karaoke');
const controller = path.join(app, 'Contents', 'Resources', 'mansion-controller');
const extensionManifest = path.join(app, 'Contents', 'Resources', 'firefox-extension', 'manifest.json');
let controllerProcess;

before(() => {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  const relativeOutput = path.relative(buildCwd, output);
  const result = spawnSync('/bin/bash', ['./build-app.sh', '--output', relativeOutput, '--arch', arch], {
    cwd: buildCwd,
    encoding: 'utf8',
    timeout: 300_000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

after(() => {
  if (controllerProcess && controllerProcess.exitCode === null) controllerProcess.kill('SIGTERM');
  rmSync(output, { force: true, recursive: true });
});

test('build produces a branded macOS application bundle', () => {
  const expectedArchitecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  const plist = spawnSync('/usr/bin/plutil', ['-extract', 'CFBundleDisplayName', 'raw', '-o', '-', path.join(app, 'Contents', 'Info.plist')], {
    encoding: 'utf8',
  });
  assert.equal(plist.status, 0, plist.stderr);
  assert.equal(plist.stdout.trim(), 'Mansion Karaoke');

  const iconName = spawnSync('/usr/bin/plutil', ['-extract', 'CFBundleIconName', 'raw', '-o', '-', path.join(app, 'Contents', 'Info.plist')], {
    encoding: 'utf8',
  });
  assert.equal(iconName.status, 0, iconName.stderr);
  assert.equal(iconName.stdout.trim(), 'AppIcon');
  assert.equal(statSync(path.join(app, 'Contents', 'Resources', 'AppIcon.icns')).size > 0, true);

  const manifest = JSON.parse(readFileSync(extensionManifest, 'utf8'));
  assert.equal(manifest.name, 'Mansion Karaoke Firefox Player');

  for (const executable of [launcher, controller]) {
    const file = spawnSync('/usr/bin/file', [executable], { encoding: 'utf8' });
    assert.equal(file.status, 0, file.stderr);
    assert.match(file.stdout, /Mach-O 64-bit executable/);
    assert.match(file.stdout, new RegExp(expectedArchitecture));
  }
});

test('launcher self-test finds its packaged resources', () => {
  const result = spawnSync(launcher, ['--self-test'], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, MANSION_KARAOKE_PORT: '4321' },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.bundleIdentifier, 'com.mansionkaraoke.host');
  assert.equal(report.controllerPort, 4321);
  assert.equal(report.controllerExecutable, true);
  assert.equal(report.extensionManifest, true);
});

test('launcher replaces a legacy token with a short readable token and starts a fresh bounded log', () => {
  const support = path.join(output, 'support-test');
  mkdirSync(support);
  const token = path.join(support, 'party-token');
  const log = path.join(support, 'controller.log');
  writeFileSync(token, '0123456789abcdef0123456789abcdef0123456789abcdef\n');
  chmodSync(token, 0o644);
  writeFileSync(log, Buffer.alloc(2 * 1024 * 1024, 65));

  const result = spawnSync(launcher, ['--self-test'], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, MANSION_KARAOKE_SELF_TEST_SUPPORT_DIR: support },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(statSync(token).mode & 0o777, 0o600);
  assert.match(readFileSync(token, 'utf8').trim(), /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(statSync(log).size, 0);
});

test('launcher preserves an existing current-format party token', () => {
  const support = path.join(output, 'current-token-test');
  mkdirSync(support);
  const token = path.join(support, 'party-token');
  writeFileSync(token, 'ABCDEFG2\n');

  const result = spawnSync(launcher, ['--self-test'], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, MANSION_KARAOKE_SELF_TEST_SUPPORT_DIR: support },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(token, 'utf8').trim(), 'ABCDEFG2');
});

test('launcher classifies a bind race as an actionable port conflict', () => {
  const support = path.join(output, 'bind-race-test');
  mkdirSync(support);
  writeFileSync(path.join(support, 'controller.log'), 'error: Failed to start server. Is port 4321 in use?\n');

  const result = spawnSync(launcher, ['--self-test'], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      MANSION_KARAOKE_PORT: '4321',
      MANSION_KARAOKE_SELF_TEST_FAILURE_DIR: support,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.match(report.controllerFailureMessage, /Port 4321 is already in use/);
});

test('launcher detects an occupied controller port before startup', async () => {
  const port = 40_000 + (process.pid % 500);
  const blocker = createServer();
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(port, '127.0.0.1', resolve);
  });
  try {
    const result = spawnSync(launcher, ['--self-test'], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, MANSION_KARAOKE_PORT: String(port) },
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.controllerPortAvailable, false);
  } finally {
    await new Promise((resolve, reject) => blocker.close((error) => error ? reject(error) : resolve()));
  }
});

test('packaged controller serves authenticated status', async () => {
  const port = 39_000 + (process.pid % 500);
  const token = 'packaged-controller-test-token';
  controllerProcess = spawn(controller, [], {
    env: { ...process.env, PORT: String(port), KARAOKE_TOKEN: token, KARAOKE_ROOM_ID: 'package-test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let response;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.ok(response?.ok, 'packaged controller did not become ready');
  const status = await response.json();
  assert.equal(status.roomId, 'package-test');
  assert.deepEqual(status.queue, []);
});
