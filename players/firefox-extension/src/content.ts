/* global browser */
import { applyPresentation, clickYouTubeFullscreenButton, logPresentationDiagnostics, presentationMessage, activateTheaterMode } from './presentation';
import { parseLoadVideoCommand, requestPageLoad } from './load-video';
import { installJoinQr } from './join-qr';
import { playbackCommandSchema } from '../../../packages/playback-protocol/src';
import type { PlaybackIdentity } from './index';

type Session = PlaybackIdentity & { position: number; presentation?: boolean; volume?: number; paused?: boolean };
const video = () => document.querySelector('video') as HTMLVideoElement | null;
export function classifyYouTubeError(documentLike: { body?: { innerText?: string } | null }, element: HTMLVideoElement): { code: string; message: string } {
    const mediaCode = element.error?.code;
    if (mediaCode) return { code: `MEDIA_ERROR_${mediaCode}`, message: element.error?.message || 'Video playback error' };
    if (/video unavailable/i.test(documentLike.body?.innerText ?? '')) return { code: 'PAGE_UNAVAILABLE_TEXT', message: 'YouTube page reports video unavailable. Choose another video or Skip.' };
    return { code: 'MEDIA_ERROR', message: 'Video playback error. Check Firefox or Skip.' };
}
function sessionFrom(raw: unknown): Session | null {
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as Record<string, unknown>;
    const parsed = playbackCommandSchema.safeParse({ ...value, type: 'play', issuedAt: 0 });
    if (!parsed.success || parsed.data.type !== 'play') return null;
    const { commandId, roomId, itemId, videoId, position } = parsed.data;
    return { commandId, roomId, itemId, videoId, position, presentation: value.presentation === true, paused: value.paused === true,
        volume: typeof value.volume === 'number' && value.volume >= 0 && value.volume <= 1 ? value.volume : .75 };
}
export function installYouTubeContentScript(send: (event: unknown) => void = event => { void browser.runtime.sendMessage(event).catch(console.error); }) {
    let session: Session | null = null;
    try { session = sessionFrom(JSON.parse(decodeURIComponent(location.hash.replace(/^#karaoke=/, '')))); } catch { /* an ordinary YouTube tab has no authority */ }
    const persistSession = () => {
        if (!session) return;
        history.replaceState(history.state, '', `/watch?v=${session.videoId}#karaoke=${encodeURIComponent(JSON.stringify(session))}`);
    };
    let armed = false, retired = false, joinUrl = '', loading = false;
    const adShowing = () => !!document.querySelector('.ad-showing, .ad-interrupting');
    const matching = () => session !== null && new URL(location.href).searchParams.get('v') === session.videoId;
    const report = (type: string, element: HTMLVideoElement, extra: { nearEnd?: boolean; code?: string; message?: string } = {}) => {
        if (!session || loading || element !== video() || !matching() || adShowing()) return;
        if (type === 'playing') armed = true;
        if (type === 'ended' && (!armed || (!element.ended && !extra.nearEnd))) return;
        send({ ...session, type, position: element.currentTime, ...(type === 'error' ? classifyYouTubeError(document, element) : {}), ...extra });
        if (type === 'ended') { armed = false; retired = true; }
    };
    const present = () => { activateTheaterMode(document); applyPresentation(document); };
    const play = async (element: HTMLVideoElement) => {
        try { await element.play(); }
        catch (error) {
            // YouTube aborts its first load during startup; metadata triggers another attempt.
            if ((error as Error)?.name !== 'AbortError') report('error', element, { code: 'AUTOPLAY', message: 'Allow autoplay with sound for YouTube in Firefox, then Resume or Skip.' });
        }
    };
    const attach = () => {
        if (joinUrl) installJoinQr(document, joinUrl);
        const element = video();
        if (!element || element.dataset.karaokeBound) return;
        element.dataset.karaokeBound = 'true';
        for (const event of ['loadedmetadata', 'playing', 'pause', 'ended', 'error']) {
            element.addEventListener(event, () => {
                if (retired && event === 'playing') { element.pause(); return; }
                if (event === 'playing' && session?.paused) { element.pause(); return; }
                report(event === 'loadedmetadata' ? 'ready' : event, element);
            });
        }
        // YouTube can route to a recommendation before the native ended handler
        // observes the original watch URL. Advance just before the media boundary,
        // while the expected video and generation are still verifiable.
        element.addEventListener('timeupdate', () => {
            if (!retired && armed && Number.isFinite(element.duration) && element.duration > 0
                && element.duration - element.currentTime <= .75 && !element.paused) {
                report('ended', element, { nearEnd: true });
                if (retired) element.pause();
            }
        });
        const prepare = () => {
            if (!session || loading || retired) return;
            element.volume = session.volume ?? .75;
            if (session.presentation) present();
            if (session.position > 0 && !adShowing()) element.currentTime = session.position;
            if (session.paused) element.pause(); else void play(element);
        };
        element.addEventListener('loadedmetadata', prepare);
        if (element.readyState >= 1) prepare();
    };
    const observer = new MutationObserver(attach);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    attach();
    void browser.runtime.sendMessage({ type: 'getJoinInfo' }).then((value: unknown) => {
        if (value && typeof value === 'object' && typeof (value as { joinUrl?: unknown }).joinUrl === 'string') {
            joinUrl = (value as { joinUrl: string }).joinUrl; installJoinQr(document, joinUrl);
        }
    }).catch(error => console.error('[karaoke-player] join QR unavailable', error));
    const channel = Math.random().toString(36).slice(2);
    const bridgeNode = document.createElement('span'); bridgeNode.hidden = true; bridgeNode.id = `karaoke-bridge-${channel}`;
    document.documentElement.appendChild(bridgeNode);
    const bridgeScript = document.createElement('script'); bridgeScript.src = browser.runtime.getURL('page-bridge.js');
    bridgeScript.dataset.karaokeChannel = channel; bridgeScript.dataset.karaokeNode = bridgeNode.id;
    bridgeScript.addEventListener('load', () => bridgeScript.remove(), { once: true });
    document.documentElement.appendChild(bridgeScript);
    browser.runtime.onMessage.addListener(async raw => {
        const message = raw as Record<string, unknown>;
        if (!message || typeof message !== 'object') return;
        const element = video();
        if (message.type === 'inspectPlayback') return session && element && !adShowing() ? { ...session, type: element.ended ? 'ended' : element.paused ? 'paused' : 'playing', position: element.currentTime } : null;
        if (message.type === 'skip') { session = null; armed = false; retired = true; element?.pause(); return; }
        const load = parseLoadVideoCommand(message);
        if (load) {
            const next = sessionFrom(message);
            if (!next) throw new Error('Missing playback identity');
            session = null; armed = false; loading = true; retired = false;
            try {
                const result = await requestPageLoad(bridgeNode, channel, load);
                if (result.ok) {
                    session = next; loading = false;
                    // Preserve a document bootstrap for extension reload, without any bearer token.
                    persistSession();
                    if (next.presentation) present();
                    const current = video();
                    if (current) { current.volume = next.volume ?? .75; if (next.paused) current.pause(); else { await play(current); if (!current.paused) report('playing', current); } }
                }
                return result;
            } finally { loading = false; }
        }
        if (presentationMessage(message)) {
            if (session) { session.presentation = true; persistSession(); }
            clickYouTubeFullscreenButton(document); present(); logPresentationDiagnostics(document); return;
        }
        if (!element) throw new Error('YouTube player is not ready');
        if (message.type === 'pause') { if (session) { session.paused = true; persistSession(); } element.pause(); }
        if (message.type === 'resume') { if (session) { session.paused = false; persistSession(); } return element.play(); }
        if (message.type === 'setVolume' && typeof message.volume === 'number' && message.volume >= 0 && message.volume <= 1) { if (session) { session.volume = message.volume; persistSession(); } element.volume = message.volume; }
    });
    return observer;
}
if (typeof browser !== 'undefined') installYouTubeContentScript();
