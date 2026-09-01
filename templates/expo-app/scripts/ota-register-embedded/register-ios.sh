#!/bin/sh

set -eu

if [ "${CONFIGURATION:-Release}" = "Debug" ]; then
  exit 0
fi

fail_registration() {
  echo "Embedded update registration failed: $1" >&2
  if [ "${OTA_EMBEDDED_REGISTER_STRICT:-false}" = "true" ]; then
    exit 1
  fi
  exit 0
}

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)" ||
  fail_registration "unable to resolve the registration script directory."
PROJECT_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)" ||
  fail_registration "unable to resolve the Expo project root."
REGISTRAR_PATH="$PROJECT_ROOT/scripts/ota-register-embedded/index.mjs"
MANIFEST_PATH=""

if [ ! -f "$REGISTRAR_PATH" ]; then
  fail_registration "registrar was not found at $REGISTRAR_PATH."
fi

if [ -n "${TARGET_BUILD_DIR:-}" ] &&
  [ -n "${UNLOCALIZED_RESOURCES_FOLDER_PATH:-}" ] &&
  [ -f "$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/app.manifest" ]; then
  MANIFEST_PATH="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/app.manifest"
fi

if [ -z "$MANIFEST_PATH" ] && [ -n "${CI_ARCHIVE_PATH:-}" ]; then
  for candidate in "$CI_ARCHIVE_PATH"/Products/Applications/*.app/app.manifest; do
    if [ -f "$candidate" ]; then
      MANIFEST_PATH="$candidate"
      break
    fi
  done
fi

if [ -z "$MANIFEST_PATH" ] && [ -n "${TARGET_BUILD_DIR:-}" ]; then
  MANIFEST_PATH="$(find "$TARGET_BUILD_DIR" -type f -name app.manifest 2>/dev/null | head -n 1 || true)"
fi

if [ -z "$MANIFEST_PATH" ]; then
  fail_registration "iOS app.manifest was not found."
fi

if ! node "$REGISTRAR_PATH" \
  --manifest "$MANIFEST_PATH" \
  --platform ios; then
  if [ "${OTA_EMBEDDED_REGISTER_STRICT:-false}" = "true" ]; then
    exit 1
  fi
fi
