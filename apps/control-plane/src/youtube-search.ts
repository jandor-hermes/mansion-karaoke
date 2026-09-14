import type { SearchAdapter, SearchPage, SearchVideo } from './search.js';

type InnertubePostOptions = { data: Record<string, unknown> };
export type InnertubeClientLike = {
  http: { post(endpoint: string, options: InnertubePostOptions): Promise<{ data: unknown }> };
};
type FetchLike = typeof fetch;
type Runtime = { client?: InnertubeClientLike; fetch?: FetchLike; endpoint?: string; apiKey?: string };
export type YoutubeSearchRuntime = Runtime;

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
    out.push({ id: video.videoId, title: title ?? video.videoId, ...(channel ? { channel } : {}), ...(text(video.lengthText) ? { duration: text(video.lengthText) } : {}), ...(thumbs?.at(-1)?.url ? { thumbnail: thumbs.at(-1)!.url } : {}) });
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

/** Adapter seam for vkara's youtubei Client; no Redis, BullMQ, or API key involved. */
export function createVkaraInnertubeSearchAdapter(client: InnertubeClientLike): SearchAdapter {
  return {
    async search(query, continuation): Promise<SearchPage> {
      const data = continuation ? { continuation } : { query, params: 'EgIQAQ==' };
      const response = await client.http.post('/youtubei/v1/search', { data });
      return normalizeInnertubeSearchResponse(response.data);
    },
  };
}

/** @deprecated Use createVkaraInnertubeSearchAdapter for the retained vkara path. */
export function createYoutubeInnertubeSearchAdapter(runtime: Runtime): SearchAdapter {
  if (runtime.client) return createVkaraInnertubeSearchAdapter(runtime.client);
  return {
    async search(query: string, continuation?: string): Promise<SearchPage> {
      if (!runtime.apiKey) throw new Error('search_not_configured');
      const body = continuation ? { continuation } : { query, params: 'EgIQAQ==' };
      const response = await (runtime.fetch ?? fetch)(runtime.endpoint ?? 'https://www.youtube.com/youtubei/v1/search?key=' + encodeURIComponent(runtime.apiKey), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`youtube_search_upstream_${response.status}`);
      return normalizeInnertubeSearchResponse(await response.json());
    },
  };
}

/** Explicit legacy official-API-key mode; not the vkara Innertube adapter. */
export function createYoutubeApiKeySearchAdapter(runtime: Omit<Runtime, 'client'> & { apiKey: string }): SearchAdapter {
  return createYoutubeInnertubeSearchAdapter(runtime);
}

export function createConfiguredYoutubeSearchAdapter(env: NodeJS.ProcessEnv = process.env): SearchAdapter {
  const apiKey = env.YOUTUBE_API_KEY ?? env.INNERTUBE_API_KEY;
  if (!apiKey) return createYoutubeInnertubeSearchAdapter({});
  return createYoutubeApiKeySearchAdapter({ apiKey });
}
