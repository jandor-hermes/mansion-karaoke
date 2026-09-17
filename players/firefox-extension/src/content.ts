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
    let playAttempts = 0, playInFlight = false;
    let loadGeneration = 0;
    let playRetry: ReturnType<typeof setTimeout> | undefined;
    const MAX_PLAY_ATTEMPTS = 4;
    const adShowing = () => !!document.querySelector('.ad-showing, .ad-interrupting');
    const debug = (message: string, details: Record<string, unknown>) => console.debug(`[karaoke-player] ${message}`, details);
    const matching = () => session !== null && new URL(location.href).searchParams.get('v') === session.videoId;
    const report = (type: string, element: HTMLVideoElement, extra: { nearEnd?: boolean; code?: string; message?: string } = {}) => {
        if (!session || loading || element !== video() || !matching() || adShowing()) return;
        if (type === 'playing') armed = true;
        if (type === 'ended' && (!armed || (!element.ended && !extra.nearEnd))) return;
        send({ ...session, type, position: element.currentTime, ...(type === 'error' ? classifyYouTubeError(document, element) : {}), ...extra });
        if (type === 'ended') { armed = false; retired = true; }
    };
    const present = () => {
        activateTheaterMode(document);
        applyPresentation(document);
        queueMicrotask(() => logPresentationDiagnostics(document));
    };
    const schedulePlay = (element: HTMLVideoElement, reason: string, delay = 0) => {
        if (!session || session.paused || retired || loading || playInFlight || playAttempts >= MAX_PLAY_ATTEMPTS) return;
        if (playRetry !== undefined) clearTimeout(playRetry);
        if (delay === 0) { void play(element, reason); return; }
        playRetry = setTimeout(() => { playRetry = undefined; void play(element, reason); }, delay);
    };
    const play = async (element: HTMLVideoElement, reason = 'prepare') => {
        if (!session || session.paused || retired || loading || element !== video() || playInFlight || playAttempts >= MAX_PLAY_ATTEMPTS) return;
        playInFlight = true;
        const active = session;
        const attempt = ++playAttempts;
        debug('content play attempt', { commandId: active.commandId, videoId: active.videoId, attempt, reason, readyState: element.readyState });
        let retry: { reason: string; delay: number } | null = null;
        try {
            await element.play();
            if (session !== active || element !== video()) return;
            debug('content play resolved', { commandId: active.commandId, videoId: active.videoId, attempt, paused: element.paused });
        } catch (error) {
            const name = (error as Error)?.name ?? 'Error';
            debug('content play rejected', { commandId: active.commandId, videoId: active.videoId, attempt, reason, name, message: (error as Error)?.message });
            if (session === active && attempt < MAX_PLAY_ATTEMPTS) retry = { reason: `retry-after-${name}`, delay: 150 * attempt };
            else if (session === active) report('error', element, { code: 'AUTOPLAY', message: 'Playback did not start after 4 attempts. Allow autoplay with sound for YouTube in Firefox, then Resume or Skip.' });
        } finally { playInFlight = false; }
        if (retry) schedulePlay(element, retry.reason, retry.delay);
    };
    const installTvJoinQr = () => {
        if (!joinUrl) return;
        const host = installJoinQr(document, joinUrl);
        if (!host || host.dataset.karaokeRelabeled === 'true') return;
        const labels = Array.from(host.children).filter(child => child.tagName === 'DIV');
        const label = labels.at(-1);
        if (label) { label.textContent = 'Mansion Karaoke'; host.dataset.karaokeRelabeled = 'true'; }
    };
    const attach = () => {
        installTvJoinQr();
        const element = video();
        if (!element || element.dataset.karaokeBound) return;
        element.dataset.karaokeBound = 'true';
        for (const event of ['loadedmetadata', 'canplay', 'playing', 'pause', 'ended', 'error']) {
            element.addEventListener(event, () => {
                if (retired && event === 'playing') { element.pause(); return; }
                if (event === 'playing' && session?.paused) { element.pause(); return; }
                if (event === 'playing') playAttempts = 0;
                if ((event === 'loadedmetadata' || event === 'canplay') && session && !session.paused) schedulePlay(element, event);
                if (event !== 'canplay') report(event === 'loadedmetadata' ? 'ready' : event, element);
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
            debug('content load ready', { commandId: session.commandId, videoId: session.videoId, readyState: element.readyState });
            element.volume = session.volume ?? .75;
            if (session.presentation) present();
            if (session.position > 0 && !adShowing()) element.currentTime = session.position;
            if (session.paused) element.pause(); else schedulePlay(element, 'prepare');
        };
        element.addEventListener('loadedmetadata', prepare);
        if (element.readyState >= 1) prepare();
    };
    const observer = new MutationObserver(() => {
        attach();
        // Presentation CSS is rooted on <html>; repeatedly clicking YouTube's
        // theater button here creates a mutation/presentation feedback loop.
        // Reapply only if YouTube removed our durable root/style markers.
        if (session?.presentation) {
            const root = document.documentElement as typeof document.documentElement & { classList: { contains?: (value: string) => boolean } };
            const hasClass = root.classList.contains?.('karaoke-video-presentation') ?? false;
            const hasStyle = Boolean(document.getElementById('karaoke-video-presentation-style'));
            if (!hasClass || !hasStyle) present();
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    attach();
    void browser.runtime.sendMessage({ type: 'getJoinInfo' }).then((value: unknown) => {
        if (value && typeof value === 'object' && typeof (value as { joinUrl?: unknown }).joinUrl === 'string') {
            joinUrl = (value as { joinUrl: string }).joinUrl; installTvJoinQr();
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
        debug('content command received', { type: message.type, commandId: message.commandId, videoId: message.videoId });
        const element = video();
        if (message.type === 'inspectPlayback') return session && element && !adShowing() ? { ...session, type: element.ended ? 'ended' : element.paused ? 'paused' : 'playing', position: element.currentTime } : null;
        if (message.type === 'skip') { session = null; armed = false; retired = true; element?.pause(); return; }
        const load = parseLoadVideoCommand(message);
        if (load) {
            const next = sessionFrom(message);
            if (!next) throw new Error('Missing playback identity');
            const generation = ++loadGeneration;
            session = null; armed = false; loading = true; retired = false; playAttempts = 0;
            if (playRetry !== undefined) { clearTimeout(playRetry); playRetry = undefined; }
            try {
                const result = await requestPageLoad(bridgeNode, channel, load);
                debug('content load resolved', { commandId: next.commandId, videoId: next.videoId, ok: result.ok, mode: result.mode, error: result.error });
                if (generation !== loadGeneration) return result;
                if (result.ok) {
                    session = next; loading = false;
                    // Preserve a document bootstrap for extension reload, without any bearer token.
                    persistSession();
                    if (next.presentation) present();
                    const current = video();
                    if (current) { current.volume = next.volume ?? .75; if (next.paused) current.pause(); else { await play(current, 'same-document-load'); if (!current.paused) report('playing', current); } }
                }
                return result;
            } catch (error) {
                debug('content load rejected', { commandId: next.commandId, videoId: next.videoId, error });
                throw error;
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
