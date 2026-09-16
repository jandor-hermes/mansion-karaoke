import { createRequire } from 'node:module';
import { createControlPlane, type ControlPlane } from './index.js';
import { createVkaraInnertubeSearchAdapter, type InnertubeClientLike } from './youtube-search.js';
import { createGoogleYouTubeSuggestionAdapter } from './suggest.js';
import type { SearchAdapter } from './search.js';

type YoutubeiClientConstructor = new (options: { oauth: { enabled: false } }) => InnertubeClientLike;
export type BootstrapOptions = {
  token: string;
  roomId: string;
  search?: SearchAdapter;
  youtubeiClient?: InnertubeClientLike;
};

export const YOUTUBEI_CONFIGURATION_ERROR =
  'youtubei is required for the default no-key search adapter; install youtubei or inject a search adapter';

function loadYoutubeiClient(): InnertubeClientLike {
  try {
    const require = createRequire(import.meta.url);
    const loaded = require('youtubei') as { Client?: YoutubeiClientConstructor; default?: { Client?: YoutubeiClientConstructor } };
    const Client = loaded.Client ?? loaded.default?.Client;
    if (!Client) throw new Error('youtubei Client export is missing');
    return new Client({ oauth: { enabled: false } });
  } catch (error) {
    throw new Error(YOUTUBEI_CONFIGURATION_ERROR, { cause: error });
  }
}

export function createSearchAdapter(options: Pick<BootstrapOptions, 'search' | 'youtubeiClient'> = {}): SearchAdapter {
  if (options.search) return options.search;
  return createVkaraInnertubeSearchAdapter(options.youtubeiClient ?? loadYoutubeiClient());
}

export function createBootstrappedControlPlane(options: BootstrapOptions): ControlPlane {
  return createControlPlane({ ...options, search: createSearchAdapter(options), suggest: createGoogleYouTubeSuggestionAdapter() });
}
