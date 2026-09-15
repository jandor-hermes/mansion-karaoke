/* global browser */
import { DEFAULT_CONTROLLER_URL, parseStoredConfig } from './config';

type StartResult = { ok?: boolean; tabId?: number | null; error?: string } | undefined;

const form = document.querySelector<HTMLFormElement>('#session-form');
const baseUrl = document.querySelector<HTMLInputElement>('#base-url');
const token = document.querySelector<HTMLInputElement>('#token');
const status = document.querySelector<HTMLElement>('#status');

function setStatus(message: string, error = false) {
    if (!status) return;
    status.textContent = message;
    status.dataset.error = String(error);
}

async function load() {
    const config = parseStoredConfig(await browser.storage.local.get(['baseUrl', 'token']));
    if (baseUrl) baseUrl.value = config.baseUrl;
    if (token) token.value = config.token;
}

form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!baseUrl || !token) return;
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    const config = {
        baseUrl: baseUrl.value.trim() || DEFAULT_CONTROLLER_URL,
        token: token.value,
    };
    if (submitter?.value !== 'start') {
        await browser.storage.local.set(config);
        setStatus('Settings saved.');
        return;
    }
    if (!config.token) {
        setStatus('Enter an authorization token first.', true);
        token.focus();
        return;
    }
    setStatus('Starting session…');
    try {
        const result = await browser.runtime.sendMessage({ type: 'startSession', config }) as StartResult;
        if (!result?.ok) throw new Error(result?.error || 'The player could not be opened.');
        setStatus('Session started.');
        window.close();
    } catch (error) {
        setStatus(error instanceof Error ? error.message : 'The session could not be started.', true);
    }
});

void load();
