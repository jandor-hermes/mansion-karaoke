/* global browser */
import { CommandRouter, createControllerClient, createInitialPlayerState, type PlayerState } from './index';
import { enrichContentEvent } from './events';
import { parseStoredConfig, type ExtensionConfig } from './config';

export async function startBackground(browserApi: typeof browser, options?: ExtensionConfig) {
    const state: PlayerState = createInitialPlayerState();
    const router = new CommandRouter(browserApi.tabs, (tabId, message) => browserApi.tabs.sendMessage(tabId, message));
    let activeConfig = options ?? parseStoredConfig(await browserApi.storage.local.get(['baseUrl', 'token']));
    let client = activeConfig.token ? createControllerClient(activeConfig) : null;
    let sequence = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    let onMessageInstalled = false;

    const poll = async () => {
        if (!client) return;
        try {
            const result = await client.poll(sequence);
            if (result.command) {
                await router.route(result.command, state);
                sequence = result.sequence;
            } else sequence = Math.max(sequence, result.sequence);
        } catch { /* loopback controller may be offline */ }
    };
    const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
    const configure = (config: ExtensionConfig) => {
        stop();
        activeConfig = config;
        client = config.token ? createControllerClient(config) : null;
        if (client) { timer = setInterval(() => void poll(), 750); void poll(); }
    };
    const onMessage = (rawMessage: unknown) => {
        if (!client) return;
        const event = enrichContentEvent(rawMessage as { type: string; position?: number; code?: string; message?: string }, state, sequence, Date.now());
        if (event) { sequence = event.sequence; void client.publish(event); }
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
