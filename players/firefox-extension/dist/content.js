"use strict";
(() => {
  // players/firefox-extension/src/content.ts
  var video = () => document.querySelector("video");
  function installYouTubeContentScript(send = (event) => browser.runtime.sendMessage(event)) {
    console.debug("[karaoke-player] YouTube content script loaded", { href: location.href });
    const report = (type, element) => {
      console.debug("[karaoke-player] YouTube media event", { type, position: element.currentTime });
      send({
        type,
        position: element.currentTime,
        ...type === "error" ? { code: "MEDIA_ERROR", message: "Video playback error" } : {}
      });
    };
    const attach = () => {
      const element = video();
      if (!element) {
        console.debug("[karaoke-player] YouTube video element not found", { href: location.href });
        return;
      }
      if (element.dataset.karaokeBound) return;
      console.debug("[karaoke-player] YouTube video element attached", { href: location.href, readyState: element.readyState });
      element.dataset.karaokeBound = "true";
      for (const event of ["loadedmetadata", "playing", "pause", "ended", "error"]) {
        element.addEventListener(event, () => report(event === "loadedmetadata" ? "ready" : event, element));
      }
    };
    const observer = new MutationObserver(attach);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    attach();
    browser.runtime.onMessage.addListener((rawMessage) => {
      const message = rawMessage;
      const element = video();
      if (!element) return;
      if (message.type === "pause") element.pause();
      if (message.type === "resume") void element.play();
      if (message.type === "setVolume" && message.volume !== void 0) element.volume = message.volume;
    });
    return observer;
  }
  if (typeof browser !== "undefined") installYouTubeContentScript();
})();
