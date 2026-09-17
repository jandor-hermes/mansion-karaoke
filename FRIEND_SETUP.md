# Mansion Karaoke: Friend Setup Guide

This is the simplest way to host Mansion Karaoke from a Mac. This is a private beta, not a finished consumer release. The app contains the controller and Firefox player files, so the host does **not** need Git, Node.js, Bun, Docker, or a developer checkout. Guests need only a phone on the same Wi-Fi and the host needs internet access for YouTube.

Host requirement: macOS 13.0 or newer. Install [Firefox from Mozilla](https://www.mozilla.org/firefox/new/) before the party.

## Download the Mac app

1. Use the **specific ZIP/version your host coordinator has rehearsed**, from [Mansion Karaoke releases](https://github.com/jandor-hermes/mansion-karaoke/releases) or a private handoff. Do not substitute a different “latest” build on party day. The coordinator should provide its version and SHA-256 checksum; a newer source checkout does not mean a newer downloadable app has been published.
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

## Rehearse before guests arrive

Use the exact app you will run at the party, the intended Wi-Fi, and two real phones. Leave time to fix setup issues before the event.

- Play three queued songs; let one finish naturally and check that the next starts exactly once. Confirm lyrics, fullscreen, and sound from the intended TV/speakers—not just the Mac. Test microphones or a mixer separately if you use them.
- Test pause/resume, volume, Skip, adding from both phones, moving/removing a queued song, and canceling an interrupt/clear confirmation.
- Quit and reopen Firefox once, reload the temporary add-on, and reconnect. Separately quit and reopen Mansion Karaoke: **the queue resets**, so test this before collecting guests' requests.
- Check recovery from an unavailable video and a brief network outage. If playback stalls, inspect the actual YouTube tab for an ad, consent/sign-in page, or autoplay prompt before skipping to a known-good upload.
- Run for at least 30 minutes, including a quiet interval. If phones cannot reach the app, audio does not work, or transitions are unreliable, use a prechecked YouTube playlist manually rather than trying a new build during the party. That fallback still needs internet.

### Keep the Mac awake

Keep the Mac plugged in and its lid open. On a MacBook, look in **System Settings → Battery → Options** for **Prevent automatic sleeping on power adapter when the display is off** and enable it for the session. On desktop Macs, look under **Energy** or **Energy Saver**; the exact labels vary by macOS and hardware. Search System Settings for “sleep” if needed. Under **Lock Screen**, set the power-adapter display-off interval long enough for the session, and restore your usual settings afterward. Turn on a suitable Focus mode to suppress notifications on the TV.

For hosts comfortable with Terminal, an alternative is `caffeinate -di`: leave that command running during the party and press **Control-C** afterward. It does not make closing a laptop lid safe; keep the lid open.

If the Mac sleeps or changes networks, wake it, confirm the host still says Running, reconnect Firefox, and scan the current LAN address again from a phone. Reload the temporary extension if Firefox quit. Avoid restarting the host unless necessary, because that loses the queue.

## Update later

Download the newer ZIP from [GitHub Releases](https://github.com/jandor-hermes/mansion-karaoke/releases), quit the old app, and replace it in Applications. The party token stored under `~/Library/Application Support/Mansion Karaoke/` remains in place.

## Troubleshooting

### A phone cannot open the guest page

- Confirm the phone and Mac are on the same Wi-Fi.
- Avoid guest Wi-Fi networks that isolate devices from each other.
- Allow incoming connections in **System Settings → Network → Firewall → Options** (labels vary by macOS). Allow Mansion Karaoke or its controller if listed; do not turn off the firewall globally.
- Use the QR code or LAN address on the Firefox display, not `127.0.0.1`.
- If the Mac has a VPN or several network adapters, compare the QR address with **System Settings → Wi-Fi → Details → TCP/IP** for the connected network. Open `http://<that-IP>:3010` on the phone and enter the app's token if the QR chose the wrong interface. Use the app's configured port if it differs. Do not disable an organization-required VPN without permission; choose a permitted network instead.
- This beta uses plain HTTP with a shared party token. Use only a trusted LAN; do not expose it with router port forwarding or a public tunnel.

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
