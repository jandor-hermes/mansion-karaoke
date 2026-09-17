#!/usr/bin/env bash
set -euo pipefail

if [[ -d "$HOME/.bun/bin" ]]; then
  export PATH="$HOME/.bun/bin:$PATH"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN_VERSION="1.3.13"
STATE_DIR="$ROOT/.karaoke"
TOKEN_FILE="$STATE_DIR/party-token"
SERVER="$ROOT/apps/control-plane/dist/apps/control-plane/src/server.js"
EXTENSION_MANIFEST="$ROOT/players/firefox-extension/dist/manifest.json"

usage() {
  cat <<'EOF'
Usage: ./scripts/karaoke-dev.sh <command>

Commands:
  prepare  Install dependencies and build the controller and Firefox extension
  start    Start an already-built controller
  run      Prepare, then start (default)
  doctor   Show the Bun and Node executables the launcher will use
  --help   Show this help

Firefox temporary add-on:
  about:debugging -> This Firefox -> Load Temporary Add-on
  Select players/firefox-extension/dist/manifest.json
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

doctor() {
  require_command bun
  require_command node
  printf 'Bun: %s\n' "$(command -v bun)"
  printf 'Node: %s\n' "$(command -v node)"
}

prepare() {
  require_command bun
  require_command node
  cd "$ROOT"
  actual_bun="$(bun --version)"
  if [[ "$actual_bun" != "$BUN_VERSION" ]]; then
    printf 'Bun %s is required (found %s).\n' "$BUN_VERSION" "$actual_bun" >&2
    exit 1
  fi
  bun install --no-save
  bun install --cwd players/firefox-extension --no-save
  bun run firefox:build
  bun run firefox:verify
  node apps/control-plane/scripts/build.mjs
  printf '\nBuild complete. Firefox manifest:\n  %s\n' "$EXTENSION_MANIFEST"
}

party_token() {
  if [[ -n "${KARAOKE_TOKEN:-}" ]]; then
    printf '%s' "$KARAOKE_TOKEN"
    return
  fi

  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  if [[ ! -s "$TOKEN_FILE" ]]; then
    require_command openssl
    openssl rand -hex 24 > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
  fi
  tr -d '\r\n' < "$TOKEN_FILE"
}

start() {
  require_command node
  if [[ ! -f "$SERVER" || ! -f "$EXTENSION_MANIFEST" ]]; then
    printf 'Build artifacts are missing. Run ./scripts/karaoke-dev.sh prepare first.\n' >&2
    exit 1
  fi

  local token port
  token="$(party_token)"
  port="${PORT:-3010}"
  printf '\nKaraoke controller\n'
  printf '  Controller URL: http://127.0.0.1:%s\n' "$port"
  printf '  Party token:    %s\n' "$token"
  printf '  Firefox add-on: %s\n' "$EXTENSION_MANIFEST"
  printf '\nKeep this window open. Press Control-C to stop.\n\n'

  cd "$ROOT"
  KARAOKE_TOKEN="$token" \
    KARAOKE_ROOM_ID="${KARAOKE_ROOM_ID:-local}" \
    node "$SERVER"
}

command="${1:-run}"
case "$command" in
  prepare)
    prepare
    ;;
  start)
    start
    ;;
  run)
    prepare
    start
    ;;
  doctor)
    doctor
    ;;
  --help|-h|help)
    usage
    ;;
  *)
    printf 'Unknown command: %s\nRun ./scripts/karaoke-dev.sh --help for usage.\n' "$command" >&2
    exit 2
    ;;
esac
