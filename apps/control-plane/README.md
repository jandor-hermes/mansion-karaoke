# Local control plane

Phase 2's minimal loopback control-plane vertical slice. It owns queue state and emits provider-neutral playback commands; the Firefox extension remains a separate playback agent and reports events back to `/events`.

## Run

From the repository root, using the checked-in Bun install (no `bun`, `bunx`, `tsx`, or `workspace:*` install is required):

```sh
cd apps/control-plane
node scripts/build.mjs
KARAOKE_TOKEN=change-me KARAOKE_ROOM_ID=local npm run start
```

The service listens on `127.0.0.1:3010` by default. Set `PORT` to change it. Every request requires `Authorization: Bearer <KARAOKE_TOKEN>`. Build output is generated from the TypeScript source into `dist/` and is ignored by git.

## API

- `POST /queue` — JSON `{ "itemId": "song-1", "videoId": "YouTubeId" }` (duplicate item IDs are idempotent)
- `GET /command?after=<sequence>` — returns the next command after the provider's last applied sequence, or `{ command: null, sequence }`
- `POST /events` — accepts schemas from `packages/playback-protocol` (an `ended` event for the current item advances the queue)
- `POST /control/pause`, `/control/resume`, `/control/skip`
- `POST /control/volume` — JSON `{ "volume": 0.0..1.0 }`
- `GET /status` — current item, queued items, and command sequence
- `POST /search` — JSON `{ "query": "karaoke", "continuation": "optional-token" }`; delegates to an injected search adapter. Without one, returns `503 { "error": "search_not_configured" }`.

### Search integration seam

The control plane intentionally does not import the vkara API runtime (Redis, BullMQ, or Elysia). Local source confirms that vkara creates `youtubei`'s `Client({ oauth: { enabled: false } })` and posts `/youtubei/v1/search` through `client.http.post`; the package supplies its Innertube client context and embedded client key. `src/youtube-search.ts` now exposes `createVkaraInnertubeSearchAdapter(client)`, a separate seam accepting that small client interface. It posts the vkara request shape without an official Data API key, parses raw `videoRenderer`/continuation nodes, and returns normalized `{ items, continuation }`. The adapter does not construct the `youtubei` client itself, so vkara's client/library extraction remains an explicit integration step.

`createYoutubeApiKeySearchAdapter()` is retained as explicitly named legacy API-key mode. `createConfiguredYoutubeSearchAdapter()` selects that mode only when `YOUTUBE_API_KEY` or `INNERTUBE_API_KEY` is present; otherwise it reports `search_not_configured`. No live search claim is made. The parser and no-key client seam are fixture-tested without network access.

Run `npm --prefix apps/control-plane run search:smoke [query]` for an optional no-secret smoke. It only checks the fixture-backed adapter seam and prints `SKIP` for live network access; live YouTube search is not exercised or claimed.

The command sequence is monotonic. A provider can persist its last sequence and resume polling after an extension restart without replaying already-applied commands. Queue authority stays in this service.

## Tests

```sh
npm --prefix apps/control-plane test
```

The integration tests cover authentication, enqueue/play-next, ended advancement, skip, pause/resume/volume, idempotent queueing, and provider restart polling recovery.

The implementation retains the repository's MIT attribution and uses the existing provider-neutral protocol schemas.
