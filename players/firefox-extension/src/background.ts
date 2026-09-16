/* global browser */
import { CommandRouter, createControllerClient, createInitialPlayerState, type PlayerState } from './index';
import { parseStoredConfig, type ExtensionConfig } from './config';

export async function startBackground(browserApi: typeof browser, options?: ExtensionConfig) {
    const state: PlayerState = createInitialPlayerState();
    const config = options ?? parseStoredConfig(await browserApi.storage.local.get(['baseUrl', 'token']));
    if (!config.token) {
        console.warn('Local Karaoke Player is idle: configure a bearer token in extension options.');
        return { state, poll: async () => undefined };
    }
    const router = new CommandRouter(browserApi.tabs, (tabId, message) => browserApi.tabs.sendMessage(tabId, message));
    const client = createControllerClient(config);
    let sequence = 0;
    const poll = async () => {
        try {
            const result = await client.poll(sequence);
            if (result.command) {
                await router.route(result.command, state);
                sequence = result.sequence;
            } else {
                sequence = Math.max(sequence, result.sequence);
            }
        } catch { /* loopback controller may be offline */ }
    };
    browserApi.tabs.onRemoved.addListener((tabId: number) => { if (tabId === state.tabId) state.tabId = null; });
    setInterval(poll, 750);
    void poll();
    return { state, poll };
}

if (typeof browser !== 'undefined') void startBackground(browser);
