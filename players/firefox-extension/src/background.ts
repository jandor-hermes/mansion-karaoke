/* global browser */
import { CommandRouter, createControllerClient, createInitialPlayerState, type PlayerState } from './index';

export function startBackground(browserApi: typeof browser, options = { baseUrl: 'http://127.0.0.1:3010', token: '' }) {
    const state: PlayerState = createInitialPlayerState();
    const router = new CommandRouter(browserApi.tabs, (tabId, message) => browserApi.tabs.sendMessage(tabId, message));
    const client = createControllerClient(options);
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
