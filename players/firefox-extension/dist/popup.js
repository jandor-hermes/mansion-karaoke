"use strict";
(() => {
  // src/config.ts
  var DEFAULT_CONTROLLER_URL = "http://127.0.0.1:3010";
  function parseStoredConfig(value) {
    if (!value || typeof value !== "object") return { baseUrl: DEFAULT_CONTROLLER_URL, token: "" };
    const stored = value;
    return {
      baseUrl: typeof stored.baseUrl === "string" ? stored.baseUrl : DEFAULT_CONTROLLER_URL,
      token: typeof stored.token === "string" ? stored.token : ""
    };
  }

  // src/popup.ts
  var form = document.querySelector("#session-form");
  var baseUrl = document.querySelector("#base-url");
  var token = document.querySelector("#token");
  var status = document.querySelector("#status");
  function setStatus(message, error = false) {
    if (!status) return;
    status.textContent = message;
    status.dataset.error = String(error);
  }
  async function load() {
    const config = parseStoredConfig(await browser.storage.local.get(["baseUrl", "token"]));
    if (baseUrl) baseUrl.value = config.baseUrl;
    if (token) token.value = config.token;
  }
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!baseUrl || !token) return;
    const submitter = event.submitter;
    const config = {
      baseUrl: baseUrl.value.trim() || DEFAULT_CONTROLLER_URL,
      token: token.value
    };
    if (submitter?.value !== "start") {
      await browser.storage.local.set(config);
      setStatus("Settings saved.");
      return;
    }
    if (!config.token) {
      setStatus("Enter an authorization token first.", true);
      token.focus();
      return;
    }
    setStatus("Starting session\u2026");
    try {
      const result = await browser.runtime.sendMessage({ type: "startSession", config });
      if (!result?.ok) throw new Error(result?.error || "The player could not be opened.");
      setStatus("Session started.");
      window.close();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The session could not be started.", true);
    }
  });
  void load();
})();
