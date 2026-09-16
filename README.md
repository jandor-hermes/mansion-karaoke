# Mansion Karaoke

A local-network karaoke host for house parties. A controller runs on one computer and drives a dedicated Firefox/YouTube player; guests search, queue songs, and control playback from their phones on the same Wi-Fi.

## Current status

There are two ways to run Mansion Karaoke:

- **Mac app (private beta)** — a self-contained macOS app that hosts a party without a developer checkout. A trusted-friend Windows x64 package and other host apps are planned but not yet published.
- **Run from source (macOS or Linux)** — the developer workflow below builds and runs the controller and Firefox player from a clone. This is the path for contributors and for those running on Linux today.

## Quick start (Mac app)

Host requirements:

- macOS
- Firefox

1. Download the Apple Silicon or Intel ZIP from [GitHub Releases](https://github.com/jandor-hermes/mansion-karaoke/releases).
2. Move **Mansion Karaoke.app** to Applications.
3. Follow [Friend Setup](FRIEND_SETUP.md) for the one-time Gatekeeper override and Firefox steps.

The TV/player page displays a QR code. Guest phones on the same Wi-Fi scan it to join.

## Develop from source (macOS or Linux)

The source workflow is a single shell script that runs unmodified in Bash on both macOS and Linux. It builds both components and starts a controller for local testing.

Prerequisites:

- **Bun** 1.3.x (the repo's locked version) — install from <https://bun.sh>. The launcher looks for it in `~/.bun/bin`.
- **Node.js** 18 or newer (the launcher tests use `node --test`, and the control plane and Firefox extension build with plain `node`).
- **openssl** — used to generate the random party token on first run.
- **Firefox** — required to load the player extension and actually play songs.

Clone and run:

```sh
git clone https://github.com/jandor-hermes/mansion-karaoke.git
cd mansion-karaoke
./scripts/karaoke-dev.sh run
```

`run` installs the locked dependencies (`bun install --no-save`), builds both the Firefox extension and the control plane, prints the controller URL and party token, then starts the controller on port `3010`.

To play a song you must load the player extension once:

1. Open `about:debugging` in Firefox → **This Firefox** → **Load Temporary Add-on…**, and select `players/firefox-extension/dist/manifest.json`.
2. Open the **Mansion Karaoke Firefox Player** toolbar button, enter the controller URL and party token printed by the launcher, then **Save & start**.
3. Put Firefox on the TV; guests on the same Wi-Fi scan the on-screen QR (or open the printed LAN URL) to search and queue songs.

The flow is intentionally Unix: `karaoke-dev.sh` is Bash and runs unchanged on macOS and Linux. Windows is not a supported source-workflow target; the planned Windows build is a standalone packaged app, not a development environment.

## Developer commands

```sh
# Install dependencies and build both components
./scripts/karaoke-dev.sh prepare

# Start an already-built controller
./scripts/karaoke-dev.sh start

# Prepare and start
./scripts/karaoke-dev.sh run

# Launcher tests
bun run karaoke:dev:test

# Build and test the self-contained Mac app
bun run macos:build
bun run macos:test

# Firefox checks
bun run firefox:test
bun run firefox:check
bun run firefox:verify

# Controller tests
bun --cwd apps/control-plane test
```

The `bun`-prefixed commands expect Bun on your `PATH` (the launcher script adds `~/.bun/bin` for you, but a plain `bun run` does not).

## How it works

Mansion Karaoke keeps playback and party coordination separate:

- **Local control plane** — owns the queue and room state, serves the guest phone UI, searches YouTube, accepts controls, and advances the queue.
- **Firefox player extension** — controls one normal YouTube watch tab and reports observed playback events to the controller.
- **Guest phones** — use the controller's local web page; no app or account is required.

The controller binds to the local network during a session. Anyone with the displayed QR code or party token can control playback, so use it only on a trusted network.

## Current limitations

- The temporary Firefox extension must be loaded again after Firefox restarts.
- Queue state is in memory and is cleared when the controller stops.
- App updates are manual downloads from GitHub Releases.
- The private-beta app is ad-hoc signed, not Developer ID signed, and not notarized, so it requires a one-time Gatekeeper override.
- YouTube page changes may require compatibility maintenance.

## Project layout

```text
apps/control-plane/                 local controller and guest web UI
players/firefox-extension/          Firefox playback provider
packages/playback-protocol/         shared command and event schemas
scripts/karaoke-dev.sh              developer setup and launcher (macOS + Linux)
packaging/macos/                    native launcher and app bundle builder
FRIEND_SETUP.md                     shareable Mac host walkthrough
NOTICE.md                           upstream attribution and license notice
```

## Origin and license

Mansion Karaoke began as a derivative of [vkara](https://github.com/lehuygiang28/vkara) by Lê Huy Giang and retains its MIT license and copyright notice. The local control-plane architecture, Firefox playback provider, guest party workflow, and developer distribution flow have since diverged substantially. See [NOTICE.md](NOTICE.md) for attribution details.

This project does not download or re-stream YouTube media and is not affiliated with or endorsed by YouTube. Users are responsible for complying with YouTube's terms and applicable copyright law.