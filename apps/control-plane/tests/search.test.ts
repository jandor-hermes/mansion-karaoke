import { afterEach, describe, expect, it } from 'vitest';
import { createControlPlane, type ControlPlane } from '../src/index.js';
import { createSearchAdapter, type SearchVideo } from '../src/search.js';

const fixture: SearchVideo[] = [{
    id: 'abc123', title: 'Karaoke Song', channel: 'Sing King',
    duration: '4:00', thumbnail: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
}];

let planes: ControlPlane[] = [];
afterEach(async () => { await Promise.all(planes.splice(0).map((plane) => plane.close())); });

async function start(search?: ReturnType<typeof createSearchAdapter>) {
    const plane = createControlPlane({ token: 'test-token', roomId: 'room-1', search });
    await plane.listen(0); planes.push(plane); return plane;
}
async function request(plane: ControlPlane, path: string, init: RequestInit = {}) {
    return fetch(`${plane.url}${path}`, { ...init, headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
}

describe('control-plane search adapter boundary', () => {
    it('returns normalized search results through POST /search', async () => {
        const calls: string[] = [];
        const plane = await start(createSearchAdapter(async (query, continuation) => {
            calls.push(`${query}:${continuation ?? ''}`);
            return { items: fixture, continuation: 'next-page' };
        }));
        const response = await request(plane, '/search', { method: 'POST', body: JSON.stringify({ query: 'karaoke' }) });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ items: fixture, continuation: 'next-page' });
        expect(calls).toEqual(['karaoke:']);
    });

    it('passes continuation to the adapter and rejects blank queries', async () => {
        let received: [string, string | undefined] | undefined;
        const plane = await start(createSearchAdapter(async (query, continuation) => {
            received = [query, continuation]; return { items: [], continuation: null };
        }));
        expect((await request(plane, '/search', { method: 'POST', body: JSON.stringify({ query: ' song ', continuation: 'token' }) })).status).toBe(200);
        expect(received).toEqual(['song karaoke', 'token']);
        expect((await request(plane, '/search', { method: 'POST', body: JSON.stringify({ query: '   ' }) })).status).toBe(400);
    });

    it('appends " karaoke" to a query that lacks the keyword', async () => {
        const calls: string[] = [];
        const plane = await start(createSearchAdapter(async (query) => {
            calls.push(query); return { items: [], continuation: null };
        }));
        const response = await request(plane, '/search', { method: 'POST', body: JSON.stringify({ query: 'sweet caroline' }) });
        expect(response.status).toBe(200);
        expect(calls).toEqual(['sweet caroline karaoke']);
    });

    it('passes a query already containing karaoke through unmodified, preserving case and whitespace', async () => {
        const calls: string[] = [];
        const plane = await start(createSearchAdapter(async (query) => {
            calls.push(query); return { items: [], continuation: null };
        }));
        const response = await request(plane, '/search', { method: 'POST', body: JSON.stringify({ query: 'Sweet Caroline KARAOKE' }) });
        expect(response.status).toBe(200);
        expect(calls).toEqual(['Sweet Caroline KARAOKE']);
    });

    it('detects a mixed-case karaoke substring and skips the rewrite', async () => {
        const calls: string[] = [];
        const plane = await start(createSearchAdapter(async (query) => {
            calls.push(query); return { items: [], continuation: null };
        }));
        const response = await request(plane, '/search', { method: 'POST', body: JSON.stringify({ query: 'Bohemian Rhapsody Karaoke Version' }) });
        expect(response.status).toBe(200);
        expect(calls).toEqual(['Bohemian Rhapsody Karaoke Version']);
    });

    it('reports an explicit integration gate when no adapter is configured', async () => {
        const plane = await start();
        const response = await request(plane, '/search', { method: 'POST', body: JSON.stringify({ query: 'karaoke' }) });
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: 'search_not_configured' });
    });
});
