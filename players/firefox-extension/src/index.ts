import { playbackCommandSchema, playbackEventSchema, type PlaybackCommand, type PlaybackEvent } from '../../../packages/playback-protocol/src';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
export type PlayerState = { tabId: number | null; itemId?: string; videoId?: string; roomId?: string; status: PlayerStatus };
export type BrowserTabs = { get(id: number): Promise<unknown>; create(options: { url: string; active: boolean }): Promise<{ id?: number }>; update(id: number, options: { url: string; active: boolean }): Promise<unknown>; sendMessage?: (tabId: number, message: unknown) => Promise<unknown> };
export type SendMessage = (tabId: number, message: { type: 'pause' | 'resume' | 'setVolume'; volume?: number }) => Promise<unknown>;

export const createInitialPlayerState = (): PlayerState => ({ tabId: null, status: 'idle' });

export class CommandRouter {
    constructor(private readonly tabs: BrowserTabs, private readonly sendMessage: SendMessage = async () => undefined) {}

    async route(input: unknown, state: PlayerState): Promise<void> {
        const command = playbackCommandSchema.parse(input);
        if (command.type === 'play') {
            const url = `https://www.youtube.com/watch?v=${encodeURIComponent(command.videoId)}`;
            if (state.tabId === null) {
                const tab = await this.tabs.create({ url, active: true });
                state.tabId = tab.id ?? null;
            } else {
                try { await this.tabs.get(state.tabId); await this.tabs.update(state.tabId, { url, active: true }); }
                catch { const tab = await this.tabs.create({ url, active: true }); state.tabId = tab.id ?? null; }
            }
            state.itemId = command.itemId; state.videoId = command.videoId; state.roomId = command.roomId; state.status = 'loading';
            return;
        }
        if (command.type === 'skip') { state.status = 'ended'; return; }
        if (state.tabId === null) return;
        if (command.type === 'pause' || command.type === 'resume' || command.type === 'setVolume') await this.sendMessage(state.tabId, { type: command.type, ...(command.type === 'setVolume' ? { volume: command.volume } : {}) });
    }
}

type Fetcher = typeof fetch;
export function createControllerClient(options: { baseUrl: string; token: string; fetcher?: Fetcher }) {
    const baseUrl = options.baseUrl.replace(/\/$/, '');
    const fetcher = options.fetcher ?? fetch;
    const headers = { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' };
    return {
        async poll(after: number) {
            const response = await fetcher(`${baseUrl}/command?after=${after}`, { headers, cache: 'no-store' });
            if (!response.ok) throw new Error(`Controller poll failed: ${response.status}`);
            return response.json() as Promise<{ command: PlaybackCommand | null }>;
        },
        async publish(event: PlaybackEvent) {
            const valid = playbackEventSchema.parse(event);
            return fetcher(`${baseUrl}/events`, { method: 'POST', headers, body: JSON.stringify(valid) });
        },
    };
}
