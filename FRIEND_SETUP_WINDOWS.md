# Mansion Karaoke: Windows Friend Setup (x64 Beta)

This guide is for a **trusted-friend Windows x64 beta**. The Windows package is planned but is not available unless a Windows ZIP and matching SHA-256 checksum have been published on the project’s [GitHub Releases](https://github.com/jandor-hermes/mansion-karaoke/releases) page. It will be unsigned, so use it only when you received the release link from the project owner and can verify the download.

The package is intended for 64-bit Intel/AMD Windows computers. It does not support Windows on ARM in this beta. The host does not need Git, Bun, Node.js, .NET, Docker, or developer tools. Guests need only a phone on the same trusted Wi-Fi.

## Download and verify the ZIP

1. On the release page, download both:
   - `Mansion-Karaoke-<version>-Windows-x64.zip`
   - its matching SHA-256 checksum file
2. Open **PowerShell** and calculate the ZIP’s checksum:

   ```powershell
   Get-FileHash -Algorithm SHA256 "$HOME\Downloads\Mansion-Karaoke-<version>-Windows-x64.zip"
   ```

3. Compare the entire `Hash` value with the SHA-256 value published for that exact ZIP. Letter case does not matter; every hexadecimal character must match.

Stop if the checksum differs, the checksum file is missing, or the filenames/versions do not match. Delete the download and contact the project owner. Do not run or recover it from a security warning.

## Unblock and extract first

After the checksum matches:

1. In File Explorer, right-click the downloaded ZIP and select **Properties**.
2. On the **General** tab, select **Unblock** under **Security**, then **Apply** and **OK**. If the Unblock option is absent, continue without changing other security settings.
3. Right-click the ZIP and select **Extract All…**.
4. Choose a normal user folder, such as `Downloads` or `Documents`, and finish extraction.
5. Open the extracted `Mansion Karaoke` folder. Do not run `Mansion Karaoke.exe` from inside the ZIP.

Keep the extracted folder together. The launcher needs its adjacent `resources` folder.

## Open the unsigned beta

The first beta will not have an Authenticode signature. Windows may show **Microsoft Defender SmartScreen protected your PC** and list the publisher as unknown.

Only after the ZIP checksum matches and the release came from the project owner:

1. Open `Mansion Karaoke.exe`.
2. If SmartScreen appears, select **More info**.
3. Confirm the app name is `Mansion Karaoke.exe`, then select **Run anyway**.

If the name or path is unexpected, or **Run anyway** is unavailable, stop and contact the project owner. Do not disable SmartScreen.

### If Microsoft Defender quarantines a release file

Do not turn off real-time protection and do not add a folder, process, or antivirus exclusion.

1. Confirm that the original release ZIP passed the SHA-256 check above.
2. Open **Windows Security → Virus & threat protection → Protection history**.
3. Open the event and confirm it names the exact downloaded ZIP or an executable inside the extracted, verified `Mansion Karaoke` folder.
4. Review the detection details. If they match the expected unsigned beta and you trust the project owner, use **Actions → Allow on device** or **Restore** for that file only. Windows wording may vary by version.
5. If the event names any other file or location, or the checksum did not match, do not allow it.

Recover only the exact file from the verified package. Do not weaken Defender globally to make the app run.

## Allow Private-network access only

When Windows Defender Firewall asks whether the controller may communicate on networks:

1. Select **Private networks**.
2. Clear **Public networks**.
3. Select **Allow access**.

Cancel and investigate if the prompt names an unexpected program or path. Do not add a public-network rule or expose port 3010 through a router. If you previously denied the prompt, allow the exact Mansion Karaoke launcher/controller app through **Windows Security → Firewall & network protection → Allow an app through firewall**, with **Private** selected and **Public** cleared.

## Load the Firefox player

Keep the Mansion Karaoke window open while hosting.

1. In Mansion Karaoke, select **Reveal Extension**. The extension copy is stored under `%LOCALAPPDATA%\Mansion Karaoke\firefox-extension\<extension-version>\`.
2. Select **Firefox Setup**. Firefox should open `about:debugging#/runtime/this-firefox`.
3. Select **Load Temporary Add-on…**.
4. Choose the revealed `manifest.json` file.
5. Open the **Mansion Karaoke Firefox Player** toolbar button.
6. Enter the **Controller URL** and **Party token** shown by Mansion Karaoke. The local controller URL is normally `http://127.0.0.1:3010`.
7. Select **Save & start**.

Firefox opens or focuses the dedicated karaoke display. A join QR code appears before the first song starts.

> Firefox removes temporary add-ons whenever Firefox quits. Repeat this section after every Firefox restart. Mansion Karaoke preserves the same eight-character party token between app launches.

## Start and stop a party

1. Put the Firefox window on the TV, directly or over HDMI.
2. Have guests join the same trusted Wi-Fi and scan the displayed QR code.
3. Guests enter a display name, search, and add songs to the shared queue.

Close **Mansion Karaoke** to stop the controller. Closing only Firefox does not stop the controller. The queue is held in memory and is cleared whenever the controller stops; the party token remains stored for future sessions.

## Update manually

This beta does not update itself.

1. Download the newer Windows x64 ZIP and matching checksum from GitHub Releases.
2. Verify the new ZIP before opening it.
3. Close the old Mansion Karaoke launcher.
4. Unblock and extract the new ZIP into a new folder, then start its `Mansion Karaoke.exe`.
5. Delete the old extracted app folder only after the new version works.
6. Reload the temporary Firefox extension from the path revealed by the new launcher.

Do not merge new files into an old extracted folder. The token under `%LOCALAPPDATA%\Mansion Karaoke\` should remain in place across manual updates.

## Troubleshooting

### A phone cannot open the guest page

- Confirm the phone and Windows computer are on the same Wi-Fi.
- Avoid guest Wi-Fi networks that isolate devices from each other.
- Confirm the firewall rule is enabled for **Private** networks only.
- Use the QR code or LAN address shown on the karaoke display, not `127.0.0.1`.
- Confirm Windows classifies the current trusted home network as **Private**, not Public.

### The Firefox extension does not connect

- Confirm Mansion Karaoke reports that the controller is running.
- Keep the controller URL set to `http://127.0.0.1:3010` unless the launcher explicitly shows a different value.
- Copy the party token exactly from the launcher.
- Reload the temporary add-on after restarting Firefox.
- If the launcher reports a protocol/version mismatch, update the host package and reload the extension from that same package.

### YouTube opens but playback remains paused

Allow autoplay with sound for YouTube in Firefox, then retry the song.

### The controller does not start

Another application may already be using port 3010. Close an older Mansion Karaoke window or other known local controller, then reopen the app. Do not terminate unrelated processes just to free the port.

Diagnostic files and mutable state are stored under:

```text
%LOCALAPPDATA%\Mansion Karaoke\
├── party-token
├── controller.log
└── firefox-extension\<extension-version>\manifest.json
```

The extracted app folder contains the launcher and immutable `resources`; logs and the token are not stored there. `controller.log` must not contain the party token, but it may contain local diagnostic details. Share it only with the project owner.

## Trust model and non-goals

- This is an assisted beta for a known recipient, not a generally distributed or signed Windows product.
- Anyone who can see the TV QR code or obtain the party token can control the session. Use it only on a trusted local network and do not post the token or QR code publicly.
- The controller is for local-network use. Do not configure port forwarding, public-network firewall access, or internet exposure.
- SmartScreen, Defender, and the firewall remain enabled. Any exception should be limited to the exact checksum-verified release file and Private networks.
- The beta has no installer, Start-menu entry, Windows service, auto-start, automatic updater, Windows ARM64 build, or persistent/signed Firefox extension.
- The temporary Firefox add-on must be reloaded after Firefox restarts, and the in-memory queue does not survive controller shutdown.
- Mansion Karaoke does not download or re-stream YouTube media and is not affiliated with or endorsed by YouTube. Users remain responsible for YouTube’s terms and applicable copyright law.
