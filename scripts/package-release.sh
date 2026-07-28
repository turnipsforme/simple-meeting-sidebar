#!/bin/bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_ROOT="$PLUGIN_ROOT/release/wrens-calendar-meetings"
VERSION="$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$PLUGIN_ROOT/manifest.json" | head -n 1)"
RELEASE_ARCHIVE="$PLUGIN_ROOT/release/calendar-meetings-$VERSION.zip"

mkdir -p "$RELEASE_ROOT/bin"
cp -f "$PLUGIN_ROOT/main.js" "$RELEASE_ROOT/main.js"
cp -f "$PLUGIN_ROOT/manifest.json" "$RELEASE_ROOT/manifest.json"
cp -f "$PLUGIN_ROOT/styles.css" "$RELEASE_ROOT/styles.css"
cp -f "$PLUGIN_ROOT/bin/calendar-helper" "$RELEASE_ROOT/bin/calendar-helper"
chmod 755 "$RELEASE_ROOT/bin/calendar-helper"

rm -f "$RELEASE_ARCHIVE"
(
  cd "$PLUGIN_ROOT/release"
  COPYFILE_DISABLE=1 zip -q -r -X "$(basename "$RELEASE_ARCHIVE")" "$(basename "$RELEASE_ROOT")"
)

echo "Packaged install-ready plugin at $RELEASE_ROOT"
echo "Created GitHub release archive at $RELEASE_ARCHIVE"
