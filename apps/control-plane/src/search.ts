/** Search boundary for the local control plane. The vkara adapter can be
 * supplied without importing the API runtime (Redis, BullMQ, or Elysia). */
export type SearchVideo = {
    id: string;
    title: string;
    channel?: string;
    duration?: string;
    thumbnail?: string;
};

export type SearchPage = { items: SearchVideo[]; continuation: string | null };
export type SearchPageFetcher = (query: string, continuation?: string) => Promise<SearchPage>;
export type SearchAdapter = { search(query: string, continuation?: string): Promise<SearchPage> };

export function createSearchAdapter(fetchPage: SearchPageFetcher): SearchAdapter {
    return { search: fetchPage };
}

export function createUnavailableSearchAdapter(): SearchAdapter {
    return {
        async search() {
            throw new Error('search_not_configured');
        },
    };
}
