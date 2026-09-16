export const DEFAULT_CONTROLLER_URL = 'http://127.0.0.1:3010';

export type ExtensionConfig = { baseUrl: string; token: string };

export function parseStoredConfig(value: unknown): ExtensionConfig {
    if (!value || typeof value !== 'object') return { baseUrl: DEFAULT_CONTROLLER_URL, token: '' };
    const stored = value as { baseUrl?: unknown; token?: unknown };
    return {
        baseUrl: typeof stored.baseUrl === 'string' ? stored.baseUrl : DEFAULT_CONTROLLER_URL,
        token: typeof stored.token === 'string' ? stored.token : '',
    };
}
