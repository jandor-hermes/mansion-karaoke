import { afterEach, describe, expect, it } from 'vitest';
import { createControlPlane, type ControlPlane } from '../src/index.js';

const item = (videoId: string, itemId = `item-${videoId}`) => ({ videoId, itemId });

let planes: ControlPlane[] = [];
afterEach(async () => { await Promise.all(planes.splice(0).map((plane) => plane.close())); });

async function start() {
    const plane = createControlPlane({ token: 'test-token', roomId: 'room-1' });
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

describe('local control-plane vertical slice', () => {
    it('allows the extension preflight and returns CORS headers', async () => {
        const plane = await start();
        const response = await fetch(`${plane.url}/command?after=0`, {
            method: 'OPTIONS',
            headers: {
                Origin: 'moz-extension://local-karaoke-player',
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'authorization',
            },
        });
        expect(response.status).toBe(204);
        expect(response.headers.get('access-control-allow-origin')).toBe('moz-extension://local-karaoke-player');
        expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
    });

    it('enqueues two videos and emits an idempotent play-next command', async () => {
        const plane = await start();
        const first = await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('first')) });
        expect(first.status).toBe(201);
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('second')) });

        const poll = await request(plane, '/command?after=0');
        const firstPoll = await json(poll);
        expect(firstPoll.command.type).toBe('play');
        expect(firstPoll.command.videoId).toBe('first');
        expect(firstPoll.sequence).toBe(1);

        const duplicate = await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('first')) });
        expect(duplicate.status).toBe(200);
        expect((await json(await request(plane, '/status'))).queue).toHaveLength(1);
    });

    it('advances on ended, then skip advances to the next queued item', async () => {
        const plane = await start();
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('first')) });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('second')) });
        const play = await json(await request(plane, '/command?after=0'));
        const ended = await request(plane, '/events', { method: 'POST', body: JSON.stringify({ type: 'ended', roomId: 'room-1', sequence: 1, timestamp: 2, itemId: 'item-first', videoId: 'first' }) });
        expect(ended.status).toBe(204);
        const next = await json(await request(plane, `/command?after=${play.sequence}`));
        expect(next.command.videoId).toBe('second');
        await request(plane, '/control/skip', { method: 'POST' });
        const skipped = await json(await request(plane, `/command?after=${next.sequence}`));
        expect(skipped.command.type).toBe('skip');
        expect((await json(await request(plane, '/status'))).current).toBeNull();
    });

    it('supports pause, resume, volume and rejects unauthenticated access', async () => {
        const plane = await start();
        expect((await fetch(`${plane.url}/status`)).status).toBe(401);
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('first')) });
        for (const action of ['pause', 'resume']) expect((await request(plane, `/control/${action}`, { method: 'POST' })).status).toBe(204);
        expect((await request(plane, '/control/volume', { method: 'POST', body: JSON.stringify({ volume: 0.4 }) })).status).toBe(204);
        expect((await request(plane, '/control/fullscreen', { method: 'POST' })).status).toBe(204);
        const commands = [];
        let after = 0;
        for (;;) { const result = await json(await request(plane, `/command?after=${after}`)); if (!result.command) break; commands.push(result.command.type); after = result.sequence; }
        expect(commands).toEqual(['play', 'pause', 'resume', 'setVolume', 'fullscreen']);
    });

    it('recovers polling after a provider restart without duplicating queue items', async () => {
        const plane = await start();
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('first')) });
        const first = await json(await request(plane, '/command?after=0'));
        const replay = await json(await request(plane, `/command?after=${first.sequence}`));
        expect(replay.command).toBeNull();
        const status = await json(await request(plane, '/status'));
        expect(status.current.videoId).toBe('first');
        expect(status.queue).toEqual([]);
    });
});

describe('queue removal and reordering', () => {
    it('removes the requested queued item and returns the updated queue', async () => {
        const plane = await start();
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('first')) });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('second')) });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('third')) });

        const removal = await request(plane, '/queue/remove', { method: 'POST', body: JSON.stringify({ itemId: 'item-second' }) });
        expect(removal.status).toBe(200);
        const body = await json(removal);
        expect(body.queue).toEqual([item('third')]);
        expect((await json(await request(plane, '/status'))).current.videoId).toBe('first');
        expect((await json(await request(plane, '/status'))).queue).toEqual([item('third')]);
    });

    it('consistently rejects removing a non-existent item', async () => {
        const plane = await start();
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('first')) });
        const first = await request(plane, '/queue/remove', { method: 'POST', body: JSON.stringify({ itemId: 'missing' }) });
        expect([400, 404]).toContain(first.status);
        const second = await request(plane, '/queue/remove', { method: 'POST', body: JSON.stringify({ itemId: 'missing' }) });
        expect(second.status).toBe(first.status);
        expect((await json(await request(plane, '/status'))).queue).toHaveLength(0);
    });

    it('rejects removing the currently playing item without stopping playback', async () => {
        const plane = await start();
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('first')) });
        const before = await json(await request(plane, '/status'));
        const removal = await request(plane, '/queue/remove', { method: 'POST', body: JSON.stringify({ itemId: 'item-first' }) });
        expect([400, 409]).toContain(removal.status);
        const after = await json(await request(plane, '/status'));
        expect(after.current).toEqual(before.current);
        expect(after.current.videoId).toBe('first');
    });

    it('requires auth for the removal endpoint', async () => {
        const plane = await start();
        expect((await fetch(`${plane.url}/queue/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: 'x' }) })).status).toBe(401);
    });

    it('moves a queued item to the requested position and clamps invalid positions', async () => {
        const plane = await start();
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('first')) });
        for (const videoId of ['second', 'third', 'fourth']) await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item(videoId)) });

        const move = await request(plane, '/queue/move', { method: 'POST', body: JSON.stringify({ itemId: 'item-fourth', position: 0 }) });
        expect(move.status).toBe(200);
        expect((await json(move)).queue).toEqual([item('fourth'), item('second'), item('third')]);

        const tooLow = await request(plane, '/queue/move', { method: 'POST', body: JSON.stringify({ itemId: 'item-second', position: -5 }) });
        expect(tooLow.status).toBe(200);
        expect((await json(tooLow)).queue).toEqual([item('second'), item('fourth'), item('third')]);

        const tooHigh = await request(plane, '/queue/move', { method: 'POST', body: JSON.stringify({ itemId: 'item-third', position: 99 }) });
        expect(tooHigh.status).toBe(200);
        expect((await json(tooHigh)).queue).toEqual([item('second'), item('fourth'), item('third')]);
        expect((await json(await request(plane, '/status'))).queue).toEqual([item('second'), item('fourth'), item('third')]);
    });

    it('rejects moving the current item or a non-existent item', async () => {
        const plane = await start();
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('first')) });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('second')) });
        const currentMove = await request(plane, '/queue/move', { method: 'POST', body: JSON.stringify({ itemId: 'item-first', position: 0 }) });
        expect(currentMove.status).toBe(400);
        expect((await json(await request(plane, '/status'))).current.videoId).toBe('first');
        const missingMove = await request(plane, '/queue/move', { method: 'POST', body: JSON.stringify({ itemId: 'missing', position: 0 }) });
        expect(missingMove.status).toBe(400);
    });

    it('rejects malformed removal and move bodies', async () => {
        const plane = await start();
        expect((await request(plane, '/queue/remove', { method: 'POST', body: JSON.stringify({}) })).status).toBe(400);
        expect((await request(plane, '/queue/move', { method: 'POST', body: JSON.stringify({ itemId: 'x' }) })).status).toBe(400);
        expect((await request(plane, '/queue/move', { method: 'POST', body: JSON.stringify({ position: 0 }) })).status).toBe(400);
        expect((await request(plane, '/queue/move', { method: 'POST', body: JSON.stringify({ itemId: 'x', position: 'zero' }) })).status).toBe(400);
    });
});
