# Firefox playback provider

Phase 1 standalone Firefox MV2 provider. The background agent polls a configurable loopback controller with a per-session bearer token, routes protocol commands to one dedicated YouTube tab, and publishes observed lifecycle events. The content script controls the real HTML video element and reports DOM playback signals. Fullscreen is intentionally left to Firefox/window presentation configuration; no OS keystroke automation is used.

Build/bundle `src/background.ts` and `src/content.ts` to `background.js` and `content.js` with the host's TypeScript/WebExtension toolchain, then load this directory as a temporary Firefox add-on. The manifest deliberately grants only tabs/storage, loopback controller, and YouTube watch permissions.

The MIT attribution and license are retained at repository root.
