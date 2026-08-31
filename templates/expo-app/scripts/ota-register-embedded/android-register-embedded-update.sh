#!/bin/sh

set -eu

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
MANIFEST_PATH="$(find "$PROJECT_ROOT/android/app/build" -type f -name app.manifest 2>/dev/null | head -n 1 || true)"

if [ -z "$MANIFEST_PATH" ]; then
  echo "Embedded update registration failed: Android app.manifest was not found." >&2
  [ "${OTA_EMBEDDED_REGISTER_STRICT:-false}" = "true" ] && exit 1
  exit 0
fi

if ! node "$PROJECT_ROOT/scripts/ota-register-embedded/index.mjs" \
  --manifest "$MANIFEST_PATH" \
  --platform android; then
  [ "${OTA_EMBEDDED_REGISTER_STRICT:-false}" = "true" ] && exit 1
fi
