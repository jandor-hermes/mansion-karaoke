# Weekend party readiness — phased plan

Audit date: 2026-09-17. Source reviewed: `15df6d052ae225d0457ec69337677fff1a06d9ab`.

## Verdict

**Promising trusted-friend beta, but not yet signed off for the party.** The automated baseline and a locally assembled Apple Silicon controller pass. The public download is older than the audited recovery code, and the exact friend's Mac / Firefox / TV / Wi-Fi path has not been rehearsed. Fix the narrow reliability gaps below, freeze a matching artifact, then perform the real-device gate. Do not turn this into a broad productization project before the weekend.

Scope: review and verification only; this plan does not implement fixes or publish a release. Two read-only reviews were delegated to `gpt-5.6-luna`; the parent verified findings and ran tests and runtime probes. Application source remained unchanged.

## Evidence from this audit

| Check | Result |
|---|---|
| Root `bun run test` | 701 passed |
| Controller `bun --cwd apps/control-plane test` | 55 passed |
| Firefox `bun run firefox:test` | 61 passed |
| Source launcher `bun run karaoke:dev:test` | 5 passed |
| Native bundle `bun run macos:test` | 14 passed, including a fresh bundle build |
| Automated test total above | 836 passed; repeated pinned-version runs not counted twice |
| Root typecheck and lint | Passed |
| Firefox build, asset verification, typecheck | Passed; 8 manifest assets verified |
| Actual `web-ext lint` on generated extension | 0 errors, 0 warnings, 0 notices |
| Bun 1.3.13 frozen install | Passed, no lockfile changes; controller and Firefox suites also passed under the pinned Bun |
| Local assembled app | Launcher and sidecar both exactly `arm64` via `lipo -archs`; deep/strict ad-hoc signature verification passed |
| Packaged controller runtime | Guest HTML, unauthorized 401, extension preflight, authenticated status passed |
| Queue runtime | Synthetic ended event advanced to second item; duplicate ended did not advance twice; 30 concurrent unique additions all retained |
| Live packaged search | HTTP 200 for `abba dancing queen karaoke`, normalized real results and continuation returned |
| Live suggestions | HTTP 200 with suggestions |
| Remote CI for audited commit | Both CI and macOS app runs reported success (35273625731 / 35273625619) |

Environment caveat: local initial tests and native build used Bun **1.4.2**, Node **26.8.2**, on **arm64**. The pinned-version checks above do not make the locally built sidecar a Bun 1.3.13 release artifact. Exact release rebuild/download verification remains required. The app's GUI, actual Firefox playback, audio, physical phone layout, Intel execution, and friend's network were **not** verified by these checks. Synthetic provider events are not evidence of real end detection.

Temporary evidence: `/tmp/karaoke-party-audit/` contains test logs, `runtime-results.json`, `failure-probes.json`, `stale-ui-probe.json`, reproduction scripts, and an audit-only local app bundle. Temporary files are not release assets and may be removed by the OS. All audit-started controller processes were terminated.

## Findings and priority

### P0 — Handoff currently selects an older release

`FRIEND_SETUP.md:9-13` sends the friend to the latest GitHub release. The live release listing still identifies **v0.1.1**, published 2026-09-16, with arm64 and x86_64 ZIPs. The local app/package version is 0.1.2.

The remote v0.1.1 commit resolves to `be4efc0b3d6e132c15d16a34f80b90efec793386`. Its Firefox background source lacks the current instance reconciliation and pending-terminal-delivery implementation. **Do not assume the download has the current fixes.** Local tag v0.1.1 resolves to a different hash; rewritten/diverged history means local tag ancestry is not reliable release evidence.

Release: https://github.com/jandor-hermes/mansion-karaoke/releases/tag/v0.1.1

### P1 — Phone connection status can remain falsely healthy after player loss

Evidence: `apps/control-plane/src/guest-ui.ts:212-213`.

Freshness is derived from `Date.now() - playback.lastSeen`, but `refresh()` skips rendering if the JSON payload is unchanged. When Firefox stops polling and the controller stays up, snapshots become identical. The last rendered “playing/connected” state can persist beyond the ten-second threshold.

**Reproduced with the actual extracted refresh function:** two identical successful snapshots, clock advanced beyond the freshness window, only one render; the indicator remained fresh at a 15-second heartbeat age. This was an isolated JS probe, not a physical-phone test.

Fix: recompute time-dependent connection state every poll or include a freshness bucket in the render key. Add a fake-clock behavioral test with identical snapshots and verify controls become unavailable after the deadline, then recover on a new heartbeat.

### P1 — Silent playback startup failure has no bounded recovery state

Evidence: controller `src/index.ts:107-118,188-192`; extension `src/index.ts:48-58`; content script `src/content.ts:50-84`; guest UI `src/guest-ui.ts:212`.

The eight-second same-document-load timeout is useful, but fallback tab navigation success is not media readiness. If the document never attaches a usable content script/video, no event need arrive. Command polling refreshes `lastSeen`, so the guest page can say “Player connected” while remaining “Loading on the TV…” indefinitely.

**Reproduced on the compiled controller:** after 32 seconds of command polling without media events, state remained `loading`, error was null, and heartbeat age was under one second. This isolates the missing lifecycle deadline; it does not claim a particular live YouTube upload failed.

Fix: distinguish extension connectivity from playback readiness; introduce a bounded loading deadline and explicit stalled/error guidance. Preserve manual Skip and offer a deliberate retry/resume path where appropriate. Do not auto-skip merely because ads or a slow load exceed a short arbitrary threshold. Test late events, ad playback, and recovery to ensure no double advancement.

### P2 — Bind failure is not a properly rejected startup operation

Evidence: `apps/control-plane/src/index.ts:292-301` creates a listen promise without an error/reject handler. The compiled controller emitted EADDRINUSE but remained running beyond the five-second probe timeout and required termination (local Bun 1.4.2 artifact).

The Swift host already protects the common case with port preflight (`Launcher.swift:149-155`) and has exit-log classification. It does **not** mean normal startup always hangs. The bind-race case can instead leave a live but unready sidecar; readiness exhaustion shows only “Controller started but did not become ready” (`Launcher.swift:255-274`).

Fix: reject listen errors promptly, exit the sidecar nonzero, and have the launcher terminate failed/unready children and surface the actionable conflict. Reproduce using both the pinned Bun compiled binary and Node, since failure behavior may differ. Tests must cover the real occupied-port executable, not only parsing fixture log text.

### Operational gates, not demonstrated code failures

- Friend's chip architecture and macOS version are unknown. Select the correct ZIP and verify macOS 13+; native Intel runtime was not tested locally.
- The exact ZIP-installed GUI must launch, expose working setup buttons, and clean up its child when quit.
- Actual phone-to-Mac access requires firewall permission and a non-isolated LAN. Multiple interfaces/VPNs can give an unsuitable QR address; join-info currently selects the first private IPv4 (`index.ts:97-103`).
- Firefox temporary extensions disappear after Firefox quits; updates require reloading the copied extension. This is an accepted beta dependency, not a signed-extension project for this weekend.
- Queue state is intentionally in memory and resets on host restart. Current reconciliation explicitly skips to idle when the new controller has no active command (`background.ts:55-77`). Clearing old-instance terminal events is therefore **not independently established as a stranded-current-song defect**. Test the reset contract rather than replaying stale events into a new party.
- Sleep prevention is a host procedure, not enforced by the app. The guide already warns to keep the lid open and Mac awake; add exact steps and a recovery checklist.
- Live search worked during this audit, but `apps/control-plane/scripts/search-smoke.mjs` is fixture-only. Preserve that distinction and add an explicitly live optional gate.

## Phase 0 — Choose the target and freeze the handoff contract

**Owner:** host + release coordinator. No application changes required.

- [ ] Confirm friend's Apple Silicon/Intel architecture, macOS version, Firefox installation, and intended TV/audio hookup.
- [ ] Confirm trusted LAN, internet availability, and no client isolation. Avoid testing only on localhost.
- [ ] Agree to the assisted-beta limits: Gatekeeper override, temporary add-on, shared control token, online YouTube dependency, queue loss on controller restart.
- [ ] Select a source commit for the party build; do not give out the old “latest” download as if it were the audited build.
- [ ] Decide on manual backup: a prechecked YouTube karaoke playlist in Firefox, plus another prepared host if available. Do not describe it as offline backup.

**Exit gate:** target machine and acceptance procedure are known; a named person owns the handoff and rehearsal.

## Phase 1 — Narrow reliability fixes

**Owner:** implementation worker, parent integration review. Keep work bounded; tests first.

- [ ] Fix stale freshness rendering with an unchanged-payload fake-clock regression test.
- [ ] Add loading timeout / actionable stalled state and distinguish poll heartbeat from actual playable media. Specify retry semantics before adding a button.
- [ ] Test no-content-script, failed navigation, blocked autoplay, slow/ad startup, late playing/ended events, and conditional Skip to a healthy second song.
- [ ] Make listen reject startup errors; reproduce occupied-port behavior in the pinned compiled artifact and Node. Verify failed children do not linger.
- [ ] Retain all existing queue-generation, reload, terminal-event retry, and same-document transition regressions.

**Exit gate:** focused tests, controller build, Firefox build/typecheck/asset verification/web-ext lint pass; the previously reproduced failures have regression coverage. The occupied-port work can be deferred only with an explicit accepted operational workaround and successful GUI preflight rehearsal; do not silently call it fixed.

## Phase 2 — Assemble and verify the actual friend artifact

**Owner:** release worker, parent artifact verification. Depends on accepted Phase 1 source.

- [ ] Build cleanly with the pinned Bun 1.3.13 and the correct native target; separately install extension dependencies as the workflow requires.
- [ ] Align app version, manifest version policy, tag, release notes, ZIP names, and source SHA. Resolve remote tags authoritatively; do not overwrite an existing release tag to hide divergent history.
- [ ] Verify exact thin architecture of launcher and controller with `lipo -archs`; verify ad-hoc signature and required bundle resources.
- [ ] Run the compiled sidecar from the assembled bundle: real search, suggestions, auth/preflight, queue-to-next and malformed/stale events, then clean shutdown.
- [ ] Create a private handoff ZIP or publish a new release when approved; record SHA-256 and source SHA. Re-download that exact ZIP and verify checksum and contents.
- [ ] Update the friend's link to the tested artifact and provide matching extension-reload instructions. Do not equate successful CI artifacts with a published release.

**Exit gate:** one identifiable ZIP, from the accepted commit, reaches the friend's Mac and passes first launch. No developer tools required on that machine.

## Phase 3 — Friend's Mac dress rehearsal (mandatory go/no-go)

**Owner:** host, with assistance as needed. Use the exact Phase 2 ZIP, intended router, TV, audio path, and real phones.

- [ ] Install into Applications; perform the scoped Gatekeeper override and allow incoming connections. Confirm this is the intended build/version.
- [ ] Launch the host and click every setup control: Reveal Extension, Firefox Setup, guest-page controls/copy actions where present. Load the revealed manifest and configure the shown controller URL/token.
- [ ] Confirm the QR exists before playback, uses the reachable LAN address, and joins from two phones. Verify wrong-token rejection and successful re-entry.
- [ ] Search live, inspect long titles/requester names, add from both phones, reorder/remove, Play next, confirmed Play now, and clear-queue cancellation. Confirm action buttons remain usable on the smaller phone.
- [ ] Queue at least three songs. Let one finish naturally; verify exactly one transition, correct next title, audible audio, visible lyrics, and presentation/fullscreen through transitions.
- [ ] Test pause/resume, volume, Skip, autoplay permission recovery, one unavailable/restricted video, and ads if encountered. Check TV audio output rather than only the Mac's speakers; test microphones/mixer separately if used.
- [ ] Close the player tab and verify recovery. Restart Firefox, reload its temporary add-on, and verify one authoritative current song without duplicate tabs/queue advancement.
- [ ] Disable the player while leaving the controller up: phone must show disconnected after the grace period. Reconnect and verify recovery.
- [ ] Test a brief network interruption and recovery. Confirm visible errors and no false success messages.
- [ ] Quit/restart the host deliberately: verify port closure, no orphan sidecar, documented empty queue, and safe idle reconciliation before adding a new song.
- [ ] Keep the Mac on power with lid open and configure sleep prevention using that Mac's settings. Disable disruptive notifications. Run a 30–60-minute rehearsal including idle time and repeated transitions.
- [ ] Write down exact artifact checksum, machine/OS/Firefox versions, test date, failures, and pass/fail sign-off.

**GO:** exact artifact passes the above critical path and host can recover within a song change. **NO-GO:** unresolved silent stall, unreliable queue advancement, phone isolation/firewall failure, inaudible audio, or inability to relaunch the host. Use the rehearsed manual backup rather than debugging a new build during the party.

## Phase 4 — Party-day runbook and deferred improvements

Before guests arrive: use the rehearsed build, plug in power, keep awake, confirm correct audio output, allow autoplay, load the add-on, scan from a phone, and queue two known-good uploads. Avoid app/Firefox updates and host restarts during the event. Skip unavailable videos and choose another upload. If the host must restart, tell guests the queue reset and re-add songs. Do not port-forward the controller or expose its shared token outside the trusted party LAN.

After the weekend, consider separately:

- Durable queue snapshots and explicit restart recovery UX.
- Signed Firefox distribution, Developer ID/notarization, and automatic updates for broader sharing; **not prerequisites for an explicitly accepted trusted-friend beta**.
- Bounded command/event retention, quieter/rotating logs during long sessions, body/queue limits, and soak tests.
- Host/guest permissions, revocable party tokens or TLS if the threat model expands. Plain HTTP bearer tokens are observable on an untrusted network; broad extension CORS does not itself bypass authentication.
- Explicit conflict behavior for simultaneous interrupting actions. Last-processed Play now is not by itself proof of queue corruption.
- Mandatory extension lint in CI and an explicitly labeled live packaged-search smoke.
- Native GUI launch/shutdown integration coverage and selectable LAN interface.

## Working rules for phased implementation

Give lower-usage workers nonoverlapping scope: guest status tests/UI, playback lifecycle tests/provider/controller, or packaging/runbook. Avoid parallel writes to the controller by multiple workers. Parent owns integration decisions and verifies real artifacts. Mark checkboxes complete only with evidence; keep required manual gates visibly pending. Do not treat deferred product polish as a weekend blocker or treat a code review as real Firefox/TV validation.
