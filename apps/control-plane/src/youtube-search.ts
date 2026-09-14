import type { SearchAdapter, SearchPage, SearchVideo } from './search.js';

type FetchLike = typeof fetch;
type Runtime = { apiKey?: string; fetch?: FetchLike; endpoint?: string };

const text = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  if (typeof record.simpleText === 'string') return record.simpleText;
  if (Array.isArray(record.runs)) return record.runs.map((run) => text(run) ?? '').join('') || undefined;
  return undefined;
};

function walk(value: unknown, out: SearchVideo[], continuations: string[]): void {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const video = record.videoRenderer as Record<string, unknown> | undefined;
  if (video && typeof video.videoId === 'string') {
    const title = text(video.title);
    const channel = text(video.ownerText) ?? text(video.longBylineText);
    const thumbs = (video.thumbnail as { thumbnails?: Array<{ url?: string }> } | undefined)?.thumbnails;
    out.push({ id: video.videoId, ...(title ? { title } : { title: video.videoId }), ...(channel ? { channel } : {}), ...(text(video.lengthText) ? { duration: text(video.lengthText) } : {}), ...(thumbs?.at(-1)?.url ? { thumbnail: thumbs.at(-1)!.url } : {}) });
  }
  const continuation = record.continuationCommand as { token?: unknown } | undefined;
  if (typeof continuation?.token === 'string') continuations.push(continuation.token);
  for (const child of Object.values(record)) walk(child, out, continuations);
}

export function normalizeInnertubeSearchResponse(response: unknown): SearchPage {
  const items: SearchVideo[] = [];
  const continuations: string[] = [];
  walk(response, items, continuations);
  return { items, continuation: continuations[0] ?? null };
}

export function createYoutubeInnertubeSearchAdapter(runtime: Runtime): SearchAdapter {
  return {
    async search(query: string, continuation?: string): Promise<SearchPage> {
      if (!runtime.apiKey) throw new Error('search_not_configured');
      const body = continuation ? { continuation } : { query, params: 'EgIQAQ%3D%3D' };
      const response = await (runtime.fetch ?? fetch)(runtime.endpoint ?? 'https://www.youtube.com/youtubei/v1/search?key=' + encodeURIComponent(runtime.apiKey), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`youtube_search_upstream_${response.status}`);
      return normalizeInnertubeSearchResponse(await response.json());
    },
  };
}

export function createConfiguredYoutubeSearchAdapter(env: NodeJS.ProcessEnv = process.env): SearchAdapter {
  return createYoutubeInnertubeSearchAdapter({ apiKey: env.YOUTUBE_API_KEY ?? env.INNERTUBE_API_KEY });
}
