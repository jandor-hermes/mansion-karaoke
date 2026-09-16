export const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export type LoadVideoCommand = { type: 'loadVideo'; videoId: string; position: number };
export type LoadVideoResult = {
    ok: boolean;
    mode?: 'yt-navigate' | 'player-api';
    videoId: string;
    fullscreenRetained: boolean;
    error?: string;
};

export function parseLoadVideoCommand(value: unknown): LoadVideoCommand | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<LoadVideoCommand>;
    if (candidate.type !== 'loadVideo' || typeof candidate.videoId !== 'string' || !YOUTUBE_VIDEO_ID.test(candidate.videoId)) return null;
    if (typeof candidate.position !== 'number' || !Number.isFinite(candidate.position) || candidate.position < 0) return null;
    return { type: 'loadVideo', videoId: candidate.videoId, position: candidate.position };
}

export type BridgeNode = EventTarget & { dataset: Record<string, string | undefined> };

export function requestPageLoad(
    node: BridgeNode,
    channel: string,
    value: unknown,
    timeoutMs = 2000,
): Promise<LoadVideoResult> {
    const command = parseLoadVideoCommand(value);
    if (!command) return Promise.reject(new Error('invalid loadVideo command'));
    if (!/^[A-Za-z0-9_-]+$/.test(channel)) return Promise.reject(new Error('invalid bridge channel'));
    const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
        const responseEvent = `karaoke-load-response-${channel}`;
        const cleanup = () => {
            clearTimeout(timeout);
            node.removeEventListener(responseEvent, onResponse);
        };
        const onResponse = () => {
            try {
                const envelope = JSON.parse(node.dataset.karaokeResponse ?? 'null') as { requestId?: unknown; result?: unknown } | null;
                if (envelope?.requestId !== requestId) return;
                const result = parseLoadVideoResult(envelope.result);
                if (!result || result.videoId !== command.videoId) throw new Error('invalid page-bridge response');
                cleanup();
                resolve(result);
            } catch (error) {
                cleanup();
                reject(error);
            }
        };
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('page-bridge response timed out'));
        }, timeoutMs);
        node.addEventListener(responseEvent, onResponse);
        node.dataset.karaokeRequest = JSON.stringify({ requestId, videoId: command.videoId, position: command.position });
        node.dispatchEvent(new Event(`karaoke-load-request-${channel}`));
    });
}

export function parseLoadVideoResult(value: unknown): LoadVideoResult | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<LoadVideoResult>;
    if (typeof candidate.ok !== 'boolean' || typeof candidate.videoId !== 'string' || !YOUTUBE_VIDEO_ID.test(candidate.videoId)) return null;
    if (typeof candidate.fullscreenRetained !== 'boolean') return null;
    if (candidate.ok && candidate.mode !== 'yt-navigate' && candidate.mode !== 'player-api') return null;
    if (candidate.mode !== undefined && candidate.mode !== 'yt-navigate' && candidate.mode !== 'player-api') return null;
    if (candidate.error !== undefined && typeof candidate.error !== 'string') return null;
    return {
        ok: candidate.ok,
        ...(candidate.mode ? { mode: candidate.mode } : {}),
        videoId: candidate.videoId,
        fullscreenRetained: candidate.fullscreenRetained,
        ...(candidate.error ? { error: candidate.error } : {}),
    };
}
