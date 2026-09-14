# Local control plane

Phase 2's minimal loopback control-plane vertical slice. It owns queue state and emits provider-neutral playback commands; the Firefox extension remains a separate playback agent and reports events back to `/events`.

## Run

From the repository root (dependencies must already be installed):

```sh
KARAOKE_TOKEN=change-me KARAOKE_ROOM_ID=local npm --prefix apps/control-plane run start
```

The service listens on `127.0.0.1:3010` by default. Set `PORT` to change it. Every request requires `Authorization: Bearer $KARAOKE_TOKEN`.

## API

- `POST /queue` — JSON `{ "itemId": "song-1", "videoId": "YouTubeId" }` (duplicate item IDs are idempotent)
- `GET /command?after=<sequence>` — returns the next command after the provider's last applied sequence, or `{ command: null, sequence }`
- `POST /events` — accepts schemas from `packages/playback-protocol` (an `ended` event for the current item advances the queue)
- `POST /control/pause`, `/control/resume`, `/control/skip`
- `POST /control/volume` — JSON `{ "volume": 0.0..1.0 }`
- `GET /status` — current item, queued items, and command sequence
- `POST /search` — JSON `{ "query": "karaoke", "continuation": "optional-token" }`; delegates to an injected search adapter. Without one, returns `503 { "error": "search_not_configured" }`.

### Search integration seam

The control plane intentionally does not import the vkara API runtime (which also prepares Redis-backed channel metadata). `src/youtube-search.ts` is the thin standalone Innertube adapter: it posts the same video-search request shape, parses raw `videoRenderer`/continuation nodes, and returns normalized `{ items, continuation }`. Construct the service with `createConfiguredYoutubeSearchAdapter()` when `YOUTUBE_API_KEY` or `INNERTUBE_API_KEY` is present; absent configuration returns explicit `search_not_configured`, and non-2xx upstream responses return `youtube_search_upstream_<status>`. The parser is fixture-tested without network access.

Run `npm --prefix apps/control-plane run search:smoke [query]` for an optional network smoke. It exits cleanly with `SKIP` when configuration is absent; network availability and YouTube response compatibility remain external gates.

The command sequence is monotonic. A provider can persist its last sequence and resume polling after an extension restart without replaying already-applied commands. Queue authority stays in this service.

## Tests

```sh
npm --prefix apps/control-plane test
```

The integration tests cover authentication, enqueue/play-next, ended advancement, skip, pause/resume/volume, idempotent queueing, and provider restart polling recovery.

The implementation retains the repository's MIT attribution and uses the existing provider-neutral protocol schemas.
