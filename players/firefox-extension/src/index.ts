import { playbackCommandSchema, playbackEventSchema, type PlaybackCommand, type PlaybackEvent } from '../../../packages/playback-protocol/src';
import { parseLoadVideoResult, type LoadVideoCommand } from './load-video';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
export type PlaybackIdentity = { commandId: string; roomId: string; itemId: string; videoId: string };
export type PlayerState = Partial<PlaybackIdentity> & { tabId: number | null; windowId?: number | null; status: PlayerStatus; presentation?: boolean; volume?: number; desiredPaused?: boolean };
export type BrowserTabs = { get(id: number): Promise<{ id?: number; windowId?: number }>; create(options: { url: string; active: boolean }): Promise<{ id?: number; windowId?: number }>; update(id: number, options: { url?: string; active?: boolean }): Promise<unknown>; sendMessage?: (tabId: number, message: unknown) => Promise<unknown> };
export type BrowserWindows = { update(id: number, options: { state: 'fullscreen' }): Promise<unknown> };
export type ContentCommand =
    | { type: 'pause' | 'resume' | 'fullscreen' | 'skip' }
    | { type: 'setVolume'; volume: number }
    | (LoadVideoCommand & PlaybackIdentity & { presentation?: boolean; volume?: number; paused?: boolean });
export type SendMessage = (tabId: number, message: ContentCommand) => Promise<unknown>;
export const createInitialPlayerState = (): PlayerState => ({ tabId: null, windowId: null, status: 'idle', volume: .75 });
const debug = (...args: unknown[]) => console.debug('[karaoke-player]', ...args);

export class CommandRouter {
    constructor(private readonly tabs: BrowserTabs, private readonly sendMessage: SendMessage = async () => undefined,
        private readonly windows?: BrowserWindows, private readonly loadTimeoutMs = 8000,
        /** Experimental: when true, play commands leave presentation alone; the host issues explicit fullscreen commands instead. */
        private readonly hostControlsPresentation = false) {}

    private async sendLoadVideo(tabId: number, message: ContentCommand): Promise<unknown> {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([this.sendMessage(tabId, message), new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error('same-document load timed out')), this.loadTimeoutMs);
            })]);
        } finally { if (timeout !== undefined) clearTimeout(timeout); }
    }

    async route(input: unknown, state: PlayerState): Promise<void> {
        const command = playbackCommandSchema.parse(input);
        debug('command received', { type: command.type, commandId: command.commandId });
        if (command.type === 'play') {
            const identity = { commandId: command.commandId, itemId: command.itemId, videoId: command.videoId, roomId: command.roomId };
            const presentation = !this.hostControlsPresentation;
            Object.assign(state, identity, { status: 'loading', presentation: state.presentation || presentation });
            const volume = state.volume ?? .75;
            const paused = state.desiredPaused ?? false;
            // Immutable document bootstrap: old documents cannot ask for a new identity.
            const bootstrap = { ...command, presentation, volume, paused };
            const url = `https://www.youtube.com/watch?v=${command.videoId}#karaoke=${encodeURIComponent(JSON.stringify(bootstrap))}`;
            if (state.tabId !== null) {
                try {
                    const existing = await this.tabs.get(state.tabId);
                    state.windowId = existing.windowId ?? state.windowId ?? null;
                } catch { state.tabId = null; }
            }
            if (state.tabId === null) {
                const tab = await this.tabs.create({ url, active: true });
                state.tabId = tab.id ?? null; state.windowId = tab.windowId ?? null;
                debug('play navigation created', { commandId: command.commandId, tabId: state.tabId, windowId: state.windowId });
                if (!this.hostControlsPresentation && state.windowId != null && this.windows) {
                    try { await this.windows.update(state.windowId, { state: 'fullscreen' }); debug('play window presentation applied', { commandId: command.commandId, windowId: state.windowId }); }
                    catch (error) { console.error('[karaoke-player] Firefox window fullscreen failed', error); }
                }
                return;
            }
            try {
                const result = parseLoadVideoResult(await this.sendLoadVideo(state.tabId, { type: 'loadVideo', ...identity, position: command.position, presentation, volume, paused }));
                if (result?.ok && result.videoId === command.videoId) {
                    debug('play applied in existing document', { commandId: command.commandId, videoId: result.videoId, mode: result.mode });
                    if (!this.hostControlsPresentation && state.windowId != null && this.windows) await this.windows.update(state.windowId, { state: 'fullscreen' });
                    return;
                }
            } catch (error) { debug('same-document load failed; using full navigation', { error }); }
            await this.tabs.update(state.tabId, { url, active: true });
            debug('play full navigation applied', { commandId: command.commandId, tabId: state.tabId });
            if (!this.hostControlsPresentation && state.windowId != null && this.windows) await this.windows.update(state.windowId, { state: 'fullscreen' });
            return;
        }
        if (command.type === 'skip') {
            // Retire first, even when messaging fails. Late events must not advance anything.
            delete state.commandId; delete state.itemId; delete state.videoId; delete state.roomId;
            state.status = 'idle'; state.desiredPaused = false;
            if (state.tabId !== null) await this.sendMessage(state.tabId, { type: 'skip' });
            return;
        }
        if (command.type === 'fullscreen') {
            state.presentation = true;
            if (state.tabId === null) { console.error('[karaoke-player] fullscreen failed: player tab unavailable'); return; }
            try { await this.sendMessage(state.tabId, { type: 'fullscreen' }); }
            catch (error) { console.error('[karaoke-player] video presentation failed', error); }
            if (state.windowId != null && this.windows) await this.windows.update(state.windowId, { state: 'fullscreen' });
            return;
        }
        if (command.type === 'setVolume') state.volume = command.volume;
        if (command.type === 'pause' || command.type === 'resume') state.desiredPaused = command.type === 'pause';
        if (state.tabId === null) return;
        if (command.type === 'pause' || command.type === 'resume') await this.sendMessage(state.tabId, { type: command.type });
        if (command.type === 'setVolume') await this.sendMessage(state.tabId, { type: 'setVolume', volume: command.volume });
    }
}

export function createControllerClient(options: { baseUrl: string; token: string; fetcher?: typeof fetch }) {
    const baseUrl = options.baseUrl.replace(/\/$/, '');
    const fetcher = options.fetcher ?? fetch;
    const headers = { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' };
    const request = (path: string, init: RequestInit = {}) => fetcher(`${baseUrl}${path}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(5000), ...init });
    return {
        async joinInfo() {
            const response = await request('/join-info');
            if (!response.ok) throw new Error(`Join info failed: ${response.status}`);
            const payload = await response.json();
            if (typeof payload?.joinUrl !== 'string') throw new Error('Malformed join info response');
            return payload as { joinUrl: string };
        },
        async status() {
            const response = await request('/status');
            if (!response.ok) throw new Error(`Controller status failed: ${response.status}`);
            const value = await response.json();
            if (typeof value?.instanceId !== 'string' || !Number.isSafeInteger(value.sequence) || value.sequence < 0 || !value.playback || typeof value.playback.volume !== 'number') throw new Error('Malformed controller status');
            const activeCommand = value.activeCommand === null ? null : playbackCommandSchema.parse(value.activeCommand);
            if (activeCommand && activeCommand.type !== 'play') throw new Error('Malformed active command');
            return { instanceId: value.instanceId as string, sequence: value.sequence as number, activeCommand, desiredPaused: value.desiredPaused === true, volume: value.playback.volume as number,
                current: value.current ?? null, queue: Array.isArray(value.queue) ? value.queue : [], playbackState: typeof value.playback?.state === 'string' ? value.playback.state : 'idle' };
        },
        async poll(after: number) {
            const response = await request(`/command?after=${after}`);
            if (!response.ok) throw new Error(`Controller poll failed: ${response.status}`);
            const value = await response.json();
            if (!value || typeof value.instanceId !== 'string' || !Number.isSafeInteger(value.sequence) || value.sequence < 0) throw new Error('Malformed controller response');
            const command = value.command === null ? null : playbackCommandSchema.parse(value.command);
            return { command, sequence: value.sequence as number, instanceId: value.instanceId as string };
        },
        async publish(event: PlaybackEvent) {
            const body = JSON.stringify(playbackEventSchema.parse(event));
            const attempts = event.type === 'ended' || event.type === 'error' ? 3 : 1;
            for (let attempt = 0; attempt < attempts; attempt++) {
                let retryable = true;
                try {
                    const response = await request('/events', { method: 'POST', body });
                    if (response.ok || response.status === 409) return;
                    retryable = response.status >= 500 || response.status === 429;
                    throw new Error(`Event publish failed: ${response.status}`);
                } catch (error) {
                    if (!retryable || attempt === attempts - 1) throw error;
                    await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt));
                }
            }
        },
    };
}
