# Local control plane

Phase 2's minimal loopback control-plane vertical slice. It owns queue state and emits provider-neutral playback commands; the Firefox extension remains a separate playback agent and reports events back to `/events`.

## Run

From the repository root, install the locked workspace dependencies and build the controller:

```sh
bun install --no-save
node apps/control-plane/scripts/build.mjs
KARAOKE_TOKEN=change-me KARAOKE_ROOM_ID=local node apps/control-plane/dist/apps/control-plane/src/server.js
```

For the complete friend-facing developer workflow, including token generation and the Firefox build, use `./scripts/karaoke-dev.sh run` and follow [`FRIEND_SETUP.md`](../../FRIEND_SETUP.md).

The service binds `0.0.0.0` (all interfaces) so phones on the same Wi-Fi can load the guest page; set `KARAOKE_BIND=127.0.0.1` to restrict it to loopback again. **Security tradeoff:** binding LAN-wide exposes an authenticated control API (queue, playback controls) to everyone on the local network — anyone with the `KARAOKE_TOKEN` party secret can steer playback, so use a long random token and treat it as shared, revocable, and unsuitable for untrusted networks. At startup the server prints its loopback URL plus `guest UI (phones on this Wi-Fi): http://<LAN-IP>:<PORT>/` lines for every LAN IPv4 address it detects.

Every API request except `GET /` requires `Authorization: Bearer <KARAOKE_TOKEN>`.

## Guest UI (phones)

Open `http://<Mac-LAN-IP>:3010/` on a phone on the same Wi-Fi (the exact URL is printed at startup, e.g. `http://192.168.4.31:3010/`). The page is a single static HTML+JS file served by the control plane — dark party styling, big touch targets, no framework or build step. On first load it asks for a display name and shows the party token as ordinary text for easy entry, then stores both in that phone browser's `localStorage` (the token remains a shared party secret, not a personal credential). New queue items carry the display name as `requestedBy`, which appears in Now Playing, Queue, and History; guests can edit their name or token through Profile. It supports search, a Now playing + queue view polled from `GET /status` every 2.5 s, and pause/resume, skip, volume ±0.25, and fullscreen control buttons. Each queued card has `↑`/`↓` buttons (move up/down via `POST /queue/move`) and a `✕` button (remove via `POST /queue/remove`); the currently playing card has no such buttons.

CORS: the control plane allows the Firefox extension origin plus same-LAN `http:` origins (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`, `localhost`/`127.0.0.1`), so the phone-served page can call the API; `https` and public-host origins are rejected.

## API

- `POST /queue` — enqueue a song; accepts `{ "itemId": "song-1", "videoId": "YouTubeId", "title": "optional", "channel": "optional", "duration": "optional", "thumbnail": "optional", "requestedBy": "optional display name" }` (duplicate item IDs are idempotent)
- `POST /queue/next` — put a song at the front of the waiting queue; starts immediately when idle
- `POST /queue/play-now` — interrupt and play a new song immediately while preserving the waiting queue
- `POST /queue/play` — JSON `{ "itemId": "song-1" }`; play an existing queued item immediately while preserving the relative order of every other waiting item
- `POST /queue/clear` — clears all waiting items without interrupting the currently playing song or changing history
- `GET /join-info` — authenticated endpoint for the TV extension; returns a LAN join URL whose fragment carries the shared party token for one-scan entry
- `GET /status` includes newest-first `history` for ended, skipped, and replaced songs (up to 100 entries in memory)
- `POST /queue/remove` — JSON `{ "itemId": "song-1" }`; removes a queued item and returns `{ "queue": [...] }`. Returns `409` for the currently playing item (skip instead) and `404` if the item is not queued.
- `POST /queue/move` — JSON `{ "itemId": "song-1", "position": 0 }`; 0-based index within the remaining queue, invalid positions are clamped. Returns `400` for the currently playing item or an unknown itemId, plus the updated `{ "queue": [...] }` on success.
- `GET /command?after=<sequence>` — returns the next command after the provider's last applied sequence, or `{ command: null, sequence }`
- `POST /events` — accepts schemas from `packages/playback-protocol` (an `ended` event for the current item advances the queue)
- `POST /control/pause`, `/control/resume`, `/control/skip`
- `POST /control/volume` — JSON `{ "volume": 0.0..1.0 }`
- `GET /status` — current item, queued items, and command sequence
- `POST /search` — JSON `{ "query": "karaoke", "continuation": "optional-token" }`; delegates to an injected search adapter. Without one, returns `503 { "error": "search_not_configured" }`.
- `GET /suggest?q=...` — no-key YouTube autocomplete suggestions; authenticated like the other API routes.

### Search integration seam

The control plane intentionally does not import the vkara API runtime (Redis, BullMQ, or Elysia). Local source confirms that vkara creates `youtubei`'s `Client({ oauth: { enabled: false } })` and posts `/youtubei/v1/search` through `client.http.post`; the package supplies its Innertube client context and embedded client key. `src/youtube-search.ts` now exposes `createVkaraInnertubeSearchAdapter(client)`, a separate seam accepting that small client interface. It posts the vkara request shape without an official Data API key, parses raw `videoRenderer`/continuation nodes, and returns normalized `{ items, continuation }`. The adapter does not construct the `youtubei` client itself, so vkara's client/library extraction remains an explicit integration step.

`createYoutubeApiKeySearchAdapter()` is retained as explicitly named legacy API-key mode. `createConfiguredYoutubeSearchAdapter()` selects that mode only when `YOUTUBE_API_KEY` or `INNERTUBE_API_KEY` is present; otherwise it reports `search_not_configured`. No live search claim is made. The parser and no-key client seam are fixture-tested without network access.

Run `npm --prefix apps/control-plane run search:smoke [query]` for an optional no-secret smoke. It only checks the fixture-backed adapter seam and prints `SKIP` for live network access; live YouTube search is not exercised or claimed.

The command sequence is monotonic. A provider can persist its last sequence and resume polling after an extension restart without replaying already-applied commands. Queue authority stays in this service.

## Tests

```sh
npm --prefix apps/control-plane test
```

The integration tests cover authentication, enqueue/play-next, ended advancement, skip, pause/resume/volume, idempotent queueing, provider restart polling recovery, queue removal (including the currently-playing guard), and queue reordering with position clamping.

The implementation retains the repository's MIT attribution and uses the existing provider-neutral protocol schemas.
