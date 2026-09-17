import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'karaoke-dev.sh');

function run(args = [], env = process.env) {
  return spawnSync('/bin/bash', [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
}

test('--help documents the prepare and start workflow', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /prepare/);
  assert.match(result.stdout, /start/);
  assert.match(result.stdout, /run/);
});

test('unknown commands fail with a useful error', () => {
  const result = run(['bogus']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown command: bogus/);
  assert.match(result.stderr, /--help/);
});

test('doctor discovers Bun in the default user install directory', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'karaoke-dev-home-'));
  const bin = path.join(home, '.bun', 'bin');
  mkdirSync(bin, { recursive: true });
  for (const command of ['bun', 'node']) {
    const target = path.join(bin, command);
    writeFileSync(target, '#!/bin/sh\nexit 0\n');
    chmodSync(target, 0o755);
  }

  const result = run(['doctor'], { HOME: home, PATH: '/usr/bin:/bin' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`Bun: ${path.join(bin, 'bun')}`));
  assert.match(result.stdout, new RegExp(`Node: ${path.join(bin, 'node')}`));
});

test('prepare installs from the repository without rewriting its lockfile', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'karaoke-dev-prepare-'));
  const bin = path.join(home, '.bun', 'bin');
  const log = path.join(home, 'commands.log');
  mkdirSync(bin, { recursive: true });
  for (const command of ['bun', 'node']) {
    const target = path.join(bin, command);
    writeFileSync(target, command === 'bun'
      ? `#!/bin/sh\nif [ "$1" = "--version" ]; then printf '1.3.13\\n'; exit 0; fi\nprintf '%s %s\\n' '${command}' "$*" >> "$COMMAND_LOG"\n`
      : `#!/bin/sh\nprintf '%s %s\\n' '${command}' "$*" >> "$COMMAND_LOG"\n`);
    chmodSync(target, 0o755);
  }

  const result = run(['prepare'], { HOME: home, PATH: '/usr/bin:/bin', COMMAND_LOG: log });
  assert.equal(result.status, 0, result.stderr);
  const commands = readFileSync(log, 'utf8');
  assert.match(commands, /^bun install --no-save$/m);
  assert.match(commands, /^bun install --cwd players\/firefox-extension --no-save$/m);
});

test('start prints a controller URL using the configured port', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'karaoke-dev-start-'));
  const bin = path.join(home, '.bun', 'bin');
  mkdirSync(bin, { recursive: true });
  const node = path.join(bin, 'node');
  writeFileSync(node, '#!/bin/sh\nexit 0\n');
  chmodSync(node, 0o755);

  const result = run(['start'], {
    HOME: home,
    PATH: '/usr/bin:/bin',
    KARAOKE_TOKEN: 'test-token',
    PORT: '4321',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Controller URL: http:\/\/127\.0\.0\.1:4321/);
});
