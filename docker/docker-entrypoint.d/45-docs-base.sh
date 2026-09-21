#!/bin/sh
set -e

# The documentation site's base path, applied at container start.
#
# VitePress writes the base into every asset URL and into the client
# router's own configuration, so it cannot be relative the way the app's
# build is. Baking it at build time made one image work at exactly one
# path, and got it wrong in a way that is hard to read: the page loads,
# then the router rewrites the address bar to wherever the build thought
# it lived. So the image is built with a placeholder and it is replaced
# here, which means the same image serves docs at any path.
#
# Priority:
# 1. DOCS_BASE (primary)
# 2. Derived from APP_URL's path, so an app behind a prefix gets docs
#    under that same prefix without being told twice
# 3. /docs/
PLACEHOLDER="/__DOCS_BASE__/"
DOCS_ROOT="${DOCS_ROOT:-/usr/share/nginx/html/docs}"

if [ ! -d "$DOCS_ROOT" ]; then
  exit 0
fi

if [ -z "${DOCS_BASE:-}" ]; then
  APP_URL_VALUE="${APP_URL:-${BASE_URL:-}}"
  if [ -n "$APP_URL_VALUE" ]; then
    # Path portion only: https://example.gov/system-design/ -> /system-design/
    APP_PATH=$(printf '%s' "$APP_URL_VALUE" | sed -e 's|^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]*||')
    case "$APP_PATH" in
      */) : ;;
      *) APP_PATH="$APP_PATH/" ;;
    esac
    [ "$APP_PATH" = "/" ] && APP_PATH=""
    DOCS_BASE="${APP_PATH}docs/"
  else
    DOCS_BASE="/docs/"
  fi
fi

# Always absolute, always with a trailing slash: VitePress joins this
# directly onto asset names, and a missing slash produces /docsassets/...
case "$DOCS_BASE" in
  /*) : ;;
  *) DOCS_BASE="/$DOCS_BASE" ;;
esac
case "$DOCS_BASE" in
  */) : ;;
  *) DOCS_BASE="$DOCS_BASE/" ;;
esac

echo "Serving documentation at $DOCS_BASE"

# Every file the placeholder can appear in: markup, the client bundle,
# and stylesheets that reference fonts.
find "$DOCS_ROOT" -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' -o -name '*.json' \) \
  -exec sed -i "s|$PLACEHOLDER|$DOCS_BASE|g" {} +
