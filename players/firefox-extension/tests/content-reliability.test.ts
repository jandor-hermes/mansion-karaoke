import { afterEach, expect, it, vi } from 'vitest';
import { installYouTubeContentScript } from '../src/content';
const identity = { commandId: 'play-1', roomId: 'r', itemId: 'one', videoId: 'dQw4w9WgXcQ', position: 0 };
afterEach(() => vi.unstubAllGlobals());
function setup() {
 const element = Object.assign(new EventTarget(), { dataset: {}, currentTime: 1, readyState: 1, ended: false, paused: false, volume: .75, error: null,
  play: vi.fn(async () => {}), pause: vi.fn() });
 let ad = false;
 const document = { body: { innerText: '' }, querySelector: vi.fn((selector: string) => selector === 'video' ? element : selector.includes('.ad-showing') && ad ? {} : null), documentElement: { appendChild: vi.fn() },
  createElement: () => Object.assign(new EventTarget(), { dataset: {}, remove: vi.fn() }) };
 const listener = vi.fn();
 vi.stubGlobal('document', document); vi.stubGlobal('history', { state: null, replaceState: vi.fn() }); vi.stubGlobal('location', { href: 'https://www.youtube.com/watch?v='+identity.videoId, hash: '#karaoke='+encodeURIComponent(JSON.stringify(identity)) });
 vi.stubGlobal('MutationObserver', class { observe() {} });
 vi.stubGlobal('browser', { runtime: { sendMessage: vi.fn(async () => ({})), getURL: (p:string)=>p, onMessage:{addListener:listener} } });
 const send=vi.fn(); installYouTubeContentScript(send);
 return { element, send, message: listener.mock.calls[0][0], ad: (value:boolean)=>ad=value };
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
