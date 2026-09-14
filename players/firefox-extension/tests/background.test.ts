import { describe, expect, it, vi } from 'vitest';
import { startBackground } from '../src/background';

describe('background lifecycle', () => {
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
