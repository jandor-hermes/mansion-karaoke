# Party friction feedback — plan (2026-09-20)

Real-world testing after ~30 songs. Each item maps to a code path; triage verdicts included.

## 1. Auto-append "karaoke" to searches — DO (small)

**Decision: append, not prefix, and do it server-side** in the `/search` handler
(`apps/control-plane/src/index.ts`), not in the phone UI:

- Append keeps the natural "artist – title" reading order; YouTube tokenizes
  the query either way, so relevance is equivalent — the only real question is
  where the transform lives, and the server is the single choke point every
  client (phone UI, future TV remote, curl) shares.
- Rule: if the trimmed query does not already contain the token `karaoke`
  (case-insensitive substring), send `<query> karaoke` to the adapter. Store the
  user's raw query in recents/localStorage, not the rewritten one.
- Leave `/suggest` untouched: while typing, people should see plain YouTube
  completions ("sweet caroline"), not karaoke-spammed suggestions. The
  transform fires on submit only.
- Tests: query with/without the keyword, mixed case, suggestion path unchanged.

## 2. Can't tell which version to pick — DO (small, CSS + copy)

- Result rows use `.title { white-space:nowrap; text-overflow:ellipsis }` — the
  version-distinguishing tail ("Karaoke Version", channel, duration) is exactly
  what gets cut. Change result rows to wrap titles (queue rows already wrap)
  and keep channel + duration visible (they already render, just were
  unreadable next to a truncated title).
- Sorting: it is plain YouTube relevance order; we don't re-rank. State that in
  the UI once ("Results ordered by YouTube relevance") in the search status
  line, rather than trying to invent a karaoke-specific ranking. The preview
  link (item 4) is the real fix for version choice; also add the video ID or
  "official/popular" cues we already have (channel name) with no wrap loss.
- Test: guest-ui served-HTML/CSS assertion for result-row wrapping.

## 3. Fade-out instead of hard skip — FEASIBLE, later phase (not won't-fix)

Not a "won't fix": the extension already owns a `volume` command and drives
the real `<video>` element, so a fade is a ~3s volume ramp in the content
script followed by the existing skip. But it touches the provider protocol
(new `fade` command or `volume` with ramp semantics), extension + control
plane + tests — real work for a nice-to-have.

**Plan:** phase 2. When done: control plane gains `POST /control/fade`
(issues volume ramp + skip), extension content script eases volume over ~3s
then reports the normal `ended`/skip flow. Guest UI: long-press or action
"Fade out & skip". Until then, Skip stays hard-cut — document that.

## 4. Preview on your own phone — DO (trivial)

- In the song action sheet (`openSongActions`), add an external link:
  `https://youtu.be/<videoId>` with `target="_blank" rel="noopener"` (plain
  anchor, no JS needed — phones open it in the browser/YouTube app).
- Same link available on queue cards via the action sheet.
- This is also the practical answer to #2 (pick the right version before
  adding). Test: served-HTML assertion for the link and video-ID escaping.

## 5. No visible search loading / autocomplete discoverability — DO (small)

- Loading exists only as a text status line ("Searching…") set after the
  request fires. Add a real affordance: spinner in the search panel header,
  and disable/gray the Add buttons while `searchSequence` is in flight (the
  generation counter already guards stale responses).
- Autocomplete: suggestions already debounce at 250ms and render below the
  input, but nobody noticed. Make the affordance explicit: show a small
  "Suggestions" hint/chevron state while suggestions are visible, and render
  an initial suggestion list from recents on focus when the input is empty
  (recents are already stored under `karaoke-recent-searches`).

## 6. Fullscreen dropout (1–2 of ~30 songs) — WON'T FIX (monitor)

Suspected ad-blocking/YouTube fullscreen-element replacement; the extension
already uses same-document `loadVideoById` switching specifically to retain
fullscreen, and the skill notes native fullscreen loss needs a real user
gesture to restore. Rate (~5%) doesn't justify defenses beyond what exists.
**Mitigation only:** if it recurs, log the `content load resolved` mode at the
moment of dropout to confirm whether it's the tab-navigation fallback; if a
pattern emerges (e.g. always after ads), revisit.

## Order of execution

1. Items 4 + 5 + 2 (guest-UI only, one worktree, no protocol change) — a
   single party-ready slice.
2. Item 1 (server-side query rewrite + tests) — control-plane slice.
3. Item 3 — phase 2 when there's appetite for protocol work.
4. Item 6 — no code; observation note only.
