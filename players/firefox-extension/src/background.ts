/* global browser */
import { CommandRouter, createControllerClient, createInitialPlayerState, type BrowserWindows, type PlayerState } from './index';
import { enrichContentEvent } from './events';
import { parseStoredConfig, type ExtensionConfig } from './config';

export async function startBackground(browserApi: typeof browser, options?: ExtensionConfig) {
    const state: PlayerState = createInitialPlayerState();
    const router = new CommandRouter(browserApi.tabs, (tabId, message) => browserApi.tabs.sendMessage(tabId, message), (browserApi as unknown as { windows?: BrowserWindows }).windows);
    const initialStored = await browserApi.storage.local.get(['baseUrl', 'token', 'commandCursor']) as { commandCursor?: unknown };
    let activeConfig = options ?? parseStoredConfig(initialStored);
    let client = activeConfig.token ? createControllerClient(activeConfig) : null;
    let commandCursor = typeof initialStored.commandCursor === 'number' && Number.isSafeInteger(initialStored.commandCursor) && initialStored.commandCursor >= 0
        ? initialStored.commandCursor
        : Number.MAX_SAFE_INTEGER;
    let eventSequence = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    let onMessageInstalled = false;

    const poll = async () => {
        if (!client) { console.debug('[karaoke-player] poll skipped: no controller token'); return; }
        try {
            console.debug('[karaoke-player] polling controller', { baseUrl: activeConfig.baseUrl, after: commandCursor });
            const result = await client.poll(commandCursor);
            if (result.command) {
                await router.route(result.command, state);
                console.debug('[karaoke-player] command applied', { type: result.command.type, sequence: result.sequence, tabId: state.tabId });
                commandCursor = result.sequence;
            } else commandCursor = commandCursor === Number.MAX_SAFE_INTEGER ? result.sequence : Math.max(commandCursor, result.sequence);
            await browserApi.storage.local.set({ commandCursor });
        } catch (error) { console.error('[karaoke-player] controller poll failed', error); }
    };
    const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
    const configure = (config: ExtensionConfig) => {
        stop();
        activeConfig = config;
        client = config.token ? createControllerClient(config) : null;
        console.debug('[karaoke-player] configuration updated', { baseUrl: config.baseUrl, hasToken: Boolean(config.token) });
        if (client) { timer = setInterval(() => void poll(), 750); void poll(); }
    };
    const onMessage = (rawMessage: unknown) => {
        if (!client) return;
        const event = enrichContentEvent(rawMessage as { type: string; position?: number; code?: string; message?: string }, state, eventSequence, Date.now());
        if (event) {
            console.debug('[karaoke-player] content event received', event);
            eventSequence = event.sequence;
            void client.publish(event).then(() => console.debug('[karaoke-player] content event published', { type: event.type, sequence: event.sequence })).catch((error) => console.error('[karaoke-player] event publish failed', error));
        }
    };
    if (!onMessageInstalled) {
        browserApi.runtime.onMessage.addListener(onMessage);
        onMessageInstalled = true;
    }
    browserApi.storage.onChanged?.addListener((changes: Record<string, { newValue?: unknown }>) => {
        if ('baseUrl' in changes || 'token' in changes) void browserApi.storage.local.get(['baseUrl', 'token']).then((stored) => configure(parseStoredConfig(stored)));
    });
    browserApi.tabs.onRemoved.addListener((tabId: number) => { if (tabId === state.tabId) state.tabId = null; });
    configure(activeConfig);
    return { state, poll, stop, configure };
}

if (typeof browser !== 'undefined') void startBackground(browser);
