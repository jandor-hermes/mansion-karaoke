export const DEFAULT_CONTROLLER_URL = 'http://127.0.0.1:3010';

/** On-video singer overlay tunables (see options.html). */
export type OverlaySettings = {
    /** Show the "Now singing" chip while a song plays. */
    nowSinging: boolean;
    /** Seconds before the song ends at which the "Up next" card appears; 0 disables timed showing. */
    upNextSeconds: number;
    /** Keep the "Up next" card permanently visible whenever a queued song exists. */
    upNextAlways: boolean;
};

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = { nowSinging: true, upNextSeconds: 20, upNextAlways: false };
const UP_NEXT_SECONDS_MIN = 0;
const UP_NEXT_SECONDS_MAX = 600;

export function parseOverlaySettings(value: unknown): OverlaySettings {
    if (!value || typeof value !== 'object') return { ...DEFAULT_OVERLAY_SETTINGS };
    const stored = value as { nowSinging?: unknown; upNextSeconds?: unknown; upNextAlways?: unknown };
    const seconds = typeof stored.upNextSeconds === 'number' && Number.isFinite(stored.upNextSeconds)
        ? Math.min(UP_NEXT_SECONDS_MAX, Math.max(UP_NEXT_SECONDS_MIN, Math.round(stored.upNextSeconds)))
        : DEFAULT_OVERLAY_SETTINGS.upNextSeconds;
    return {
        nowSinging: typeof stored.nowSinging === 'boolean' ? stored.nowSinging : DEFAULT_OVERLAY_SETTINGS.nowSinging,
        upNextSeconds: seconds,
        upNextAlways: typeof stored.upNextAlways === 'boolean' ? stored.upNextAlways : DEFAULT_OVERLAY_SETTINGS.upNextAlways,
    };
}

export type ExtensionConfig = { baseUrl: string; token: string; overlay: OverlaySettings };

export function parseStoredConfig(value: unknown): ExtensionConfig {
    if (!value || typeof value !== 'object') return { baseUrl: DEFAULT_CONTROLLER_URL, token: '', overlay: { ...DEFAULT_OVERLAY_SETTINGS } };
    const stored = value as { baseUrl?: unknown; token?: unknown; overlay?: unknown };
    return {
        baseUrl: typeof stored.baseUrl === 'string' ? stored.baseUrl : DEFAULT_CONTROLLER_URL,
        token: typeof stored.token === 'string' ? stored.token : '',
        overlay: parseOverlaySettings(stored.overlay),
    };
}
