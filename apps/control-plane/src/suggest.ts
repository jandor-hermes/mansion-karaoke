import type { SuggestionAdapter } from './index.js';

type FetchLike = typeof fetch;

export function parseGoogleSuggestions(value: unknown): string[] {
    if (!Array.isArray(value) || !Array.isArray(value[1])) return [];
    const seen = new Set<string>();
    const suggestions: string[] = [];
    for (const candidate of value[1]) {
        if (typeof candidate !== 'string') continue;
        const trimmed = candidate.trim();
        const normalized = trimmed.toLowerCase();
        if (!trimmed || seen.has(normalized)) continue;
        seen.add(normalized);
        suggestions.push(trimmed);
    }
    return suggestions;
}

export function createGoogleYouTubeSuggestionAdapter(fetcher: FetchLike = fetch): SuggestionAdapter {
    return {
        async suggest(query: string): Promise<string[]> {
            const url = new URL('https://suggestqueries.google.com/complete/search');
            url.searchParams.set('client', 'firefox');
            url.searchParams.set('ds', 'yt');
            url.searchParams.set('q', query);
            const response = await fetcher(url.toString(), { headers: { accept: 'application/json' } });
            if (!response.ok) throw new Error(`suggest_upstream_${response.status}`);
            return parseGoogleSuggestions(await response.json());
        },
    };
}
