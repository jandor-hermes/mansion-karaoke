# Mansion Karaoke: Friend Setup Guide

This is the simplest way to host Mansion Karaoke from a Mac. This is a private beta, not a finished consumer release. The app contains the controller and Firefox player files, so the host does **not** need Git, Node.js, Bun, Docker, or a developer checkout. Guests need only a phone on the same Wi-Fi and the host needs internet access for YouTube.

Host requirement: macOS 13.0 or newer. Install [Firefox from Mozilla](https://www.mozilla.org/firefox/new/) before the party.

## Download the Mac app

1. Open the latest [Mansion Karaoke release](https://github.com/jandor-hermes/mansion-karaoke/releases/latest).
2. Download the correct file:
   - **Apple Silicon:** `Mansion-Karaoke-…-macOS-arm64.zip` for M1, M2, M3, M4, or newer Apple chips.
   - **Intel:** `Mansion-Karaoke-…-macOS-x86_64.zip` for older Intel Macs.
3. Double-click the ZIP, then drag **Mansion Karaoke.app** into Applications.

To check the Mac type, choose **Apple menu → About This Mac** and look for **Chip** or **Processor**.

## Open it the first time

This private beta is not Apple-notarized, so macOS may block the first launch even though the release came from this project.

1. Try to open **Mansion Karaoke** once.
2. If macOS blocks it, open **System Settings → Privacy & Security**.
3. Scroll to the security message for Mansion Karaoke and select **Open Anyway**.
4. Confirm **Open**.
5. If the firewall asks whether Mansion Karaoke may accept incoming connections, choose **Allow**.

Only bypass Gatekeeper for a release you received from the project owner. Later launches should open normally.

## Load the Firefox player

Keep the Mansion Karaoke window open while hosting.

1. Select **Reveal Extension** in the app.
2. Select **Firefox Setup** in the app. Firefox opens its temporary-add-on page.
3. Select **Load Temporary Add-on…**.
4. Choose the revealed `manifest.json` file.
5. Open the **Mansion Karaoke Firefox Player** toolbar button.
6. Enter the **Controller URL** and **Party token** shown in the app.
7. Select **Save & start**.

Firefox opens or focuses the dedicated karaoke display. A join QR code appears before the first song starts.

> Firefox removes temporary add-ons whenever Firefox quits. Repeat this section after restarting Firefox. The app keeps the same eight-character party token between launches.

Repeat the Firefox setup after installing a newer app update too: the temporary extension files are replaced.

## Start the party

1. Put Firefox on the TV, directly or over HDMI/AirPlay.
2. Have guests join the same Wi-Fi and scan the QR code.
3. Guests enter a display name, search for karaoke videos, and add them to the shared queue.

Before guests arrive, rehearse two songs on a real phone on the same Wi-Fi. Test pause, resume, and Skip; confirm TV audio and fullscreen; and keep the Mac plugged in with its lid open, awake, and set not to sleep.

Anyone with the QR code or party token can control the session. Use it only on a trusted local network. Quit **Mansion Karaoke** to stop the local controller; the current queue is cleared when it stops.

YouTube may play ads, or a queued video may be unavailable or restricted. Press **Skip** to recover to the next song; search for another upload if needed.

## Update later

Download the newer ZIP from [GitHub Releases](https://github.com/jandor-hermes/mansion-karaoke/releases), quit the old app, and replace it in Applications. The party token stored under `~/Library/Application Support/Mansion Karaoke/` remains in place.

## Troubleshooting

### A phone cannot open the guest page

- Confirm the phone and Mac are on the same Wi-Fi.
- Avoid guest Wi-Fi networks that isolate devices from each other.
- Allow incoming connections in the macOS firewall.
- Use the QR code or LAN address on the Firefox display, not `127.0.0.1`.

### The extension does not connect

- Keep the controller URL set to `http://127.0.0.1:3010`.
- Copy the party token exactly from the app.
- Confirm that the app status says **Running**.
- Reload the temporary extension after restarting Firefox.

### YouTube opens but playback remains paused

Allow autoplay with sound for YouTube in Firefox, then retry the song.

### Mansion Karaoke says the controller stopped

Another application may already use port 3010. Quit the other controller and reopen Mansion Karaoke. Diagnostic output is in:

```text
~/Library/Application Support/Mansion Karaoke/controller.log
```

## Developer setup

Contributors can still run the source workflow:

```sh
git clone https://github.com/jandor-hermes/mansion-karaoke.git
cd mansion-karaoke
./scripts/karaoke-dev.sh run
```

See the root README for tests and development commands.
