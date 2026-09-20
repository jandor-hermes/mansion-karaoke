import { afterEach, describe, expect, it } from 'vitest';
import { createControlPlane, type ControlPlane } from '../src/index.js';

const videoIds: Record<string, string> = {
    first: 'dQw4w9WgXcQ', second: 'M7lc1UVf-VE', third: '9bZkp7q19f0', fourth: 'kJQP7kiw5Fk',
    next: '3JZ_D3ELwOQ', now: 'ScMzIvxBSi4',
};
const canonicalVideoId = (value: string) => videoIds[value] ?? value;
const item = (videoId: string, itemId = `item-${videoId}`) => ({ videoId: canonicalVideoId(videoId), itemId });

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

    it('returns an authenticated one-scan join URL carrying the party token in its fragment', async () => {
        const plane = await start();
        const response = await request(plane, '/join-info');
        expect(response.status).toBe(200);
        const { joinUrl } = await json(response);
        const parsed = new URL(joinUrl);
        expect(parsed.protocol).toBe('http:');
        expect(parsed.port).toBe(new URL(plane.url).port);
        expect(new URLSearchParams(parsed.hash.slice(1)).get('token')).toBe('test-token');
        expect((await fetch(`${plane.url}/join-info`)).status).toBe(401);
    });

    it('enqueues two videos and emits an idempotent play-next command', async () => {
        const plane = await start();
        const first = await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('first')) });
        expect(first.status).toBe(201);
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('second')) });

        const poll = await request(plane, '/command?after=0');
        const firstPoll = await json(poll);
        expect(firstPoll.command.type).toBe('play');
        expect(firstPoll.command.videoId).toBe(videoIds.first);
        expect(firstPoll.sequence).toBe(1);

        const duplicate = await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('first')) });
        expect(duplicate.status).toBe(200);
        expect((await json(await request(plane, '/status'))).queue).toHaveLength(1);
    });

    it('retains search metadata in queue state without adding it to playback commands', async () => {
        const plane = await start();
        const rich = {
            ...item('first'),
            title: 'First Song',
            channel: 'Singer',
            duration: '3:45',
            thumbnail: 'https://img.example/first.jpg',
            requestedBy: 'Alex',
        };
        const requestItem = { ...rich, clientOnly: 'discard me' };
        expect((await request(plane, '/queue', { method: 'POST', body: JSON.stringify(requestItem) })).status).toBe(201);
        const status = await json(await request(plane, '/status'));
        expect(status.current).toEqual(rich);
        const play = (await json(await request(plane, '/command?after=0'))).command;
        expect(play).toMatchObject({ type: 'play', itemId: rich.itemId, videoId: rich.videoId });
        expect(play).not.toHaveProperty('title');
        expect(play).not.toHaveProperty('channel');
        expect(play).not.toHaveProperty('duration');
        expect(play).not.toHaveProperty('thumbnail');
        expect(play).not.toHaveProperty('requestedBy');
    });

    it('rejects malformed optional queue metadata consistently', async () => {
        const plane = await start();
        for (const field of ['title', 'channel', 'duration', 'thumbnail', 'requestedBy']) {
            const response = await request(plane, '/queue', {
                method: 'POST',
                body: JSON.stringify({ ...item(field, `item-${field}`), [field]: 42 }),
            });
            expect(response.status, field).toBe(400);
        }
        expect((await json(await request(plane, '/status'))).current).toBeNull();
    });

    it('advances on ended, then skip advances to the next queued item', async () => {
        const plane = await start();
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('first')) });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('second')) });
        const play = await json(await request(plane, '/command?after=0'));
        const ended = await request(plane, '/events', { method: 'POST', body: JSON.stringify({ type: 'ended', commandId: play.command.commandId, roomId: 'room-1', sequence: 1, timestamp: 2, itemId: 'item-first', videoId: videoIds.first }) });
        expect(ended.status).toBe(204);
        const next = await json(await request(plane, `/command?after=${play.sequence}`));
        expect(next.command.videoId).toBe(videoIds.second);
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
        expect(status.current.videoId).toBe(videoIds.first);
        expect(status.queue).toEqual([]);
    });
});

describe('phone song actions', () => {
    it('inserts a rich play-next item at the front of the waiting queue', async () => {
        const plane = await start();
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('first')) });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('second')) });
        const nextItem = { ...item('next'), title: 'Next Song', channel: 'Next Singer', duration: '4:01', thumbnail: 'https://img.example/next.jpg' };

        const response = await request(plane, '/queue/next', { method: 'POST', body: JSON.stringify(nextItem) });

        expect(response.status).toBe(201);
        expect(await json(response)).toMatchObject({ current: item('first'), queue: [nextItem, item('second')] });
        expect((await json(await request(plane, '/status'))).queue).toEqual([nextItem, item('second')]);
    });
    it('starts a play-next item immediately while idle', async () => {
        const plane = await start();
        const nextItem = { ...item('next'), title: 'Next Song' };

        const response = await request(plane, '/queue/next', { method: 'POST', body: JSON.stringify(nextItem) });

        expect(response.status).toBe(201);
        expect(await json(response)).toMatchObject({ current: nextItem, queue: [] });
        const play = await json(await request(plane, '/command?after=0'));
        expect(play.command).toMatchObject({ type: 'play', itemId: nextItem.itemId, videoId: nextItem.videoId });
    });
    it('replaces the current song now without changing the waiting queue', async () => {
        const plane = await start();
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('first')) });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('second')) });
        const nowItem = { ...item('now'), title: 'Play Me Now', channel: 'Headliner' };

        const response = await request(plane, '/queue/play-now', { method: 'POST', body: JSON.stringify(nowItem) });

        expect(response.status).toBe(201);
        expect(await json(response)).toMatchObject({ current: nowItem, queue: [item('second')] });
        const interrupt = await json(await request(plane, '/command?after=1'));
        expect(interrupt.command).toMatchObject({ type: 'skip' });
        const nextCommand = await json(await request(plane, `/command?after=${interrupt.sequence}`));
        expect(nextCommand.command).toMatchObject({ type: 'play', itemId: nowItem.itemId, videoId: nowItem.videoId });
        expect(nextCommand.command).not.toHaveProperty('title');
    });
    it('treats duplicate item IDs as idempotent for immediate actions', async () => {
        const plane = await start();
        const first = { ...item('first'), title: 'Original' };
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(first) });

        const playNext = await request(plane, '/queue/next', { method: 'POST', body: JSON.stringify({ ...first, title: 'Changed' }) });
        const playNow = await request(plane, '/queue/play-now', { method: 'POST', body: JSON.stringify({ ...first, title: 'Changed Again' }) });

        expect(playNext.status).toBe(200);
        expect(playNow.status).toBe(200);
        expect(await json(playNow)).toMatchObject({ current: first, queue: [] });
        expect((await json(await request(plane, '/command?after=1'))).command).toBeNull();
    });
});

describe('autosuggestions', () => {
    it('serves at most eight suggestions from an injected adapter', async () => {
        const queries: string[] = [];
        const plane = createControlPlane({
            token: 'test-token',
            roomId: 'room-1',
            suggest: { suggest: async (query: string) => { queries.push(query); return Array.from({ length: 10 }, (_, index) => `${query} ${index}`); } },
        });
        await plane.listen(0);
        planes.push(plane);

        const response = await request(plane, '/suggest?q=queen%20karaoke');

        expect(response.status).toBe(200);
        expect(await json(response)).toEqual({ suggestions: Array.from({ length: 8 }, (_, index) => `queen karaoke ${index}`) });
        expect(queries).toEqual(['queen karaoke']);
    });
    it('leaves /suggest untouched: no karaoke rewrite on queries without the keyword', async () => {
        const queries: string[] = [];
        const plane = createControlPlane({
            token: 'test-token',
            roomId: 'room-1',
            suggest: { suggest: async (query: string) => { queries.push(query); return [`${query} karaoke`]; } },
        });
        await plane.listen(0);
        planes.push(plane);

        const response = await request(plane, '/suggest?q=sweet%20caroline');

        expect(response.status).toBe(200);
        expect(await json(response)).toEqual({ suggestions: ['sweet caroline karaoke'] });
        expect(queries).toEqual(['sweet caroline']);
    });
});

describe('queue history and direct selection', () => {
    it('records completed and skipped songs in newest-first history', async () => {
        const plane = await start();
        const first = { ...item('first'), title: 'First Song' };
        const second = { ...item('second'), title: 'Second Song' };
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(first) });
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(second) });
        const active = await json(await request(plane, '/command?after=0'));
        await request(plane, '/events', { method: 'POST', body: JSON.stringify({ type: 'ended', commandId: active.command.commandId, roomId: 'room-1', sequence: 1, timestamp: 2, itemId: first.itemId, videoId: first.videoId }) });
        await request(plane, '/control/skip', { method: 'POST' });

        const status = await json(await request(plane, '/status'));
        expect(status.history).toEqual([
            { ...second, completedAt: expect.any(Number), reason: 'skipped' },
            { ...first, completedAt: 2, reason: 'ended' },
        ]);
    });

    it('plays a selected queued item without reordering the remaining queue', async () => {
        const plane = await start();
        for (const videoId of ['first', 'second', 'third', 'fourth']) {
            await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item(videoId)) });
        }

        const response = await request(plane, '/queue/play', { method: 'POST', body: JSON.stringify({ itemId: 'item-third' }) });
        expect(response.status).toBe(200);
        const body = await json(response);
        expect(body.current).toEqual(item('third'));
        expect(body.queue).toEqual([item('second'), item('fourth')]);
        expect(body.history[0]).toMatchObject({ ...item('first'), reason: 'replaced' });

        const interrupt = await json(await request(plane, '/command?after=1'));
        expect(interrupt.command.type).toBe('skip');
        const play = await json(await request(plane, `/command?after=${interrupt.sequence}`));
        expect(play.command).toMatchObject({ type: 'play', itemId: 'item-third', videoId: videoIds.third });
    });

    it('rejects direct play for an unknown or currently playing item', async () => {
        const plane = await start();
        await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item('first')) });
        expect((await request(plane, '/queue/play', { method: 'POST', body: JSON.stringify({ itemId: 'missing' }) })).status).toBe(404);
        expect((await request(plane, '/queue/play', { method: 'POST', body: JSON.stringify({ itemId: 'item-first' }) })).status).toBe(409);
    });
});

describe('queue clearing', () => {
    it('clears every waiting item without interrupting the current song or adding history', async () => {
        const plane = await start();
        for (const videoId of ['first', 'second', 'third']) {
            await request(plane, '/queue', { method: 'POST', body: JSON.stringify(item(videoId)) });
        }

        const response = await request(plane, '/queue/clear', { method: 'POST' });
        expect(response.status).toBe(200);
        expect(await json(response)).toEqual({ queue: [] });
        const status = await json(await request(plane, '/status'));
        expect(status.current).toEqual(item('first'));
        expect(status.queue).toEqual([]);
        expect(status.history).toEqual([]);
    });

    it('requires authentication', async () => {
        const plane = await start();
        expect((await fetch(`${plane.url}/queue/clear`, { method: 'POST' })).status).toBe(401);
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
        expect((await json(await request(plane, '/status'))).current.videoId).toBe(videoIds.first);
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
        expect(after.current.videoId).toBe(videoIds.first);
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
        expect((await json(await request(plane, '/status'))).current.videoId).toBe(videoIds.first);
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
