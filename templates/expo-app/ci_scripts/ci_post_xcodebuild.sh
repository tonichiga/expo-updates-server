#!/bin/sh

set -eu

export OTA_EMBEDDED_REGISTER_STRICT="${OTA_EMBEDDED_REGISTER_STRICT:-true}"
sh "${CI_PRIMARY_REPOSITORY_PATH}/ci_scripts/register-embedded-update.sh"
