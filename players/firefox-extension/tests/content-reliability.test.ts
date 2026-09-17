import { afterEach, expect, it, vi } from 'vitest';
import { installYouTubeContentScript } from '../src/content';
const identity = { commandId: 'play-1', roomId: 'r', itemId: 'one', videoId: 'dQw4w9WgXcQ', position: 0, presentation: true };
afterEach(() => vi.unstubAllGlobals());
function setup(overrides: { readyState?: number; play?: ReturnType<typeof vi.fn> } = {}) {
 const element = Object.assign(new EventTarget(), { dataset: {}, currentTime: 1, readyState: overrides.readyState ?? 1, ended: false, paused: false, volume: .75, error: null, duration: 100,
  play: overrides.play ?? vi.fn(async () => {}), pause: vi.fn(), getBoundingClientRect: () => ({ width: 1920, height: 1080, top: 0, left: 0 }) });
 let ad = false;
 const styleIds = new Set<string>();
 const classes = { add: vi.fn(), contains: vi.fn((value: string) => value === 'karaoke-video-presentation') };
 const document = { body: { innerText: '', classList: classes }, head: { append: vi.fn((element: { id: string }) => styleIds.add(element.id)) }, getElementById: vi.fn((id: string) => styleIds.has(id) ? { id, textContent: '' } : null), querySelectorAll: vi.fn(() => []),
  querySelector: vi.fn((selector: string) => selector === 'video' || selector === 'video.html5-main-video' ? element : selector.includes('.ad-showing') && ad ? {} : null),
  documentElement: { appendChild: vi.fn(), classList: classes }, createElement: () => Object.assign(new EventTarget(), { dataset: {}, remove: vi.fn(), id: '', textContent: '' }) };
 const listener = vi.fn();
 vi.stubGlobal('document', document); vi.stubGlobal('history', { state: null, replaceState: vi.fn() }); vi.stubGlobal('location', { href: 'https://www.youtube.com/watch?v='+identity.videoId, hash: '#karaoke='+encodeURIComponent(JSON.stringify(identity)) });
 let mutationCallback: () => void = () => undefined;
 vi.stubGlobal('MutationObserver', class { constructor(callback: () => void) { mutationCallback = callback; } observe() {} });
 vi.stubGlobal('browser', { runtime: { sendMessage: vi.fn(async () => ({})), getURL: (p:string)=>p, onMessage:{addListener:listener} } });
 const send=vi.fn(); installYouTubeContentScript(send);
 return { element, send, message: listener.mock.calls[0][0], ad: (value:boolean)=>ad=value, mutate: () => mutationCallback(), document };
}
it('carries immutable generation and ignores ad and synthetic stale ends', () => {
 const { element, send, ad }=setup();
 element.dispatchEvent(new Event('playing'));
 expect(send).toHaveBeenLastCalledWith(expect.objectContaining({...identity,position:1,type:'playing'}));
 send.mockClear(); element.dispatchEvent(new Event('ended')); expect(send).not.toHaveBeenCalled();
 element.ended=true; ad(true); element.dispatchEvent(new Event('ended')); expect(send).not.toHaveBeenCalled();
 ad(false); element.dispatchEvent(new Event('ended'));
 expect(send).toHaveBeenLastCalledWith(expect.objectContaining({...identity,position:1,type:'ended'}));
});
it('reports a verified near-end boundary before YouTube can auto-route', () => {
 const { element, send }=setup();
 Object.assign(element,{duration:100,currentTime:99.5,paused:false});
 element.dispatchEvent(new Event('playing')); send.mockClear();
 element.dispatchEvent(new Event('timeupdate'));
 expect(send).toHaveBeenCalledWith(expect.objectContaining({type:'ended',commandId:identity.commandId,nearEnd:true}));
 expect(element.pause).toHaveBeenCalled();
});
it('skip pauses media, retires events and suppresses YouTube continuation', async () => {
 const { element, send, message }=setup();
 await message({type:'skip'}); expect(element.pause).toHaveBeenCalledTimes(1);
 element.dispatchEvent(new Event('playing')); expect(element.pause).toHaveBeenCalledTimes(2);
 element.ended=true; element.dispatchEvent(new Event('ended')); expect(send).not.toHaveBeenCalled();
 expect(await message({type:'inspectPlayback'})).toBeNull();
});
it('persists pause and volume in the token-free document bootstrap', async () => {
 const { element, message }=setup();
 const replaceState=history.replaceState as ReturnType<typeof vi.fn>;
 await message({type:'pause'}); await message({type:'setVolume',volume:.2});
 const url=String(replaceState.mock.calls.at(-1)?.[2]);
 const saved=JSON.parse(decodeURIComponent(url.split('#karaoke=')[1]));
 expect(saved).toMatchObject({paused:true,volume:.2,commandId:identity.commandId});
 expect(element.pause).toHaveBeenCalled();
});
it('retries an aborted startup play after metadata without reporting autoplay failure', async () => {
 vi.useFakeTimers();
 try {
  const abort = Object.assign(new Error('startup load replaced'), { name: 'AbortError' });
  const play = vi.fn().mockRejectedValueOnce(abort).mockResolvedValueOnce(undefined);
  const { element, send } = setup({ readyState: 0, play });
  element.dispatchEvent(new Event('loadedmetadata'));
  await vi.runAllTimersAsync();
  expect(play).toHaveBeenCalledTimes(2);
  expect(send.mock.calls.some(([event]) => event.code === 'AUTOPLAY')).toBe(false);
 } finally { vi.useRealTimers(); }
});
it('reports an actionable autoplay error only after bounded readiness retries', async () => {
 vi.useFakeTimers();
 try {
  const denied = Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
  const play = vi.fn().mockRejectedValue(denied);
  const { element, send } = setup({ readyState: 0, play });
  element.dispatchEvent(new Event('loadedmetadata'));
  element.dispatchEvent(new Event('canplay'));
  await vi.runAllTimersAsync();
  expect(play.mock.calls.length).toBeGreaterThan(1);
  expect(play.mock.calls.length).toBeLessThanOrEqual(4);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', code: 'AUTOPLAY', message: expect.stringContaining('Allow autoplay') }));
 } finally { vi.useRealTimers(); }
});
it('reapplies presentation after a YouTube rerender without clicking theater repeatedly', () => {
 const { mutate, document } = setup();
 const initialPresentationCalls = document.documentElement.classList.add.mock.calls.length;
 mutate();
 mutate();
 expect(document.documentElement.classList.add).toHaveBeenCalledWith('karaoke-video-presentation');
 expect(document.documentElement.classList.add.mock.calls.length).toBe(initialPresentationCalls);
});
