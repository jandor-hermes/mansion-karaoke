import { describe, expect, it, vi } from 'vitest';
import {
    PRESENTATION_CLASS,
    YOUTUBE_FULLSCREEN_BUTTON_SELECTOR,
    YOUTUBE_THEATER_BUTTON_SELECTOR,
    YOUTUBE_WATCH_FLEXY_SELECTOR,
    activateTheaterMode,
    applyPresentation,
    clickYouTubeFullscreenButton,
    logPresentationDiagnostics,
    presentationMessage,
} from '../src/presentation';
import { classifyYouTubeError } from '../src/content';

describe('YouTube presentation mode', () => {
    it('uses the supplied YouTube fullscreen button selector', () => {
        expect(YOUTUBE_FULLSCREEN_BUTTON_SELECTOR).toBe('button.ytp-fullscreen-button[aria-label*="Full screen"]');
    });

    it('locates, logs, and clicks the YouTube fullscreen button', () => {
        const button = { click: vi.fn() };
        const querySelector = vi.fn().mockReturnValue(button);
        const logger = vi.fn();

        expect(clickYouTubeFullscreenButton({ querySelector }, logger)).toBe(true);
        expect(querySelector).toHaveBeenCalledWith(YOUTUBE_FULLSCREEN_BUTTON_SELECTOR);
        expect(button.click).toHaveBeenCalledOnce();
        expect(logger).toHaveBeenCalledWith('YouTube fullscreen button located', expect.objectContaining({ selector: YOUTUBE_FULLSCREEN_BUTTON_SELECTOR, button }));
    });

    it('diagnoses a missing button without preventing fallback presentation', () => {
        const logger = vi.fn();
        expect(clickYouTubeFullscreenButton({ querySelector: () => null }, logger)).toBe(false);
        expect(logger).toHaveBeenCalledWith('YouTube fullscreen button not found (best-effort attempt only; CSS presentation will proceed)', expect.objectContaining({ selector: YOUTUBE_FULLSCREEN_BUTTON_SELECTOR }));
    });

    it('diagnoses a blocked synthetic click as a best-effort failure', () => {
        const error = new Error('User activation is required');
        const logger = vi.fn();
        const button = { click: vi.fn(() => { throw error; }) };
        expect(clickYouTubeFullscreenButton({ querySelector: () => button }, logger)).toBe(false);
        expect(logger).toHaveBeenCalledWith('YouTube fullscreen button click failed (expected: untrusted activation); falling back to CSS presentation', expect.objectContaining({ error }));
    });

    it('recognizes only the fullscreen presentation command', () => {
        expect(presentationMessage({ type: 'fullscreen' })).toBe(true);
        expect(presentationMessage({ type: 'resume' })).toBe(false);
    });

    it('distinguishes media errors from page text that says unavailable', () => {
        const media = { error: { code: 3, message: '' } } as any;
        expect(classifyYouTubeError({ body: { innerText: 'Video unavailable' } }, media).code).toBe('MEDIA_ERROR_3');
        expect(classifyYouTubeError({ body: { innerText: 'Video unavailable' } }, { error: null } as any).code).toBe('PAGE_UNAVAILABLE_TEXT');
    });

    describe('theater mode activation', () => {
        it('clicks the theater size button when theater is not yet active', () => {
            const logger = vi.fn();
            const button = { click: vi.fn() };
            const doc = {
                querySelector: vi.fn((selector: string) => {
                    if (selector === YOUTUBE_WATCH_FLEXY_SELECTOR) return { click: () => undefined, hasAttribute: (name: string) => name !== 'theater' };
                    if (selector === YOUTUBE_THEATER_BUTTON_SELECTOR) return button;
                    return null;
                }),
            };
            expect(activateTheaterMode(doc as any, logger)).toBe(true);
            expect(button.click).toHaveBeenCalledOnce();
            expect(logger).toHaveBeenCalledWith('YouTube theater (size) button clicked; YouTube applies the layout asynchronously', expect.objectContaining({ selector: YOUTUBE_THEATER_BUTTON_SELECTOR }));
        });

        it('does not click the size button when theater is already active', () => {
            const logger = vi.fn();
            const button = { click: vi.fn() };
            const doc = {
                querySelector: (selector: string) =>
                    selector === YOUTUBE_WATCH_FLEXY_SELECTOR
                        ? { click: () => undefined, hasAttribute: () => true }
                        : selector === YOUTUBE_THEATER_BUTTON_SELECTOR
                            ? button
                            : null,
            };
            expect(activateTheaterMode(doc as any, logger)).toBe(true);
            expect(button.click).not.toHaveBeenCalled();
        });

        it('sets the theater attribute directly when the button is missing', () => {
            const logger = vi.fn();
            const setAttribute = vi.fn();
            const flexy = { click: () => undefined, hasAttribute: () => false, setAttribute };
            const doc = {
                querySelector: (selector: string) => (selector === YOUTUBE_WATCH_FLEXY_SELECTOR ? flexy : null),
                querySelectorAll: () => [flexy],
            };
            expect(activateTheaterMode(doc as any, logger)).toBe(true);
            expect(setAttribute).toHaveBeenCalledWith('theater', '');
        });
    });

    describe('CSS presentation', () => {
        const makeDoc = () => {
            const classes = new Set<string>();
            const styles: Array<{ id: string; textContent: string }> = [];
            const doc = {
                documentElement: { classList: { add: (value: string) => classes.add(value) } },
                body: { classList: { add: (value: string) => classes.add(value) } },
                getElementById: (id: string) => styles.find((style) => style.id === id) ?? null,
                createElement: () => ({ id: '', textContent: '' }),
                head: { append: (style: { id: string; textContent: string }) => styles.push(style) },
            } as any;
            return { doc, classes, styles };
        };

        it('adds the presentation class and stylesheet once', () => {
            const { doc, classes, styles } = makeDoc();
            expect(applyPresentation(doc)).toBe(true);
            expect(classes.has(PRESENTATION_CLASS)).toBe(true);
            expect(styles).toHaveLength(1);
            expect(applyPresentation(doc)).toBe(true);
            expect(styles).toHaveLength(1);
        });

        it('hides page chrome but never styles the video element', () => {
            const { doc, styles } = makeDoc();
            applyPresentation(doc);
            const css = styles[0].textContent;
            for (const chrome of ['#masthead-container', 'ytd-masthead', '#guide', '#secondary', '#comments', '#related']) {
                expect(css).toContain(chrome);
            }
            expect(css).toContain('display: none');
            // The video element must NOT be repositioned or resized by our CSS.
            expect(css).not.toMatch(/video\s*\{|video\s*,/);
            expect(css).not.toContain('html5-main-video');
            // No fixed/inset position hacks on player containers.
            expect(css).not.toContain('position: fixed');
            expect(css).not.toContain('position:fixed');
            expect(css).not.toContain('inset: 0');
            expect(css).not.toContain('inset:0');
        });

        it('stretches the player container chain to the viewport', () => {
            const { doc, styles } = makeDoc();
            applyPresentation(doc);
            const css = styles[0].textContent;
            for (const container of ['#player', '#player-container-outer', '#player-container-inner', '#movie_player']) {
                expect(css).toContain(container);
            }
            expect(css).toContain('100vw');
            expect(css).toContain('100vh');
        });
    });

    describe('presentation diagnostics', () => {
        it('logs computed sizes of the player and video elements', () => {
            const logger = vi.fn();
            const doc = {
                querySelector: (selector: string) =>
                    selector === '#movie_player'
                        ? { getBoundingClientRect: () => ({ width: 1920, height: 1080, top: 0, left: 0 }) }
                        : selector === 'video.html5-main-video'
                            ? { getBoundingClientRect: () => ({ width: 1920, height: 1080, top: 0, left: 0 }), videoWidth: 3840, videoHeight: 2160 }
                            : null,
            };
            logPresentationDiagnostics(doc as any, logger);
            expect(logger).toHaveBeenCalledWith('presentation diagnostics', expect.objectContaining({
                player: expect.objectContaining({ selector: '#movie_player', rect: { width: 1920, height: 1080, top: 0, left: 0 } }),
                video: expect.objectContaining({ selector: 'video.html5-main-video', intrinsic: { videoWidth: 3840, videoHeight: 2160 } }),
            }));
        });

        it('reports missing elements gracefully', () => {
            const logger = vi.fn();
            logPresentationDiagnostics({ querySelector: () => null }, logger);
            expect(logger).toHaveBeenCalledWith('presentation diagnostics', expect.objectContaining({
                player: { selector: '#movie_player', found: false },
                video: { selector: 'video.html5-main-video', found: false },
            }));
        });
    });
});