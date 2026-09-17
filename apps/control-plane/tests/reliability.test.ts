import { afterEach, expect, it } from 'vitest';
import { createControlPlane, type ControlPlane } from '../src/index.js';
let plane: ControlPlane;
afterEach(async () => { await plane?.close(); });
async function setup() {
 plane = createControlPlane({ token: 't', roomId: 'r' }); await plane.listen(0);
 return async (path: string, body?: unknown) => fetch(plane.url + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
it('rejects noncanonical IDs atomically on every insertion route', async () => {
 const req = await setup();
 for (const path of ['/queue', '/queue/next', '/queue/play-now']) for (const item of [{ itemId: ' x', videoId: 'dQw4w9WgXcQ' }, { itemId: 'x', videoId: 'invalid' }, { itemId: ' ', videoId: 'dQw4w9WgXcQ' }]) expect((await req(path, item)).status).toBe(400);
 expect(await (await req('/status')).json()).toMatchObject({ current: null, queue: [], sequence: 0 });
});
it('exposes authoritative generation, observed state and conditional skip', async () => {
 const req = await setup();
 const initial = await (await req('/status')).json();
 expect(initial.instanceId).toEqual(expect.any(String));
 expect(initial.playback).toEqual({ state: 'idle', error: null, lastSeen: null, volume: .75 });
 await req('/queue', { itemId: 'one', videoId: 'dQw4w9WgXcQ' });
 await req('/queue', { itemId: 'two', videoId: 'M7lc1UVf-VE' });
 const poll = await (await req('/command?after=0')).json();
 expect(poll.instanceId).toBe(initial.instanceId);
 const event = { type: 'playing', roomId: 'r', itemId: 'one', videoId: 'dQw4w9WgXcQ', commandId: poll.command.commandId, sequence: 1, timestamp: 1 };
 for (const wrong of [{ roomId: 'wrong' }, { videoId: 'M7lc1UVf-VE' }, { commandId: 'old' }, { itemId: 'two' }]) expect((await req('/events', { ...event, ...wrong, type: 'ended' })).status).toBe(409);
 expect((await req('/events', event)).status).toBe(204);
 expect((await (await req('/status')).json()).playback).toMatchObject({ state: 'playing', lastSeen: expect.any(Number) });
 await req('/events', { ...event, sequence: 2, type: 'error', code: 'AUTOPLAY', message: 'Blocked' });
 expect((await (await req('/status')).json()).playback).toMatchObject({ state: 'error', error: 'Blocked' });
 expect((await req('/control/skip', { expectedItemId: 'stale' })).status).toBe(409);
 expect((await req('/control/skip', { expectedItemId: 'one' })).status).toBe(204);
 expect((await req('/control/skip', { expectedItemId: 'one' })).status).toBe(409);
 expect((await (await req('/status')).json()).current.itemId).toBe('two');
});
it('does not let delayed lifecycle events overwrite newer playback and clears recovered errors', async () => {
 const req = await setup();
 await req('/queue', { itemId: 'one', videoId: 'dQw4w9WgXcQ' });
 const { command } = await (await req('/command?after=0')).json();
 const event = { ...command, sequence: 10, timestamp: 1, type: 'error', code: 'AUTOPLAY', message: 'Blocked' };
 await req('/events', event);
 await req('/events', { ...event, sequence: 12, type: 'playing' });
 expect((await req('/events', { ...event, sequence: 11, type: 'paused' })).status).toBe(409);
 expect((await (await req('/status')).json()).playback).toMatchObject({ state: 'playing', error: null });
});
it('ignores volume envelope overrides and applies terminal events idempotently', async () => {
 const req = await setup();
 await req('/queue', { itemId: 'one', videoId: 'dQw4w9WgXcQ' });
 const { command } = await (await req('/command?after=0')).json();
 await req('/control/volume', { volume: .4, type: 'skip', roomId: 'bad', commandId: 'evil' });
 expect((await (await req('/command?after=1')).json()).command).toMatchObject({ type: 'setVolume', roomId: 'r', volume: .4 });
 const event = { type: 'ended', roomId: 'r', itemId: 'one', videoId: command.videoId, commandId: command.commandId, sequence: 1, timestamp: 1 };
 expect((await req('/events', event)).status).toBe(204);
 expect((await req('/events', event)).status).toBe(204);
 const status = await (await req('/status')).json();
 expect(status.history).toHaveLength(1);
 expect(status.playback).toMatchObject({ state: 'ended', volume: .4 });
});
