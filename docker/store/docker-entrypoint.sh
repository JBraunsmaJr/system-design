#!/bin/sh
set -e

if [ "$1" = "generate-recovery-key" ]; then
  shift
  exec node --experimental-strip-types /app/scripts/generate-recovery-key.ts "$@"
elif [ "$1" = "recover-document" ]; then
  shift
  exec node --experimental-strip-types /app/scripts/recover-document.ts "$@"
fi

exec "$@"
