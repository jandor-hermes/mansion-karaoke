/* global browser */
import { DEFAULT_CONTROLLER_URL, parseOverlaySettings, parseStoredConfig } from './config';

const form = document.querySelector<HTMLFormElement>('#config-form');
const baseUrl = document.querySelector<HTMLInputElement>('#base-url');
const token = document.querySelector<HTMLInputElement>('#token');
const nowSinging = document.querySelector<HTMLInputElement>('#overlay-now-singing');
const upNextAlways = document.querySelector<HTMLInputElement>('#overlay-up-next-always');
const upNextSeconds = document.querySelector<HTMLInputElement>('#overlay-up-next-seconds');
const status = document.querySelector<HTMLElement>('#status');

async function load() {
    const config = parseStoredConfig(await browser.storage.local.get(['baseUrl', 'token', 'overlay']));
    if (baseUrl) baseUrl.value = config.baseUrl;
    if (token) token.value = config.token;
    if (nowSinging) nowSinging.checked = config.overlay.nowSinging;
    if (upNextAlways) upNextAlways.checked = config.overlay.upNextAlways;
    if (upNextSeconds) upNextSeconds.value = String(config.overlay.upNextSeconds);
    const hostFullscreen = document.querySelector<HTMLInputElement>('#exp-host-fullscreen');
    if (hostFullscreen) hostFullscreen.checked = config.experiments.hostControlsFullscreen;
}

form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!baseUrl || !token || !status) return;
    await browser.storage.local.set({
        baseUrl: baseUrl.value.trim() || DEFAULT_CONTROLLER_URL,
        token: token.value,
        overlay: parseOverlaySettings({
            nowSinging: nowSinging?.checked,
            upNextAlways: upNextAlways?.checked,
            upNextSeconds: upNextSeconds ? Number(upNextSeconds.value) : undefined,
        }),
        experiments: {
            hostControlsFullscreen: document.querySelector<HTMLInputElement>('#exp-host-fullscreen')?.checked === true,
        },
    });
    status.textContent = 'Saved. The player overlay updates on the next poll (within a second).';
});

void load();
