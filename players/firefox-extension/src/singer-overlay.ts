/** KaraFun-style singer overlay: a "Now singing" chip and a timed or
 * permanent "Up next" card, rendered inside .html5-video-player so native
 * fullscreen retains it (same strategy as the join QR). */
import type { OverlaySettings } from './config';

export const SINGER_OVERLAY_ID = 'karaoke-singer-overlay';

export type OverlayInfo = {
    current?: { title?: string; requestedBy?: string } | null;
    next?: { title?: string; requestedBy?: string } | null;
    playing: boolean;
    /** Seconds remaining in the current song; null when unknown or not playing. */
    remainingSeconds: number | null;
};

/** Label for one line: "Sarah — Title", falling back to whichever is present. */
export function singerLabel(item: { title?: string; requestedBy?: string } | null | undefined): string {
    if (!item) return '';
    if (item.requestedBy && item.title) return `${item.requestedBy} — ${item.title}`;
    return item.requestedBy || item.title || '';
}

/** Whether the up-next card should be visible under the current settings. */
export function upNextVisible(info: OverlayInfo, settings: OverlaySettings): boolean {
    if (!info.next || !singerLabel(info.next)) return false;
    if (settings.upNextAlways) return true;
    if (!settings.upNextSeconds) return false;
    if (!info.playing || info.remainingSeconds === null) return false;
    return info.remainingSeconds <= settings.upNextSeconds;
}

function ensureHost(documentLike: Document): HTMLElement {
    let host = documentLike.getElementById(SINGER_OVERLAY_ID) as HTMLElement | null;
    if (host) return host;
    host = documentLike.createElement('div');
    host.id = SINGER_OVERLAY_ID;
    const nowSinging = documentLike.createElement('div');
    nowSinging.id = 'karaoke-now-singing';
    const upNext = documentLike.createElement('div');
    upNext.id = 'karaoke-up-next';
    if (typeof (host as unknown as { appendChild?: unknown }).appendChild !== 'function') return host;
    host.appendChild(nowSinging);
    host.appendChild(upNext);
    return host;
}

/** Apply inline CSS tolerating minimal DOM stubs without a style object. */
function applyStyle(element: HTMLElement, cssText: string): void {
    if (element.style) element.style.cssText = cssText;
}

/** Install the overlay inside the player element (falls back to body). */
export function installSingerOverlay(documentLike: Document): HTMLElement | null {
    const parent = documentLike.querySelector('.html5-video-player') ?? documentLike.body;
    if (!parent || typeof (parent as unknown as { appendChild?: unknown }).appendChild !== 'function') return null;
    const host = ensureHost(documentLike);
    if (host.parentElement !== parent) parent.appendChild(host);
    return host;
}

/** Update overlay contents from controller state + user settings. Safe to call repeatedly. */
export function updateSingerOverlay(documentLike: Document, info: OverlayInfo, settings: OverlaySettings): HTMLElement | null {
    const host = installSingerOverlay(documentLike);
    if (!host) return null;
    const nowSinging = host.querySelector('#karaoke-now-singing') as HTMLElement | null;
    const upNext = host.querySelector('#karaoke-up-next') as HTMLElement | null;
    if (!nowSinging || !upNext) return host;
    applyStyle(host, 'position:absolute;left:18px;bottom:64px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;pointer-events:none;');
    applyStyle(nowSinging, 'display:none;max-width:44vw;padding:8px 14px;border-radius:999px;background:rgba(0,0,0,.62);color:#fff;font:700 15px/1.3 -apple-system,system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;backdrop-filter:blur(4px);');
    applyStyle(upNext, 'display:none;max-width:44vw;padding:7px 13px;border-radius:999px;background:rgba(0,0,0,.5);color:rgba(255,255,255,.92);font:600 13px/1.3 -apple-system,system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;backdrop-filter:blur(4px);');
    const currentLabel = settings.nowSinging && info.playing ? singerLabel(info.current) : '';
    if (currentLabel) { nowSinging.textContent = `🎤 ${currentLabel}`; nowSinging.style.display = 'block'; }
    else nowSinging.style.display = 'none';
    const nextLabel = upNextVisible(info, settings) ? singerLabel(info.next) : '';
    if (nextLabel) { upNext.textContent = `Up next: ${nextLabel}`; upNext.style.display = 'block'; }
    else upNext.style.display = 'none';
    return host;
}

/** Hide the overlay entirely (e.g. while an ad is showing). */
export function hideSingerOverlay(documentLike: Document): void {
    documentLike.getElementById(SINGER_OVERLAY_ID)?.style.setProperty('display', 'none');
}

/** Restore visibility after hideSingerOverlay. */
export function showSingerOverlay(documentLike: Document): void {
    documentLike.getElementById(SINGER_OVERLAY_ID)?.style.removeProperty('display');
}
