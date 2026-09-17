import { describe, expect, it, vi } from 'vitest';
import { startBackground } from '../src/background';

const activePlay = { type: 'play' as const, commandId: 'generation-1', roomId: 'room-1', issuedAt: 1, itemId: 'item-1', videoId: 'dQw4w9WgXcQ', position: 12 };
const config = { baseUrl: 'http://127.0.0.1:3010', token: 'token' };
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function browserApi(overrides: Record<string, unknown> = {}) {
    return {
        tabs: { query: vi.fn().mockResolvedValue([]), get: vi.fn(), create: vi.fn().mockResolvedValue({ id: 55, windowId: 9 }), update: vi.fn(), sendMessage: vi.fn(), onRemoved: { addListener: vi.fn() } },
        runtime: { getURL: vi.fn((path: string) => `moz-extension://test/${path}`), sendMessage: vi.fn(), onMessage: { addListener: vi.fn() } },
        storage: { local: { get: vi.fn().mockResolvedValue(config), set: vi.fn() }, onChanged: { addListener: vi.fn() } },
        ...overrides,
    } as any;
}

describe('background lifecycle', () => {
    it('opens a join screen immediately when configured but no dedicated player tab exists', async () => {
        const browser = browserApi();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(async (url) => String(url).endsWith('/status')
            ? response({ instanceId: 'instance-1', sequence: 0, activeCommand: null, desiredPaused: false, playback: { volume: .75 } })
            : response({ instanceId: 'instance-1', command: null, sequence: 0 }));
        try {
            const background = await startBackground(browser);
            await background.poll();
            expect(browser.tabs.create).toHaveBeenCalledWith({ url: 'moz-extension://test/display.html', active: true });
            expect(background.state).toMatchObject({ tabId: 55, windowId: 9 });
            background.stop();
        } finally { globalThis.fetch = originalFetch; }
    });

    it('does not adopt an arbitrary YouTube tab without stored ownership or a karaoke marker', async () => {
        const browser = browserApi({ tabs: { query: vi.fn().mockResolvedValue([{ id: 66, windowId: 10, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }]), get: vi.fn(), create: vi.fn().mockResolvedValue({ id: 55, windowId: 9 }), update: vi.fn(), sendMessage: vi.fn(), onRemoved: { addListener: vi.fn() } } });
        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(async (url) => String(url).endsWith('/status')
            ? response({ instanceId: 'instance-1', sequence: 0, activeCommand: null, desiredPaused: false, playback: { volume: .75 } })
            : response({ instanceId: 'instance-1', command: null, sequence: 0 }));
        try {
            const background = await startBackground(browser);
            await background.poll();
            expect(browser.tabs.create).toHaveBeenCalledWith({ url: 'moz-extension://test/display.html', active: true });
            expect(background.state.tabId).toBe(55);
            background.stop();
        } finally { globalThis.fetch = originalFetch; }
    });

    it('reuses the stored dedicated player tab rather than creating a duplicate surface', async () => {
        const browser = browserApi({
            tabs: { query: vi.fn().mockResolvedValue([{ id: 66, windowId: 10, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }]), get: vi.fn(), create: vi.fn(), update: vi.fn(), sendMessage: vi.fn(), onRemoved: { addListener: vi.fn() } },
            storage: { local: { get: vi.fn().mockResolvedValue({ ...config, playerTabId: 66 }), set: vi.fn() }, onChanged: { addListener: vi.fn() } },
        });
        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(async (url) => String(url).endsWith('/status')
            ? response({ instanceId: 'instance-1', sequence: 0, activeCommand: null, desiredPaused: false, playback: { volume: .75 } })
            : response({ instanceId: 'instance-1', command: null, sequence: 0 }));
        try {
            const background = await startBackground(browser);
            await background.poll();
            expect(browser.tabs.create).not.toHaveBeenCalled();
            expect(background.state).toMatchObject({ tabId: 66, windowId: 10 });
            background.stop();
        } finally { globalThis.fetch = originalFetch; }
    });

    it('reconciles the latest active status at startup instead of replaying historical commands', async () => {
        const browser = browserApi();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(async (url) => String(url).endsWith('/status')
            ? response({ instanceId: 'instance-1', sequence: 9, activeCommand: activePlay, desiredPaused: true, playback: { volume: .4 } })
            : response({ instanceId: 'instance-1', command: null, sequence: 9 }));
        try {
            const background = await startBackground(browser);
            await background.poll();
            const url = browser.tabs.create.mock.calls.at(-1)?.[0].url ?? browser.tabs.update.mock.calls.at(-1)?.[1].url;
            expect(new URL(url).searchParams.get('v')).toBe(activePlay.videoId);
            expect(background.state).toMatchObject({ commandId: activePlay.commandId, itemId: activePlay.itemId, desiredPaused: true, volume: .4 });
            expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/status'), expect.anything());
            expect(browser.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({ commandCursor: 9, controllerInstanceId: 'instance-1' }));
            background.stop();
        } finally { globalThis.fetch = originalFetch; }
    });

    it('reapplies disconnected pause and volume intent to a matching player document', async () => {
        const browser = browserApi({
            tabs: { query: vi.fn().mockResolvedValue([{ id: 66, windowId: 10, url: `https://www.youtube.com/watch?v=${activePlay.videoId}#karaoke=owned` }]), get: vi.fn(), create: vi.fn(), update: vi.fn(), sendMessage: vi.fn().mockResolvedValue({ ...activePlay, type: 'playing', position: 20 }), onRemoved: { addListener: vi.fn() } },
            storage: { local: { get: vi.fn().mockResolvedValue({ ...config, playerTabId: 66 }), set: vi.fn() }, onChanged: { addListener: vi.fn() } },
        });
        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(async (url) => String(url).endsWith('/status')
            ? response({ instanceId: 'instance-1', sequence: 9, activeCommand: activePlay, desiredPaused: true, playback: { volume: .2 } })
            : String(url).endsWith('/events') ? new Response(null, { status: 204 }) : response({ instanceId: 'instance-1', command: null, sequence: 9 }));
        try {
            const background = await startBackground(browser);
            await background.poll();
            expect(browser.tabs.sendMessage).toHaveBeenCalledWith(66, { type: 'setVolume', volume: .2 });
            expect(browser.tabs.sendMessage).toHaveBeenCalledWith(66, { type: 'pause' });
            background.stop();
        } finally { globalThis.fetch = originalFetch; }
    });

    it('starts a session from the extension popup with newly supplied configuration', async () => {
        const listeners: Array<(message: unknown) => unknown> = [];
        const browser = browserApi({
            runtime: { getURL: vi.fn((path: string) => `moz-extension://test/${path}`), sendMessage: vi.fn(), onMessage: { addListener: (listener: (message: unknown) => unknown) => listeners.push(listener) } },
            storage: { local: { get: vi.fn().mockResolvedValue({ ...config, token: '' }), set: vi.fn() }, onChanged: { addListener: vi.fn() } },
            tabs: { query: vi.fn().mockResolvedValue([]), get: vi.fn(), create: vi.fn().mockResolvedValue({ id: 72, windowId: 12 }), update: vi.fn(), sendMessage: vi.fn(), onRemoved: { addListener: vi.fn() } },
        });
        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(async (url) => String(url).endsWith('/status')
            ? response({ instanceId: 'instance-1', sequence: 0, activeCommand: null, desiredPaused: false, playback: { volume: .75 } })
            : response({ instanceId: 'instance-1', command: null, sequence: 0 }));
        try {
            const background = await startBackground(browser);
            const result = await listeners[0]({ type: 'startSession', config: { ...config, token: 'new-token' } });
            expect(result).toEqual({ ok: true, tabId: 72 });
            expect(browser.tabs.create).toHaveBeenCalledWith({ url: 'moz-extension://test/display.html', active: true });
            background.stop();
        } finally { globalThis.fetch = originalFetch; }
    });

    it('does not create another polling timer when storage repeats the same configuration', async () => {
        const onChanged: Array<(changes: Record<string, { newValue?: unknown }>) => void> = [];
        const browser = browserApi({
            storage: { local: { get: vi.fn().mockResolvedValue({ ...config, token: '' }), set: vi.fn() }, onChanged: { addListener: (listener: (changes: Record<string, { newValue?: unknown }>) => void) => onChanged.push(listener) } },
        });
        const timers = vi.spyOn(globalThis, 'setInterval');
        const background = await startBackground(browser);
        expect(timers).not.toHaveBeenCalled();
        browser.storage.local.get.mockResolvedValue(config);
        await onChanged[0]({ token: { newValue: config.token } });
        expect(timers).toHaveBeenCalledTimes(1);
        await onChanged[0]({ token: { newValue: config.token } });
        expect(timers).toHaveBeenCalledTimes(1);
        background.stop();
        timers.mockRestore();
    });
});
