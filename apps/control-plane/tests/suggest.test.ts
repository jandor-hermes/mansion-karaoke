import { describe, expect, it, vi } from 'vitest';

import { createGoogleYouTubeSuggestionAdapter, parseGoogleSuggestions } from '../src/suggest.js';

describe('Google YouTube no-key suggestions', () => {
    it('defensively parses the Firefox suggestion response', () => {
        expect(parseGoogleSuggestions(['query', ['Queen karaoke', 'queen karaoke', '', 42, 'Bohemian Rhapsody karaoke']]))
            .toEqual(['Queen karaoke', 'Bohemian Rhapsody karaoke']);
        expect(parseGoogleSuggestions({ bad: true })).toEqual([]);
    });

    it('calls the YouTube suggestion endpoint without an API key', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(['queen', ['queen karaoke', 'queen songs']]), { status: 200 }));
        const adapter = createGoogleYouTubeSuggestionAdapter(fetcher);
        await expect(adapter.suggest('queen kar')).resolves.toEqual(['queen karaoke', 'queen songs']);
        const url = new URL(fetcher.mock.calls[0][0]);
        expect(url.origin + url.pathname).toBe('https://suggestqueries.google.com/complete/search');
        expect(url.searchParams.get('client')).toBe('firefox');
        expect(url.searchParams.get('ds')).toBe('yt');
        expect(url.searchParams.get('q')).toBe('queen kar');
    });

    it('rejects upstream failures', async () => {
        const adapter = createGoogleYouTubeSuggestionAdapter(vi.fn().mockResolvedValue(new Response('no', { status: 503 })));
        await expect(adapter.suggest('queen')).rejects.toThrow('suggest_upstream_503');
    });
});
