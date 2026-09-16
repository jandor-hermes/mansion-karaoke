import { describe, expect, it, vi } from 'vitest';
import { startBackground } from '../src/background';

describe('background lifecycle', () => {
    it('fast-forwards to the current server sequence when no durable cursor exists', async () => {
        const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ command: null, sequence: 12 }), { status: 200 }));
        const browserApi = {
            tabs: { get: vi.fn(), create: vi.fn(), update: vi.fn(), sendMessage: vi.fn(), onRemoved: { addListener: vi.fn() } },
            runtime: { sendMessage: vi.fn(), onMessage: { addListener: vi.fn() } },
            storage: {
                local: {
                    get: vi.fn().mockResolvedValue({ baseUrl: 'http://127.0.0.1:3010', token: 'token' }),
                    set: vi.fn(),
                },
                onChanged: { addListener: vi.fn() },
            },
        } as any;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = fetcher;
        try {
            const background = await startBackground(browserApi);
            await background.poll();
            expect(fetcher.mock.calls[0][0]).toContain('/command?after=9007199254740991');
            expect(browserApi.storage.local.set).toHaveBeenCalledWith({ commandCursor: 12 });
            background.stop();
        } finally { globalThis.fetch = originalFetch; }
    });

    it('restores and advances a durable command cursor across reloads', async () => {
        const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ command: null, sequence: 9 }), { status: 200 }));
        const browserApi = {
            tabs: { get: vi.fn(), create: vi.fn(), update: vi.fn(), sendMessage: vi.fn(), onRemoved: { addListener: vi.fn() } },
            runtime: { sendMessage: vi.fn(), onMessage: { addListener: vi.fn() } },
            storage: {
                local: {
                    get: vi.fn().mockResolvedValue({ baseUrl: 'http://127.0.0.1:3010', token: 'token', commandCursor: 7 }),
                    set: vi.fn(),
                },
                onChanged: { addListener: vi.fn() },
            },
        } as any;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = fetcher;
        try {
            const background = await startBackground(browserApi);
            await background.poll();
            expect(fetcher.mock.calls[0][0]).toContain('/command?after=7');
            expect(browserApi.storage.local.set).toHaveBeenCalledWith({ commandCursor: 9 });
            background.stop();
        } finally { globalThis.fetch = originalFetch; }
    });

    it('detects a restarted controller and consumes its new lower-sequence command', async () => {
        const play = { type: 'play', commandId: 'new-server-command', roomId: 'r1', issuedAt: 1, itemId: 'i1', videoId: 'dQw4w9WgXcQ', position: 0 };
        const fetcher = vi.fn()
            .mockImplementationOnce(async () => new Response(JSON.stringify({ command: null, sequence: 1 }), { status: 200 }))
            .mockImplementationOnce(async () => new Response(JSON.stringify({ command: play, sequence: 1 }), { status: 200 }));
        const browserApi = {
            tabs: { get: vi.fn(), create: vi.fn().mockResolvedValue({ id: 41 }), update: vi.fn(), sendMessage: vi.fn(), onRemoved: { addListener: vi.fn() } },
            runtime: { sendMessage: vi.fn(), onMessage: { addListener: vi.fn() } },
            storage: {
                local: {
                    get: vi.fn().mockResolvedValue({ baseUrl: 'http://127.0.0.1:3010', token: 'token', commandCursor: 14 }),
                    set: vi.fn(),
                },
                onChanged: { addListener: vi.fn() },
            },
        } as any;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = fetcher;
        try {
            const background = await startBackground(browserApi);
            await background.poll();
            expect(fetcher.mock.calls[0][0]).toContain('/command?after=14');
            expect(fetcher.mock.calls[1][0]).toContain('/command?after=0');
            expect(browserApi.tabs.create).toHaveBeenCalledWith({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', active: true });
            expect(browserApi.storage.local.set).toHaveBeenLastCalledWith({ commandCursor: 1 });
            background.stop();
        } finally { globalThis.fetch = originalFetch; }
    });

    it('starts polling after a token is saved and never creates duplicate timers', async () => {
        const onMessage: Array<(message: unknown) => void> = [];
        const onChanged: Array<(changes: Record<string, { newValue?: unknown }>) => void> = [];
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ command: null, sequence: 0 }), { status: 200 }));
        const browserApi = {
            tabs: { get: vi.fn(), create: vi.fn(), update: vi.fn(), sendMessage: vi.fn(), onRemoved: { addListener: vi.fn() } },
            runtime: { sendMessage: vi.fn(), onMessage: { addListener: (listener: (message: unknown) => void) => onMessage.push(listener) } },
            storage: {
                local: { get: vi.fn().mockResolvedValue({ baseUrl: 'http://127.0.0.1:3010', token: '' }), set: vi.fn() },
                onChanged: { addListener: (listener: (changes: Record<string, { newValue?: unknown }>) => void) => onChanged.push(listener) },
            },
        } as any;
        const timers = vi.spyOn(globalThis, 'setInterval');
        const background = await startBackground(browserApi);
        expect(timers).not.toHaveBeenCalled();
        browserApi.storage.local.get.mockResolvedValue({ baseUrl: 'http://127.0.0.1:3010', token: 'new-token' });
        await onChanged[0]({ token: { newValue: 'new-token' } });
        expect(timers).toHaveBeenCalledTimes(1);
        await onChanged[0]({ token: { newValue: 'new-token' } });
        expect(timers).toHaveBeenCalledTimes(2);
        background.stop();
        timers.mockRestore();
        void fetcher;
    });
});
