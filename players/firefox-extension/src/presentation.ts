export const PRESENTATION_CLASS = 'karaoke-video-presentation';
export const PRESENTATION_STYLE_ID = 'karaoke-video-presentation-style';

export const presentationMessage = (message: unknown): boolean =>
    Boolean(message && typeof message === 'object' && (message as { type?: unknown }).type === 'fullscreen');

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
html.${PRESENTATION_CLASS}, html.${PRESENTATION_CLASS} body { background: #000 !important; overflow: hidden !important; }
html.${PRESENTATION_CLASS} #masthead-container, html.${PRESENTATION_CLASS} ytd-masthead,
html.${PRESENTATION_CLASS} #guide, html.${PRESENTATION_CLASS} #secondary,
html.${PRESENTATION_CLASS} #comments, html.${PRESENTATION_CLASS} #related,
html.${PRESENTATION_CLASS} ytd-watch-next-secondary-results-renderer,
html.${PRESENTATION_CLASS} #player-ads, html.${PRESENTATION_CLASS} .ytp-chrome-top,
html.${PRESENTATION_CLASS} .ytp-chrome-bottom, html.${PRESENTATION_CLASS} .ytp-gradient-top,
html.${PRESENTATION_CLASS} .ytp-gradient-bottom { display: none !important; }
html.${PRESENTATION_CLASS} ytd-page-manager, html.${PRESENTATION_CLASS} #page-manager,
html.${PRESENTATION_CLASS} #content, html.${PRESENTATION_CLASS} #player-container-outer,
html.${PRESENTATION_CLASS} #player-container-inner, html.${PRESENTATION_CLASS} #movie_player {
    position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
    max-width: none !important; margin: 0 !important; padding: 0 !important;
}
html.${PRESENTATION_CLASS} #movie_player video,
html.${PRESENTATION_CLASS} video.html5-main-video {
    position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important;
    max-width: 100% !important; max-height: 100% !important; object-fit: contain !important;
}
`;
            documentLike.head.append(style);
        }
        return true;
    } catch {
        return false;
    }
}
