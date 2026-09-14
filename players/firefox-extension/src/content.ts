/* global browser */

type VideoCommand = { type: 'pause' | 'resume' | 'setVolume'; volume?: number };
const video = () => document.querySelector('video') as HTMLVideoElement | null;

export function installYouTubeContentScript(send: (event: unknown) => void = (event) => browser.runtime.sendMessage(event)) {
    const report = (type: string) => { const element = video(); if (element) send({ type, position: element.currentTime }); };
    const attach = () => {
        const element = video();
        if (!element || element.dataset.karaokeBound) return;
        element.dataset.karaokeBound = 'true';
        for (const event of ['loadedmetadata', 'playing', 'pause', 'ended', 'error']) element.addEventListener(event, () => report(event === 'loadedmetadata' ? 'ready' : event));
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
