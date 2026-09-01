#!/bin/sh

set -eu

if [ -n "${CI_PRIMARY_REPOSITORY_PATH:-}" ]; then
  if ! PROJECT_ROOT="$(CDPATH= cd -- "$CI_PRIMARY_REPOSITORY_PATH" && pwd)"; then
    echo "Embedded update registration failed: CI_PRIMARY_REPOSITORY_PATH is unavailable: $CI_PRIMARY_REPOSITORY_PATH" >&2
    exit 1
  fi
else
  SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)" || {
    echo "Embedded update registration failed: unable to resolve the Xcode Cloud script directory." >&2
    exit 1
  }
  PROJECT_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)" || {
    echo "Embedded update registration failed: unable to resolve the Expo project root." >&2
    exit 1
  }
fi

REGISTER_SCRIPT="$PROJECT_ROOT/scripts/ota-register-embedded/register-ios.sh"
if [ ! -f "$REGISTER_SCRIPT" ]; then
  echo "Embedded update registration failed: iOS registrar was not found at $REGISTER_SCRIPT." >&2
  exit 1
fi

export OTA_EMBEDDED_REGISTER_STRICT="${OTA_EMBEDDED_REGISTER_STRICT:-true}"
exec sh "$REGISTER_SCRIPT"
