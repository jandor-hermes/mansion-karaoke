import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { playbackCommandSchema, playbackEventSchema, type PlaybackCommand, type PlaybackEvent } from '../../../packages/playback-protocol/src';
import { createUnavailableSearchAdapter, type SearchAdapter } from './search.js';
import { guestPage } from './guest-ui.js';

export type ControlPlane = { url: string; bind: string; listen(port: number): Promise<void>; close(): Promise<void> };
type QueueItem = { itemId: string; videoId: string };
type Options = { token: string; roomId: string; search?: SearchAdapter; bind?: string };

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
    const queue: QueueItem[] = [];
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
    const skip = () => { if (current) { issue(commandFor('skip')); current = null; startNext(); } };
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
            if (request.method === 'GET' && urlObject.pathname === '/status') return send(response, 200, { roomId: options.roomId, current, queue, sequence });
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
            if (request.method === 'GET' && urlObject.pathname === '/command') {
                const after = Number(urlObject.searchParams.get('after') ?? 0);
                const next = commands.find((entry) => entry.sequence > after);
                return send(response, 200, next ? next : { command: null, sequence });
            }
            if (request.method === 'POST' && urlObject.pathname === '/queue') {
                const value = await body(request) as QueueItem;
                if (!value.itemId || !value.videoId) return send(response, 400, { error: 'itemId and videoId required' });
                if (current?.itemId === value.itemId || queue.some((item) => item.itemId === value.itemId)) return send(response, 200, value);
                const wasIdle = !current; queue.push(value); if (wasIdle) startNext();
                return send(response, 201, value);
            }
            if (request.method === 'POST' && urlObject.pathname === '/events') {
                const event = playbackEventSchema.parse(await body(request)) as PlaybackEvent;
                if (event.type === 'ended' && current?.itemId === event.itemId) { current = null; startNext(); }
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
