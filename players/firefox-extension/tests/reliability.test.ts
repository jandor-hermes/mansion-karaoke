import { afterEach, expect, it, vi } from 'vitest';
import { startBackground } from '../src/background';
import { CommandRouter, createControllerClient, createInitialPlayerState } from '../src';
import { enrichContentEvent } from '../src/events';
const play = { type: 'play' as const, commandId: 'generation', roomId: 'r', issuedAt: 1, itemId: 'one', videoId: 'dQw4w9WgXcQ', position: 0 };
const stops: Array<() => void> = [];
afterEach(() => { stops.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); });
function api(stored = {}) {
 return { tabs: { query: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue({ id: 7 }), create: vi.fn().mockResolvedValue({ id: 7 }), update: vi.fn(), sendMessage: vi.fn().mockResolvedValue(undefined), onRemoved: { addListener: vi.fn() } }, runtime: { getURL: (p: string) => 'moz-extension://test/' + p, onMessage: { addListener: vi.fn() } }, storage: { local: { get: vi.fn().mockResolvedValue({ baseUrl: 'http://localhost:3010', token: 't', ...stored }), set: vi.fn() }, onChanged: { addListener: vi.fn() } } } as any;
}
const response = (value: unknown) => new Response(JSON.stringify(value));
it.each([{}, { commandCursor: 1, controllerInstanceId: 'old' }, { commandCursor: 1, controllerInstanceId: 'new' }])('reconciles current on first connect/reload without historical controls %j', async stored => {
 const browser = api(stored);
 const fetcher = vi.fn(async (url: any) => String(url).includes('/status') ? response({ instanceId: 'new', sequence: 1, activeCommand: play, desiredPaused: false, playback: { volume: .75 } }) : response({ instanceId: 'new', sequence: 1, command: null }));
 vi.stubGlobal('fetch', fetcher);
 const bg = await startBackground(browser); stops.push(bg.stop); await bg.poll();
 expect(bg.state).toMatchObject({ itemId: 'one', commandId: 'generation' });
 expect(browser.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({ commandCursor: 1, controllerInstanceId: 'new' }));
 expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/status'))).toBe(true);
});
it('rejects other tabs, subframes, wrong video and old generation before publishing', async () => {
 const browser = api(); const fetcher = vi.fn(async (url: any) => String(url).includes('/status') ? response({ instanceId: 'new', sequence: 1, activeCommand: play, playback: { volume: .75 } }) : response({ instanceId: 'new', sequence: 1, command: null }));
 vi.stubGlobal('fetch', fetcher); const bg = await startBackground(browser); stops.push(bg.stop); await bg.poll();
 const listener = browser.runtime.onMessage.addListener.mock.calls[0][0];
 const event = { ...play, type: 'ended', position: 1 };
 for (const [data, sender] of [[event, { tab: { id: 88 }, frameId: 0 }], [event, { tab: { id: 7 }, frameId: 1 }], [{ ...event, commandId: 'old' }, { tab: { id: 7 }, frameId: 0 }], [{ ...event, videoId: 'M7lc1UVf-VE' }, { tab: { id: 7 }, frameId: 0 }]]) await listener(data, sender);
 expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/events'))).toBe(false);
 await listener(event, { tab: { id: 7 }, frameId: 0 });
 expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/events'))).toBe(true);
});
it('consumes rejected resume and lets later skip retire playback', async () => {
 const browser = api(); let sequence = 1;
 vi.stubGlobal('fetch', vi.fn(async (url: any) => {
  if (String(url).endsWith('/status')) return response({ instanceId: 'new', sequence: 1, activeCommand: play, playback: { volume: .75 } });
  if (String(url).endsWith('/events')) return new Response(null, { status: 204 });
  return response({ instanceId: 'new', sequence, command: sequence === 1 ? null : { ...play, commandId: 'c' + sequence, type: sequence === 2 ? 'resume' : 'skip' } });
 }));
 const bg = await startBackground(browser); stops.push(bg.stop); await bg.poll();
 browser.tabs.sendMessage.mockRejectedValueOnce(new Error('autoplay denied'));
 sequence = 2; await bg.poll();
 expect(browser.storage.local.set).toHaveBeenLastCalledWith(expect.objectContaining({ commandCursor: 2 }));
 sequence = 3; await bg.poll(); expect(bg.state.commandId).toBeUndefined();
 expect(browser.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'skip' });
});
it('pauses the dedicated player on skip even with no next song', async () => {
 const send = vi.fn(); const state = { ...createInitialPlayerState(), tabId: 7, ...play, status: 'playing' as const };
 await new CommandRouter({ get: vi.fn(), create: vi.fn(), update: vi.fn() }, send).route({ ...play, type: 'skip' }, state);
 expect(send).toHaveBeenCalledWith(7, { type: 'skip' }); expect(state.commandId).toBeUndefined();
});
it('never assigns current identity to an uncorrelated content event', () => {
 expect(enrichContentEvent({ type: 'ended' }, play, 0, 1)).toBeNull();
});
it('retries terminal HTTP failures using an identical event and rejects exhausted delivery', async () => {
 const event = { ...play, type: 'ended' as const, sequence: 1, timestamp: 1 };
 const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 500 })).mockResolvedValue(new Response(null, { status: 204 }));
 const client = createControllerClient({ baseUrl: 'http://localhost', token: 't', fetcher });
 await client.publish(event); expect(fetcher).toHaveBeenCalledTimes(2);
 expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
 const fail = vi.fn(async () => new Response(null, { status: 500 }));
 await expect(createControllerClient({ baseUrl: 'http://localhost', token: 't', fetcher: fail }).publish(event)).rejects.toThrow();
 expect(fail).toHaveBeenCalledTimes(3);
});
