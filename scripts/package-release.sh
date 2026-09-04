#!/bin/bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_ROOT="$PLUGIN_ROOT/release/simple-meeting-sidebar"
VERSION="$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$PLUGIN_ROOT/manifest.json" | head -n 1)"

mkdir -p "$RELEASE_ROOT/bin"
cp -f "$PLUGIN_ROOT/main.js" "$RELEASE_ROOT/main.js"
cp -f "$PLUGIN_ROOT/manifest.json" "$RELEASE_ROOT/manifest.json"
cp -f "$PLUGIN_ROOT/styles.css" "$RELEASE_ROOT/styles.css"
cp -f "$PLUGIN_ROOT/runtime/calendar-helper" "$RELEASE_ROOT/bin/calendar-helper"
chmod 755 "$RELEASE_ROOT/bin/calendar-helper"

echo "Packaged install-ready plugin at $RELEASE_ROOT"
echo "Release assets: main.js manifest.json styles.css (plus bin/calendar-helper) from $RELEASE_ROOT"
