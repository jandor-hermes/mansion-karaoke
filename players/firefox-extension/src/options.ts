/* global browser */
import { DEFAULT_CONTROLLER_URL, parseStoredConfig } from './config';

const form = document.querySelector<HTMLFormElement>('#config-form');
const baseUrl = document.querySelector<HTMLInputElement>('#base-url');
const token = document.querySelector<HTMLInputElement>('#token');
const status = document.querySelector<HTMLElement>('#status');

async function load() {
    const config = parseStoredConfig(await browser.storage.local.get(['baseUrl', 'token']));
    if (baseUrl) baseUrl.value = config.baseUrl;
    if (token) token.value = config.token;
}

form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!baseUrl || !token || !status) return;
    await browser.storage.local.set({ baseUrl: baseUrl.value.trim() || DEFAULT_CONTROLLER_URL, token: token.value });
    status.textContent = 'Saved. The background poller will use this configuration.';
});

void load();
