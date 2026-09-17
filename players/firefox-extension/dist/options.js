"use strict";
(() => {
  // src/config.ts
  var DEFAULT_CONTROLLER_URL = "http://127.0.0.1:3010";
  var DEFAULT_OVERLAY_SETTINGS = { nowSinging: true, upNextSeconds: 20, upNextAlways: false };
  var UP_NEXT_SECONDS_MIN = 0;
  var UP_NEXT_SECONDS_MAX = 600;
  function parseOverlaySettings(value) {
    if (!value || typeof value !== "object") return { ...DEFAULT_OVERLAY_SETTINGS };
    const stored = value;
    const seconds = typeof stored.upNextSeconds === "number" && Number.isFinite(stored.upNextSeconds) ? Math.min(UP_NEXT_SECONDS_MAX, Math.max(UP_NEXT_SECONDS_MIN, Math.round(stored.upNextSeconds))) : DEFAULT_OVERLAY_SETTINGS.upNextSeconds;
    return {
      nowSinging: typeof stored.nowSinging === "boolean" ? stored.nowSinging : DEFAULT_OVERLAY_SETTINGS.nowSinging,
      upNextSeconds: seconds,
      upNextAlways: typeof stored.upNextAlways === "boolean" ? stored.upNextAlways : DEFAULT_OVERLAY_SETTINGS.upNextAlways
    };
  }
  function parseStoredConfig(value) {
    if (!value || typeof value !== "object") return { baseUrl: DEFAULT_CONTROLLER_URL, token: "", overlay: { ...DEFAULT_OVERLAY_SETTINGS } };
    const stored = value;
    return {
      baseUrl: typeof stored.baseUrl === "string" ? stored.baseUrl : DEFAULT_CONTROLLER_URL,
      token: typeof stored.token === "string" ? stored.token : "",
      overlay: parseOverlaySettings(stored.overlay)
    };
  }

  // src/options.ts
  var form = document.querySelector("#config-form");
  var baseUrl = document.querySelector("#base-url");
  var token = document.querySelector("#token");
  var nowSinging = document.querySelector("#overlay-now-singing");
  var upNextAlways = document.querySelector("#overlay-up-next-always");
  var upNextSeconds = document.querySelector("#overlay-up-next-seconds");
  var status = document.querySelector("#status");
  async function load() {
    const config = parseStoredConfig(await browser.storage.local.get(["baseUrl", "token", "overlay"]));
    if (baseUrl) baseUrl.value = config.baseUrl;
    if (token) token.value = config.token;
    if (nowSinging) nowSinging.checked = config.overlay.nowSinging;
    if (upNextAlways) upNextAlways.checked = config.overlay.upNextAlways;
    if (upNextSeconds) upNextSeconds.value = String(config.overlay.upNextSeconds);
  }
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!baseUrl || !token || !status) return;
    await browser.storage.local.set({
      baseUrl: baseUrl.value.trim() || DEFAULT_CONTROLLER_URL,
      token: token.value,
      overlay: parseOverlaySettings({
        nowSinging: nowSinging?.checked,
        upNextAlways: upNextAlways?.checked,
        upNextSeconds: upNextSeconds ? Number(upNextSeconds.value) : void 0
      })
    });
    status.textContent = "Saved. The player overlay updates on the next poll (within a second).";
  });
  void load();
})();
