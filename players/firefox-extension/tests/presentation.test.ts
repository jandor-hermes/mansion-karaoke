import { describe, expect, it } from 'vitest';
import { PRESENTATION_CLASS, applyPresentation, presentationMessage } from '../src/presentation';
import { classifyYouTubeError } from '../src/content';

describe('YouTube presentation mode', () => {
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
