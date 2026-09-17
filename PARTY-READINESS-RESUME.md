# Party readiness implementation checkpoint

## Resume here

Integration checkout: `/Users/hermes/Documents/karaoke/karaoke-app`
Integration branch: `fix/party-readiness`
Audit baseline: `15df6d0`; plan checkpoint: `c35c303`.
Read `PARTY-READINESS-PLAN.md` for findings and acceptance gates. Do not redo the audit or change unrelated upstream code.

User authorized phased fixes, efficient workers, and interruption-safe progress. No remote publication has been performed. Main branch remains at the prior baseline. Commit one verified slice at a time; never mark unrun manual gates complete.

## Work ownership

1. Luna guest worker: branch `fix/party-guest-status`, worktree `/Users/hermes/Documents/karaoke/party-guest-status`. Owns `apps/control-plane/src/guest-ui.ts` and guest UI tests only. Fix unchanged-snapshot freshness expiry and honest loading/connected copy. TDD and focused controller tests, then commit.
2. Luna controller worker: branch `fix/party-controller-recovery`, worktree `/Users/hermes/Documents/karaoke/party-controller-recovery`. Owns controller `src/index.ts`, `src/server.ts`, `src/compiled-server.ts` and non-guest controller tests only. Add generation-scoped loading deadline (default 30 seconds) with actionable error, no automatic skip, safe late success, unchanged active identity, manual Skip recovery. Fix startup listen rejection/nonzero executable failure. TDD and focused tests, then commit.
3. Luna native worker: branch `fix/party-native-startup`, worktree `/Users/hermes/Documents/karaoke/party-native-startup`. Owns `packaging/macos/Launcher.swift`, `build-app.sh`, and native tests only. Bounded readiness requests, unready child cleanup, explicit pinned `BUN_BIN` selection. TDD; no GUI launch or writes to user Application Support.
4. Parent owns integration, independent review, final packaging verification, friend runbook, this checkpoint, and the plan. No parallel edits to worker-owned files.

## Contract decisions

- Preserve existing playback state schema: deadline uses `state: 'error'` and a clear message, does not advance queue or retire active command. Valid late media events may recover the same item; stale identities remain rejected. No automatic retries/skips during possible ads.
- Keep `lastSeen` as extension poll connectivity; do not pretend it proves media health. Guest copy distinguishes connected extension/loading from observed playback.
- Guest freshness must expire even when status JSON is identical; avoid unnecessary destructive queue rerenders if possible.
- No queue persistence or public signing project in this weekend slice.
- Native build must use Bun 1.3.13 explicitly; existing build script prepends ~/.bun/bin (currently 1.4.2), so resolve this before calling a new artifact release-ready.

## Status

- [x] Baseline preserved and audit plan committed.
- [ ] Worker fixes completed and independently reviewed.
- [ ] Integrated focused/full automated checks pass.
- [ ] Native launcher failure cleanup verified.
- [ ] Exact pinned-toolchain app/ZIP built and smoke tested.
- [ ] Friend-facing runbook updated.
- [ ] Remote release handoff resolved (old public latest is v0.1.1).
- [ ] Actual friend Mac / Wi-Fi / Firefox / TV rehearsal — user/device gate, cannot infer from unit tests.

## Integrated checkpoint — guest/controller slices

Integrated worker commits on this branch: `a2f9fad`, `a8cea3d`, `5128624`, `46cd27d`, `96e81f9` (native), plus `f19f698` (parent test fix).

Parent independent review (2026-09-17, this session) — **approve, nits only**, replacing the failed Luna delegation (`deleg_d60d0ac2`, `deleg_acd9e17d`, `deleg_611297e5` all 429):

1. Guest freshness (`a2f9fad`): freshness bucket `f` added to the unchanged-payload render key so identical snapshots still expire; queue/history rerenders split onto their own keys; loading copy distinguishes extension-connected from observed playback. Contract-compliant, with a fake-clock regression covering expiry and heartbeat recovery.
2. Loading deadline (`a8cea3d`): generation-scoped by commandId, lazily evaluated on request handling (no timer), 30s default via injectable `now`. Polls and `ready` events do not extend it; `playing`/`paused`/`error` clear it. Timeout leaves `state: 'error'` with actionable guidance, keeps `current` and `activeCommand`, never advances the queue or auto-skips; same-generation late `playing` recovers (regression-tested). Nits: a >30s pre-roll ad before the first `playing` will surface as the loading-timeout error (acceptable per the no-auto-skip contract — copy mentions ads); `ready` after a deadline expiry does not clear the error (only a playing/paused event does — harmless).
3. Listen rejection (`5128624`): `server.once('error')` rejects and clears the server handle; compiled-server top-level `await plane.listen(port)` therefore exits nonzero on EADDRINUSE — verified by unit test plus runtime Node and pinned-Bun-1.3.13 compiled probes.
4. Scope: diff vs audit baseline touches only control-plane guest/controller files, packaging/macos, and docs. No queue persistence, no scope creep.

Rerun checklist after review:
- [x] Independent review recorded (this entry).
- [x] Integrated automated gates pass under pinned Bun 1.3.13: root 701/701, Firefox 61/61, control-plane 62/62, karaoke-dev 5/5, macOS suite 17/17 (after `f19f698` regex fix).
- [x] Release artifact built and smoke tested: `packaging/macos/release/Mansion Karaoke.app` (arm64 thin launcher+controller, ad-hoc signature deep/strict verified, launcher self-tests pass, packaged controller live `/status` 200 auth / 401 unauth). Handoff ZIP `Mansion-Karaoke-arm64.zip` SHA-256 `e687e237acc4f1ca56995e774ade5395b2a6a2ba3772c18fe751764314c89038`, source commit `f19f698`.
- [ ] Remote release handoff resolved (old public latest is v0.1.1; new ZIP not yet delivered).
- [ ] Actual friend Mac / Wi-Fi / Firefox / TV rehearsal — user/device gate, cannot infer from unit tests.

Pinned Bun executable discovered without changing the global install:
`/Users/hermes/.npm/_npx/b22965130bfded9d/node_modules/bun/bin/bun.exe`.
Resolve again with `npm exec --yes --package=bun@1.3.13 -- bun -e 'console.log(process.execPath)'` if the npm cache is removed. Pass this as `BUN_BIN` after native build changes integrate.

Friend rehearsal/recovery runbook is committed in `28f352e`. Root automated baseline from audit remains 701, Firefox 61; rerun integration gates before packaging.

## If interrupted

Inspect `git status`, `git log`, and `git worktree list` first. Workers may have committed partial or complete slices; inspect their diffs and logs before cherry-picking. A worker success report is not independent verification. Do not reset or discard uncommitted worker changes. Record remaining commands/errors here before stopping. Delegated sessions may not survive a usage interruption; branches and worktrees do.
