# Mansion Karaoke — Promo Reel (build strategy)

Source of truth for regenerating the promo reel. Binary outputs (`*.mp4`, `*.wav`)
and throwaway artifacts (`screens/`, `rendered-scenes/`, `verification/`, `site/`)
are intentionally **not** committed — regenerate them with the scripts below.

## What the reel says

Vertical 9:16, ~24s, one Mac + phones + YouTube on the TV:

1. **Intro** — MANSION KARAOKE brand lockup, "Turn any room into karaoke night."
2. **Join** — scan a QR / enter a name + party token. "No account. No guest app."
3. **Search** — the phone is the remote. "Find the song. Tap once. You're in."
4. **Queue** — shared up-next list. "Everyone gets a turn."
5. **Controls** — pause / skip / volume / fullscreen. "The party, in your hand."
6. **Outro** — brand lockup + "One Mac. Any phone. No app."

## How it's built

1. Run the control plane (`apps/control-plane`) with `KARAOKE_TOKEN`, seed a fake
   queue via the authenticated API (songs + `requestedBy` names), then capture the
   real guest UI in headless Chrome at **`480x1040`**:
   `--headless=new --window-size=480,1040 --force-device-scale-factor=2 --virtual-time-budget=3000 --screenshot=...`
   `480` is deliberately wider than the 430px phone viewport because the login
   card is `min(100%, 28rem)` ≈ 448px; capturing at 430 clips the card's right edge
   **into the screenshot**. `1040/480 = 2.167` matches the 700×1517 phone-box ratio
   in the scenes, so `object-fit:cover` applies zero crop.
2. **`build_reel.sh`** renders each finished frame as a 1080×1920 PNG and stitches
   them with ffmpeg `xfade` transitions (fade / slideleft / slideup / slideright),
   muxing the generated beat. `generate_audio.py` synthesizes an original ~120 BPM
   party loop (no licensed music) and fades in/out.
3. Captions/headlines are baked into static scene HTML rendered by headless Chrome
   (Chrome's font rendering) because the Homebrew ffmpeg has **no `drawtext`**
   (built without `--enable-libfreetype`). Do not reach for `drawtext` on this box.

## Distribution

- **Private / DM**: send the MP4 directly. AirDrop → Photos → Instagram Messages →
  gallery icon → select video → Send. This does *not* publish. (9:16 + local file
  needs no conversion.)
- **Posted Reel then share**: Instagram → ＋ → Reel → select from Photos → add
  cover/caption → Publish → tap the share/paper-plane → recipient.

## Pitfalls (learned 2026-09)

- **Guard against login screenshots.** When extracting the guest UI, the phone's
  party token/name live in `localStorage` under the *scanned-token* flow. The default
  capture came back as the login gate for every view. Fix: prefill the token+name
  into the controller's real JS state so `validateToken()` succeeds, and verify the
  render with OCR (`tesseract`) on extracted frames — check every panel, not one.
- **Clipping is usually baked into the source capture, not the display.** The
  first reel's "cropped phone" was the login card's right edge being cut off in
  the PNG itself — the card (`min(100%,28rem)` ≈ 448px) overflowed the 430px
  capture viewport, and the emulated phone just showed a faithful-but-bad image.
  Before touching scene layout, check the raw capture against the element that
  should be fully visible (OCR the source PNG, and know the widget's real width).
- **Re-capturing against a dead server silently writes a Chrome error page into
  the file.** If the preview shows `ERR_CONNECTION_REFUSED`, the capture ran while
  the control plane/static server was down — not a layout bug. After every
  capture, OCR (`tesseract`) the raw PNG immediately and grep for real content
  (and `ERR_`/`Join house-party`) so an error page never makes it into a scene.
- **`xfade` duration values need a leading `0`** (e.g. `0.5`, not `.5`) or ffmpeg
  fails to parse them.
- **Keep the capture aspect equal to the display box, or `cover` crops it.** Full-page
  phone captures placed in the 700×1517 phone box with `object-fit:cover` crop any aspect
  mismatch. Capture at `480x1040` (→ 960×2080, ratio 2.167) to match the box and get a
  guaranteed zero-crop fit; verify the phone frame in the stitched scene, not the raw capture.