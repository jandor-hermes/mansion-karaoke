import { afterEach, describe, expect, it, vi } from 'vitest';
import { guestPage, guestWorker } from '../src/guest-ui.js';

type Listener = (event: any) => any;

class FakeNode {
    id = '';
    value = '';
    private _textContent = '';
    private _innerHTML = '';
    get textContent() { return this._textContent; }
    set textContent(value: string) { this._textContent = String(value); this.children = []; }
    get innerHTML() { return this._innerHTML; }
    set innerHTML(value: string) { this._innerHTML = String(value); this.children = []; }
    hidden = false;
    disabled = false;
    className = '';
    tagName = '';
    dataset: Record<string, string> = {};
    children: FakeNode[] = [];
    parent: FakeNode | null = null;
    attributes = new Map<string, string>();
    listeners = new Map<string, Listener[]>();
    classList = {
        values: new Set<string>(),
        toggle: (name: string, force?: boolean) => {
            const enabled = force === undefined ? !this.classList.values.has(name) : force;
            if (enabled) this.classList.values.add(name); else this.classList.values.delete(name);
            return enabled;
        },
        add: (...names: string[]) => names.forEach((name) => this.classList.values.add(name)),
        remove: (...names: string[]) => names.forEach((name) => this.classList.values.delete(name)),
        contains: (name: string) => this.classList.values.has(name),
    };

    addEventListener(type: string, listener: Listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    dispatch(type: string, extra: Record<string, unknown> = {}) {
        for (const listener of this.listeners.get(type) || []) listener({
            preventDefault() {}, target: this, currentTarget: this, ...extra,
        });
    }

    append(...nodes: FakeNode[]) { nodes.forEach((node) => this.appendChild(node)); }
    appendChild(node: FakeNode) { node.parent = this; this.children.push(node); return node; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    getAttribute(name: string) { return this.attributes.get(name) || null; }
    showModal() { this.hidden = false; }
    close() { this.hidden = true; }
    focus() {}
    requestSubmit() { this.dispatch('submit'); }
    closest(selector: string): FakeNode | null {
        if (selector === 'button' && this.tagName === 'button') return this;
        if (selector.startsWith('.') && this.className.split(/\s+/).includes(selector.slice(1))) return this;
        return this.parent?.closest(selector) || null;
    }
    querySelectorAll(selector: string): FakeNode[] {
        const wantedClass = selector.startsWith('.') ? selector.slice(1) : null;
        const wantedTag = selector === 'button' ? 'button' : null;
        return this.children.flatMap((child) => [
            ...((wantedClass && child.className.split(/\s+/).includes(wantedClass)) || (wantedTag && child.tagName === wantedTag) ? [child] : []),
            ...child.querySelectorAll(selector),
        ]);
    }
    querySelector(selector: string): FakeNode | null { return this.querySelectorAll(selector)[0] || null; }
}

function response(status: number, body: unknown = {}) {
    return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
}

async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

function boot(options: { stored?: Record<string, string>, fetch: (path: string, init?: RequestInit) => Promise<any>, worker?: any }) {
    const nodes = new Map<string, FakeNode>();
    const ids = [...guestPage('party-room').matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    for (const id of ids) {
        const node = new FakeNode();
        node.id = id;
        if (id.includes('button') || id.startsWith('action-') || id.startsWith('control-') || id.startsWith('volume-') || id.startsWith('nav-') || id === 'token-save' || id === 'change-token' || id === 'load-more' || id === 'clear-queue') node.className = 'button';
        nodes.set(id, node);
    }
    const storage = new Map(Object.entries(options.stored || {}));
    const timers: Array<() => void> = [];
    const documentListeners = new Map<string, Listener[]>();
    const document = {
        getElementById: (id: string) => nodes.get(id) || null,
        querySelectorAll: (_selector: string) => [],
        visibilityState: 'visible',
        addEventListener: (type: string, listener: Listener) => {
            const listeners = documentListeners.get(type) || [];
            listeners.push(listener);
            documentListeners.set(type, listeners);
        },
        createElement: (tag: string) => { const node = new FakeNode(); node.tagName = tag; node.className = tag === 'button' ? 'button' : ''; return node; },
    };
    const html = guestPage('party-room');
    const script = html.match(/<script>\n([\s\S]*?)\n<\/script>/)?.[1];
    if (!script) throw new Error('guest page has no script');
    const run = new Function('document', 'localStorage', 'location', 'history', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'URLSearchParams', 'globalThis', 'Worker', script);
    run(document, {
        getItem: (key: string) => storage.get(key) || null,
        setItem: (key: string, value: string) => storage.set(key, String(value)),
        removeItem: (key: string) => storage.delete(key),
    }, { hash: '', pathname: '/', search: '' }, { replaceState() {} }, options.fetch, (callback: () => void) => { timers.push(callback); return timers.length; }, () => {}, (callback: () => void) => { timers.push(callback); return timers.length; }, URLSearchParams, { crypto: undefined }, options.worker);
    return { nodes, storage, timers, documentListeners };
}

class FakeWorker {
    url: string;
    onmessage: Listener | null = null;
    messages: any[] = [];
    terminated = false;
    constructor(url: string) { this.url = url; }
    postMessage(data: any) { this.messages.push(data); }
    terminate() { this.terminated = true; }
    receive(data: any) { if (this.onmessage) this.onmessage({ data }); }
}

describe('guest UI resilience', () => {
    it('keeps a saved token through a startup network outage and recovers on its retry timer', async () => {
        let attempts = 0;
        const page = boot({
            stored: { 'karaoke-token-party-room': 'saved-token', 'karaoke-name-party-room': 'Ada' },
            fetch: async () => {
                attempts++;
                if (attempts === 1) throw new TypeError('network down');
                return response(200, { current: { itemId: 'now', videoId: 'song', title: 'Song' }, queue: [], history: [], playback: { state: 'playing', error: null, lastSeen: Date.now(), volume: .75 } });
            },
        });

        await settle();

        expect(page.storage.get('karaoke-token-party-room')).toBe('saved-token');
        expect(page.nodes.get('controller-shell')?.hidden).toBe(false);
        expect(page.nodes.get('control-status')?.textContent).toMatch(/disconnected|retrying/i);
        page.timers[0]!();
        await settle();
        expect(page.nodes.get('control-toggle')!.getAttribute('aria-label')).toBe('Pause playback');
        expect(page.nodes.get('control-status')!.textContent).toMatch(/connected/i);
        // The periodic retry remains active after recovery; a subsequent successful
        // refresh keeps the authoritative connected state.
        page.timers[0]!();
        await settle();
        expect(page.nodes.get('control-status')!.textContent).toMatch(/connected/i);
    });

    it('expires unchanged playback snapshots after ten seconds and recovers on a new heartbeat', async () => {
        let now = 1_000_000;
        const realNow = Date.now;
        Date.now = () => now;
        try {
            const status = { current: { itemId: 'now', videoId: 'song', title: 'Song' }, queue: [], history: [], playback: { state: 'playing', error: null, lastSeen: now, volume: .75 } };
            const page = boot({
                stored: { 'karaoke-token-party-room': 'saved-token', 'karaoke-name-party-room': 'Ada' },
                fetch: async () => response(200, status),
            });
            await settle();
            expect(page.nodes.get('control-toggle')!.getAttribute('aria-label')).toBe('Pause playback');

            page.timers[0]!();
            await settle();
            now += 10001;
            page.timers[0]!();
            await settle();
            expect(page.nodes.get('control-toggle')!.getAttribute('aria-label')).toBe('Playback state unavailable');
            expect(page.nodes.get('control-status')!.textContent).toMatch(/disconnected/i);

            status.playback.lastSeen = now;
            page.timers[0]!();
            await settle();
            expect(page.nodes.get('control-toggle')!.getAttribute('aria-label')).toBe('Pause playback');
        } finally {
            Date.now = realNow;
        }
    });

    it('distinguishes extension connection from loading playback and gives Skip guidance for player errors', async () => {
        const status = { current: { itemId: 'now', videoId: 'song', title: 'Song' }, queue: [], history: [], playback: { state: 'loading', error: null, lastSeen: Date.now(), volume: .75 } };
        const page = boot({
            stored: { 'karaoke-token-party-room': 'saved-token', 'karaoke-name-party-room': 'Ada' },
            fetch: async () => response(200, status),
        });
        await settle();
        expect(page.nodes.get('control-status')!.textContent).toMatch(/extension connected/i);
        expect(page.nodes.get('control-status')!.textContent).toMatch(/playback.*not observed|skip/i);
        expect(page.nodes.get('control-status')!.textContent).not.toBe('Player connected. Controls reflect the TV.');

        status.playback.state = 'error';
        status.playback.error = 'Video unavailable';
        page.timers[0]!();
        await settle();
        expect(page.nodes.get('control-status')!.textContent).toMatch(/Video unavailable/);
        expect(page.nodes.get('control-status')!.textContent).toMatch(/Skip/i);
    });

    it('ignores an older full-search response after a newer search completes', async () => {
        const firstSearch = deferred<any>();
        const page = boot({
            stored: { 'karaoke-token-party-room': 'saved-token', 'karaoke-name-party-room': 'Ada' },
            fetch: async (path, init) => {
                if (path === '/status') return response(200, { current: null, queue: [], history: [], playback: {} });
                const query = JSON.parse(String(init?.body)).query;
                if (query === 'first') return firstSearch.promise;
                return response(200, { items: [{ id: 'new-song', title: 'New song' }] });
            },
        });
        await settle();

        page.nodes.get('karaoke-search')!.value = 'first';
        page.nodes.get('search-form')!.dispatch('submit');
        await settle();
        page.nodes.get('karaoke-search')!.value = 'second';
        page.nodes.get('search-form')!.dispatch('submit');
        await settle();
        firstSearch.resolve(response(200, { items: [{ id: 'old-song', title: 'Old song' }] }));
        await settle();

        expect(page.nodes.get('results')!.children[0]?.dataset.videoId).toBe('new-song');
        expect(page.nodes.get('search-status')!.textContent).toBe('1 results — ordered by YouTube relevance');
    });

    it('preserves prior useful results when a later search errors', async () => {
        const page = boot({
            stored: { 'karaoke-token-party-room': 'saved-token', 'karaoke-name-party-room': 'Ada' },
            fetch: async (path, init) => {
                if (path === '/status') return response(200, { current: null, queue: [], history: [], playback: {} });
                return JSON.parse(String(init?.body)).query === 'good'
                    ? response(200, { items: [{ id: 'kept-song', title: 'Keep this' }] })
                    : response(503);
            },
        });
        await settle();
        page.nodes.get('karaoke-search')!.value = 'good';
        page.nodes.get('search-form')!.dispatch('submit');
        await settle();
        page.nodes.get('karaoke-search')!.value = 'offline';
        page.nodes.get('search-form')!.dispatch('submit');
        await settle();

        expect(page.nodes.get('results')!.children[0]?.dataset.videoId).toBe('kept-song');
        expect(page.nodes.get('search-status')!.textContent).toMatch(/search failed/i);
    });

    it('escapes the video id in the action-sheet preview link', async () => {
        const page = boot({
            stored: { 'karaoke-token-party-room': 'saved-token', 'karaoke-name-party-room': 'Ada' },
            fetch: async (path, init) => {
                if (path === '/status') return response(200, { current: null, queue: [], history: [], playback: {} });
                if (path === '/search') return response(200, { items: [{ id: 'abc"<script>', title: 'Evil' }] });
                throw new Error(`unexpected ${path}`);
            },
        });
        await settle();
        page.nodes.get('karaoke-search')!.value = 'evil';
        page.nodes.get('search-form')!.dispatch('submit');
        await settle();

        page.nodes.get('results')!.children[0]!.querySelector('.result-main')!.dispatch('click');
        const preview = page.nodes.get('action-preview')!;
        expect(preview.getAttribute('href')).toBe('https://youtu.be/abc&quot;&lt;script&gt;');
        expect(page.nodes.get('song-actions')!.hidden).toBe(false);
        expect(page.nodes.get('song-actions-title')!.textContent).toBe('Evil');
    });

    it('opens the action sheet with the preview link from a queue card', async () => {
        const page = boot({
            stored: { 'karaoke-token-party-room': 'saved-token', 'karaoke-name-party-room': 'Ada' },
            fetch: async (path) => {
                if (path === '/status') return response(200, { current: null, queue: [{ itemId: 'q1', videoId: 'queue-vid', title: 'Queued Song', channel: 'Ch', duration: '3:00' }], history: [], playback: {} });
                throw new Error(`unexpected ${path}`);
            },
        });
        await settle();

        const more = new FakeNode();
        more.tagName = 'button';
        more.classList.add('secondary', 'queue-more');
        more.dataset.itemId = 'q1';
        page.nodes.get('queue-list')!.dispatch('click', { target: more });

        expect(page.nodes.get('action-preview')!.getAttribute('href')).toBe('https://youtu.be/queue-vid');
        expect(page.nodes.get('song-actions-title')!.textContent).toBe('Queued Song');
        expect(page.nodes.get('action-add')!.hidden).toBe(true);
        expect(page.nodes.get('action-next')!.hidden).toBe(true);
        expect(page.nodes.get('action-now')!.hidden).toBe(true);
        expect(page.nodes.get('action-cancel')!.hidden).toBe(false);
    });

    it('shows the search spinner and marks the results container while a search is in flight', async () => {
        const search = deferred<any>();
        const page = boot({
            stored: { 'karaoke-token-party-room': 'saved-token', 'karaoke-name-party-room': 'Ada' },
            fetch: async (path) => {
                if (path === '/status') return response(200, { current: null, queue: [], history: [], playback: {} });
                return search.promise;
            },
        });
        await settle();
        page.nodes.get('karaoke-search')!.value = 'song';
        page.nodes.get('search-form')!.dispatch('submit');
        await settle();

        expect(page.nodes.get('search-spinner')!.hidden).toBe(false);
        expect(page.nodes.get('results')!.classList.contains('searching')).toBe(true);

        search.resolve(response(200, { items: [{ id: 'song-id', title: 'Song' }] }));
        await settle();
        expect(page.nodes.get('search-spinner')!.hidden).toBe(true);
        expect(page.nodes.get('results')!.classList.contains('searching')).toBe(false);
    });

    it('shows labeled recent-search suggestions when the empty search input is focused', async () => {
        const page = boot({
            stored: {
                'karaoke-token-party-room': 'saved-token',
                'karaoke-name-party-room': 'Ada',
                'karaoke-recent-searches': JSON.stringify(['sweet caroline', 'bohemian rhapsody']),
            },
            fetch: async () => response(200, { current: null, queue: [], history: [], playback: {} }),
        });
        await settle();

        page.nodes.get('karaoke-search')!.dispatch('focus');
        const html = page.nodes.get('search-suggestions')!.innerHTML;
        expect(html).toContain('Suggestions');
        expect(html).toContain('sweet caroline');
        expect(html).toContain('bohemian rhapsody');
    });

    it('keeps tokens for server errors but clears them for an explicit 401', async () => {
        const unavailable = boot({
            stored: { 'karaoke-token-party-room': 'saved-token', 'karaoke-name-party-room': 'Ada' },
            fetch: async () => response(503),
        });
        const rejected = boot({
            stored: { 'karaoke-token-party-room': 'bad-token', 'karaoke-name-party-room': 'Ada' },
            fetch: async () => response(401),
        });
        await settle();

        expect(unavailable.storage.get('karaoke-token-party-room')).toBe('saved-token');
        expect(rejected.storage.get('karaoke-token-party-room')).toBeUndefined();
        expect(rejected.nodes.get('auth-gate')!.hidden).toBe(false);
    });

    it('disables an add mutation only while it is pending and restores it after failure', async () => {
        const queueRequest = deferred<any>();
        const page = boot({
            stored: { 'karaoke-token-party-room': 'saved-token', 'karaoke-name-party-room': 'Ada' },
            fetch: async (path, init) => {
                if (path === '/status') return response(200, { current: null, queue: [], history: [], playback: {} });
                if (path === '/search') return response(200, { items: [{ id: 'song-id', title: 'Song' }] });
                if (path === '/queue') return queueRequest.promise;
                throw new Error(`unexpected ${path} ${String(init?.body)}`);
            },
        });
        await settle();
        page.nodes.get('karaoke-search')!.value = 'song';
        page.nodes.get('search-form')!.dispatch('submit');
        await settle();

        const add = page.nodes.get('results')!.children[0]!.querySelector('.quick-add')!;
        add.dispatch('click');
        await settle();
        expect(add.disabled).toBe(true);
        queueRequest.resolve(response(500));
        await settle();

        expect(add.disabled).toBe(false);
        expect(page.nodes.get('queue-status')!.textContent).toBe('');
    });

    it('uses the shared observed playback state for every phone and restores controls after a failed command', async () => {
        const status = { current: { itemId: 'now', videoId: 'song', title: 'Song' }, queue: [], history: [], playback: { state: 'paused', error: null, lastSeen: Date.now(), volume: .5 } };
        const resumeRequest = deferred<any>();
        const requests: string[] = [];
        const makePhone = () => boot({
            stored: { 'karaoke-token-party-room': 'saved-token', 'karaoke-name-party-room': 'Ada' },
            fetch: async (path) => {
                requests.push(path);
                if (path === '/status') return response(200, status);
                return resumeRequest.promise;
            },
        });
        const phoneA = makePhone();
        const phoneB = makePhone();
        await settle();

        for (const phone of [phoneA, phoneB]) {
            expect(phone.nodes.get('control-toggle')!.getAttribute('aria-label')).toBe('Resume playback');
            expect(phone.nodes.get('control-toggle')!.textContent).toBe('▶');
        }
        const toggle = phoneA.nodes.get('control-toggle')!;
        toggle.dispatch('click');
        await settle();
        expect(toggle.disabled).toBe(true);
        resumeRequest.reject(new TypeError('controller lost'));
        await settle();

        expect(requests).toContain('/control/resume');
        expect(toggle.disabled).toBe(false);
        expect(toggle.getAttribute('aria-label')).toBe('Resume playback');
        expect(toggle.textContent).toBe('▶');
    });

    it('sends skip with the displayed current item and refreshes stale-song feedback', async () => {
        let skipBody: unknown;
        const page = boot({
            stored: { 'karaoke-token-party-room': 'saved-token', 'karaoke-name-party-room': 'Ada' },
            fetch: async (path, init) => {
                if (path === '/status') return response(200, { current: { itemId: 'displayed-item', videoId: 'song', title: 'Song' }, queue: [], history: [], playback: { state: 'playing', error: null, lastSeen: Date.now(), volume: .75 } });
                if (path === '/control/skip') { skipBody = JSON.parse(String(init?.body)); return response(409); }
                throw new Error(`unexpected ${path}`);
            },
        });
        await settle();

        const skip = page.nodes.get('control-skip')!;
        skip.dispatch('click');
        await settle();

        expect(skipBody).toEqual({ expectedItemId: 'displayed-item' });
        expect(skip.disabled).toBe(false);
        expect(page.nodes.get('control-status')!.textContent).toMatch(/song changed|stale/i);
    });
});

describe('guest status worker wiring', () => {
    const liveStatus = () => ({ current: { itemId: 'now', videoId: 'song', title: 'Current Song' }, queue: [], history: [], playback: { state: 'playing', error: null, lastSeen: Date.now(), volume: .75 } });

    function bootWithWorker(fetch: (path: string, init?: any) => Promise<any>) {
        const workers: FakeWorker[] = [];
        const workerFactory = class extends FakeWorker {
            constructor(url: string) { super(url); workers.push(this); }
        };
        const page = boot({
            stored: { 'karaoke-token-party-room': 'saved-token', 'karaoke-name-party-room': 'Ada' },
            fetch,
            worker: workerFactory,
        });
        return { page, workers };
    }

    it('boots the status worker after a successful join and renders its pushed statuses', async () => {
        const { page, workers } = bootWithWorker(async () => response(200, liveStatus()));
        await settle();
        expect(workers).toHaveLength(1);
        expect(workers[0].url).toBe('/guest-worker.js');
        expect(workers[0].messages[0]).toEqual({ type: 'start', token: 'saved-token' });

        workers[0].receive({ type: 'status', status: { ...liveStatus(), queue: [{ itemId: 'q1', videoId: 'queued', title: 'Queued Song' }] } });
        expect(page.nodes.get('queue-list')!.innerHTML).toContain('Queued Song');
        expect(page.nodes.get('queue-count')!.textContent).toBe('1 song');
    });

    it('resyncs immediately when the phone becomes visible again', async () => {
        const calls: string[] = [];
        const { page, workers } = bootWithWorker(async (path) => { calls.push(path); return response(200, liveStatus()); });
        await settle();
        const visibility = page.documentListeners.get('visibilitychange') ?? [];
        expect(visibility.length).toBeGreaterThan(0);
        workers[0].messages.length = 0;
        calls.length = 0;

        visibility[0]!({ visibilityState: 'visible' });
        await settle();
        expect(workers[0].messages).toContainEqual({ type: 'resync' });
        expect(calls).toContain('/status');
    });

    it('terminates the worker and clears the token when the worker reports the session expired', async () => {
        const { page, workers } = bootWithWorker(async () => response(200, liveStatus()));
        await settle();
        workers[0].receive({ type: 'unauthorized' });
        await settle();
        expect(workers[0].terminated).toBe(true);
        expect(page.nodes.get('auth-gate')!.hidden).toBe(false);
        expect(page.storage.has('karaoke-token-party-room')).toBe(false);
    });

    it('shows the reconnecting notice when the worker detects a sleep gap', async () => {
        const { page, workers } = bootWithWorker(async () => response(200, liveStatus()));
        await settle();
        workers[0].receive({ type: 'resync' });
        expect(page.nodes.get('control-status')!.textContent).toMatch(/reconnecting|updating/i);
    });
});

describe('guest worker script', () => {
    afterEach(() => { vi.useRealTimers(); });

    function bootWorkerScript(fetchImpl: (path: string, init?: any) => Promise<any>) {
        const posted: any[] = [];
        const self: any = { postMessage: (message: any) => posted.push(message), onmessage: null };
        const run = new Function('self', 'fetch', 'setTimeout', 'clearTimeout', guestWorker());
        run(self, fetchImpl, setTimeout, clearTimeout);
        return { posted, receive: (data: any) => self.onmessage({ data }) };
    }

    it('polls /status with the bearer token on start and on each tick, forwarding the payload', async () => {
        vi.useFakeTimers();
        const requests: Array<{ path: string, authorization?: string }> = [];
        const worker = bootWorkerScript(async (path, init) => {
            requests.push({ path, authorization: init?.headers?.Authorization });
            return response(200, { current: null, queue: [], history: [], playback: {} });
        });
        worker.receive({ type: 'start', token: 'party' });
        await vi.advanceTimersByTimeAsync(0);
        expect(requests).toEqual([{ path: '/status', authorization: 'Bearer party' }]);
        expect(worker.posted[0]).toEqual(expect.objectContaining({ type: 'status' }));

        await vi.advanceTimersByTimeAsync(2500);
        expect(requests).toHaveLength(2);
    });

    it('announces a resync after the phone sleeps through a long timer gap', async () => {
        let now = 1_000_000;
        const realNow = Date.now;
        Date.now = () => now;
        try {
            const posted: any[] = [];
            const timers: Array<() => void> = [];
            const self: any = { postMessage: (message: any) => posted.push(message), onmessage: null };
            const run = new Function('self', 'fetch', 'setTimeout', 'clearTimeout', guestWorker());
            run(self, async () => response(200, { current: null, queue: [], history: [], playback: {} }),
                (callback: () => void) => { timers.push(callback); return timers.length; }, () => {});
            self.onmessage({ data: { type: 'start', token: 'party' } });
            for (let i = 0; i < 10; i += 1) await Promise.resolve();
            expect(posted.some((message) => message.type === 'resync')).toBe(false);

            // The phone slept: real time jumped far past the worker's tick cadence.
            now += 60_000;
            (timers[0] as unknown as () => void)();
            for (let i = 0; i < 10; i += 1) await Promise.resolve();
            expect(posted.some((message) => message.type === 'resync')).toBe(true);
            expect(posted.some((message) => message.type === 'status')).toBe(true);
        } finally {
            Date.now = realNow;
        }
    });

    it('reports offline on failures and keeps retrying', async () => {
        vi.useFakeTimers();
        let failures = 2;
        const worker = bootWorkerScript(async () => {
            if (failures-- > 0) throw new Error('network down');
            return response(200, { current: null, queue: [], history: [], playback: {} });
        });
        worker.receive({ type: 'start', token: 'party' });
        await vi.advanceTimersByTimeAsync(0);
        expect(worker.posted[0]).toEqual({ type: 'offline' });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(worker.posted.some((message) => message.type === 'status')).toBe(true);
    });

    it('reports unauthorized instead of offline on a 401', async () => {
        vi.useFakeTimers();
        const worker = bootWorkerScript(async () => response(401, { error: 'unauthorized' }));
        worker.receive({ type: 'start', token: 'expired' });
        await vi.advanceTimersByTimeAsync(0);
        expect(worker.posted).toEqual([{ type: 'unauthorized' }]);
    });

    it('stops polling after a stop message', async () => {
        vi.useFakeTimers();
        let polls = 0;
        const worker = bootWorkerScript(async () => { polls += 1; return response(200, { current: null, queue: [], history: [], playback: {} }); });
        worker.receive({ type: 'start', token: 'party' });
        await vi.advanceTimersByTimeAsync(0);
        worker.receive({ type: 'stop' });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(polls).toBe(1);
    });
});
