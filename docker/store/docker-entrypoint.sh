#!/bin/sh
set -e

# Runs the image's command. Kept as the entry point so a deployment's
# wrapper scripts, written when this dispatched to other tools, still work.
exec "$@"
