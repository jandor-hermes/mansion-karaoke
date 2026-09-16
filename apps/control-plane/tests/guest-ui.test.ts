import { afterEach, describe, expect, it } from 'vitest';
import { createControlPlane, type ControlPlane, isAllowedOrigin, resolveBindAddress } from '../src/index.js';

let planes: ControlPlane[] = [];
afterEach(async () => { await Promise.all(planes.splice(0).map((plane) => plane.close())); });

async function start(bind?: string) {
    const plane = createControlPlane({ token: 'test-token', roomId: 'party-room', ...(bind ? { bind } : {}) });
    await plane.listen(0);
    planes.push(plane);
    return plane;
}

describe('guest UI CORS policy', () => {
    it('accepts same-LAN http origins and loopback origins', () => {
        expect(isAllowedOrigin('http://192.168.4.31:3010')).toBe(true);
        expect(isAllowedOrigin('http://192.168.0.1')).toBe(true);
        expect(isAllowedOrigin('http://10.0.0.5:3010')).toBe(true);
        expect(isAllowedOrigin('http://172.16.0.9:3010')).toBe(true);
        expect(isAllowedOrigin('http://172.31.255.255:3010')).toBe(true);
        expect(isAllowedOrigin('http://localhost:3010')).toBe(true);
        expect(isAllowedOrigin('http://127.0.0.1:3010')).toBe(true);
        expect(isAllowedOrigin('moz-extension://local-karaoke-player')).toBe(true);
    });

    it('rejects non-LAN, private-range edge, and https origins', () => {
        expect(isAllowedOrigin('https://192.168.4.31:3010')).toBe(false);
        expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
        expect(isAllowedOrigin('http://example.com')).toBe(false);
        expect(isAllowedOrigin('http://172.32.0.1:3010')).toBe(false);
        expect(isAllowedOrigin('http://172.15.0.1:3010')).toBe(false);
        expect(isAllowedOrigin('http://193.168.4.31:3010')).toBe(false);
        expect(isAllowedOrigin('http://1025.168.4.31:3010')).toBe(false);
        expect(isAllowedOrigin(undefined)).toBe(false);
        expect(isAllowedOrigin('not a url')).toBe(false);
    });

    it('applies the CORS policy to real responses', async () => {
        const plane = await start();
        const allowed = await fetch(`${plane.url}/status`, {
            method: 'OPTIONS',
            headers: { Origin: 'http://192.168.4.99:8080', 'Access-Control-Request-Method': 'GET' },
        });
        expect(allowed.headers.get('access-control-allow-origin')).toBe('http://192.168.4.99:8080');
        const denied = await fetch(`${plane.url}/status`, {
            method: 'OPTIONS',
            headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'GET' },
        });
        expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    });
});

describe('guest UI page', () => {
    it('serves the phone guest UI at GET / without a token', async () => {
        const plane = await start();
        const response = await fetch(`${plane.url}/`);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/html');
        const html = await response.text();
        expect(html).toContain('karaoke-search');          // search input
        expect(html).toContain('now-playing');            // now playing section
        expect(html).toContain('queue-list');              // queue list
        expect(html).toContain('/search');                 // API wiring
        expect(html).toContain('/control/skip');           // control buttons
        expect(html).toContain('/control/volume');
        expect(html).toContain('/control/fullscreen');
        expect(html).toContain('/queue/remove');          // queue remove button
        expect(html).toContain('/queue/move');            // queue move up/down buttons
        expect(html).toContain('queue-remove');           // button markers
        expect(html).toContain('queue-up');
        expect(html).toContain('queue-down');
        expect(html).toContain('song-actions');
        expect(html).toContain('action-add');
        expect(html).toContain('action-next');
        expect(html).toContain('action-now');
        expect(html).toContain('play-now-confirm');
        expect(html).toContain('/queue/next');
        expect(html).toContain('/queue/play-now');
        expect(html).toContain('/suggest?q=');
        expect(html).toContain('search-suggestions');
        expect(html).toContain('karaoke-recent-searches');
        expect(html).toContain('bottom-nav');
        expect(html).toContain('nav-search');
        expect(html).toContain('nav-queue');
        expect(html).toContain('nav-controls');
        expect(html).toContain('controller-shell');
        expect(html).toContain('change-token');
        expect(html).toContain('quick-add');
        expect(html).toContain('load-more');
        expect(html).toContain("$('results').textContent='';visibleResults=0;renderMore()");
        expect(html).toContain("clearTimeout(suggestTimer);suggestSequence++;$('search-suggestions').textContent='';");
        expect(html).toContain('toast');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('aria-label="Pause playback"');
        expect(html).toContain('history-list');
        expect(html).toContain('queue-play');
        expect(html).toContain('/queue/play');
        expect(html).toContain('localStorage');            // token storage
        expect(html).toContain('party-room');              // room name in header
        expect(html).toContain('viewport');                // phone-friendly
    });

    it('still protects the API behind the token', async () => {
        const plane = await start();
        expect((await fetch(`${plane.url}/status`)).status).toBe(401);
    });
});

describe('bind address behavior', () => {
    it('defaults to binding all interfaces and stays reachable via loopback', async () => {
        const plane = await start();
        expect(plane.bind).toBe('0.0.0.0');
        const response = await fetch(`${plane.url}/status`, { headers: { Authorization: 'Bearer test-token' } });
        expect(response.status).toBe(200);
    });

    it('keeps 127.0.0.1 selectable', async () => {
        const plane = await start('127.0.0.1');
        expect(plane.bind).toBe('127.0.0.1');
        const response = await fetch(`${plane.url}/status`, { headers: { Authorization: 'Bearer test-token' } });
        expect(response.status).toBe(200);
    });

    it('resolves the bind address from the environment', () => {
        expect(resolveBindAddress({})).toBe('0.0.0.0');
        expect(resolveBindAddress({ KARAOKE_BIND: '127.0.0.1' })).toBe('127.0.0.1');
    });
});
