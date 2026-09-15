export const PRESENTATION_CLASS = 'karaoke-video-presentation';
export const PRESENTATION_STYLE_ID = 'karaoke-video-presentation-style';
export const YOUTUBE_FULLSCREEN_BUTTON_SELECTOR = 'button.ytp-fullscreen-button[aria-label*="Full screen"]';
export const YOUTUBE_THEATER_BUTTON_SELECTOR = 'button.ytp-size-button';
export const YOUTUBE_WATCH_FLEXY_SELECTOR = 'ytd-watch-flexy';
export const YOUTUBE_PLAYER_SELECTOR = '#movie_player';
export const YOUTUBE_VIDEO_SELECTOR = 'video.html5-main-video';

type ClickableDocument = { querySelector(selector: string): { click(): void } | null };
type DiagnosticLogger = (message: string, details: Record<string, unknown>) => void;
const defaultLogger: DiagnosticLogger = (message, details) => console.debug(`[karaoke-player] ${message}`, details);

/**
 * Best-effort first attempt: click YouTube's own fullscreen button.
 * This is expected to FAIL for programmatic triggers — a synthetic click
 * lacks trusted user activation, so YouTube's internal requestFullscreen()
 * is rejected. We only log; the CSS presentation is the real mechanism.
 */
export function clickYouTubeFullscreenButton(documentLike: ClickableDocument, logger: DiagnosticLogger = defaultLogger): boolean {
    const button = documentLike.querySelector(YOUTUBE_FULLSCREEN_BUTTON_SELECTOR);
    if (!button) {
        logger('YouTube fullscreen button not found (best-effort attempt only; CSS presentation will proceed)', { selector: YOUTUBE_FULLSCREEN_BUTTON_SELECTOR });
        return false;
    }
    logger('YouTube fullscreen button located', { selector: YOUTUBE_FULLSCREEN_BUTTON_SELECTOR, button });
    try {
        button.click();
        logger('YouTube fullscreen button clicked; NOTE a synthetic click may lack trusted user activation, so YouTube\'s requestFullscreen may be rejected — CSS presentation is the fallback', { selector: YOUTUBE_FULLSCREEN_BUTTON_SELECTOR });
        return true;
    } catch (error) {
        logger('YouTube fullscreen button click failed (expected: untrusted activation); falling back to CSS presentation', { selector: YOUTUBE_FULLSCREEN_BUTTON_SELECTOR, error });
        return false;
    }
}

/**
 * Activate YouTube's theater (cinema) mode so the player container expands
 * via YouTube's own layout engine. Clicking the size button does not require
 * the fullscreen API, so it works without trusted user activation. If the
 * click does not stick, we set the `theater` attribute on ytd-watch-flexy
 * directly as a secondary best-effort nudge.
 */
export function activateTheaterMode(documentLike: {
    querySelector(selector: string): { click(): void; hasAttribute(name: string): boolean } | null;
    querySelectorAll?(selector: string): ArrayLike<{ setAttribute?(name: string, value: string): void }>;
}, logger: DiagnosticLogger = defaultLogger): boolean {
    const flexy = documentLike.querySelector(YOUTUBE_WATCH_FLEXY_SELECTOR);
    if (flexy?.hasAttribute('theater')) {
        logger('YouTube theater mode already active', { selector: YOUTUBE_WATCH_FLEXY_SELECTOR });
        return true;
    }
    const button = documentLike.querySelector(YOUTUBE_THEATER_BUTTON_SELECTOR);
    if (button) {
        try {
            button.click();
            logger('YouTube theater (size) button clicked; YouTube applies the layout asynchronously', { selector: YOUTUBE_THEATER_BUTTON_SELECTOR, button });
            return true;
        } catch (error) {
            logger('YouTube theater button click failed; trying attribute toggle', { selector: YOUTUBE_THEATER_BUTTON_SELECTOR, error });
        }
    } else {
        logger('YouTube theater (size) button not found; trying attribute toggle', { selector: YOUTUBE_THEATER_BUTTON_SELECTOR });
    }
    if (documentLike.querySelector(YOUTUBE_WATCH_FLEXY_SELECTOR)?.hasAttribute('theater')) {
        logger('YouTube theater mode active after button click', { selector: YOUTUBE_WATCH_FLEXY_SELECTOR });
        return true;
    }
    // Secondary nudge: set the polymer attribute directly. YouTube's own CSS
    // keys the full-width player layout off ytd-watch-flexy[theater], so even
    // if the polymer property isn't updated, our presentation CSS below
    // stretches the player regardless.
    const flexyElements = documentLike.querySelectorAll?.(YOUTUBE_WATCH_FLEXY_SELECTOR);
    if (flexyElements && flexyElements.length > 0) {
        try {
            flexyElements[0].setAttribute?.('theater', '');
            logger('set theater attribute on ytd-watch-flexy directly', { selector: YOUTUBE_WATCH_FLEXY_SELECTOR });
            return true;
        } catch (error) {
            logger('failed to set theater attribute on ytd-watch-flexy', { selector: YOUTUBE_WATCH_FLEXY_SELECTOR, error });
        }
    }
    logger('theater mode could not be confirmed; presentation CSS will stretch the player anyway', { selector: YOUTUBE_WATCH_FLEXY_SELECTOR });
    return false;
}

export const presentationMessage = (message: unknown): boolean =>
    Boolean(message && typeof message === 'object' && (message as { type?: unknown }).type === 'fullscreen');

/**
 * CSS-only presentation. Verified against the real YouTube watch-page DOM:
 *
 *   ytd-app
 *   └─ #masthead-container / ytd-masthead            (top chrome — hidden)
 *   └─ #guide                                         (left sidebar — hidden)
 *   └─ ytd-page-manager
 *      └─ ytd-watch-flexy[theater]
 *         ├─ #player                                  (expands in theater mode)
 *         │  └─ #player-container-outer > #player-container-inner
 *         │     └─ ytd-player (#movie_player) > video.html5-main-video
 *         ├─ #secondary                               (related sidebar — hidden)
 *         └─ #comments / ytd-watch-next-secondary-results-renderer (hidden)
 *
 * The <video> element is deliberately NOT styled: YouTube sizes it with
 * inline width/height/transform relative to the expanded player, and any
 * forced positioning fights that (the previous white-video bug). We only
 * hide chrome and stretch the player container chain.
 */
export function applyPresentation(documentLike: {
    documentElement: { classList: { add(value: string): void } };
    body?: { classList: { add(value: string): void } } | null;
    getElementById(id: string): { id: string; textContent: string | null } | null;
    createElement(name: string): { id: string; textContent: string };
    head: { append(element: unknown): void };
}): boolean {
    try {
        documentLike.documentElement.classList.add(PRESENTATION_CLASS);
        documentLike.body?.classList.add(PRESENTATION_CLASS);
        if (!documentLike.getElementById(PRESENTATION_STYLE_ID)) {
            const style = documentLike.createElement('style');
            style.id = PRESENTATION_STYLE_ID;
            style.textContent = `
/* Hide page chrome */
html.${PRESENTATION_CLASS} #masthead-container, html.${PRESENTATION_CLASS} ytd-masthead,
html.${PRESENTATION_CLASS} #guide, html.${PRESENTATION_CLASS} #guide-spacer,
html.${PRESENTATION_CLASS} #secondary, html.${PRESENTATION_CLASS} #comments,
html.${PRESENTATION_CLASS} #related, html.${PRESENTATION_CLASS} ytd-watch-next-secondary-results-renderer,
html.${PRESENTATION_CLASS} #player-ads { display: none !important; }
/* Expand the watch layout: uncap widths so the player area can fill the viewport */
html.${PRESENTATION_CLASS} ytd-app, html.${PRESENTATION_CLASS} #content,
html.${PRESENTATION_CLASS} ytd-page-manager, html.${PRESENTATION_CLASS} #page-manager,
html.${PRESENTATION_CLASS} ytd-watch-flexy, html.${PRESENTATION_CLASS} #columns,
html.${PRESENTATION_CLASS} #primary, html.${PRESENTATION_CLASS} #primary-inner,
html.${PRESENTATION_CLASS} #player {
    max-width: none !important; width: auto !important; padding: 0 !important; margin: 0 !important;
}
/* Stretch the player container chain to the full viewport — no position hacks,
   no styling of the <video> element itself */
html.${PRESENTATION_CLASS} #player,
html.${PRESENTATION_CLASS} #player-container-outer,
html.${PRESENTATION_CLASS} #player-container-inner {
    width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important;
}
html.${PRESENTATION_CLASS} #movie_player {
    width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important;
}
/* Immersive background */
html.${PRESENTATION_CLASS}, html.${PRESENTATION_CLASS} body { background: #000 !important; }
`;
            documentLike.head.append(style);
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * Diagnostics: log the computed size of the player container and the video
 * element after the presentation is applied, to verify the video actually
 * renders inside the expanded player.
 */
export function logPresentationDiagnostics(documentLike: {
    querySelector(selector: string): { getBoundingClientRect(): { width: number; height: number; top: number; left: number }; offsetWidth?: number; videoWidth?: number; videoHeight?: number } | null;
}, logger: DiagnosticLogger = defaultLogger): void {
    const player = documentLike.querySelector(YOUTUBE_PLAYER_SELECTOR);
    const video = documentLike.querySelector(YOUTUBE_VIDEO_SELECTOR);
    logger('presentation diagnostics', {
        player: player
            ? { selector: YOUTUBE_PLAYER_SELECTOR, rect: player.getBoundingClientRect() }
            : { selector: YOUTUBE_PLAYER_SELECTOR, found: false },
        video: video
            ? { selector: YOUTUBE_VIDEO_SELECTOR, rect: video.getBoundingClientRect(), intrinsic: { videoWidth: video.videoWidth, videoHeight: video.videoHeight } }
            : { selector: YOUTUBE_VIDEO_SELECTOR, found: false },
    });
}