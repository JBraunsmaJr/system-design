#!/bin/sh
set -e

# Priority for relay / signaling URL:
# 1. RELAY (Primary container env var)
# 2. RELAY_URL
# 3. SIGNALING_URL
# 4. VITE_SIGNALING_URL (Build-time fallback)
SIGNALING_URL="${RELAY:-${RELAY_URL:-${SIGNALING_URL:-${VITE_SIGNALING_URL:-${VITE_RELAY_URL:-${VITE_RELAY:-}}}}}}"
# Priority for base application URL:
# 1. APP_URL (Primary container env var)
# 2. BASE_URL
# 3. VITE_APP_URL (Build-time fallback)
APP_URL="${APP_URL:-${BASE_URL:-${VITE_APP_URL:-${VITE_BASE_URL:-}}}}"
ICE_SERVERS="${ICE_SERVERS:-${VITE_ICE_SERVERS:-}}"
if [ -n "$TURN_USERNAME" ]; then
  ICE_SERVERS="$(printf '%s' "$ICE_SERVERS" | sed "s|\\\${TURN_USERNAME}|$TURN_USERNAME|g; s|\\\$TURN_USERNAME|$TURN_USERNAME|g")"
fi
if [ -n "$TURN_PASSWORD" ]; then
  ICE_SERVERS="$(printf '%s' "$ICE_SERVERS" | sed "s|\\\${TURN_PASSWORD}|$TURN_PASSWORD|g; s|\\\$TURN_PASSWORD|$TURN_PASSWORD|g")"
fi
# Where the store is, if this deployment has one. Empty means no workspace:
# the editor behaves exactly as it does with no store at all.
STORE_URL="${STORE_URL:-${VITE_STORE_URL:-}}"
# Where the documentation is, for the editor's Documentation button. Empty
# means beside the editor, which is where 45-docs-base.sh puts it unless
# DOCS_BASE says otherwise - so DOCS_BASE feeds this too.
DOCS_URL="${DOCS_URL:-${DOCS_BASE:-}}"

# Escape backslashes and double quotes for valid JavaScript string literal,
# stripping carriage returns (e.g. from Windows CRLF env files or host environments)
# and rejecting unescaped line feeds.
escape_js() {
  CLEANED="$(printf '%s' "$1" | tr -d '\r')"
  LF="$(printf '\nx')"
  LF="${LF%x}"
  case "$CLEANED" in
    *"$LF"*)
      echo "Error: line-feed characters are not allowed in configuration values" >&2
      exit 1
      ;;
  esac
  printf '%s' "$CLEANED" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

ESC_SIGNALING="$(escape_js "$SIGNALING_URL")"
ESC_APP_URL="$(escape_js "$APP_URL")"
ESC_ICE="$(escape_js "$ICE_SERVERS")"
ESC_STORE="$(escape_js "$STORE_URL")"
ESC_DOCS="$(escape_js "$DOCS_URL")"

TARGET_FILE="${TARGET_FILE:-/usr/share/nginx/html/env-config.js}"

cat <<EOF > "$TARGET_FILE"
// Runtime environment configuration generated on container startup
window.__APP_CONFIG__ = {
  SIGNALING_URL: "$ESC_SIGNALING",
  RELAY_URL: "$ESC_SIGNALING",
  RELAY: "$ESC_SIGNALING",
  APP_URL: "$ESC_APP_URL",
  BASE_URL: "$ESC_APP_URL",
  ICE_SERVERS: "$ESC_ICE",
  STORE_URL: "$ESC_STORE",
  DOCS_URL: "$ESC_DOCS"
};
EOF

chmod 644 "$TARGET_FILE" 2>/dev/null || true
