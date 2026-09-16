import { describe, expect, it } from 'vitest';
import {
  createYoutubeInnertubeSearchAdapter,
  normalizeInnertubeSearchResponse,
  type InnertubeClientLike,
} from '../src/youtube-search.js';

const fixture = {
  contents: {
    twoColumnSearchResultsRenderer: {
      primaryContents: {
        sectionListRenderer: {
          contents: [{
            itemSectionRenderer: {
              contents: [{ videoRenderer: {
                videoId: 'abc123',
                title: { runs: [{ text: 'Karaoke Song' }] },
                ownerText: { simpleText: 'Sing King' },
                lengthText: { simpleText: '4:00' },
                thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg' }] },
              } }],
            },
          }, {
            continuationItemRenderer: {
              continuationEndpoint: { continuationCommand: { token: 'next-token' } },
            },
          }],
        },
      },
    },
  },
};

describe('Innertube search normalization', () => {
  it('extracts normalized video items and continuation from an initial response', () => {
    expect(normalizeInnertubeSearchResponse(fixture)).toEqual({
      items: [{ id: 'abc123', title: 'Karaoke Song', channel: 'Sing King', duration: '4:00', thumbnail: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg' }],
      continuation: 'next-token',
    });
  });

  it('supports continuation responses and ignores non-video renderers', () => {
    expect(normalizeInnertubeSearchResponse({ onResponseReceivedCommands: [{ appendContinuationItemsAction: { continuationItems: [{ videoRenderer: { videoId: 'v2', title: { simpleText: 'Second' } }, continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'last' } } } }] } }] })).toEqual({ items: [{ id: 'v2', title: 'Second' }], continuation: 'last' });
  });

  it('uses youtubei client context without an official API key', async () => {
    const calls: Array<{ endpoint: string; data: Record<string, unknown> }> = [];
    const client: InnertubeClientLike = {
      http: { post: async (endpoint: string, options: { data: Record<string, unknown> }) => { calls.push({ endpoint, data: options.data }); return { data: fixture }; } },
    };
    const adapter = createYoutubeInnertubeSearchAdapter({
      client,
    });

    await expect(adapter.search('song')).resolves.toEqual(normalizeInnertubeSearchResponse(fixture));
    expect(calls).toEqual([{ endpoint: '/youtubei/v1/search', data: { query: 'song', params: 'EgIQAQ==' } }]);
  });

  it('sends only the continuation for subsequent pages', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client: InnertubeClientLike = {
      http: { post: async (_endpoint: string, options: { data: Record<string, unknown> }) => { calls.push(options.data); return { data: { contents: [] } }; } },
    };
    const adapter = createYoutubeInnertubeSearchAdapter({ client });

    await adapter.search('ignored', 'next-token');
    expect(calls).toEqual([{ continuation: 'next-token' }]);
  });
});
