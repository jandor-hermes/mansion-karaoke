import { describe, expect, it, vi } from 'vitest';
import { PRESENTATION_CLASS, YOUTUBE_FULLSCREEN_BUTTON_SELECTOR, applyPresentation, clickYouTubeFullscreenButton, presentationMessage } from '../src/presentation';
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
        expect(logger).toHaveBeenCalledWith('YouTube fullscreen button not found', expect.objectContaining({ selector: YOUTUBE_FULLSCREEN_BUTTON_SELECTOR }));
    });

    it('diagnoses a blocked synthetic click', () => {
        const error = new Error('User activation is required');
        const logger = vi.fn();
        const button = { click: vi.fn(() => { throw error; }) };
        expect(clickYouTubeFullscreenButton({ querySelector: () => button }, logger)).toBe(false);
        expect(logger).toHaveBeenCalledWith('YouTube fullscreen button click failed', expect.objectContaining({ error }));
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

    it('adds the presentation class and stylesheet once', () => {
        const classes = new Set<string>();
        const styles: Array<{ id: string; textContent: string }> = [];
        const doc = {
            documentElement: { classList: { add: (value: string) => classes.add(value) } },
            body: { classList: { add: (value: string) => classes.add(value) } },
            getElementById: (id: string) => styles.find((style) => style.id === id) ?? null,
            createElement: () => ({ id: '', textContent: '' }),
            head: { append: (style: { id: string; textContent: string }) => styles.push(style) },
        } as any;
        expect(applyPresentation(doc)).toBe(true);
        expect(classes.has(PRESENTATION_CLASS)).toBe(true);
        expect(styles).toHaveLength(1);
        expect(styles[0].textContent).toContain('#movie_player');
        expect(applyPresentation(doc)).toBe(true);
        expect(styles).toHaveLength(1);
    });
});
