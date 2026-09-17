"use strict";
(() => {
  // src/load-video.ts
  var YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
  function parseLoadVideoCommand(value) {
    if (!value || typeof value !== "object") return null;
    const candidate = value;
    if (candidate.type !== "loadVideo" || typeof candidate.videoId !== "string" || !YOUTUBE_VIDEO_ID.test(candidate.videoId)) return null;
    if (typeof candidate.position !== "number" || !Number.isFinite(candidate.position) || candidate.position < 0) return null;
    return { type: "loadVideo", videoId: candidate.videoId, position: candidate.position };
  }

  // src/page-bridge.ts
  var retained = (before, adapter) => before != null && adapter.getFullscreenElement() === before;
  function syncYouTubeMetadata(documentLike, title) {
    documentLike.title = `${title} - YouTube`;
    for (const selector of [
      "h1.ytd-watch-metadata yt-formatted-string",
      "h1.title yt-formatted-string",
      ".ytp-fullscreen-metadata .ytPlayerOverlayVideoDetailsRendererTitle .ytAttributedStringHost"
    ]) {
      const node = documentLike.querySelector(selector);
      if (node) node.textContent = title;
    }
    documentLike.querySelector('meta[property="og:title"]')?.setAttribute?.("content", title);
  }
  async function waitFor(adapter, predicate, attempts) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (predicate()) return true;
      await adapter.wait(100);
    }
    return predicate();
  }
  async function loadVideoInPage(raw, adapter, attempts = 20) {
    const command = parseLoadVideoCommand(raw);
    if (!command) return { ok: false, videoId: "", fullscreenRetained: false, error: "invalid command" };
    const fullscreen = adapter.getFullscreenElement();
    const routeDispatched = adapter.getVideoId() !== command.videoId && adapter.dispatchNavigate(command.videoId, command.position);
    if (routeDispatched && await waitFor(adapter, () => {
      try {
        return new URL(adapter.getHref()).searchParams.get("v") === command.videoId && adapter.getVideoId() === command.videoId;
      } catch {
        return false;
      }
    }, attempts)) {
      await adapter.syncMetadata(command.videoId);
      return { ok: true, mode: "yt-navigate", videoId: command.videoId, fullscreenRetained: retained(fullscreen, adapter) };
    }
    if (adapter.loadVideoById(command.videoId, command.position) && await waitFor(adapter, () => adapter.getVideoId() === command.videoId, attempts)) {
      adapter.replaceWatchUrl(command.videoId);
      await adapter.syncMetadata(command.videoId);
      return { ok: true, mode: "player-api", videoId: command.videoId, fullscreenRetained: retained(fullscreen, adapter) };
    }
    return { ok: false, videoId: command.videoId, fullscreenRetained: retained(fullscreen, adapter), error: "same-document load was not verified" };
  }
  function installPageBridge() {
    const script = document.currentScript;
    const channel = script?.dataset.karaokeChannel;
    const nodeId = script?.dataset.karaokeNode;
    if (!channel || !/^[A-Za-z0-9_-]+$/.test(channel) || !nodeId) return;
    const node = document.getElementById(nodeId);
    if (!node) return;
    const player = () => document.getElementById("movie_player");
    const adapter = {
      dispatchNavigate(videoId) {
        const manager = document.querySelector("ytd-navigation-manager");
        if (!manager) return false;
        manager.dispatchEvent(new CustomEvent("yt-navigate", { bubbles: true, composed: true, detail: {
          endpoint: { commandMetadata: { webCommandMetadata: { pageType: "WEB_PAGE_TYPE_WATCH", url: `/watch?v=${videoId}` } }, watchEndpoint: { videoId } }
        } }));
        return true;
      },
      getVideoId: () => player()?.getVideoData?.().video_id,
      getHref: () => location.href,
      loadVideoById(videoId, position) {
        const method = player()?.loadVideoById;
        if (typeof method !== "function") return false;
        method.call(player(), { videoId, startSeconds: position });
        return true;
      },
      replaceWatchUrl(videoId) {
        history.replaceState(history.state, "", `/watch?v=${videoId}`);
      },
      async syncMetadata(videoId) {
        let data = player()?.getVideoData?.();
        for (let attempt = 0; attempt < 20 && (data?.video_id !== videoId || !data?.title); attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          data = player()?.getVideoData?.();
        }
        if (data?.video_id !== videoId || !data.title) return;
        syncYouTubeMetadata(document, data.title);
      },
      getFullscreenElement: () => document.fullscreenElement,
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    };
    node.addEventListener(`karaoke-load-request-${channel}`, () => {
      void (async () => {
        try {
          const envelope = JSON.parse(node.dataset.karaokeRequest ?? "null");
          if (!envelope || typeof envelope.requestId !== "string" || typeof envelope.videoId !== "string" || !YOUTUBE_VIDEO_ID.test(envelope.videoId)) return;
          const command = { type: "loadVideo", videoId: envelope.videoId, position: Number(envelope.position) };
          const result = await loadVideoInPage(command, adapter);
          node.dataset.karaokeResponse = JSON.stringify({ requestId: envelope.requestId, result });
          node.dispatchEvent(new Event(`karaoke-load-response-${channel}`));
        } catch {
        }
      })();
    });
  }
  if (typeof document !== "undefined") installPageBridge();
})();
