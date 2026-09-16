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
   real guest UI in headless Chrome:
   `--headless=new --window-size=430,932 --force-device-scale-factor=2 --virtual-time-budget=3000 --screenshot=...`
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
- **Headline can clip at the right edge.** The scene `.headline` box was
  `width:970px; left:55px; centered` — at 60px bold the outer glyph ("…SING.") got
  cut off the 1080 canvas. Keep fixed-width centered text boxes inside a smaller
  safe margin, or left-align, and check rendered frames (not just the no-phone
  layout) before finalizing.
- **`xfade` duration values need a leading `0`** (e.g. `0.5`, not `.5`) or ffmpeg
  fails to parse them.
- **Screenshot crop ≠ preview.** Full-page phone captures (860×1864) placed in a
  shorter display window with `object-fit:cover` crop vertically — verify the phone
  frame in the stitched scene, not the raw capture.