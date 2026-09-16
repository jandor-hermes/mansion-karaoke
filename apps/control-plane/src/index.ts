import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { playbackCommandSchema, playbackEventSchema, type PlaybackCommand, type PlaybackEvent } from '../../../packages/playback-protocol/src';

export type ControlPlane = { url: string; listen(port: number): Promise<void>; close(): Promise<void> };
type QueueItem = { itemId: string; videoId: string };
type Options = { token: string; roomId: string };

export function createControlPlane(options: Options): ControlPlane {
    const queue: QueueItem[] = [];
    const commands: Array<{ sequence: number; command: PlaybackCommand }> = [];
    let current: QueueItem | null = null;
    let sequence = 0;
    let server: Server | undefined;
    let url = '';

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
    const handler = async (request: IncomingMessage, response: ServerResponse) => {
        if (request.headers.authorization !== `Bearer ${options.token}`) return send(response, 401, { error: 'unauthorized' });
        const urlObject = new URL(request.url ?? '/', url || 'http://127.0.0.1');
        try {
            if (request.method === 'GET' && urlObject.pathname === '/status') return send(response, 200, { roomId: options.roomId, current, queue, sequence });
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
        listen(port) { return new Promise((resolve) => { server = createServer((request, response) => void handler(request, response)); server.listen(port, '127.0.0.1', () => { const address = server?.address(); const actual = typeof address === 'object' && address ? address.port : port; url = `http://127.0.0.1:${actual}`; resolve(); }); }); },
        close() { return new Promise((resolve, reject) => { if (!server) return resolve(); server.close((error) => error ? reject(error) : resolve()); }); },
    };
}
