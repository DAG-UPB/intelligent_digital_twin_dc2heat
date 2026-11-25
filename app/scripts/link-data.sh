#!/usr/bin/env bash
# Links app/data_versions to YOUR data folder on this computer (the same as "Set data folder…" in the app).
#
# The app only ever reads the relative path app/data_versions (backend/config.py); this git-ignored symlink points
# it at a folder that holds version_1, version_2, ..., each laid out like app/data. Everyone picks their own folder,
# nothing personal is committed, and without a link the app shows the examples (app/data).
#
#   bash scripts/link-data.sh /path/to/your/data_folder
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINK="$APP_DIR/data_versions"
TARGET="${1:-}"

if [ -z "$TARGET" ]; then
  echo "Usage: bash scripts/link-data.sh /path/to/your/data_folder   (or use \"Set data folder…\" in the app)" >&2
  exit 1
fi
if [ ! -d "$TARGET" ]; then
  echo "No such directory: $TARGET" >&2
  exit 1
fi
if [ -e "$LINK" ] && [ ! -L "$LINK" ]; then
  echo "$LINK already exists and is not a symlink: move it aside first." >&2
  exit 1
fi

ln -sfn "$TARGET" "$LINK"
echo "Linked $LINK -> $TARGET"
echo "Versions: $(find "$LINK/" -mindepth 1 -maxdepth 1 -type d ! -name '.*' ! -name '_*' -exec basename {} \; | sort | tr '\n' ' ')"
echo "Restart the app, or reload it if it is running."
