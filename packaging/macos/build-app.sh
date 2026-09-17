#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT="$ROOT/dist/macos"
ARCH="$(uname -m)"
BUN_REQUIRED_VERSION="1.3.13"
CHECK_BUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      OUTPUT="$2"
      shift 2
      ;;
    --arch)
      ARCH="$2"
      shift 2
      ;;
    --check-bun)
      CHECK_BUN=1
      shift
      ;;
    --help|-h)
      printf 'Usage: %s [--output DIR] [--arch arm64|x86_64]\n' "$0"
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

if [[ -n "${BUN_BIN:-}" ]]; then
  if [[ ! -x "$BUN_BIN" ]]; then
    printf 'BUN_BIN is not an executable file: %s\n' "$BUN_BIN" >&2
    exit 1
  fi
else
  BUN_BIN="$(command -v bun || true)"
  if [[ -z "$BUN_BIN" ]]; then
    printf 'Bun %s is required; install it or set BUN_BIN to the pinned executable.\n' "$BUN_REQUIRED_VERSION" >&2
    exit 1
  fi
fi
BUN_VERSION="$($BUN_BIN --version 2>/dev/null || true)"
if [[ "$BUN_VERSION" != "$BUN_REQUIRED_VERSION" ]]; then
  printf 'Release build requires Bun %s, but %s reports %s. Set BUN_BIN to the pinned executable.\n' \
    "$BUN_REQUIRED_VERSION" "$BUN_BIN" "${BUN_VERSION:-unavailable}" >&2
  exit 1
fi
if [[ "$CHECK_BUN" == 1 ]]; then
  printf 'Using Bun: %s (version %s)\n' "$BUN_BIN" "$BUN_VERSION"
  exit 0
fi

case "$OUTPUT" in
  /*) ;;
  *) OUTPUT="$(pwd)/$OUTPUT" ;;
esac

case "$ARCH" in
  arm64)
    BUN_TARGET="bun-darwin-arm64"
    SWIFT_TARGET="arm64-apple-macosx13.0"
    ;;
  x86_64|x64)
    ARCH="x86_64"
    BUN_TARGET="bun-darwin-x64"
    SWIFT_TARGET="x86_64-apple-macosx13.0"
    ;;
  *)
    printf 'Unsupported architecture: %s\n' "$ARCH" >&2
    exit 2
    ;;
esac

for command in swiftc codesign; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$command" >&2
    exit 1
  fi
done

APP="$OUTPUT/Mansion Karaoke.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"

rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES"
cp "$ROOT/packaging/macos/Info.plist" "$CONTENTS/Info.plist"

cd "$ROOT"
swift "$ROOT/packaging/macos/generate-icon.swift"
iconutil --convert icns --output "$RESOURCES/AppIcon.icns" "$ROOT/packaging/macos/AppIcon.iconset"
"$BUN_BIN" run firefox:build
"$BUN_BIN" run firefox:verify
cp -R "$ROOT/players/firefox-extension/dist" "$RESOURCES/firefox-extension"

"$BUN_BIN" build \
  --compile \
  --target="$BUN_TARGET" \
  "$ROOT/apps/control-plane/src/compiled-server.ts" \
  --outfile "$RESOURCES/mansion-controller"

swiftc \
  -O \
  -target "$SWIFT_TARGET" \
  -framework AppKit \
  -framework Foundation \
  -framework Security \
  "$ROOT/packaging/macos/Launcher.swift" \
  -o "$MACOS/Mansion Karaoke"

chmod 755 "$MACOS/Mansion Karaoke" "$RESOURCES/mansion-controller"
codesign --force --deep --sign - "$APP"

printf 'Built %s (%s)\n' "$APP" "$ARCH"
