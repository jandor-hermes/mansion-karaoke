import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { itemIdSchema, videoIdSchema, playbackCommandSchema, playbackEventSchema, type PlaybackCommand, type PlaybackEvent } from '../../../packages/playback-protocol/src/index.js';
import { createUnavailableSearchAdapter, type SearchAdapter } from './search.js';
import { guestPage, guestWorker } from './guest-ui.js';
import { chooseInsertionIndex, chooseNextIndex, normalizeSinger, type Placement, type SchedulerState, type SchedulingItem } from './auto-kj.js';
import { homedir } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export type ControlPlane = { url: string; bind: string; listen(port: number): Promise<void>; close(): Promise<void> };
export type QueueItem = {
    itemId: string;
    videoId: string;
    title?: string;
    channel?: string;
    duration?: string;
    thumbnail?: string;
    requestedBy?: string;
};
export type SuggestionAdapter = { suggest(query: string): Promise<string[]> };
type Options = {
    token: string; roomId: string; search?: SearchAdapter; suggest?: SuggestionAdapter; bind?: string; now?: () => number;
    /** Startup default for Auto-KJ (KARAOKE_AUTO_KJ=off passes false). */
    autoKjEnabled?: boolean;
    /** Persisted host-setting file for the Auto-KJ runtime toggle; omit to disable persistence. */
    autoKjStateFile?: string;
};

/** Default persisted-state path for the Auto-KJ host toggle (owner-owned home directory). */
export function defaultAutoKjStateFile(env: Record<string, string | undefined>): string | undefined {
    if (env.KARAOKE_AUTO_KJ_STATE_FILE === '') return undefined;
    return env.KARAOKE_AUTO_KJ_STATE_FILE ?? join(homedir(), '.karaoke', 'auto-kj.json');
}

export function autoKjStartupDefault(env: Record<string, string | undefined>): boolean {
    return (env.KARAOKE_AUTO_KJ ?? '').trim().toLowerCase() !== 'off';
}

const queueMetadataFields = ['title', 'channel', 'duration', 'thumbnail', 'requestedBy'] as const;

function parseQueueItem(value: unknown): QueueItem | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Record<string, unknown>;
    if (!itemIdSchema.safeParse(candidate.itemId).success || !videoIdSchema.safeParse(candidate.videoId).success) return null;
    const item: QueueItem = { itemId: candidate.itemId as string, videoId: candidate.videoId as string };
    for (const field of queueMetadataFields) {
        if (candidate[field] !== undefined && typeof candidate[field] !== 'string') return null;
        if (typeof candidate[field] === 'string') item[field] = candidate[field];
    }
    return item;
}

/** True for private IPv4 hostnames like 192.168.4.31 or 10.0.0.5 (no port validation). */
function isPrivateIpv4Hostname(hostname: string): boolean {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
    if (!match) return false;
    const octets = match.slice(1).map(Number);
    if (octets.some((octet) => octet < 0 || octet > 255)) return false;
    const [first, second] = octets as [number, number, number, number];
    return first === 192 && second === 168
        || first === 10
        || first === 172 && second >= 16 && second <= 31
        || first === 127;
}

/** CORS policy: the Firefox extension origin plus same-LAN http origins.
 * The guest page is served by this server itself, so phone browsers on the
 * Wi-Fi get an allowed Origin while arbitrary https/public sites stay out. */
export function isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return false;
    if (origin.startsWith('moz-extension://')) return true;
    try {
        const parsed = new URL(origin);
        if (parsed.protocol !== 'http:') return false;
        return parsed.hostname === 'localhost' || isPrivateIpv4Hostname(parsed.hostname);
    } catch {
        return false;
    }
}

/** Bind host: defaults to all interfaces so phones on the LAN can load the
 * guest page; set KARAOKE_BIND=127.0.0.1 to go back to loopback-only. */
export function resolveBindAddress(env: Record<string, string | undefined>): string {
    return env.KARAOKE_BIND ?? '0.0.0.0';
}

/** LAN IPv4 addresses of this host, for printing at startup. */
export function lanIPv4Addresses(): string[] {
    const addresses: string[] = [];
    for (const entries of Object.values(networkInterfaces())) {
        for (const entry of entries ?? []) {
            if (entry.family === 'IPv4' && isPrivateIpv4Hostname(entry.address) && !entry.address.startsWith('127.')) addresses.push(entry.address);
        }
    }
    return [...new Set(addresses)];
}

export function createControlPlane(options: Options): ControlPlane {
    const search = options.search ?? createUnavailableSearchAdapter();
    const suggest = options.suggest;
    const queue: QueueItem[] = [];
    const history: Array<QueueItem & { completedAt: number; reason: 'ended' | 'skipped' | 'replaced' }> = [];
    const commands: Array<{ sequence: number; command: PlaybackCommand }> = [];
    let current: QueueItem | null = null;
    let sequence = 0;
    const instanceId = randomUUID();
    let activeCommand: Extract<PlaybackCommand, { type: 'play' }> | null = null;
    let loadingDeadline: { commandId: string; at: number } | null = null;
    const playback: { state: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'; error: string | null; lastSeen: number | null; volume: number } = { state: 'idle', error: null, lastSeen: null, volume: .75 };
    let desiredPaused = false;
    let lastEventSequence = 0;
    const acceptedEvents = new Set<string>();
    let server: Server | undefined;
    let url = '';
    const bind = options.bind ?? resolveBindAddress(process.env);
    const now = options.now ?? Date.now;
    // Auto-KJ scheduling state (see AUTO-KJ-PLAN.md). Ephemeral with the queue.
    const autoKjStateFile = options.autoKjStateFile;
    let autoKjEnabled = options.autoKjEnabled ?? true;
    const singerState: SchedulerState = { lastTurnBySinger: new Map<string, number>() };
    const scheduling = new Map<string, { singerKey: string; arrivalSequence: number; placement: Placement }>();
    let arrivalCounter = 0;
    let turnCounter = 0;
    const schedule = (item: QueueItem, placement: Placement) => {
        scheduling.set(item.itemId, { singerKey: normalizeSinger(item.requestedBy), arrivalSequence: ++arrivalCounter, placement });
    };
    const markPlacement = (itemId: string, placement: Placement) => {
        const entry = scheduling.get(itemId);
        if (entry) entry.placement = placement;
    };
    const asSchedulingItems = (list: readonly QueueItem[]): SchedulingItem[] => list.map((item) => {
        const entry = scheduling.get(item.itemId);
        return { itemId: item.itemId, singerKey: entry?.singerKey ?? normalizeSinger(item.requestedBy), arrivalSequence: entry?.arrivalSequence ?? 0, placement: entry?.placement ?? 'auto' };
    });
    const serializeItem = (item: QueueItem) => {
        const entry = scheduling.get(item.itemId);
        return { ...item, placement: entry?.placement ?? 'auto' };
    };
    const readAutoKjState = async () => {
        if (!autoKjStateFile) return;
        try {
            const value = JSON.parse(await readFile(autoKjStateFile, 'utf8')) as { enabled?: unknown };
            if (typeof value.enabled === 'boolean') autoKjEnabled = value.enabled;
        } catch { /* missing or unreadable state falls back to the startup default */ }
    };
    const persistAutoKjState = async () => {
        if (!autoKjStateFile) return;
        try {
            await mkdir(dirname(autoKjStateFile), { recursive: true });
            await writeFile(autoKjStateFile, JSON.stringify({ enabled: autoKjEnabled }), { mode: 0o600 });
        } catch { /* non-fatal: the runtime toggle stays effective for this session */ }
    };
    void readAutoKjState();
    const refreshLoadingDeadline = () => {
        if (loadingDeadline && activeCommand?.commandId === loadingDeadline.commandId && playback.state === 'loading' && now() >= loadingDeadline.at) {
            playback.state = 'error';
            playback.error = 'Playback is still loading after 30 seconds. Check Firefox, autoplay permissions, ads, or press Skip.';
        }
    };
    const joinUrl = () => {
        const value = new URL(url);
        value.hostname = lanIPv4Addresses()[0] ?? '127.0.0.1';
        value.pathname = '/';
        value.search = '';
        value.hash = new URLSearchParams({ token: options.token }).toString();
        return value.toString();
    };

    const issue = (command: PlaybackCommand) => {
        if (command.type === 'play') { lastEventSequence = 0; activeCommand = command; loadingDeadline = { commandId: command.commandId, at: now() + 30_000 }; playback.state = 'loading'; playback.error = null; desiredPaused = false; }
        if (command.type === 'pause') desiredPaused = true;
        if (command.type === 'resume') desiredPaused = false;
        if (command.type === 'setVolume') playback.volume = command.volume;
        commands.push({ sequence: ++sequence, command });
    };
    const commandFor = (type: PlaybackCommand['type'], extra: Record<string, unknown> = {}): PlaybackCommand => playbackCommandSchema.parse({
        ...extra, type, commandId: randomUUID(), roomId: options.roomId, issuedAt: Date.now(),
    });
    const startNext = (previousSingerKey: string | null = null) => {
        if (autoKjEnabled) {
            const guardIndex = chooseNextIndex(asSchedulingItems(queue), previousSingerKey, singerState);
            if (guardIndex > 0) queue.unshift(queue.splice(guardIndex, 1)[0]);
        }
        current = queue.shift() ?? null;
        if (current) {
            const singerKey = normalizeSinger(current.requestedBy);
            singerState.lastTurnBySinger.set(singerKey, ++turnCounter);
            issue(commandFor('play', { itemId: current.itemId, videoId: current.videoId, position: 0 }));
        }
        else activeCommand = null;
    };
    const hasItemId = (itemId: string) => current?.itemId === itemId || queue.some((item) => item.itemId === itemId);
    const remember = (item: QueueItem, reason: 'ended' | 'skipped' | 'replaced', completedAt = Date.now()) => {
        history.unshift({ ...item, completedAt, reason });
        if (history.length > 100) history.length = 100;
    };
    const singerOfCurrent = () => (current ? normalizeSinger(current.requestedBy) : null);
    const skip = () => { if (current) { issue(commandFor('skip')); remember(current, 'skipped'); const previousSinger = singerOfCurrent(); current = null; playback.state = 'idle'; playback.error = null; startNext(previousSinger); } };
    const body = async (request: IncomingMessage) => {
        let data = ''; for await (const chunk of request) data += chunk;
        return data ? JSON.parse(data) : {};
    };
    const send = (response: ServerResponse, status: number, value?: unknown) => {
        response.statusCode = status;
        if (value === undefined) return response.end();
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value));
    };
    const cors = (request: IncomingMessage, response: ServerResponse) => {
        const origin = request.headers.origin;
        if (isAllowedOrigin(origin)) {
            response.setHeader('Access-Control-Allow-Origin', origin as string);
            response.setHeader('Vary', 'Origin');
        }
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    };
    const handler = async (request: IncomingMessage, response: ServerResponse) => {
        console.log('[control-plane]', request.method, request.url, request.headers.origin ?? '-', request.headers.authorization ? 'auth' : 'no-auth');
        cors(request, response);
        if (request.method === 'OPTIONS') return send(response, 204);
        if (request.method === 'GET' && (request.url ?? '/').split('?')[0] === '/') {
            response.statusCode = 200;
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            return response.end(guestPage(options.roomId));
        }
        const urlObject = new URL(request.url ?? '/', url || 'http://127.0.0.1');
        if (request.method === 'GET' && urlObject.pathname === '/guest-worker.js') {
            response.statusCode = 200;
            response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            response.setHeader('Cache-Control', 'no-cache');
            return response.end(guestWorker());
        }
        if (request.headers.authorization !== `Bearer ${options.token}`) return send(response, 401, { error: 'unauthorized' });
        refreshLoadingDeadline();
        try {
            if (request.method === 'GET' && urlObject.pathname === '/join-info') return send(response, 200, { joinUrl: joinUrl() });
            if (request.method === 'GET' && urlObject.pathname === '/status') return send(response, 200, { roomId: options.roomId, instanceId, current: current && serializeItem(current), queue: queue.map(serializeItem), history, sequence, playback, activeCommand, desiredPaused, autoKj: { enabled: autoKjEnabled } });
            if (request.method === 'POST' && urlObject.pathname === '/search') {
                const value = await body(request) as { query?: unknown; continuation?: unknown };
                if (typeof value.query !== 'string' || value.query.trim().length === 0) return send(response, 400, { error: 'query required' });
                if (value.continuation !== undefined && typeof value.continuation !== 'string') return send(response, 400, { error: 'continuation must be a string' });
                try {
                    // Party-friction item 1: append "karaoke" server-side on submit so
                    // every client gets karaoke-ranked results; skip when the user's
                    // trimmed query already contains the token (case-insensitive).
                    const trimmedQuery = value.query.trim();
                    const query = trimmedQuery.toLowerCase().includes('karaoke')
                        ? value.query
                        : `${trimmedQuery} karaoke`;
                    return send(response, 200, await search.search(query, value.continuation as string | undefined));
                } catch (error) {
                    if (error instanceof Error && error.message === 'search_not_configured') return send(response, 503, { error: 'search_not_configured' });
                    return send(response, 502, { error: 'search_upstream_failed' });
                }
            }
            if (request.method === 'GET' && urlObject.pathname === '/suggest') {
                const query = (urlObject.searchParams.get('q') ?? '').trim();
                if (!query) return send(response, 200, { suggestions: [] });
                if (!suggest) return send(response, 503, { error: 'suggest_not_configured' });
                try {
                    const seen = new Set<string>();
                    const suggestions = (await suggest.suggest(query)).filter((value) => {
                        if (typeof value !== 'string' || !value.trim()) return false;
                        const normalized = value.trim().toLowerCase();
                        if (seen.has(normalized)) return false;
                        seen.add(normalized);
                        return true;
                    }).slice(0, 8);
                    return send(response, 200, { suggestions });
                } catch {
                    return send(response, 502, { error: 'suggest_upstream_failed' });
                }
            }
            if (request.method === 'GET' && urlObject.pathname === '/command') {
                playback.lastSeen = now();
                const after = Number(urlObject.searchParams.get('after') ?? 0);
                const next = commands.find((entry) => entry.sequence > after);
                return send(response, 200, { ...(next ?? { command: null, sequence }), instanceId });
            }
            if (request.method === 'POST' && urlObject.pathname === '/queue') {
                const value = parseQueueItem(await body(request));
                if (!value) return send(response, 400, { error: 'itemId and videoId required' });
                if (current?.itemId === value.itemId || queue.some((item) => item.itemId === value.itemId)) return send(response, 200, value);
                schedule(value, autoKjEnabled ? 'auto' : 'off');
                const wasIdle = !current;
                let index = queue.length;
                if (autoKjEnabled) index = chooseInsertionIndex({ singerKey: normalizeSinger(value.requestedBy), arrivalSequence: scheduling.get(value.itemId)!.arrivalSequence }, asSchedulingItems(queue), singerState);
                queue.splice(index, 0, value);
                if (wasIdle) { startNext(); index = 0; }
                return send(response, 201, { item: serializeItem(value), position: index, placement: autoKjEnabled ? 'auto' : 'off', playing: wasIdle });
            }
            if (request.method === 'POST' && urlObject.pathname === '/queue/next') {
                const value = parseQueueItem(await body(request));
                if (!value) return send(response, 400, { error: 'valid itemId, videoId, and string metadata required' });
                if (hasItemId(value.itemId)) return send(response, 200, { current: current && serializeItem(current), queue: queue.map(serializeItem) });
                schedule(value, 'manual');
                queue.unshift(value);
                if (!current) startNext();
                return send(response, 201, { current: current && serializeItem(current), queue: queue.map(serializeItem) });
            }
            if (request.method === 'POST' && urlObject.pathname === '/queue/play-now') {
                const value = parseQueueItem(await body(request));
                if (!value) return send(response, 400, { error: 'valid itemId, videoId, and string metadata required' });
                if (hasItemId(value.itemId)) return send(response, 200, { current: current && serializeItem(current), queue: queue.map(serializeItem), history });
                if (current) { issue(commandFor('skip')); remember(current, 'replaced'); }
                schedule(value, 'manual');
                current = value;
                singerState.lastTurnBySinger.set(normalizeSinger(current.requestedBy), ++turnCounter);
                issue(commandFor('play', { itemId: current.itemId, videoId: current.videoId, position: 0 }));
                return send(response, 201, { current: serializeItem(current), queue: queue.map(serializeItem), history });
            }
            if (request.method === 'POST' && urlObject.pathname === '/queue/play') {
                const value = await body(request) as { itemId?: unknown };
                if (typeof value.itemId !== 'string' || !value.itemId) return send(response, 400, { error: 'itemId required' });
                if (current?.itemId === value.itemId) return send(response, 409, { error: 'item is already playing' });
                const index = queue.findIndex((item) => item.itemId === value.itemId);
                if (index === -1) return send(response, 404, { error: 'item not found in queue' });
                const [selected] = queue.splice(index, 1);
                if (current) { issue(commandFor('skip')); remember(current, 'replaced'); }
                current = selected;
                singerState.lastTurnBySinger.set(normalizeSinger(current.requestedBy), ++turnCounter);
                issue(commandFor('play', { itemId: current.itemId, videoId: current.videoId, position: 0 }));
                return send(response, 200, { current: serializeItem(current), queue: queue.map(serializeItem), history });
            }
            if (request.method === 'POST' && urlObject.pathname === '/queue/clear') {
                queue.length = 0;
                return send(response, 200, { queue });
            }
            if (request.method === 'POST' && urlObject.pathname === '/queue/remove') {
                const value = await body(request) as { itemId?: unknown };
                if (typeof value.itemId !== 'string' || value.itemId.length === 0) return send(response, 400, { error: 'itemId required' });
                if (current?.itemId === value.itemId) return send(response, 409, { error: 'cannot remove the currently playing item; skip instead' });
                const index = queue.findIndex((item) => item.itemId === value.itemId);
                if (index === -1) return send(response, 404, { error: 'item not found in queue' });
                queue.splice(index, 1);
                return send(response, 200, { queue: queue.map(serializeItem) });
            }
            if (request.method === 'POST' && urlObject.pathname === '/queue/move') {
                const value = await body(request) as { itemId?: unknown; position?: unknown };
                if (typeof value.itemId !== 'string' || value.itemId.length === 0) return send(response, 400, { error: 'itemId required' });
                if (typeof value.position !== 'number' || !Number.isFinite(value.position)) return send(response, 400, { error: 'position must be a number' });
                if (current?.itemId === value.itemId) return send(response, 400, { error: 'cannot move the currently playing item' });
                const index = queue.findIndex((item) => item.itemId === value.itemId);
                if (index === -1) return send(response, 400, { error: 'item not found in queue' });
                const target = Math.max(0, Math.min(queue.length - 1, Math.trunc(value.position)));
                const [moved] = queue.splice(index, 1);
                queue.splice(target, 0, moved);
                markPlacement(moved.itemId, 'manual');
                return send(response, 200, { queue: queue.map(serializeItem) });
            }
            if (request.method === 'POST' && urlObject.pathname === '/events') {
                const event = playbackEventSchema.parse(await body(request)) as PlaybackEvent;
                const key = JSON.stringify(event);
                if (acceptedEvents.has(key)) return send(response, 204);
                if (!current || event.roomId !== options.roomId || event.itemId !== current.itemId || event.videoId !== current.videoId || event.commandId !== activeCommand?.commandId) return send(response, 409, { error: 'stale playback identity' });
                if (event.sequence <= lastEventSequence) return send(response, 409, { error: 'stale event sequence' });
                lastEventSequence = event.sequence;
                acceptedEvents.add(key);
                if (acceptedEvents.size > 512) acceptedEvents.delete(acceptedEvents.values().next().value!);
                playback.lastSeen = now();
                if (event.type !== 'ready') playback.state = event.type;
                if (event.type === 'error') { playback.error = event.message; loadingDeadline = null; }
                else if (event.type === 'playing' || event.type === 'paused') { playback.error = null; loadingDeadline = null; }
                if (event.type === 'ended') { remember(current, 'ended', event.timestamp); const previousSinger = singerOfCurrent(); current = null; startNext(previousSinger); }
                return send(response, 204);
            }
            if (request.method === 'POST' && urlObject.pathname === '/control/auto-kj') {
                const value = await body(request) as { enabled?: unknown };
                if (typeof value.enabled !== 'boolean') return send(response, 400, { error: 'enabled must be a boolean' });
                if (value.enabled !== autoKjEnabled) {
                    autoKjEnabled = value.enabled;
                    await persistAutoKjState();
                    console.log('[control-plane]', 'auto-kj', autoKjEnabled ? 'enabled' : 'disabled', '(host toggle)');
                }
                return send(response, 200, { autoKj: { enabled: autoKjEnabled } });
            }
            if (request.method === 'POST' && urlObject.pathname === '/control/skip') {
                const value = await body(request);
                if (value.expectedItemId !== undefined) {
                    if (!itemIdSchema.safeParse(value.expectedItemId).success) return send(response, 400, { error: 'invalid expectedItemId' });
                    if (value.expectedItemId !== current?.itemId) return send(response, 409, { error: 'current item changed' });
                }
                skip(); return send(response, 204);
            }
            if (request.method === 'POST' && urlObject.pathname === '/control/fullscreen') { issue(commandFor('fullscreen')); return send(response, 204); }
            if (request.method === 'POST' && ['/control/pause', '/control/resume', '/control/volume'].includes(urlObject.pathname)) {
                const type = urlObject.pathname.slice('/control/'.length) as 'pause' | 'resume' | 'volume';
                const value = type === 'volume' ? await body(request) as { volume: number } : {};
                const commandType = type === 'volume' ? 'setVolume' : type;
                issue(commandFor(commandType, type === 'volume' ? { volume: (value as { volume: unknown }).volume } : {})); return send(response, 204);
            }
            return send(response, 404, { error: 'not found' });
        } catch (error) { return send(response, 400, { error: error instanceof Error ? error.message : 'bad request' }); }
    };
    return {
        get url() { return url; },
        get bind() { return bind; },
        listen(port) {
            return readAutoKjState().then(() => new Promise((resolve, reject) => {
                server = createServer((request, response) => void handler(request, response));
                server.once('error', (error) => {
                    server = undefined;
                    reject(error);
                });
                server.listen(port, bind, () => {
                    const address = server?.address();
                    const actual = typeof address === 'object' && address ? address.port : port;
                    url = `http://127.0.0.1:${actual}`;
                    resolve();
                });
            }));
        },
        close() { return new Promise((resolve, reject) => { if (!server) return resolve(); server.close((error) => error ? reject(error) : resolve()); }); },
    };
}
