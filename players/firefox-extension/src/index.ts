import { playbackCommandSchema, playbackEventSchema, type PlaybackCommand, type PlaybackEvent } from '../../../packages/playback-protocol/src';
import { parseLoadVideoResult, type LoadVideoCommand, type LoadVideoResult } from './load-video';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
export type PlayerState = { tabId: number | null; windowId?: number | null; itemId?: string; videoId?: string; roomId?: string; status: PlayerStatus };
export type BrowserTabs = { get(id: number): Promise<{ id?: number; windowId?: number }>; create(options: { url: string; active: boolean }): Promise<{ id?: number; windowId?: number }>; update(id: number, options: { url?: string; active?: boolean }): Promise<unknown>; sendMessage?: (tabId: number, message: unknown) => Promise<unknown> };
export type BrowserWindows = { update(id: number, options: { state: 'fullscreen' }): Promise<unknown> };
export type ContentCommand =
    | { type: 'pause' | 'resume' | 'fullscreen' }
    | { type: 'setVolume'; volume: number }
    | LoadVideoCommand;
export type SendMessage = (tabId: number, message: ContentCommand) => Promise<unknown>;

function isVerifiedLoad(result: unknown, videoId: string): result is LoadVideoResult {
    const value = parseLoadVideoResult(result);
    return value?.ok === true && value.videoId === videoId;
}

export const createInitialPlayerState = (): PlayerState => ({ tabId: null, windowId: null, status: 'idle' });

const debug = (...args: unknown[]) => console.debug('[karaoke-player]', ...args);

export class CommandRouter {
    constructor(
        private readonly tabs: BrowserTabs,
        private readonly sendMessage: SendMessage = async () => undefined,
        private readonly windows?: BrowserWindows,
        private readonly loadTimeoutMs = 2500,
    ) {}

    private async sendLoadVideo(tabId: number, videoId: string, position: number): Promise<unknown> {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                this.sendMessage(tabId, { type: 'loadVideo', videoId, position }),
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('same-document load timed out')), this.loadTimeoutMs);
                }),
            ]);
        } finally {
            if (timeout !== undefined) clearTimeout(timeout);
        }
    }

    async route(input: unknown, state: PlayerState): Promise<void> {
        const command = playbackCommandSchema.parse(input);
        debug('command received', { type: command.type, sequence: state.status, videoId: command.type === 'play' ? command.videoId : state.videoId });
        if (command.type === 'play') {
            const url = `https://www.youtube.com/watch?v=${encodeURIComponent(command.videoId)}`;
            if (state.tabId === null) {
                const tab = await this.tabs.create({ url, active: true });
                state.tabId = tab.id ?? null;
                state.windowId = tab.windowId ?? null;
                console.debug('[karaoke-player] created YouTube tab', { tabId: state.tabId, windowId: state.windowId, url });
            } else {
                try {
                    const existing = await this.tabs.get(state.tabId);
                    state.windowId = existing.windowId ?? state.windowId ?? null;
                } catch (error) {
                    console.debug('[karaoke-player] existing tab unavailable; creating YouTube tab', { error });
                    const tab = await this.tabs.create({ url, active: true });
                    state.tabId = tab.id ?? null;
                    state.windowId = tab.windowId ?? null;
                    state.itemId = command.itemId;
                    state.videoId = command.videoId;
                    state.roomId = command.roomId;
                    state.status = 'loading';
                    return;
                }
                state.itemId = command.itemId;
                state.videoId = command.videoId;
                state.roomId = command.roomId;
                state.status = 'loading';
                console.debug('[karaoke-player] reusing YouTube tab', { tabId: state.tabId, windowId: state.windowId });
                try {
                    const result = await this.sendLoadVideo(state.tabId, command.videoId, command.position);
                    if (isVerifiedLoad(result, command.videoId)) return;
                } catch (error) {
                    console.debug('[karaoke-player] same-document load failed; using full navigation', { error });
                }
                await this.tabs.update(state.tabId, { url, active: true });
            }
            state.itemId = command.itemId; state.videoId = command.videoId; state.roomId = command.roomId; state.status = 'loading';
            return;
        }
        if (command.type === 'skip') { state.status = 'ended'; debug('skip applied'); return; }
        if (command.type === 'fullscreen') {
            if (state.tabId === null) { console.error('[karaoke-player] fullscreen failed: player tab unavailable'); return; }
            try { await this.sendMessage(state.tabId, { type: 'fullscreen' }); debug('video presentation applied', { tabId: state.tabId }); }
            catch (error) { console.error('[karaoke-player] video presentation failed', { tabId: state.tabId, error }); }
            if (state.windowId != null && this.windows) {
                try { await this.windows.update(state.windowId, { state: 'fullscreen' }); debug('window fullscreen applied', { windowId: state.windowId }); }
                catch (error) { console.error('[karaoke-player] window fullscreen failed', { windowId: state.windowId, error }); }
            }
            return;
        }
        if (state.tabId === null) return;
        if (command.type === 'pause' || command.type === 'resume') await this.sendMessage(state.tabId, { type: command.type });
        if (command.type === 'setVolume') await this.sendMessage(state.tabId, { type: 'setVolume', volume: command.volume });
    }
}

type Fetcher = typeof fetch;
export function createControllerClient(options: { baseUrl: string; token: string; fetcher?: Fetcher }) {
    const baseUrl = options.baseUrl.replace(/\/$/, '');
    const fetcher = options.fetcher ?? fetch;
    const headers = { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' };
    return {
        async joinInfo() {
            const response = await fetcher(`${baseUrl}/join-info`, { headers, cache: 'no-store' });
            if (!response.ok) throw new Error(`Join info failed: ${response.status}`);
            const payload: unknown = await response.json();
            if (!payload || typeof payload !== 'object' || typeof (payload as { joinUrl?: unknown }).joinUrl !== 'string') throw new Error('Malformed join info response');
            return payload as { joinUrl: string };
        },
        async poll(after: number) {
            const response = await fetcher(`${baseUrl}/command?after=${after}`, { headers, cache: 'no-store' });
            if (!response.ok) throw new Error(`Controller poll failed: ${response.status}`);
            const payload: unknown = await response.json();
            if (!payload || typeof payload !== 'object' || !('command' in payload) || !('sequence' in payload)) throw new Error('Malformed controller response');
            const value = payload as { command: unknown; sequence: unknown };
            if (value.command !== null) playbackCommandSchema.parse(value.command);
            if (typeof value.sequence !== 'number' || !Number.isInteger(value.sequence) || value.sequence < 0) throw new Error('Malformed controller response');
            return { command: value.command as PlaybackCommand | null, sequence: value.sequence };
        },
        async publish(event: PlaybackEvent) {
            const valid = playbackEventSchema.parse(event);
            return fetcher(`${baseUrl}/events`, { method: 'POST', headers, body: JSON.stringify(valid) });
        },
    };
}
