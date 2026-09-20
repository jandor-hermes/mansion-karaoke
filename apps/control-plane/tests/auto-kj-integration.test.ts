import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createControlPlane, type ControlPlane } from '../src/index.js';

let planes: ControlPlane[] = [];
afterEach(async () => { await Promise.all(planes.splice(0).map((plane) => plane.close())); });

async function start(options: Partial<Parameters<typeof createControlPlane>[0]> = {}) {
    const plane = createControlPlane({ token: 'test-token', roomId: 'room-1', ...options });
    await plane.listen(0);
    planes.push(plane);
    return plane;
}

async function request(plane: ControlPlane, path: string, init: RequestInit = {}) {
    return fetch(`${plane.url}${path}`, {
        ...init,
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
}

async function json(response: Response) { return response.json() as Promise<any>; }

const song = (name: string, requestedBy: string) => ({
    itemId: `item-${name}`,
    videoId: 'dQw4w9WgXcQ',
    title: `Song ${name}`,
    requestedBy,
});

/** Plays the current item to completion via the extension event path. */
async function endCurrent(plane: ControlPlane) {
    const status = await json(await request(plane, '/status'));
    const commandId = status.activeCommand?.commandId;
    expect(commandId).toBeTruthy();
    await request(plane, '/events', {
        method: 'POST',
        body: JSON.stringify({ type: 'ended', commandId, roomId: 'room-1', sequence: 1, timestamp: 2, itemId: status.current.itemId, videoId: status.current.videoId }),
    });
}

const queueSingers = (status: any) => status.queue.map((item: any) => item.requestedBy);

describe('Auto-KJ integration', () => {
    it('enqueues with Auto-KJ placement and returns the visible position', async () => {
        const plane = await start();
        const first = await json(await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('a1', 'Jordan')) }));
        expect(first).toMatchObject({ position: 0, placement: 'auto', playing: true });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('a2', 'Jordan')) });
        const a3 = await json(await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('a3', 'Jordan')) }));
        const b1 = await json(await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('b1', 'Athena')) }));
        expect(b1.position).toBe(0);
        expect(b1.placement).toBe('auto');
        expect(a3.position).toBe(1);
        const status = await json(await request(plane, '/status'));
        expect(status.autoKj).toEqual({ enabled: true });
        expect(queueSingers(status)).toEqual(['Athena', 'Jordan', 'Jordan']);
    });

    it('advances so a waiting different singer plays before an automatic repeat', async () => {
        const plane = await start();
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('j1', 'Jordan')) });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('j2', 'Jordan')) });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('j3', 'Jordan')) });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('at1', 'Athena')) });
        expect(queueSingers(await json(await request(plane, '/status')))).toEqual(['Athena', 'Jordan', 'Jordan']);
        await endCurrent(plane); // newcomer bump: Athena plays before Jordan's repeats
        expect((await json(await request(plane, '/status'))).current.requestedBy).toBe('Athena');
        await endCurrent(plane);
        expect((await json(await request(plane, '/status'))).current.requestedBy).toBe('Jordan');
    });

    it('the playback guard repairs a Jordan-run created while Auto-KJ was off', async () => {
        const plane = await start({ autoKjEnabled: false });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('j1', 'Jordan')) });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('j2', 'Jordan')) });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('j3', 'Jordan')) });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('at1', 'Athena')) });
        expect(queueSingers(await json(await request(plane, '/status')))).toEqual(['Jordan', 'Jordan', 'Athena']);
        await request(plane, '/control/auto-kj', { method: 'POST', body: JSON.stringify({ enabled: true }) });
        await endCurrent(plane); // front is an automatic Jordan repeat with Athena waiting → promote Athena
        expect((await json(await request(plane, '/status'))).current.requestedBy).toBe('Athena');
        await endCurrent(plane);
        expect((await json(await request(plane, '/status'))).current.requestedBy).toBe('Jordan');
    });

    it('marks manual moves and never jumps over a manually placed next item', async () => {
        const plane = await start();
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('j1', 'Jordan')) });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('j2', 'Jordan')) });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('at1', 'Athena')) });
        // Host manually moves Athena's song behind Jordan's second song.
        const moved = await json(await request(plane, '/queue/move', { method: 'POST', body: JSON.stringify({ itemId: 'item-at1', position: 1 }) }));
        expect(moved.queue.map((item: any) => item.placement)).toEqual(['auto', 'manual']);
        await endCurrent(plane); // Jordan j1
        expect((await json(await request(plane, '/status'))).current.requestedBy).toBe('Jordan');
        expect(queueSingers(await json(await request(plane, '/status')))).toEqual(['Athena']);
        await endCurrent(plane); // front is Athena (different singer) → plays normally
        expect((await json(await request(plane, '/status'))).current.requestedBy).toBe('Athena');
        expect(queueSingers(await json(await request(plane, '/status')))).toEqual([]);
    });

    it('Play next inserts at the front as a manual override', async () => {
        const plane = await start();
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('j1', 'Jordan')) });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('j2', 'Jordan')) });
        await request(plane, '/queue/next', { method: 'POST', body: JSON.stringify(song('at1', 'Athena')) });
        const status = await json(await request(plane, '/status'));
        expect(queueSingers(status)).toEqual(['Athena', 'Jordan']);
        expect(status.queue[0].placement).toBe('manual');
    });

    it('kill-switch default off appends to the end and the toggle endpoint still works', async () => {
        const plane = await start({ autoKjEnabled: false });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('j1', 'Jordan')) });
        const a1 = await json(await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('a1', 'Athena')) }));
        const j2 = await json(await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('j2', 'Jordan')) }));
        expect([a1.position, j2.position]).toEqual([0, 1]);
        expect(a1.placement).toBe('off');
        const status = await json(await request(plane, '/status'));
        expect(status.autoKj).toEqual({ enabled: false });
        expect(queueSingers(status)).toEqual(['Athena', 'Jordan']);
        // Host re-enables at runtime.
        await request(plane, '/control/auto-kj', { method: 'POST', body: JSON.stringify({ enabled: true }) });
        const b1 = await json(await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song('b1', 'Bea')) }));
        expect(b1.placement).toBe('auto');
        expect(b1.position).toBe(1);
        const rejected = await request(plane, '/control/auto-kj', { method: 'POST', body: JSON.stringify({ enabled: 'yes' }) });
        expect(rejected.status).toBe(400);
    });

    it('rejects unauthenticated toggle requests and persists the host choice across restarts', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'auto-kj-'));
        const stateFile = join(dir, 'nested', 'auto-kj.json');
        const first = await start({ autoKjStateFile: stateFile });
        expect((await fetch(`${first.url}/control/auto-kj`, { method: 'POST', body: JSON.stringify({ enabled: false }) })).status).toBe(401);
        const toggled = await request(first, '/control/auto-kj', { method: 'POST', body: JSON.stringify({ enabled: false }) });
        expect(await json(toggled)).toEqual({ autoKj: { enabled: false } });
        await planes.splice(0).map((plane) => plane.close());
        // A restart with KARAOKE_AUTO_KJ unset (default on) honors the persisted off choice.
        const second = await start({ autoKjEnabled: true, autoKjStateFile: stateFile });
        expect((await json(await request(second, '/status'))).autoKj).toEqual({ enabled: false });
    });

    it('plays a complete multi-singer rotation sequence in fair order', async () => {
        const plane = await start();
        const singers: Array<[string, string]> = [['j1', 'Jordan'], ['j2', 'Jordan'], ['a1', 'Athena'], ['c1', 'Casey'], ['j3', 'Jordan'], ['c2', 'Casey']];
        const positions: number[] = [];
        for (const [name, who] of singers) {
            const result = await json(await request(plane, '/queue', { method: 'POST', body: JSON.stringify(song(name, who)) }));
            positions.push(result.position);
        }
        // The first add starts playing immediately when the queue is empty.
        const status = await json(await request(plane, '/status'));
        expect(queueSingers(status)).toEqual(['Athena', 'Casey', 'Jordan', 'Casey', 'Jordan']);
        expect(positions).toEqual([0, 0, 0, 1, 3, 3]);
        expect(status.current.requestedBy).toBe('Jordan');
        // Drain the queue and record the play order.
        const order: string[] = ['Jordan'];
        for (let i = 0; i < 5; i++) {
            await endCurrent(plane);
            order.push((await json(await request(plane, '/status'))).current.requestedBy);
        }
        expect(order).toEqual(['Jordan', 'Athena', 'Casey', 'Jordan', 'Casey', 'Jordan']);
    });
});
