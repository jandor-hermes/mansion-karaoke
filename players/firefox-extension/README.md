# Firefox playback provider

Phase 1 standalone Firefox MV2 provider. The background agent polls a configurable loopback controller with a per-session bearer token, routes protocol commands to one dedicated YouTube tab, and publishes observed lifecycle events. The content script controls the real HTML video element and reports DOM playback signals. Fullscreen is intentionally left to Firefox/window presentation configuration; no OS keystroke automation is used.

## Build and load

From the repository root, run:

```sh
npm run firefox:build
npm run firefox:verify
```

The deterministic build bundles `src/background.ts` and `src/content.ts` with the pinned repository `esbuild` tool into `players/firefox-extension/dist/background.js` and `dist/content.js`, and copies the manifest into `dist/`. Load **`players/firefox-extension/dist`** as a temporary Firefox add-on (`about:debugging` → This Firefox → Load Temporary Add-on → `dist/manifest.json`). The verification step checks every manifest script exists and rejects common embedded-secret patterns; tokens remain runtime loopback configuration and are not bundled.

The manifest deliberately grants only tabs/storage, loopback controller, and YouTube watch permissions. `npm run firefox:lint` runs `web-ext lint` when that optional CLI is installed; otherwise it reports the manual gate.

The MIT attribution and license are retained at repository root.
