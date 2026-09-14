/* global browser */

type VideoCommand = { type: 'pause' | 'resume' | 'setVolume'; volume?: number };
const video = () => document.querySelector('video') as HTMLVideoElement | null;

export function installYouTubeContentScript(send: (event: unknown) => void = (event) => browser.runtime.sendMessage(event)) {
    console.debug('[karaoke-player] YouTube content script loaded', { href: location.href });
    const report = (type: string, element: HTMLVideoElement) => {
        console.debug('[karaoke-player] YouTube media event', { type, position: element.currentTime });
        send({
            type,
            position: element.currentTime,
            ...(type === 'error' ? { code: 'MEDIA_ERROR', message: 'Video playback error' } : {}),
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
    };
    const observer = new MutationObserver(attach);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    attach();
    browser.runtime.onMessage.addListener((rawMessage) => {
        const message = rawMessage as VideoCommand;
        const element = video();
        if (!element) return;
        if (message.type === 'pause') element.pause();
        if (message.type === 'resume') void element.play();
        if (message.type === 'setVolume' && message.volume !== undefined) element.volume = message.volume;
    });
    return observer;
}

if (typeof browser !== 'undefined') installYouTubeContentScript();
