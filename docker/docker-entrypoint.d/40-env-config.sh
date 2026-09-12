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

# Escape backslashes and double quotes for valid JavaScript string literal
escape_js() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

ESC_SIGNALING="$(escape_js "$SIGNALING_URL")"
ESC_APP_URL="$(escape_js "$APP_URL")"
ESC_ICE="$(escape_js "$ICE_SERVERS")"

TARGET_FILE="/usr/share/nginx/html/env-config.js"

cat <<EOF > "$TARGET_FILE"
// Runtime environment configuration generated on container startup
window.__APP_CONFIG__ = {
  SIGNALING_URL: "$ESC_SIGNALING",
  RELAY_URL: "$ESC_SIGNALING",
  RELAY: "$ESC_SIGNALING",
  APP_URL: "$ESC_APP_URL",
  BASE_URL: "$ESC_APP_URL",
  ICE_SERVERS: "$ESC_ICE"
};
EOF

chmod 644 "$TARGET_FILE" 2>/dev/null || true
