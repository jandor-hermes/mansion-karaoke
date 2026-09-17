/* global browser */
import { CommandRouter, createControllerClient, createInitialPlayerState, type BrowserWindows, type PlayerState } from './index';
import { enrichContentEvent, type ContentEvent } from './events';
import { parseStoredConfig, type ExtensionConfig, type OverlaySettings } from './config';
import { singerLabel, type OverlayInfo } from './singer-overlay';
import type { PlaybackEvent } from '../../../packages/playback-protocol/src';

export async function startBackground(browserApi: typeof browser, options?: ExtensionConfig) {
    const state: PlayerState = createInitialPlayerState();
    const windows = (browserApi as unknown as { windows?: BrowserWindows & { update(id: number, options: { state: 'fullscreen' } | { focused: boolean }): Promise<unknown> } }).windows;
    const stored = await browserApi.storage.local.get(['baseUrl', 'token', 'playerTabId']) as Record<string, unknown>;
    const log = (...args: unknown[]) => console.info('[karaoke-player]', ...args);
    let activeConfig = options ?? parseStoredConfig(stored);
    let router = new CommandRouter(browserApi.tabs, (id, message) => browserApi.tabs.sendMessage(id, message), windows,
        8000, activeConfig.experiments.hostControlsFullscreen);
    let overlaySettings: OverlaySettings = activeConfig.overlay;
    let client = activeConfig.token ? createControllerClient(activeConfig) : null;
    let commandCursor = 0, instanceId = '', eventSequence = Date.now();
    let needsReconcile = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    let pollInFlight: Promise<void> | null = null;
    let surfaceReady: Promise<void> = Promise.resolve();
    const pending = new Map<string, PlaybackEvent>();

    const ensurePlayerSurface = async (activate = false) => {
        if (!client) return;
        if (state.tabId !== null) {
            try {
                const tab = await browserApi.tabs.get(state.tabId);
                if (tab.windowId !== undefined) state.windowId = tab.windowId;
                if (activate) {
                    await browserApi.tabs.update(state.tabId, { active: true });
                    if (state.windowId != null && windows) await windows.update(state.windowId, { focused: true });
                    log('focus', { tabId: state.tabId, windowId: state.windowId });
                }
                return;
            }
            catch { state.tabId = null; }
        }
        if (typeof browserApi.tabs.query !== 'function' || typeof browserApi.runtime.getURL !== 'function') return;
        const displayUrl = browserApi.runtime.getURL('display.html');
        const tabs = await browserApi.tabs.query({});
        const existing = tabs.find(tab => tab.id === stored.playerTabId && (tab.url === displayUrl || tab.url?.startsWith('https://www.youtube.com/watch')))
            ?? tabs.find(tab => tab.url === displayUrl || (tab.url?.startsWith('https://www.youtube.com/watch') && tab.url.includes('#karaoke=')));
        const tab = existing ?? await browserApi.tabs.create({ url: displayUrl, active: true });
        state.tabId = tab.id ?? null; state.windowId = tab.windowId ?? null;
        await browserApi.storage.local.set({ playerTabId: state.tabId });
        if (activate && existing && state.tabId !== null) {
            await browserApi.tabs.update(state.tabId, { active: true });
            if (state.windowId != null && windows) await windows.update(state.windowId, { focused: true });
            log('focus', { tabId: state.tabId, windowId: state.windowId });
        }
    };
    /** Last overlay info sent to the player tab, to avoid redundant messages. */
    let lastOverlayKey = '';
    const pushOverlay = async (info: OverlayInfo) => {
        const key = JSON.stringify([info, overlaySettings]);
        if (key === lastOverlayKey || state.tabId === null) return;
        lastOverlayKey = key;
        try { await browserApi.tabs.sendMessage(state.tabId, { type: 'updateSingerOverlay', info, settings: overlaySettings }); }
        catch { lastOverlayKey = ''; /* tab reloading; retry on next poll */ }
    };
    /** Derive overlay labels from a controller status snapshot. */
    const overlayInfoFromStatus = (snapshot: { current?: { title?: string; requestedBy?: string } | null; queue?: Array<{ title?: string; requestedBy?: string }>; playbackState?: string }): OverlayInfo => ({
        current: snapshot.current ?? null,
        next: snapshot.queue?.[0] ?? null,
        playing: snapshot.playbackState === 'playing' || snapshot.playbackState === 'loading',
        remainingSeconds: null,
    });
    const publish = async (event: PlaybackEvent) => {
        const target = client;
        if (!target) return;
        const key = `${event.commandId}:${event.sequence}`;
        if (event.type === 'ended' || event.type === 'error') {
            pending.set(key, event);
            if (pending.size > 32) pending.delete(pending.keys().next().value!);
        }
        try { await target.publish(event); pending.delete(key); }
        catch (error) { console.error('[karaoke-player] event delivery pending', error); }
    };
    const apply = async (command: unknown) => {
        try { await router.route(command, state); }
        catch (error) {
            console.error('[karaoke-player] command failed; later controls remain available', error);
            const event = enrichContentEvent({ ...state, type: 'error', code: 'COMMAND_FAILED', message: 'Playback command failed. Check Firefox autoplay, then Resume or Skip.' }, state, eventSequence, Date.now());
            if (event) { eventSequence = event.sequence; await publish(event); }
        }
    };
    const reconcile = async () => {
        if (!client) return;
        log('poll', { reason: 'reconcile', after: commandCursor });
        const snapshot = await client.status();
        if (instanceId && instanceId !== snapshot.instanceId) pending.clear();
        instanceId = snapshot.instanceId;
        state.volume = snapshot.volume; state.desiredPaused = snapshot.desiredPaused;
        if (snapshot.activeCommand) {
            let observed: any = null;
            if (state.tabId !== null) {
                try { observed = await browserApi.tabs.sendMessage(state.tabId, { type: 'inspectPlayback' }); } catch { /* extension reload needs a fresh document */ }
            }
            const command = snapshot.activeCommand;
            if (observed?.commandId === command.commandId && observed?.videoId === command.videoId && observed?.roomId === command.roomId && observed?.itemId === command.itemId) {
                Object.assign(state, { commandId: command.commandId, roomId: command.roomId, itemId: command.itemId, videoId: command.videoId });
                await browserApi.tabs.sendMessage(state.tabId!, { type: 'setVolume', volume: snapshot.volume });
                await browserApi.tabs.sendMessage(state.tabId!, { type: snapshot.desiredPaused ? 'pause' : 'resume' });
                const event = enrichContentEvent(observed, state, eventSequence, Date.now());
                if (event) { eventSequence = event.sequence; await publish(event); }
            } else await apply(command);
        } else {
            await apply({ type: 'skip', commandId: 'reconcile-idle', roomId: 'local', issuedAt: Date.now() });
        }
        commandCursor = snapshot.sequence; needsReconcile = false;
    };
    const runPoll = async () => {
        if (!client) return;
        try {
            await surfaceReady;
            for (const event of [...pending.values()]) await publish(event);
            if (needsReconcile) await reconcile();
            const result = await client.poll(commandCursor);
            if (result.instanceId !== instanceId) await reconcile();
            else if (result.command) {
                log('poll', { reason: 'command', sequence: result.sequence, type: result.command.type });
                if (result.command.type === 'play') state.desiredPaused = false;
                await apply(result.command);
                commandCursor = result.sequence;
            } else commandCursor = Math.max(commandCursor, result.sequence);
            if (client) {
                try { await pushOverlay(overlayInfoFromStatus(await client.status())); }
                catch (error) { console.error('[karaoke-player] overlay status fetch failed', error); }
            }
            await browserApi.storage.local.set({ commandCursor, controllerInstanceId: instanceId });
        } catch (error) { console.error('[karaoke-player] controller poll failed', error); }
    };
    const poll = () => {
        if (pollInFlight) return pollInFlight;
        pollInFlight = runPoll().finally(() => { pollInFlight = null; });
        return pollInFlight;
    };
    const stop = () => { if (timer !== null) clearInterval(timer); timer = null; };
    const configure = (config: ExtensionConfig) => {
        const changed = config.baseUrl !== activeConfig.baseUrl || config.token !== activeConfig.token;
        if (!changed) return surfaceReady;
        stop();
        activeConfig = config;
        client = config.token ? createControllerClient(config) : null;
        router = new CommandRouter(browserApi.tabs, (id, message) => browserApi.tabs.sendMessage(id, message), windows,
            8000, config.experiments.hostControlsFullscreen);
        if (changed) { commandCursor = 0; needsReconcile = true; pending.clear(); instanceId = ''; lastOverlayKey = ''; }
        overlaySettings = config.overlay;
        surfaceReady = (pollInFlight ?? Promise.resolve()).then(() => ensurePlayerSurface());
        if (client) { timer = setInterval(() => void poll(), 750); void poll(); }
        return surfaceReady;
    };
    browserApi.runtime.onMessage.addListener(async (raw: unknown, sender?: { tab?: { id?: number }; frameId?: number }) => {
        if (!raw || typeof raw !== 'object') return;
        const message = raw as ContentEvent & { config?: unknown };
        if (message.type === 'startSession') {
            log('start-session received');
            // Configuration messages originate in extension pages, never a YouTube frame.
            if (sender?.tab && message.config === undefined) return;
            const config = parseStoredConfig(message.config);
            if (!config.token) return { ok: false, error: 'Enter an authorization token first.' };
            await configure(config); await ensurePlayerSurface(true);
            await browserApi.storage.local.set(config);
            const result = { ok: true, tabId: state.tabId };
            log('start-session result', result);
            return result;
        }
        if (!client) return;
        if (message.type === 'getJoinInfo') return client.joinInfo();
        if (sender?.tab?.id !== state.tabId || sender?.frameId !== 0) return;
        const event = enrichContentEvent(message, state, eventSequence, Date.now());
        if (event) { eventSequence = event.sequence; state.status = event.type === 'ready' ? 'loading' : event.type; await publish(event); }
        if (message.type === 'updateOverlayNow') {
            // Content script asks for an immediate overlay refresh (e.g. near-end visibility).
            lastOverlayKey = '';
            if (state.tabId !== null && sender?.tab?.id === state.tabId) {
                try { const snapshot = await client.status(); await pushOverlay(overlayInfoFromStatus(snapshot)); } catch { /* next poll recovers */ }
            }
        }
    });
    browserApi.storage.onChanged?.addListener((changes: Record<string, { newValue?: unknown }>) => {
        if ('baseUrl' in changes || 'token' in changes || 'overlay' in changes) void browserApi.storage.local.get(['baseUrl', 'token', 'overlay']).then(value => {
            const config = parseStoredConfig(value);
            if (config.baseUrl !== activeConfig.baseUrl || config.token !== activeConfig.token) configure(config);
            else if (JSON.stringify(config.overlay) !== JSON.stringify(overlaySettings)) {
                overlaySettings = config.overlay; lastOverlayKey = '';
                void poll();
            }
        });
    });
    browserApi.tabs.onRemoved.addListener(id => { if (id === state.tabId) { state.tabId = null; needsReconcile = true; surfaceReady = ensurePlayerSurface(); } });
    if (client) { surfaceReady = ensurePlayerSurface(); timer = setInterval(() => void poll(), 750); void poll(); }
    return { state, poll, stop, configure };
}
if (typeof browser !== 'undefined') void startBackground(browser);
