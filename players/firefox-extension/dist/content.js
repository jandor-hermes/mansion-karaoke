"use strict";
(() => {
  // src/presentation.ts
  var PRESENTATION_CLASS = "karaoke-video-presentation";
  var PRESENTATION_STYLE_ID = "karaoke-video-presentation-style";
  var YOUTUBE_FULLSCREEN_BUTTON_SELECTOR = 'button.ytp-fullscreen-button[aria-label*="Full screen"]';
  var YOUTUBE_THEATER_BUTTON_SELECTOR = "button.ytp-size-button";
  var YOUTUBE_WATCH_FLEXY_SELECTOR = "ytd-watch-flexy";
  var YOUTUBE_PLAYER_SELECTOR = "#movie_player";
  var YOUTUBE_VIDEO_SELECTOR = "video.html5-main-video";
  var defaultLogger = (message, details) => console.debug(`[karaoke-player] ${message}`, details);
  function clickYouTubeFullscreenButton(documentLike, logger = defaultLogger) {
    const button = documentLike.querySelector(YOUTUBE_FULLSCREEN_BUTTON_SELECTOR);
    if (!button) {
      logger("YouTube fullscreen button not found (best-effort attempt only; CSS presentation will proceed)", { selector: YOUTUBE_FULLSCREEN_BUTTON_SELECTOR });
      return false;
    }
    logger("YouTube fullscreen button located", { selector: YOUTUBE_FULLSCREEN_BUTTON_SELECTOR, button });
    try {
      button.click();
      logger("YouTube fullscreen button clicked; NOTE a synthetic click may lack trusted user activation, so YouTube's requestFullscreen may be rejected \u2014 CSS presentation is the fallback", { selector: YOUTUBE_FULLSCREEN_BUTTON_SELECTOR });
      return true;
    } catch (error) {
      logger("YouTube fullscreen button click failed (expected: untrusted activation); falling back to CSS presentation", { selector: YOUTUBE_FULLSCREEN_BUTTON_SELECTOR, error });
      return false;
    }
  }
  function activateTheaterMode(documentLike, logger = defaultLogger) {
    const flexy = documentLike.querySelector(YOUTUBE_WATCH_FLEXY_SELECTOR);
    if (flexy?.hasAttribute("theater")) {
      logger("YouTube theater mode already active", { selector: YOUTUBE_WATCH_FLEXY_SELECTOR });
      return true;
    }
    const button = documentLike.querySelector(YOUTUBE_THEATER_BUTTON_SELECTOR);
    if (button) {
      try {
        button.click();
        logger("YouTube theater (size) button clicked; YouTube applies the layout asynchronously", { selector: YOUTUBE_THEATER_BUTTON_SELECTOR, button });
        return true;
      } catch (error) {
        logger("YouTube theater button click failed; trying attribute toggle", { selector: YOUTUBE_THEATER_BUTTON_SELECTOR, error });
      }
    } else {
      logger("YouTube theater (size) button not found; trying attribute toggle", { selector: YOUTUBE_THEATER_BUTTON_SELECTOR });
    }
    if (documentLike.querySelector(YOUTUBE_WATCH_FLEXY_SELECTOR)?.hasAttribute("theater")) {
      logger("YouTube theater mode active after button click", { selector: YOUTUBE_WATCH_FLEXY_SELECTOR });
      return true;
    }
    const flexyElements = documentLike.querySelectorAll?.(YOUTUBE_WATCH_FLEXY_SELECTOR);
    if (flexyElements && flexyElements.length > 0) {
      try {
        flexyElements[0].setAttribute?.("theater", "");
        logger("set theater attribute on ytd-watch-flexy directly", { selector: YOUTUBE_WATCH_FLEXY_SELECTOR });
        return true;
      } catch (error) {
        logger("failed to set theater attribute on ytd-watch-flexy", { selector: YOUTUBE_WATCH_FLEXY_SELECTOR, error });
      }
    }
    logger("theater mode could not be confirmed; presentation CSS will stretch the player anyway", { selector: YOUTUBE_WATCH_FLEXY_SELECTOR });
    return false;
  }
  var presentationMessage = (message) => Boolean(message && typeof message === "object" && message.type === "fullscreen");
  function applyPresentation(documentLike) {
    try {
      documentLike.documentElement.classList.add(PRESENTATION_CLASS);
      documentLike.body?.classList.add(PRESENTATION_CLASS);
      if (!documentLike.getElementById(PRESENTATION_STYLE_ID)) {
        const style = documentLike.createElement("style");
        style.id = PRESENTATION_STYLE_ID;
        style.textContent = `
/* Hide page chrome */
html.${PRESENTATION_CLASS} #masthead-container, html.${PRESENTATION_CLASS} ytd-masthead,
html.${PRESENTATION_CLASS} #guide, html.${PRESENTATION_CLASS} #guide-spacer,
html.${PRESENTATION_CLASS} #secondary, html.${PRESENTATION_CLASS} #comments,
html.${PRESENTATION_CLASS} #related, html.${PRESENTATION_CLASS} ytd-watch-next-secondary-results-renderer,
html.${PRESENTATION_CLASS} #player-ads { display: none !important; }
/* Expand the watch layout: uncap widths so the player area can fill the viewport */
html.${PRESENTATION_CLASS} ytd-app, html.${PRESENTATION_CLASS} #content,
html.${PRESENTATION_CLASS} ytd-page-manager, html.${PRESENTATION_CLASS} #page-manager,
html.${PRESENTATION_CLASS} ytd-watch-flexy, html.${PRESENTATION_CLASS} #columns,
html.${PRESENTATION_CLASS} #primary, html.${PRESENTATION_CLASS} #primary-inner,
html.${PRESENTATION_CLASS} #player {
    max-width: none !important; width: auto !important; padding: 0 !important; margin: 0 !important;
}
/* Stretch the player container chain to the full viewport \u2014 no position hacks,
   no styling of the <video> element itself */
html.${PRESENTATION_CLASS} #player,
html.${PRESENTATION_CLASS} #player-container-outer,
html.${PRESENTATION_CLASS} #player-container-inner {
    width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important;
}
html.${PRESENTATION_CLASS} #movie_player {
    width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important;
}
/* Immersive background */
html.${PRESENTATION_CLASS}, html.${PRESENTATION_CLASS} body { background: #000 !important; }
`;
        documentLike.head.append(style);
      }
      return true;
    } catch {
      return false;
    }
  }
  function logPresentationDiagnostics(documentLike, logger = defaultLogger) {
    const player = documentLike.querySelector(YOUTUBE_PLAYER_SELECTOR);
    const video2 = documentLike.querySelector(YOUTUBE_VIDEO_SELECTOR);
    logger("presentation diagnostics", {
      player: player ? { selector: YOUTUBE_PLAYER_SELECTOR, rect: player.getBoundingClientRect() } : { selector: YOUTUBE_PLAYER_SELECTOR, found: false },
      video: video2 ? { selector: YOUTUBE_VIDEO_SELECTOR, rect: video2.getBoundingClientRect(), intrinsic: { videoWidth: video2.videoWidth, videoHeight: video2.videoHeight } } : { selector: YOUTUBE_VIDEO_SELECTOR, found: false }
    });
  }

  // src/load-video.ts
  var YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
  function parseLoadVideoCommand(value) {
    if (!value || typeof value !== "object") return null;
    const candidate = value;
    if (candidate.type !== "loadVideo" || typeof candidate.videoId !== "string" || !YOUTUBE_VIDEO_ID.test(candidate.videoId)) return null;
    if (typeof candidate.position !== "number" || !Number.isFinite(candidate.position) || candidate.position < 0) return null;
    return { type: "loadVideo", videoId: candidate.videoId, position: candidate.position };
  }
  function requestPageLoad(node, channel, value, timeoutMs = 2e3) {
    const command = parseLoadVideoCommand(value);
    if (!command) return Promise.reject(new Error("invalid loadVideo command"));
    if (!/^[A-Za-z0-9_-]+$/.test(channel)) return Promise.reject(new Error("invalid bridge channel"));
    const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const responseEvent = `karaoke-load-response-${channel}`;
      const cleanup = () => {
        clearTimeout(timeout);
        node.removeEventListener(responseEvent, onResponse);
      };
      const onResponse = () => {
        try {
          const envelope = JSON.parse(node.dataset.karaokeResponse ?? "null");
          if (envelope?.requestId !== requestId) return;
          const result = parseLoadVideoResult(envelope.result);
          if (!result || result.videoId !== command.videoId) throw new Error("invalid page-bridge response");
          cleanup();
          resolve(result);
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("page-bridge response timed out"));
      }, timeoutMs);
      node.addEventListener(responseEvent, onResponse);
      node.dataset.karaokeRequest = JSON.stringify({ requestId, videoId: command.videoId, position: command.position });
      node.dispatchEvent(new Event(`karaoke-load-request-${channel}`));
    });
  }
  function parseLoadVideoResult(value) {
    if (!value || typeof value !== "object") return null;
    const candidate = value;
    if (typeof candidate.ok !== "boolean" || typeof candidate.videoId !== "string" || !YOUTUBE_VIDEO_ID.test(candidate.videoId)) return null;
    if (typeof candidate.fullscreenRetained !== "boolean") return null;
    if (candidate.ok && candidate.mode !== "yt-navigate" && candidate.mode !== "player-api") return null;
    if (candidate.mode !== void 0 && candidate.mode !== "yt-navigate" && candidate.mode !== "player-api") return null;
    if (candidate.error !== void 0 && typeof candidate.error !== "string") return null;
    return {
      ok: candidate.ok,
      ...candidate.mode ? { mode: candidate.mode } : {},
      videoId: candidate.videoId,
      fullscreenRetained: candidate.fullscreenRetained,
      ...candidate.error ? { error: candidate.error } : {}
    };
  }

  // src/content.ts
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
    };
    const observer = new MutationObserver(attach);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    attach();
    const channel = Math.random().toString(36).slice(2);
    const bridgeNode = document.createElement("span");
    bridgeNode.hidden = true;
    bridgeNode.id = `karaoke-bridge-${channel}`;
    document.documentElement.appendChild(bridgeNode);
    const bridgeScript = document.createElement("script");
    bridgeScript.src = browser.runtime.getURL("page-bridge.js");
    bridgeScript.dataset.karaokeChannel = channel;
    bridgeScript.dataset.karaokeNode = bridgeNode.id;
    bridgeScript.addEventListener("load", () => bridgeScript.remove(), { once: true });
    document.documentElement.appendChild(bridgeScript);
    browser.runtime.onMessage.addListener((rawMessage) => {
      const message = rawMessage;
      const load = parseLoadVideoCommand(message);
      if (load) return requestPageLoad(bridgeNode, channel, load);
      if (presentationMessage(message)) {
        clickYouTubeFullscreenButton(document);
        activateTheaterMode(document);
        if (applyPresentation(document)) console.debug("[karaoke-player] video presentation applied");
        else console.error("[karaoke-player] video presentation failed");
        logPresentationDiagnostics(document);
        return;
      }
      const element = video();
      if (!element) return;
      if (message.type === "pause") element.pause();
      if (message.type === "resume") {
        console.debug("[karaoke-player] received resume command");
        return element.play().then(() => console.debug("[karaoke-player] resume play() resolved"));
      }
      if (message.type === "setVolume" && message.volume !== void 0) element.volume = message.volume;
    });
    return observer;
  }
  if (typeof browser !== "undefined") installYouTubeContentScript();
})();
