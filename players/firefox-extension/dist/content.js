"use strict";
(() => {
  // players/firefox-extension/src/presentation.ts
  var PRESENTATION_CLASS = "karaoke-video-presentation";
  var PRESENTATION_STYLE_ID = "karaoke-video-presentation-style";
  var presentationMessage = (message) => Boolean(message && typeof message === "object" && message.type === "fullscreen");
  function applyPresentation(documentLike) {
    try {
      documentLike.documentElement.classList.add(PRESENTATION_CLASS);
      documentLike.body?.classList.add(PRESENTATION_CLASS);
      if (!documentLike.getElementById(PRESENTATION_STYLE_ID)) {
        const style = documentLike.createElement("style");
        style.id = PRESENTATION_STYLE_ID;
        style.textContent = `
html.${PRESENTATION_CLASS}, html.${PRESENTATION_CLASS} body { background: #000 !important; overflow: hidden !important; }
html.${PRESENTATION_CLASS} #masthead-container, html.${PRESENTATION_CLASS} ytd-masthead,
html.${PRESENTATION_CLASS} #guide, html.${PRESENTATION_CLASS} #secondary,
html.${PRESENTATION_CLASS} #comments, html.${PRESENTATION_CLASS} #related,
html.${PRESENTATION_CLASS} ytd-watch-next-secondary-results-renderer,
html.${PRESENTATION_CLASS} #player-ads, html.${PRESENTATION_CLASS} .ytp-chrome-top,
html.${PRESENTATION_CLASS} .ytp-chrome-bottom, html.${PRESENTATION_CLASS} .ytp-gradient-top,
html.${PRESENTATION_CLASS} .ytp-gradient-bottom { display: none !important; }
html.${PRESENTATION_CLASS} ytd-page-manager, html.${PRESENTATION_CLASS} #page-manager,
html.${PRESENTATION_CLASS} #content, html.${PRESENTATION_CLASS} #player-container-outer,
html.${PRESENTATION_CLASS} #player-container-inner, html.${PRESENTATION_CLASS} #movie_player {
    position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
    max-width: none !important; margin: 0 !important; padding: 0 !important;
}
html.${PRESENTATION_CLASS} #movie_player video,
html.${PRESENTATION_CLASS} video.html5-main-video {
    position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important;
    max-width: 100% !important; max-height: 100% !important; object-fit: contain !important;
}
`;
        documentLike.head.append(style);
      }
      return true;
    } catch {
      return false;
    }
  }

  // players/firefox-extension/src/content.ts
  var video = () => document.querySelector("video");
  function classifyYouTubeError(documentLike, element) {
    const mediaCode = element.error?.code;
    if (mediaCode) return { code: `MEDIA_ERROR_${mediaCode}`, message: element.error?.message || "Video playback error" };
    const text = documentLike.body?.innerText ?? "";
    if (/video unavailable/i.test(text)) return { code: "PAGE_UNAVAILABLE_TEXT", message: "YouTube page reports video unavailable" };
    return { code: "MEDIA_ERROR", message: "Video playback error" };
  }
  function installYouTubeContentScript(send = (event) => browser.runtime.sendMessage(event)) {
    console.debug("[karaoke-player] YouTube content script loaded", { href: location.href });
    const report = (type, element) => {
      console.debug("[karaoke-player] YouTube media event", { type, position: element.currentTime });
      send({
        type,
        position: element.currentTime,
        ...type === "error" ? classifyYouTubeError(document, element) : {}
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
      const attemptAutoplay = () => {
        console.debug("[karaoke-player] attempting YouTube autoplay", { muted: element.muted, readyState: element.readyState });
        void element.play().then(() => console.debug("[karaoke-player] YouTube play() resolved")).catch((error) => console.error("[karaoke-player] YouTube play() rejected", error));
      };
      if (element.readyState >= HTMLMediaElement.HAVE_METADATA) attemptAutoplay();
      else element.addEventListener("loadedmetadata", attemptAutoplay, { once: true });
      attemptAutoplay();
      browser.runtime.onMessage.addListener((rawMessage) => {
        const message = rawMessage;
        if (message.type !== "resume") return;
        const current = video();
        if (!current) return;
        console.debug("[karaoke-player] received resume command");
        void current.play().then(() => console.debug("[karaoke-player] resume play() resolved")).catch((error) => console.error("[karaoke-player] resume play() rejected", error));
      });
    };
    const observer = new MutationObserver(attach);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    attach();
    browser.runtime.onMessage.addListener((rawMessage) => {
      const message = rawMessage;
      if (presentationMessage(message)) {
        if (applyPresentation(document)) console.debug("[karaoke-player] video presentation applied");
        else console.error("[karaoke-player] video presentation failed");
        return;
      }
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
