#!/bin/sh

set -eu

if [ "${CONFIGURATION:-Release}" = "Debug" ]; then
  exit 0
fi

PROJECT_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)}"
MANIFEST_PATH=""

for candidate in \
  "${TARGET_BUILD_DIR:-}/${UNLOCALIZED_RESOURCES_FOLDER_PATH:-}/app.manifest" \
  "${CI_ARCHIVE_PATH:-}/Products/Applications/"*.app/app.manifest
do
  if [ -f "$candidate" ]; then
    MANIFEST_PATH="$candidate"
    break
  fi
done

if [ -z "$MANIFEST_PATH" ] && [ -n "${TARGET_BUILD_DIR:-}" ]; then
  MANIFEST_PATH="$(find "$TARGET_BUILD_DIR" -type f -name app.manifest 2>/dev/null | head -n 1 || true)"
fi

if [ -z "$MANIFEST_PATH" ]; then
  echo "Embedded update registration failed: iOS app.manifest was not found." >&2
  [ "${OTA_EMBEDDED_REGISTER_STRICT:-false}" = "true" ] && exit 1
  exit 0
fi

if ! node "$PROJECT_ROOT/scripts/ota-register-embedded/index.mjs" \
  --manifest "$MANIFEST_PATH" \
  --platform ios; then
  [ "${OTA_EMBEDDED_REGISTER_STRICT:-false}" = "true" ] && exit 1
fi
