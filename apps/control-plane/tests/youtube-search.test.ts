import { describe, expect, it } from 'vitest';
import { normalizeInnertubeSearchResponse, createYoutubeInnertubeSearchAdapter } from '../src/youtube-search.js';

const fixture = {
  contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [{ videoRenderer: {
    videoId: 'abc123', title: { runs: [{ text: 'Karaoke Song' }] }, ownerText: { simpleText: 'Sing King' },
    lengthText: { simpleText: '4:00' }, thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg' }] },
  }}] }}, { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'next-token' } } } }] } } } },
};

describe('Innertube search normalization', () => {
  it('extracts normalized video items and continuation from an initial response', () => {
    expect(normalizeInnertubeSearchResponse(fixture)).toEqual({ items: [{ id: 'abc123', title: 'Karaoke Song', channel: 'Sing King', duration: '4:00', thumbnail: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg' }], continuation: 'next-token' });
  });

  it('supports continuation responses and ignores non-video renderers', () => {
    expect(normalizeInnertubeSearchResponse({ onResponseReceivedCommands: [{ appendContinuationItemsAction: { continuationItems: [{ videoRenderer: { videoId: 'v2', title: { simpleText: 'Second' } }, continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'last' } } } }] } }] })).toEqual({ items: [{ id: 'v2', title: 'Second' }], continuation: 'last' });
  });

  it('exposes explicit configuration and upstream errors', async () => {
    await expect(createYoutubeInnertubeSearchAdapter({}).search('song')).rejects.toThrow('search_not_configured');
    const adapter = createYoutubeInnertubeSearchAdapter({ apiKey: 'key', fetch: async () => new Response('bad', { status: 503 }) });
    await expect(adapter.search('song')).rejects.toThrow('youtube_search_upstream_503');
  });
});
