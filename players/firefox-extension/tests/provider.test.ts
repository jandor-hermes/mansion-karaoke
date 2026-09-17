import { describe, expect, it, vi } from 'vitest';

import { CommandRouter, createControllerClient, createInitialPlayerState, type BrowserTabs, type PlayerState } from '../src';

const videoA = 'M7lc1UVf-VE';
const videoB = 'dQw4w9WgXcQ';
const bootstrap = (url: string) => JSON.parse(decodeURIComponent(new URL(url).hash.slice('#karaoke='.length)));

describe('Firefox command router', () => {
    it('switches a subsequent song in the existing document after verified content load', async () => {
        const state = createInitialPlayerState();
        const sendMessage = vi.fn(async (_tabId: number, message: { type: string; videoId?: string }) => {
            expect(state.itemId).toBe('i2');
            expect(state.videoId).toBe(videoB);
            return { ok: true, mode: 'yt-navigate', videoId: message.videoId, fullscreenRetained: true };
        });
        const tabs: BrowserTabs = { get: vi.fn().mockResolvedValue({ id: 41 }), create: vi.fn().mockResolvedValue({ id: 41 }), update: vi.fn().mockResolvedValue({ id: 41 }) };
        const router = new CommandRouter(tabs, sendMessage);
        const play = { type: 'play' as const, commandId: 'c1', roomId: 'r1', issuedAt: 1, itemId: 'i1', videoId: videoA, position: 4 };

        await router.route(play, state);
        await router.route({ ...play, commandId: 'c2', itemId: 'i2', videoId: videoB, position: 7 }, state);

        expect(tabs.create).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith(41, {
            type: 'loadVideo', commandId: 'c2', roomId: 'r1', itemId: 'i2', videoId: videoB, position: 7,
            presentation: true, volume: .75, paused: false,
        });
        expect(tabs.update).not.toHaveBeenCalled();
        expect(state.tabId).toBe(41);
    });

    it('falls back to a full navigation with immutable karaoke bootstrap when same-document loading rejects', async () => {
        const tabs: BrowserTabs = { get: vi.fn().mockResolvedValue({ id: 41 }), create: vi.fn().mockResolvedValue({ id: 41 }), update: vi.fn().mockResolvedValue({ id: 41 }) };
        const router = new CommandRouter(tabs, vi.fn().mockRejectedValue(new Error('content script unavailable')));
        const state: PlayerState = { ...createInitialPlayerState(), tabId: 41, itemId: 'i1', videoId: videoA };

        await router.route({ type: 'play', commandId: 'c2', roomId: 'r1', issuedAt: 2, itemId: 'i2', videoId: videoB, position: 7 }, state);

        const url = (tabs.update as ReturnType<typeof vi.fn>).mock.calls[0][1].url;
        expect(new URL(url).searchParams.get('v')).toBe(videoB);
        expect(bootstrap(url)).toMatchObject({ commandId: 'c2', roomId: 'r1', itemId: 'i2', videoId: videoB, position: 7, presentation: true, volume: .75, paused: false });
        expect(tabs.create).not.toHaveBeenCalled();
    });

    it('falls back to full navigation when same-document loading times out', async () => {
        vi.useFakeTimers();
        try {
            const tabs: BrowserTabs = { get: vi.fn().mockResolvedValue({ id: 41 }), create: vi.fn(), update: vi.fn().mockResolvedValue({ id: 41 }) };
            const router = new CommandRouter(tabs, vi.fn(() => new Promise<never>(() => undefined)), undefined, 25);
            const state: PlayerState = { ...createInitialPlayerState(), tabId: 41 };

            const routed = router.route({ type: 'play', commandId: 'c2', roomId: 'r1', issuedAt: 2, itemId: 'i2', videoId: videoB, position: 7 }, state);
            await vi.advanceTimersByTimeAsync(25);
            await routed;

            const url = (tabs.update as ReturnType<typeof vi.fn>).mock.calls[0][1].url;
            expect(new URL(url).searchParams.get('v')).toBe(videoB);
            expect(bootstrap(url)).toMatchObject({ commandId: 'c2', itemId: 'i2', videoId: videoB });
        } finally { vi.useRealTimers(); }
    });

    it('tracks the dedicated window id for later fullscreen use', async () => {
        const tabs: BrowserTabs = { get: vi.fn().mockResolvedValue({ id: 9, windowId: 77 }), create: vi.fn().mockResolvedValue({ id: 9, windowId: 77 }), update: vi.fn().mockResolvedValue({ id: 9, windowId: 77 }) };
        const windows = { update: vi.fn().mockResolvedValue({ id: 77, state: 'fullscreen' }) };
        const router = new CommandRouter(tabs, vi.fn());
        const state = createInitialPlayerState();
        await router.route({ type: 'play', commandId: 'c1', roomId: 'r1', issuedAt: 1, itemId: 'i1', videoId: videoB, position: 0 }, state);
        await router.route({ type: 'fullscreen', commandId: 'c2', roomId: 'r1', issuedAt: 2 }, state);
        expect(state.windowId).toBe(77);
        expect(windows.update).not.toHaveBeenCalled();
    });

    it('fullscreens the Firefox window and sends presentation mode to the content tab', async () => {
        const tabs: BrowserTabs = { get: vi.fn().mockResolvedValue({ id: 9, windowId: 77 }), create: vi.fn(), update: vi.fn(), sendMessage: vi.fn() };
        const windows = { update: vi.fn().mockResolvedValue({ id: 77, state: 'fullscreen' }) };
        const sendMessage = vi.fn().mockResolvedValue(undefined);
        const router = new CommandRouter(tabs, sendMessage, windows);
        await router.route({ type: 'fullscreen', commandId: 'c3', roomId: 'r1', issuedAt: 3 }, { ...createInitialPlayerState(), tabId: 9, windowId: 77 });
        expect(sendMessage).toHaveBeenCalledWith(9, { type: 'fullscreen' });
        expect(windows.update).toHaveBeenCalledWith(77, { state: 'fullscreen' });
    });

    it('automatically fullscreens the Firefox window for every play command', async () => {
        const tabs: BrowserTabs = { get: vi.fn(), create: vi.fn().mockResolvedValue({ id: 9, windowId: 77 }), update: vi.fn() };
        const windows = { update: vi.fn().mockResolvedValue({ id: 77, state: 'fullscreen' }) };
        const router = new CommandRouter(tabs, vi.fn(), windows);
        const state = createInitialPlayerState();

        await router.route({ type: 'play', commandId: 'c1', roomId: 'r1', issuedAt: 1, itemId: 'i1', videoId: videoB, position: 0 }, state);

        expect(state.presentation).toBe(true);
        expect(bootstrap((tabs.create as ReturnType<typeof vi.fn>).mock.calls[0][0].url)).toMatchObject({ presentation: true });
        expect(windows.update).toHaveBeenCalledWith(77, { state: 'fullscreen' });
    });

    it('reports fullscreen failure when the player tab is unavailable', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const router = new CommandRouter({ get: vi.fn(), create: vi.fn(), update: vi.fn() }, vi.fn());
        await router.route({ type: 'fullscreen', commandId: 'c4', roomId: 'r1', issuedAt: 4 }, createInitialPlayerState());
        expect(errorSpy).toHaveBeenCalledWith('[karaoke-player] fullscreen failed: player tab unavailable');
        errorSpy.mockRestore();
    });

    it('routes controls, then skip clears active identity and reports idle', async () => {
        const sendMessage = vi.fn().mockResolvedValue(undefined);
        const router = new CommandRouter({ get: vi.fn(), create: vi.fn(), update: vi.fn() }, sendMessage);
        const state: PlayerState = { ...createInitialPlayerState(), tabId: 9, commandId: 'active-command', roomId: 'r1', itemId: 'i1', videoId: videoB };

        await router.route({ type: 'pause', commandId: 'c1', roomId: 'r1', issuedAt: 1 }, state);
        await router.route({ type: 'resume', commandId: 'c2', roomId: 'r1', issuedAt: 2 }, state);
        await router.route({ type: 'setVolume', commandId: 'c3', roomId: 'r1', issuedAt: 3, volume: 0.5 }, state);
        await router.route({ type: 'skip', commandId: 'c4', roomId: 'r1', issuedAt: 4 }, state);

        expect(sendMessage.mock.calls.map(([tab, message]) => [tab, message.type])).toEqual([[9, 'pause'], [9, 'resume'], [9, 'setVolume'], [9, 'skip']]);
        expect(state.status).toBe('idle');
        expect(state.commandId).toBeUndefined();
    });
});

describe('loopback controller client', () => {
    it('rejects a malformed controller response before routing it', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ command: { type: 'not-valid' }, sequence: 1 }), { status: 200 }));
        await expect(createControllerClient({ baseUrl: 'http://127.0.0.1:3010', token: 'session-token', fetcher }).poll(0)).rejects.toThrow();
    });

    it('requires instance identity with the durable poll sequence', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ command: null, sequence: 8, instanceId: 'instance-1' }), { status: 200 }));
        await expect(createControllerClient({ baseUrl: 'http://127.0.0.1:3010', token: 'session-token', fetcher }).poll(7)).resolves.toEqual({ command: null, sequence: 8, instanceId: 'instance-1' });
    });

    it('uses the configured loopback URL and session token for polling and events', async () => {
        const fetcher = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ command: null, sequence: 7, instanceId: 'instance-1' }), { status: 200 }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }));
        const client = createControllerClient({ baseUrl: 'http://127.0.0.1:3010/', token: 'session-token', fetcher });
        await client.poll(7);
        await client.publish({ type: 'ready', commandId: 'command-1', roomId: 'r1', sequence: 1, timestamp: 2, itemId: 'i1', videoId: videoB });
        expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:3010/command?after=7');
        expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer session-token');
        expect(fetcher.mock.calls[1][0]).toBe('http://127.0.0.1:3010/events');
    });
});
