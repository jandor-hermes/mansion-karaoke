# Controller recovery worker checkpoint

## Completed

- Generation-scoped, lazy 30-second loading deadline in `createControlPlane`; no timer is allocated.
- Polls and `ready` events do not extend the deadline. `playing`/`paused` and explicit provider errors resolve it.
- Timeout remains on the current item with actionable guidance; no automatic skip/retry or queue mutation. A valid late event for the same command generation recovers; stale identity/sequence events remain rejected.
- `listen()` now rejects bind errors, allowing Node and compiled Bun startup failures to terminate nonzero.

## Evidence

- RED: `bunx vitest run tests/reliability.test.ts` initially failed timeout test (`loading`, `error: null`).
- GREEN: `bunx vitest run tests/reliability.test.ts` — 9 passed.
- GREEN: `bunx vitest run tests/*.test.ts` — 8 files, 60 tests passed.
- GREEN: `bunx tsc --noEmit -p tsconfig.json` from `apps/control-plane`.
- Runtime Node probe with an occupied port: exited promptly, code 1, `EADDRINUSE`.
- Runtime compiled Bun 1.3.13 probe (`bun build --compile src/compiled-server.ts`): exited promptly, code 1, `EADDRINUSE`.

## Commits

- `15e69ad` — `fix(controller): bound loading recovery by generation`
- `6a4a59e` — `fix(controller): reject occupied listen ports`

## Next steps

- Parent integration should verify the pinned compiled artifact and native host cleanup, then run the real-device readiness gate. No remote push performed.
