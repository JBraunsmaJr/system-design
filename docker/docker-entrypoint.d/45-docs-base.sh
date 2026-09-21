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

# Where the documentation links back to: the editor. APP_URL if the
# deployment named it; otherwise the docs' own parent when they sit at the
# usual docs/ beside the editor; otherwise the domain root.
APP_PLACEHOLDER="https://__APP_URL__/"
if [ -n "${APP_URL:-${BASE_URL:-}}" ]; then
  EDITOR_URL="${APP_URL:-${BASE_URL:-}}"
  case "$EDITOR_URL" in
    */) : ;;
    *) EDITOR_URL="$EDITOR_URL/" ;;
  esac
else
  case "$DOCS_BASE" in
    */docs/) EDITOR_URL="${DOCS_BASE%docs/}" ;;
    *) EDITOR_URL="/" ;;
  esac
fi

echo "Serving documentation at $DOCS_BASE, linking back to the editor at $EDITOR_URL"

# Every file the placeholder can appear in: markup, the client bundle,
# and stylesheets that reference fonts.
find "$DOCS_ROOT" -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' -o -name '*.json' \) \
  -exec sed -i -e "s|$PLACEHOLDER|$DOCS_BASE|g" -e "s|$APP_PLACEHOLDER|$EDITOR_URL|g" {} +
