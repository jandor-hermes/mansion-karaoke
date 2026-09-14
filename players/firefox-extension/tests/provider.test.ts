import { describe, expect, it, vi } from 'vitest';

import {
    CommandRouter,
    createControllerClient,
    createInitialPlayerState,
    type BrowserTabs,
    type PlayerState,
} from '../src';

describe('Firefox command router', () => {
    it('creates one dedicated tab and reuses it for play commands', async () => {
        const tabs: BrowserTabs = {
            get: vi.fn().mockResolvedValue({ id: 41 }),
            create: vi.fn().mockResolvedValue({ id: 41 }),
            update: vi.fn().mockResolvedValue({ id: 41 }),
        };
        const router = new CommandRouter(tabs);
        const state = createInitialPlayerState();
        const play = { type: 'play' as const, commandId: 'c1', roomId: 'r1', issuedAt: 1, itemId: 'i1', videoId: 'abc', position: 4 };

        await router.route(play, state);
        await router.route({ ...play, commandId: 'c2', videoId: 'def' }, state);

        expect(tabs.create).toHaveBeenCalledTimes(1);
        expect(tabs.update).toHaveBeenCalledWith(41, { url: 'https://www.youtube.com/watch?v=def', active: true });
        expect(state.tabId).toBe(41);
    });

    it('routes controls to the content tab and reports skipped state', async () => {
        const sendMessage = vi.fn().mockResolvedValue(undefined);
        const router = new CommandRouter({ get: vi.fn(), create: vi.fn(), update: vi.fn() }, sendMessage);
        const state: PlayerState = { ...createInitialPlayerState(), tabId: 9, itemId: 'i1', videoId: 'abc' };

        await router.route({ type: 'pause', commandId: 'c1', roomId: 'r1', issuedAt: 1 }, state);
        await router.route({ type: 'resume', commandId: 'c2', roomId: 'r1', issuedAt: 2 }, state);
        await router.route({ type: 'setVolume', commandId: 'c3', roomId: 'r1', issuedAt: 3, volume: 0.5 }, state);
        await router.route({ type: 'skip', commandId: 'c4', roomId: 'r1', issuedAt: 4 }, state);

        expect(sendMessage.mock.calls.map(([tab, message]) => [tab, message.type])).toEqual([
            [9, 'pause'], [9, 'resume'], [9, 'setVolume'],
        ]);
        expect(state.status).toBe('ended');
    });
});

describe('loopback controller client', () => {
    it('uses the configured loopback URL and session token for polling and events', async () => {
        const fetcher = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ command: null }), { status: 200 }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }));
        const client = createControllerClient({ baseUrl: 'http://127.0.0.1:3010/', token: 'session-token', fetcher });

        await client.poll(7);
        await client.publish({ type: 'ready', roomId: 'r1', sequence: 1, timestamp: 2, itemId: 'i1', videoId: 'abc' });

        expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:3010/command?after=7');
        expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer session-token');
        expect(fetcher.mock.calls[1][0]).toBe('http://127.0.0.1:3010/events');
    });
});
