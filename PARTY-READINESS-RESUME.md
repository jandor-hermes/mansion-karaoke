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

Integrated worker commits on this branch: `a2f9fad`, `a8cea3d`, `5128624`, `46cd27d`.

Parent reran the complete controller suite using pinned Bun 1.3.13: **8 test files, 62 tests passed**, including standalone server startup. This resolves the guest worker's missing-youtubei worktree environment limitation; it was not waived. Log: `/tmp/party-integrated-controller.log`. Independent Luna review is pending (delegation `deleg_d60d0ac2`). Native worker remains separate (delegation `deleg_2b6dc0d6`). Do not call these integrated slices independently approved until that result is recorded.

Pinned Bun executable discovered without changing the global install:
`/Users/hermes/.npm/_npx/b22965130bfded9d/node_modules/bun/bin/bun.exe`.
Resolve again with `npm exec --yes --package=bun@1.3.13 -- bun -e 'console.log(process.execPath)'` if the npm cache is removed. Pass this as `BUN_BIN` after native build changes integrate.

Friend rehearsal/recovery runbook is committed in `28f352e`. Root automated baseline from audit remains 701, Firefox 61; rerun integration gates before packaging.

## If interrupted

Inspect `git status`, `git log`, and `git worktree list` first. Workers may have committed partial or complete slices; inspect their diffs and logs before cherry-picking. A worker success report is not independent verification. Do not reset or discard uncommitted worker changes. Record remaining commands/errors here before stopping. Delegated sessions may not survive a usage interruption; branches and worktrees do.
