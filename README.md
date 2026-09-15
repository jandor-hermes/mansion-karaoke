# Mansion Karaoke

A local-network karaoke host for house parties. One Mac runs the controller and a dedicated Firefox/YouTube player; guests search, queue songs, and control playback from their phones on the same Wi-Fi.

## Current status

Mansion Karaoke is a private beta for macOS. A self-contained Mac app runs the local controller and guides the host through loading the temporary Firefox extension. Guests install nothing.

For the complete host walkthrough, see **[Friend Setup](FRIEND_SETUP.md)**.

## Quick start

Host requirements:

- macOS
- Firefox

1. Download the Apple Silicon or Intel ZIP from [GitHub Releases](https://github.com/jandor-hermes/mansion-karaoke/releases).
2. Move **Mansion Karaoke.app** to Applications.
3. Follow [Friend Setup](FRIEND_SETUP.md) for the one-time Gatekeeper override and Firefox steps.

The TV/player page displays a QR code. Guest phones on the same Wi-Fi scan it to join.

## How it works

Mansion Karaoke keeps playback and party coordination separate:

- **Local control plane** — owns the queue and room state, serves the guest phone UI, searches YouTube, accepts controls, and advances the queue.
- **Firefox player extension** — controls one normal YouTube watch tab and reports observed playback events to the controller.
- **Guest phones** — use the controller’s local web page; no app or account is required.

The controller binds to the local network during a session. Anyone with the displayed QR code or party token can control playback, so use it only on a trusted network.

## Developer commands

```sh
# Install dependencies and build both components
./scripts/karaoke-dev.sh prepare

# Start an existing build
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
scripts/karaoke-dev.sh              developer setup and launcher
packaging/macos/                    native launcher and app bundle builder
FRIEND_SETUP.md                     shareable host walkthrough
DISTRIBUTION_AND_UPDATES.md         future packaging and update notes
```

## Origin and license

Mansion Karaoke began as a derivative of [vkara](https://github.com/lehuygiang28/vkara) by Lê Huy Giang and retains its MIT license and copyright notice. The local control-plane architecture, Firefox playback provider, guest party workflow, and developer distribution flow have since diverged substantially. See [NOTICE.md](NOTICE.md) for attribution details.

This project does not download or re-stream YouTube media and is not affiliated with or endorsed by YouTube. Users are responsible for complying with YouTube’s terms and applicable copyright law.
