import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const app = resolve(import.meta.dirname, '..');
const token = 'integration-test-token';
let server: ChildProcess;
let baseUrl = '';

beforeAll(async () => {
  execFileSync('node', ['scripts/build.mjs'], { cwd: app, stdio: 'pipe' });
  server = spawn(process.execPath, ['dist/apps/control-plane/src/server.js'], {
    cwd: app,
    env: { ...process.env, KARAOKE_TOKEN: token, KARAOKE_ROOM_ID: 'integration-room', PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = readFileSync(resolve(app, 'dist/apps/control-plane/src/server.js'), 'utf8');
  expect(output).toContain('createControlPlane');
  const chunks: Buffer[] = [];
  server.stdout!.on('data', (chunk) => chunks.push(chunk));
  await new Promise<void>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${Buffer.concat(chunks)}`)), 5000);
    server.stdout!.on('data', () => {
      const match = Buffer.concat(chunks).toString().match(/control-plane listening at (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); baseUrl = match[1]; resolveReady(); }
    });
    server.once('exit', (code) => reject(new Error(`server exited: ${code}`)));
  });
});

afterAll(async () => { server.kill(); await once(server, 'exit').catch(() => undefined); });

const request = (path: string, init: RequestInit = {}) => fetch(`${baseUrl}${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
});
const json = (response: Response) => response.json() as Promise<any>;

describe('standalone control-plane process', () => {
  it('authenticates, enqueues, polls play, and accepts ended', async () => {
    expect((await fetch(`${baseUrl}/status`)).status).toBe(401);
    expect((await request('/queue', { method: 'POST', body: JSON.stringify({ itemId: 'integration-item', videoId: 'integration-video' }) })).status).toBe(201);
    const play = await json(await request('/command?after=0'));
    expect(play.command).toMatchObject({ type: 'play', videoId: 'integration-video' });
    expect((await request('/events', { method: 'POST', body: JSON.stringify({ type: 'ended', roomId: 'integration-room', sequence: play.sequence, timestamp: Date.now(), itemId: 'integration-item', videoId: 'integration-video' }) })).status).toBe(204);
    expect((await json(await request('/status'))).current).toBeNull();
  });
});
