# Mansion Karaoke: Friend Setup Guide

This is the current developer-preview way to host a karaoke night from a Mac. It runs a small local controller in Terminal and loads the Firefox player as a temporary extension. Guests need only a phone on the same Wi-Fi; they do not install anything.

## What the host needs

- A Mac connected to the same Wi-Fi as the guest phones
- [Firefox](https://www.mozilla.org/firefox/)
- [Git](https://git-scm.com/) (included with Xcode Command Line Tools on many Macs)
- [Bun 1.3.13 or newer](https://bun.sh/docs/installation)
- [Node.js 22 or newer](https://nodejs.org/)
- Internet access for YouTube search and playback

No Redis, Docker, YouTube API key, or account is required for this local build.

## First-time setup

Open Terminal and run:

```sh
git clone https://github.com/jandor-hermes/mansion-karaoke.git
cd mansion-karaoke
./scripts/karaoke-dev.sh run
```

The first run installs dependencies and builds both parts of the system. When it finishes, leave Terminal open. It displays:

- The controller URL, normally `http://127.0.0.1:3010`
- A generated party token
- The path to the Firefox extension manifest

The token is stored locally in `.karaoke/party-token` and reused on later runs. Do not post it publicly.

## Load the Firefox player

Temporary extensions disappear whenever Firefox exits, so repeat these steps after restarting Firefox:

1. Open `about:debugging` in Firefox.
2. Select **This Firefox**.
3. Select **Load Temporary Add-on…**.
4. Choose `players/firefox-extension/dist/manifest.json` inside the cloned repository.
5. Pin the **Mansion Karaoke Firefox Player** toolbar button if desired.
6. Click its toolbar button.
7. Enter the controller URL and party token printed in Terminal.
8. Select **Save & start**.

Firefox opens or focuses the dedicated karaoke display. A join QR code should appear before the first song starts.

## Start the party

1. Keep the controller Terminal window open.
2. If macOS asks whether Node may accept incoming network connections, choose **Allow**.
3. Put Firefox on the TV, directly or over HDMI/AirPlay.
4. Have guests join the same Wi-Fi and scan the QR code.
5. Guests enter a display name, search for karaoke videos, and add them to the shared queue.

Anyone with the QR code or party token can control the session. Use this only on a trusted local network.

Stop the session with **Control-C** in Terminal. The queue is currently held in memory and is cleared when the controller stops.

## Later launches

If nothing changed and the build is already present:

```sh
cd mansion-karaoke
./scripts/karaoke-dev.sh start
```

After downloading updates, rebuild before starting:

```sh
cd mansion-karaoke
git pull --ff-only
./scripts/karaoke-dev.sh run
```

## Troubleshooting

### A phone cannot open the guest page

- Confirm the phone and Mac are on the same Wi-Fi.
- Avoid guest Wi-Fi networks that isolate devices from each other.
- Allow incoming connections if the macOS firewall prompts.
- Use the LAN phone URL printed by the controller, not `127.0.0.1`.

### The extension does not connect

- Keep the controller URL set to `http://127.0.0.1:3010`.
- Copy the party token exactly from Terminal.
- Confirm the controller Terminal window is still running.
- Reload the temporary extension after restarting Firefox.

### Port 3010 is already in use

A previous controller may still be running. Find it with:

```sh
lsof -nP -iTCP:3010 -sTCP:LISTEN
```

Stop the old Terminal process with **Control-C**, then start again.

### YouTube opens but playback remains paused

Allow autoplay with sound for YouTube in Firefox, then retry the song.

## Current limitations

- This developer flow is intended for macOS and a technically comfortable host.
- The Firefox extension must be loaded again after Firefox restarts.
- Terminal must remain open during the party.
- Updates are manual through `git pull`.
- The queue is not persisted across controller restarts.
- YouTube page changes may occasionally require a software update.

For setup help, send the host the repository link and this file:

<https://github.com/jandor-hermes/mansion-karaoke/blob/main/FRIEND_SETUP.md>
