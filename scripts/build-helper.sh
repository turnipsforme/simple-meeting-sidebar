#!/bin/bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_PATH="$PLUGIN_ROOT/helper/CalendarHelper.swift"
PLIST_PATH="$PLUGIN_ROOT/helper/Info.plist"
OUTPUT_DIRECTORY="$PLUGIN_ROOT/bin"
OUTPUT_PATH="$OUTPUT_DIRECTORY/calendar-helper"
BUILD_DIRECTORY="$(mktemp -d)"

cleanup() {
  rm -rf "$BUILD_DIRECTORY"
}
trap cleanup EXIT

mkdir -p "$OUTPUT_DIRECTORY"
SWIFTC="$(command -v swiftc)"
LIPO="$(command -v lipo)"

compile_architecture() {
  local architecture="$1"
  local architecture_output="$BUILD_DIRECTORY/calendar-helper-$architecture"
  local module_cache="$BUILD_DIRECTORY/module-cache-$architecture"
  mkdir -p "$module_cache"
  env \
    CLANG_MODULE_CACHE_PATH="$module_cache" \
    SWIFT_MODULECACHE_PATH="$module_cache" \
    "$SWIFTC" \
    -parse-as-library \
    -O \
    -target "$architecture-apple-macosx12.0" \
    -framework EventKit \
    -framework Foundation \
    "$SOURCE_PATH" \
    -Xlinker -sectcreate \
    -Xlinker __TEXT \
    -Xlinker __info_plist \
    -Xlinker "$PLIST_PATH" \
    -o "$architecture_output"
}

compile_architecture arm64
compile_architecture x86_64
"$LIPO" -create \
  "$BUILD_DIRECTORY/calendar-helper-arm64" \
  "$BUILD_DIRECTORY/calendar-helper-x86_64" \
  -output "$OUTPUT_PATH"

codesign --force --sign - \
  --identifier com.turnipsforme.simple-meeting-sidebar.helper \
  "$OUTPUT_PATH"
chmod 755 "$OUTPUT_PATH"

echo "Built universal Simple Meeting Sidebar helper at $OUTPUT_PATH"
