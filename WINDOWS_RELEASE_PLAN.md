# Windows Host Beta Plan

## Goal

Ship a self-contained **Windows x64 trusted-friend beta** of Mansion Karaoke through GitHub Actions and GitHub Releases. A recipient extracts one ZIP and opens `Mansion Karaoke.exe`; no Bun, Node.js, .NET, Docker, Git, or development tools are required.

## Non-goals

- No installer, Start-menu registration, Windows service, auto-start, or automatic updates.
- No Authenticode signing in the first trusted-friend beta; SmartScreen friction is documented rather than bypassed.
- No Windows ARM64 build in the first release.
- No persistent/signed Firefox extension; temporary loading remains the supported workflow.
- No alternate controller port or automatic port fallback; port 3010 remains the shared launcher/extension contract.
- No redesign of the controller, guest UI, queue, or Firefox playback protocol.
- No broad internet exposure, port forwarding, public-network firewall rule, or weakening of Defender/Firefox security controls.

## Reusable subsystems and contracts

- `apps/control-plane/src/compiled-server.ts` is the standalone Bun entry point. Its static `youtubei` import must be retained so Bun embeds the search adapter.
- `players/firefox-extension/dist` remains the packaged playback provider.
- Root `package.json` remains the authoritative release version.
- Runtime environment remains `KARAOKE_TOKEN`, `KARAOKE_ROOM_ID=local`, and `PORT=3010`, while preserving an explicitly supplied `KARAOKE_BIND`.
- Readiness is an authenticated HTTP 200 response from `GET /status`, not merely a running child process.
- Party tokens remain eight characters matching `^[A-HJ-NP-Z2-9]{8}$` and use an OS cryptographic RNG.
- Mutable state belongs under `%LOCALAPPDATA%\Mansion Karaoke`, never beside the executable.
- The packaged extension is copied to writable per-user state before Firefox loads it.
- Firefox receives `about:debugging#/runtime/this-firefox` as a raw direct argument.
- Port conflicts are detected before launch and classified after a bind race from controller output.
- Controller stdout/stderr are truncated into `controller.log` on each launch, without recording the token.

## Package layout

```text
Mansion Karaoke/
├── Mansion Karaoke.exe
├── resources/
│   ├── mansion-controller.exe
│   └── firefox-extension/
│       └── manifest.json
├── FRIEND_SETUP_WINDOWS.md
├── LICENSE
└── NOTICE.md
```

Mutable state:

```text
%LOCALAPPDATA%\Mansion Karaoke\
├── party-token
├── controller.log
└── firefox-extension\<extension-version>\manifest.json
```

## Implementation choice

Use a native **Win32 C++20 launcher**, compiled by MSVC with `/MT` and the Windows subsystem. This creates a small launcher with no added runtime dependency and gives direct access to BCrypt, ACLs, registry lookup, Job Objects, WinHTTP, and process supervision. Build and execute it on `windows-latest`; macOS can validate source/configuration contracts but cannot prove Windows runtime behavior.

## Phases

### Phase 1 — Package-contract tests (RED)

Create `packaging/windows/windows-package.test.mjs` before production files. It must fail until the implementation provides:

- native launcher and build script;
- BCrypt token generation and the exact token alphabet;
- `%LOCALAPPDATA%` state path;
- direct Firefox raw internal-page argument;
- Job Object child cleanup;
- authenticated readiness polling;
- port-conflict classification;
- package resources, license, notice, and Windows guide;
- Windows workflow with a native runtime smoke and exact PE x64 checks.

Gate: run the focused Node test and observe expected failures caused by missing Windows implementation.

### Phase 2 — Native launcher (GREEN)

Add:

- `packaging/windows/Launcher.cpp`
- `packaging/windows/app.manifest`
- `packaging/windows/resources.rc`

Vertical behavior:

1. Resolve immutable resources relative to the launcher executable.
2. Create protected per-user state, securely generate/migrate/preserve the party token, and install a versioned extension copy.
3. Enforce a single per-user launcher instance and preflight port 3010.
4. Spawn the hidden controller with an explicit environment block, redirected logs, and a kill-on-close Job Object.
5. Poll authenticated `/status`; distinguish ready, early exit, timeout, and address-in-use race.
6. Present status, controller URL, token, extension path, copy/open/reveal/Firefox actions, and clean shutdown.
7. Provide `--self-test-json <path>` for deterministic CI checks without opening the GUI.

Gate: focused package-contract tests pass; MSVC builds with `/W4 /WX /MT`; self-test succeeds from a path containing spaces.

### Phase 3 — Build and Windows runtime tests

Add:

- `packaging/windows/build-app.ps1`
- `packaging/windows/app-bundle.test.ps1`

The build script must:

1. Validate semantic version and required tools.
2. Build and verify the Firefox extension.
3. Compile `compiled-server.ts` using Bun `1.3.13`, `--target=bun-windows-x64`, and `--windows-hide-console`.
4. Compile/link the launcher as a static-runtime x64 Windows GUI executable.
5. Copy release documentation and resources.
6. Produce `Mansion-Karaoke-<version>-Windows-x64.zip` plus SHA-256.

Runtime tests must:

- verify MZ/PE signatures and exact machine `0x8664` for both executables;
- assert the launcher has no `VCRUNTIME*.dll`/`MSVCP*.dll` dependency;
- run `--self-test-json` with temporary `%LOCALAPPDATA%`;
- prove token format, persistence, migration, and ACL status;
- prove resources resolve from a path containing spaces;
- start the packaged controller with Bun/Node absent from `PATH`;
- verify authenticated `/status`, unauthenticated 401, root HTTP 200, and one live search response;
- verify occupied-port diagnosis and cleanup leaves no controller process;
- extract the final ZIP and repeat critical checks against the extracted artifact.

Gate: `app-bundle.test.ps1` passes on `windows-latest` and visibly executes both packaged executables.

### Phase 4 — CI and release integration

Add `.github/workflows/windows-app.yml` for branch/push/manual validation. To avoid two workflows racing to create one release, Windows initially uploads workflow artifacts only. After the Windows artifact is proven, consolidate release publication into a single host-app workflow or otherwise serialize release creation before tagging a version.

The Windows workflow must pin Bun `1.3.13`, install the standalone Firefox package separately, initialize MSVC x64, run controller/extension tests, run package contract tests, build, execute runtime tests, and upload ZIP/checksum artifacts.

Gate: a GitHub-hosted Windows run completes successfully and the exact downloaded artifact passes checksum and ZIP-structure verification.

### Phase 5 — Documentation and beta release

Add `FRIEND_SETUP_WINDOWS.md` and link it from `README.md`/`FRIEND_SETUP.md`. Include:

- x64 support and extract-first requirement;
- checksum verification and ZIP Unblock instructions;
- explicit unsigned/SmartScreen warning;
- precise, narrow “More info → Run anyway” guidance only after hash verification;
- Defender recovery for the exact verified file, never disabling protection or adding broad exclusions;
- Private-network-only firewall permission;
- Firefox temporary-extension steps and restart limitation;
- `%LOCALAPPDATA%` log/state paths;
- queue ephemerality, trusted-LAN/token authority, and manual updates.

Ship `LICENSE` and `NOTICE.md` in the ZIP. Third-party notice generation is a follow-up release gate if the dependency audit shows licenses not already satisfied by repository-distributed notices; do not invent incomplete notices.

Gate: independent review approves security, lifecycle, release behavior, and docs; all local and GitHub checks pass before commit/push or tagging.

## File ownership for parallel work

- Package contract tests: `packaging/windows/windows-package.test.mjs`
- Launcher: `packaging/windows/Launcher.cpp`, `app.manifest`, `resources.rc`
- Build/runtime tests: `packaging/windows/build-app.ps1`, `app-bundle.test.ps1`
- CI: `.github/workflows/windows-app.yml`
- Documentation: `FRIEND_SETUP_WINDOWS.md`, targeted links in `README.md` and `FRIEND_SETUP.md`

Agents must not touch the unrelated untracked `promo-reel/` directory or modify macOS behavior unless an integration test proves a shared release change requires it.

## Dependency graph

```text
Plan
 └─ Package-contract RED test
     ├─ Native launcher
     ├─ Build/runtime PowerShell
     └─ Documentation
          └─ Windows CI
               └─ GitHub-hosted runtime verification
                    └─ Independent review
                         └─ Commit/push; release decision
```

Documentation can proceed in parallel after the contracts are fixed. Launcher and build script may proceed in parallel only with the package layout and self-test JSON schema held stable.

## Rollback and stop/go criteria

- Work stays on `feature/windows-host-beta`; `main` remains the rollback point.
- Do not publish an artifact if Windows CI cannot execute the packaged launcher and controller.
- Stop rather than weaken Defender, SmartScreen, firewall, token, ACL, or auth checks to make CI pass.
- Stop release publication if the Bun executable cannot perform live search on Windows.
- Stop release publication if closing/crashing the launcher can leave the controller listening on port 3010.
- An unsigned ZIP is acceptable only as an explicitly labeled trusted-friend beta; broader distribution requires Authenticode signing.
