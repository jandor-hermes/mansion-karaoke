# Firefox playback provider

Phase 1 standalone Firefox MV2 provider. The background agent polls a configurable loopback controller with a per-session bearer token, routes protocol commands to one dedicated YouTube tab, and publishes observed lifecycle events. The content script controls the real HTML video element and reports DOM playback signals. Fullscreen is intentionally left to Firefox/window presentation configuration; no OS keystroke automation is used.

## Build and load

From the repository root, run:

```sh
npm run firefox:build
npm run firefox:verify
```

The deterministic build bundles `src/background.ts`, `src/content.ts`, and `src/options.ts` with the pinned repository `esbuild` tool into `players/firefox-extension/dist/`, and copies the manifest and options page into `dist/`. Load **`players/firefox-extension/dist`** as a temporary Firefox add-on (`about:debugging` → This Firefox → Load Temporary Add-on → `dist/manifest.json`). Open the add-on's **Preferences** (or `about:addons` → Local Karaoke Player → Preferences), enter the controller URL and bearer token, then click **Save settings**. The background poller loads those values from `browser.storage.local` before starting; with no token it remains idle and logs a diagnostic message. The verification step checks every manifest asset, including the options page, exists and rejects common embedded-secret patterns; tokens remain runtime loopback configuration and are not bundled.

The manifest deliberately grants only tabs/storage, loopback controller, and YouTube watch permissions. `npm run firefox:lint` runs `web-ext lint` when that optional CLI is installed; otherwise it reports the manual gate.

The MIT attribution and license are retained at repository root.
