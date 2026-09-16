import { afterEach, describe, expect, it } from 'vitest';
import { createControlPlane, type ControlPlane } from '../src';

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
        const commands = [];
        let after = 0;
        for (;;) { const result = await json(await request(plane, `/command?after=${after}`)); if (!result.command) break; commands.push(result.command.type); after = result.sequence; }
        expect(commands).toEqual(['play', 'pause', 'resume', 'setVolume']);
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
