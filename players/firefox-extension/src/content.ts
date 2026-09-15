/* global browser */
import { applyPresentation, clickYouTubeFullscreenButton, presentationMessage } from './presentation';

type VideoCommand = { type: 'pause' | 'resume' | 'setVolume' | 'fullscreen'; volume?: number };
const video = () => document.querySelector('video') as HTMLVideoElement | null;

export function classifyYouTubeError(documentLike: { body?: { innerText?: string } | null }, element: HTMLVideoElement): { code: string; message: string } {
    const mediaCode = element.error?.code;
    if (mediaCode) return { code: `MEDIA_ERROR_${mediaCode}`, message: element.error?.message || 'Video playback error' };
    const text = documentLike.body?.innerText ?? '';
    if (/video unavailable/i.test(text)) return { code: 'PAGE_UNAVAILABLE_TEXT', message: 'YouTube page reports video unavailable' };
    return { code: 'MEDIA_ERROR', message: 'Video playback error' };
}

export function installYouTubeContentScript(send: (event: unknown) => void = (event) => browser.runtime.sendMessage(event)) {
    console.debug('[karaoke-player] YouTube content script loaded', { href: location.href });
    const report = (type: string, element: HTMLVideoElement) => {
        console.debug('[karaoke-player] YouTube media event', { type, position: element.currentTime });
        send({
            type,
            position: element.currentTime,
            ...(type === 'error' ? classifyYouTubeError(document, element) : {}),
        });
    };
    const attach = () => {
        const element = video();
        if (!element) {
            console.debug('[karaoke-player] YouTube video element not found', { href: location.href });
            return;
        }
        if (element.dataset.karaokeBound) return;
        console.debug('[karaoke-player] YouTube video element attached', { href: location.href, readyState: element.readyState });
        element.dataset.karaokeBound = 'true';
        for (const event of ['loadedmetadata', 'playing', 'pause', 'ended', 'error']) {
            element.addEventListener(event, () => report(event === 'loadedmetadata' ? 'ready' : event, element));
        }
        const attemptAutoplay = () => {
            console.debug('[karaoke-player] attempting YouTube autoplay', { muted: element.muted, readyState: element.readyState });
            void element.play()
                .then(() => console.debug('[karaoke-player] YouTube play() resolved'))
                .catch((error: unknown) => console.error('[karaoke-player] YouTube play() rejected', error));
        };
        if (element.readyState >= HTMLMediaElement.HAVE_METADATA) attemptAutoplay();
        else element.addEventListener('loadedmetadata', attemptAutoplay, { once: true });
        attemptAutoplay();
        browser.runtime.onMessage.addListener((rawMessage) => {
            const message = rawMessage as VideoCommand;
            if (message.type !== 'resume') return;
            const current = video();
            if (!current) return;
            console.debug('[karaoke-player] received resume command');
            void current.play()
                .then(() => console.debug('[karaoke-player] resume play() resolved'))
                .catch((error: unknown) => console.error('[karaoke-player] resume play() rejected', error));
        });
    };
    const observer = new MutationObserver(attach);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    attach();
    browser.runtime.onMessage.addListener((rawMessage) => {
        const message = rawMessage as VideoCommand;
        if (presentationMessage(message)) {
            clickYouTubeFullscreenButton(document);
            if (applyPresentation(document)) console.debug('[karaoke-player] video presentation applied');
            else console.error('[karaoke-player] video presentation failed');
            return;
        }
        const element = video();
        if (!element) return;
        if (message.type === 'pause') element.pause();
        if (message.type === 'resume') void element.play();
        if (message.type === 'setVolume' && message.volume !== undefined) element.volume = message.volume;
    });
    return observer;
}

if (typeof browser !== 'undefined') installYouTubeContentScript();
