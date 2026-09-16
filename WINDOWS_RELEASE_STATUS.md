# Windows Release Status

**Branch:** `feature/windows-host-beta`
**State:** Paused pending confirmation that the intended recipient uses Windows rather than Linux.

## Implemented on this branch

- Executable Windows x64 release plan and package contracts.
- Native Win32 C++ launcher source with:
  - `%LOCALAPPDATA%\Mansion Karaoke` state;
  - secure eight-character party-token generation and migration;
  - protected per-user ACLs;
  - versioned Firefox-extension copying;
  - port-3010 preflight and actionable conflict classification;
  - hidden controller process, restricted inherited handles, and kill-on-close Job Object;
  - authenticated readiness checks and continued child supervision;
  - Firefox discovery/setup, token copying, party-page opening, and extension reveal;
  - token-free self-test and launcher-controlled host-smoke modes.
- PowerShell build and runtime-verification scripts.
- Artifact-only `windows-latest` GitHub Actions workflow.
- Windows friend setup, SmartScreen/Defender/firewall guidance, and README links.

## Verified locally

- Windows source/package contract tests pass on macOS.
- Existing controller, Firefox-extension, and macOS packaging regression suites pass.
- GitHub Actions workflow syntax passes `actionlint`.

## Not yet verified

- The C++ launcher has not been compiled by MSVC.
- The generated Windows executables have not run on Windows.
- The launcher-controlled host-smoke path, process cleanup, ACL behavior, Firefox discovery, firewall behavior, and SmartScreen experience remain unproven on a real Windows host.
- The independent review found issues and fixes were applied, but the revised implementation has not received a final post-fix review.
- No Windows artifact or release has been published.

## Next steps if Windows is needed

1. Push this branch and run `.github/workflows/windows-app.yml` on `windows-latest`.
2. Fix any MSVC `/W4 /WX`, resource compiler, PowerShell, or runtime failures.
3. Download the workflow artifact and independently verify its checksum and ZIP layout.
4. Run a manual Windows gate: launcher UI, private-network firewall prompt, Firefox temporary extension, live search/playback, shutdown cleanup, and occupied-port error.
5. Obtain a final independent security/logic review.
6. Decide whether to merge and publish a new tagged beta release.

## If the recipient uses Linux

Do not continue this branch by default. First scope a Linux package separately (likely a Bun-compiled controller plus a small GTK or browser-based launcher, distributed as an AppImage or tarball) and confirm the recipient's distribution, CPU architecture, desktop environment, Firefox availability, and tolerance for unsigned packages.
