# Native startup worker checkpoint

## Scope

Implemented only macOS launcher/build-script packaging fixes and macOS tests.

## Evidence

- `node --test packaging/macos/release-config.test.mjs`: 9 passed.
- `/bin/bash -n packaging/macos/build-app.sh`: passed.
- `swiftc -parse packaging/macos/Launcher.swift`: passed.
- A standalone arm64 Swift compile plus `--self-test-readiness` returned bounded-budget and deadline-exhaustion evidence.
- Explicit `BUN_BIN` validation accepts 1.3.13 and rejects 1.4.2 without installing or changing the host Bun.

## Limitation

The assembled app test/build was attempted with an explicit Bun 1.3.13 wrapper but the branch worktree lacks the required `zod` dependency for the Firefox build. No GUI app was launched and no user Application Support data was written. Real child-process cleanup and GUI startup remain unexercised; the regression covers the helper seam and source-level termination path.
