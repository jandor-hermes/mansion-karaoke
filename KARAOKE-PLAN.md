# Local YouTube Karaoke — Phased Build Plan

## Goal

Build a Mac-hosted karaoke app for a TV connected by HDMI. Guests join from phones over LAN, search YouTube karaoke videos, add songs to a shared queue, and control playback. The host plays videos in a normal Firefox `youtube.com/watch` tab rather than a YouTube iframe, so uploader-level embed restrictions do not eliminate otherwise playable videos.

## Architectural principles

1. **Preserve the proven product surface.** Reuse vkara's phone UI, QR/room flow, queue semantics, search presentation, Innertube search implementation, localization, and tests where practical.
2. **Keep playback behind a provider boundary.** The app must not depend directly on Firefox. Define a playback protocol so a future mpv/local-library provider can replace Firefox without rewriting room and queue logic.
3. **Separate control plane from playback plane.** The LAN web app owns rooms, guests, search, queue, and desired playback state. The Firefox extension is a playback agent that reports observed state; it is not the queue authority.
4. **Do not over-simplify the data model.** A single Mac is the first deployment, but room IDs, playback commands, idempotency, sequence numbers, and provider capabilities should remain explicit so the system can later support multiple rooms or another player.
5. **Keep upstream attribution and a clean update path.** Do not modify the only working vkara checkout in place. Create a derivative worktree/branch or a separate `karaoke-app` repository with the vkara MIT license and attribution retained.
6. **Test vertical slices.** Every phase must have automated tests plus a manual acceptance gate. Do not build a large UI shell before proving the end-to-end path.

## Current assets and constraints

- Upstream checkout: `/Users/hermes/Documents/karaoke/vkara`
- Existing checkout has local diagnostic changes and must be preserved.
- Existing player POC: `/Users/hermes/Documents/karaoke/firefox-player-poc`
- Host: Apple Silicon Mac, Firefox, HDMI TV, LAN guests.
- vkara search uses YouTube Innertube through the `youtubei` package and currently returns useful results without a Data API key.
- vkara is MIT licensed. Preserve copyright/license notices in copied substantial portions.
- YouTube/Innertube, YouTube DOM, autoplay, login/age/region restrictions, and ad-blocking behavior are external dependencies; none may be treated as guaranteed.

## Target repository layout

Start from an isolated derivative worktree or repository, not the dirty upstream checkout:

```text
karaoke-app/
  apps/
    web/                 # guest/host web UI derived from vkara
    api/                 # room, search, queue, provider gateway
  packages/
    playback-protocol/   # provider-neutral commands/events/types
    youtube-search/      # retained/adapted Innertube search boundary
    shared/              # schemas and shared types
  players/
    firefox-extension/   # background + YouTube content script
  deploy/
    local/               # Mac-local launch/configuration
  docs/
    upstream.md          # attribution and retained upstream components
  LICENSE                # MIT license from vkara, with attribution
```

The exact monorepo split may be adjusted after Phase 0, but these boundaries must remain conceptually separate.

## Phases and gates

### Phase 0 — Baseline, extraction map, and clean foundation

**Purpose:** Make future work reversible and identify the smallest retained surface.

- Create an isolated branch/worktree from upstream `main`; do not overwrite current local fixes.
- Record upstream commit, local patches, retained packages, and attribution.
- Inventory room state, WebSocket messages, queue actions, search endpoints, player actions, and relevant tests.
- Add a provider-neutral playback protocol with schemas for:
  - `play {commandId, roomId, itemId, videoId, position, issuedAt}`
  - `pause`, `resume`, `skip`, `setVolume`
  - events `ready`, `loading`, `playing`, `paused`, `ended`, `error`
- Define monotonic sequence/idempotency behavior and stale-command handling.
- No visual redesign and no deletion of upstream code yet.

**Gate:** clean derivative builds; existing relevant tests pass; protocol types compile; a written extraction map exists.

### Phase 1 — Standalone Firefox player agent

**Purpose:** Turn the existing POC into a reliable provider implementation before integrating the queue.

- Move the POC into `players/firefox-extension`.
- Use a dedicated Firefox profile and one dedicated YouTube tab/window.
- Local authenticated control channel bound to loopback initially; use a per-session random token, not unauthenticated LAN commands.
- Navigate to normal YouTube watch pages.
- Add a YouTube content script that detects the actual `<video>`, reports state, listens for `ended`, and applies play/pause/volume/seek commands.
- Fullscreen the Firefox window rather than depending on `requestFullscreen()` after a remote command; hide page chrome with extension CSS where possible.
- Report explicit errors for unavailable, age/login/region blocked, autoplay blocked, and video element not found.
- Keep browser automation out of the core: use WebExtension APIs and DOM events, not OS keystrokes.

**Gate:** automated extension/controller tests pass; manual test plays a previously non-embeddable-but-public video, fills the TV window, pauses/resumes, skips, and reports `ended`; reopening the tab recovers cleanly.

### Phase 2 — Local control-plane vertical slice

**Purpose:** Prove queue-to-player integration without porting all vkara UI.

- Implement a minimal local room and queue service using the provider-neutral protocol.
- Add queue operations: enqueue, reorder, remove, play-next, skip, pause/resume.
- Make commands idempotent and persist enough state to recover after extension restart.
- Add a small host/guest web page or adapter to enqueue a known YouTube ID.
- Keep search out of the critical path temporarily.

**Gate:** an automated integration test and manual test complete: enqueue two IDs → player opens first → end event advances to second → skip advances → extension restart does not duplicate or lose the queue.

### Phase 3 — Port vkara search and guest UX

**Purpose:** Replace the temporary input with the useful vkara experience.

- Retain/adapt vkara's Innertube search boundary, result parsing, continuation pagination, suggestions, karaoke query option, thumbnails, and metadata.
- Retain QR/room join and phone queue UX.
- Route selected results into the local queue service; do not couple UI components to Firefox.
- Remove iframe-specific prefiltering from the normal-page provider path, while preserving a provider capability for providers that need it.
- Keep the existing language support or default English without hard-coding UI logic into the backend.

**Gate:** from two phones, scan/join room, search, add two songs, see the shared queue, and control the host playback; search failures and unavailable videos produce recoverable UI errors.

### Phase 4 — Local Mac deployment and operational hardening

**Purpose:** Make it usable at a party without exposing an unsafe service.

- One-command local launch; avoid Docker unless it materially simplifies the final install.
- Bind guest web/API to the LAN interface, but keep privileged playback control authenticated and scoped to the host/provider session.
- Use a short-lived room token and host token; do not expose arbitrary URL navigation or shell execution.
- Add QR generation using the actual detected LAN address, with a displayed fallback address.
- Add health/status page, graceful shutdown, extension reconnect, and clear stale-player indication.
- Configure a dedicated Firefox profile with required autoplay behavior. Treat uBlock as optional/best-effort, never as an application guarantee.

**Gate:** clean Mac start/stop; phone on Wi-Fi joins; host recovery after browser restart; no unauthenticated remote skip/navigation outside the room; no secrets in git.

### Phase 5 — Optional enhancements only after the gates

- Singer names, voting, duplicate detection, estimated wait time.
- Search result caching/favorites.
- Multiple playback providers (mpv/local files).
- Queue persistence across server restarts.
- Packaging as a macOS app/menu-bar launcher.

## Phase 0 status

- Isolated derivative foundation retained upstream `main` at commit `eeb7801b07d4fa985cd4bc6da6f2263d99719546` and preserved the existing MIT license/attribution.
- Added provider-neutral `packages/playback-protocol` schemas and inferred TypeScript types for playback commands and sequenced lifecycle events.
- Focused protocol tests pass; no UI or upstream package changes were made.

## Phase 1 status

- Added a standalone Firefox MV2 provider under `players/firefox-extension` with protocol-validated command routing, authenticated configurable loopback polling, one dedicated YouTube tab, and a YouTube content script for HTML video lifecycle/control.
- Provider unit tests and TypeScript checks pass. Fullscreen remains a Firefox/window presentation configuration/manual gate; OS keystroke automation is not used.

## Phase 2 status

- Added `apps/control-plane`, a token-authenticated loopback Node/TypeScript service that owns a queue and emits provider-neutral commands for enqueue, play-next, pause, resume, skip, and volume control.
- Added provider event ingestion with ended-event advancement, monotonic command polling sequences, idempotent queue insertion, status reporting, and restart-safe polling semantics.
- Added integration tests and a runnable README. Automated Phase 2 tests pass; the Firefox fullscreen/window presentation and real YouTube playback remain the manual gate.

## Phase 3 status

- Added a small, independently callable `SearchAdapter` seam to the local control plane and a token-authenticated `POST /search` route supporting query and continuation requests.
- Kept the retained vkara Innertube search implementation in `apps/api` untouched; the control plane does not import the API runtime, avoiding implicit Redis/BullMQ/environment startup dependencies.
- Added fixture/contract tests for normalized results, continuation forwarding, input validation, and the explicit unconfigured-search response.
- The real vkara adapter wiring and YouTube network smoke test remain an integration/manual gate because the current implementation requires API runtime configuration and Redis-backed result preparation.

## Deliberately out of scope until the core gates pass

- Downloading or caching YouTube media.
- Building an ad-blocking feature into the app.
- Official YouTube Data API integration unless Innertube becomes unusable.
- OS-level mouse/keyboard automation.
- Tizen/Android TV ports.
- Multi-host distributed deployment.
- Commercial/public karaoke licensing claims.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| YouTube changes Innertube | Isolate search adapter, add fixtures/contract tests, retain pasted-URL fallback. |
| YouTube changes DOM/player | Isolate content script, use semantic/player signals, add manual smoke test and explicit error state. |
| Autoplay is blocked | Dedicated profile/site permission plus a one-time host bootstrap gesture. |
| User closes/replaces tab | Track tab ID, validate URL, recreate only the dedicated tab. |
| LAN abuse | Random room/host tokens, input validation, no arbitrary browser URLs, loopback provider bridge. |
| Upstream drift | Keep attribution, record source commit, isolate adaptation, periodically rebase rather than copy blindly. |
| iframe assumptions leak into app | Provider-neutral playback protocol and capability checks. |

## Delegation strategy

Use narrow vertical tasks with explicit file boundaries and tests. Agents must work in isolated worktrees or independent directories, follow test-first development for new behavior, and report exact tests and commits. Integrate one phase at a time; do not launch agents editing the same files concurrently.

Recommended order:

1. Architecture/extraction audit and clean derivative foundation.
2. Firefox provider implementation.
3. Local queue/control-plane integration.
4. vkara search and guest UX port.
5. Deployment/security hardening.
6. Review, simplify, and manual party simulation.

Each phase stops at its gate. If a gate fails because of YouTube behavior rather than local code, preserve the fallback path and reassess before adding complexity.
