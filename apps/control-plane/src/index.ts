import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { playbackCommandSchema, playbackEventSchema, type PlaybackCommand, type PlaybackEvent } from '../../../packages/playback-protocol/src/index.js';
import { createUnavailableSearchAdapter, type SearchAdapter } from './search.js';
import { guestPage } from './guest-ui.js';

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
type Options = { token: string; roomId: string; search?: SearchAdapter; suggest?: SuggestionAdapter; bind?: string };

const queueMetadataFields = ['title', 'channel', 'duration', 'thumbnail', 'requestedBy'] as const;

function parseQueueItem(value: unknown): QueueItem | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.itemId !== 'string' || candidate.itemId.length === 0
        || typeof candidate.videoId !== 'string' || candidate.videoId.length === 0) return null;
    const item: QueueItem = { itemId: candidate.itemId, videoId: candidate.videoId };
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
    let server: Server | undefined;
    let url = '';
    const bind = options.bind ?? resolveBindAddress(process.env);

    const issue = (command: PlaybackCommand) => { commands.push({ sequence: ++sequence, command }); };
    const commandFor = (type: PlaybackCommand['type'], extra: Record<string, unknown> = {}): PlaybackCommand => playbackCommandSchema.parse({
        type, commandId: randomUUID(), roomId: options.roomId, issuedAt: Date.now(), ...extra,
    });
    const startNext = () => {
        current = queue.shift() ?? null;
        if (current) issue(commandFor('play', { itemId: current.itemId, videoId: current.videoId, position: 0 }));
    };
    const hasItemId = (itemId: string) => current?.itemId === itemId || queue.some((item) => item.itemId === itemId);
    const remember = (item: QueueItem, reason: 'ended' | 'skipped' | 'replaced', completedAt = Date.now()) => {
        history.unshift({ ...item, completedAt, reason });
        if (history.length > 100) history.length = 100;
    };
    const skip = () => { if (current) { issue(commandFor('skip')); remember(current, 'skipped'); current = null; startNext(); } };
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
        if (request.headers.authorization !== `Bearer ${options.token}`) return send(response, 401, { error: 'unauthorized' });
        const urlObject = new URL(request.url ?? '/', url || 'http://127.0.0.1');
        try {
            if (request.method === 'GET' && urlObject.pathname === '/status') return send(response, 200, { roomId: options.roomId, current, queue, history, sequence });
            if (request.method === 'POST' && urlObject.pathname === '/search') {
                const value = await body(request) as { query?: unknown; continuation?: unknown };
                if (typeof value.query !== 'string' || value.query.trim().length === 0) return send(response, 400, { error: 'query required' });
                if (value.continuation !== undefined && typeof value.continuation !== 'string') return send(response, 400, { error: 'continuation must be a string' });
                try {
                    return send(response, 200, await search.search(value.query, value.continuation as string | undefined));
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
                const after = Number(urlObject.searchParams.get('after') ?? 0);
                const next = commands.find((entry) => entry.sequence > after);
                return send(response, 200, next ? next : { command: null, sequence });
            }
            if (request.method === 'POST' && urlObject.pathname === '/queue') {
                const value = parseQueueItem(await body(request));
                if (!value) return send(response, 400, { error: 'itemId and videoId required' });
                if (current?.itemId === value.itemId || queue.some((item) => item.itemId === value.itemId)) return send(response, 200, value);
                const wasIdle = !current; queue.push(value); if (wasIdle) startNext();
                return send(response, 201, value);
            }
            if (request.method === 'POST' && urlObject.pathname === '/queue/next') {
                const value = parseQueueItem(await body(request));
                if (!value) return send(response, 400, { error: 'valid itemId, videoId, and string metadata required' });
                if (hasItemId(value.itemId)) return send(response, 200, { current, queue });
                queue.unshift(value);
                if (!current) startNext();
                return send(response, 201, { current, queue });
            }
            if (request.method === 'POST' && urlObject.pathname === '/queue/play-now') {
                const value = parseQueueItem(await body(request));
                if (!value) return send(response, 400, { error: 'valid itemId, videoId, and string metadata required' });
                if (hasItemId(value.itemId)) return send(response, 200, { current, queue, history });
                if (current) { issue(commandFor('skip')); remember(current, 'replaced'); }
                current = value;
                issue(commandFor('play', { itemId: current.itemId, videoId: current.videoId, position: 0 }));
                return send(response, 201, { current, queue, history });
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
                issue(commandFor('play', { itemId: current.itemId, videoId: current.videoId, position: 0 }));
                return send(response, 200, { current, queue, history });
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
                return send(response, 200, { queue });
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
                return send(response, 200, { queue });
            }
            if (request.method === 'POST' && urlObject.pathname === '/events') {
                const event = playbackEventSchema.parse(await body(request)) as PlaybackEvent;
                if (event.type === 'ended' && current?.itemId === event.itemId) { remember(current, 'ended', event.timestamp); current = null; startNext(); }
                return send(response, 204);
            }
            if (request.method === 'POST' && urlObject.pathname === '/control/skip') { skip(); return send(response, 204); }
            if (request.method === 'POST' && urlObject.pathname === '/control/fullscreen') { issue(commandFor('fullscreen')); return send(response, 204); }
            if (request.method === 'POST' && ['/control/pause', '/control/resume', '/control/volume'].includes(urlObject.pathname)) {
                const type = urlObject.pathname.slice('/control/'.length) as 'pause' | 'resume' | 'volume';
                const value = type === 'volume' ? await body(request) as { volume: number } : {};
                const commandType = type === 'volume' ? 'setVolume' : type;
                issue(commandFor(commandType, value)); return send(response, 204);
            }
            return send(response, 404, { error: 'not found' });
        } catch (error) { return send(response, 400, { error: error instanceof Error ? error.message : 'bad request' }); }
    };
    return {
        get url() { return url; },
        get bind() { return bind; },
        listen(port) {
            return new Promise((resolve) => {
                server = createServer((request, response) => void handler(request, response));
                server.listen(port, bind, () => {
                    const address = server?.address();
                    const actual = typeof address === 'object' && address ? address.port : port;
                    url = `http://127.0.0.1:${actual}`;
                    resolve();
                });
            });
        },
        close() { return new Promise((resolve, reject) => { if (!server) return resolve(); server.close((error) => error ? reject(error) : resolve()); }); },
    };
}
