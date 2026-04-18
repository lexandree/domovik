#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_UUID="assistant-ptt@local"
SOURCE_DIR="${SCRIPT_DIR}/${EXTENSION_UUID}"
BUILD_ROOT="${SCRIPT_DIR}/.build"
TARGET_DIR="${HOME}/.local/share/gnome-shell/extensions/${EXTENSION_UUID}"
ZIP_PATH="${BUILD_ROOT}/${EXTENSION_UUID}.zip"

rm -rf "${BUILD_ROOT}"
mkdir -p "${BUILD_ROOT}"
cp -R "${SOURCE_DIR}" "${BUILD_ROOT}/${EXTENSION_UUID}"

(
  cd "${BUILD_ROOT}/${EXTENSION_UUID}"
  zip -qr "${ZIP_PATH}" .
)

gnome-extensions install --force "${ZIP_PATH}"
glib-compile-schemas "${TARGET_DIR}/schemas"
gnome-extensions enable "${EXTENSION_UUID}" || true

cat <<EOF
Installed GNOME extension:
  ${EXTENSION_UUID}

Target directory:
  ${TARGET_DIR}

If GNOME Shell does not show it immediately, log out and log back in once.
EOF
