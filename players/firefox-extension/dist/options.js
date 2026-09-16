"use strict";
(() => {
  // players/firefox-extension/src/config.ts
  var DEFAULT_CONTROLLER_URL = "http://127.0.0.1:3010";
  function parseStoredConfig(value) {
    if (!value || typeof value !== "object") return { baseUrl: DEFAULT_CONTROLLER_URL, token: "" };
    const stored = value;
    return {
      baseUrl: typeof stored.baseUrl === "string" ? stored.baseUrl : DEFAULT_CONTROLLER_URL,
      token: typeof stored.token === "string" ? stored.token : ""
    };
  }

  // players/firefox-extension/src/options.ts
  var form = document.querySelector("#config-form");
  var baseUrl = document.querySelector("#base-url");
  var token = document.querySelector("#token");
  var status = document.querySelector("#status");
  async function load() {
    const config = parseStoredConfig(await browser.storage.local.get(["baseUrl", "token"]));
    if (baseUrl) baseUrl.value = config.baseUrl;
    if (token) token.value = config.token;
  }
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!baseUrl || !token || !status) return;
    await browser.storage.local.set({ baseUrl: baseUrl.value.trim() || DEFAULT_CONTROLLER_URL, token: token.value });
    status.textContent = "Saved. The background poller will use this configuration.";
  });
  void load();
})();
