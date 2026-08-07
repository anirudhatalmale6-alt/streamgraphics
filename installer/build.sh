#!/usr/bin/env bash
# Build the StreamGraphics Pro Windows installer (StreamGraphicsProSetup.exe).
# Works on Linux/macOS with `makensis` (NSIS) installed. Bundles the Windows Node runtime.
#
#   cd installer && ./build.sh
#
# Output: installer/build/StreamGraphicsProSetup.exe
set -euo pipefail

NODE_VER="v20.18.1"                       # Node runtime bundled with the app (app needs >= 16)
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"            # repo root (the app)
STAGE="$HERE/build/app"
ENGINE="$STAGE/sgpro-engine.exe"          # the Node runtime, uniquely renamed

echo ">> staging app files into $STAGE"
rm -rf "$HERE/build" && mkdir -p "$STAGE/assets" "$STAGE/data"
# End-user files ONLY. Never ship the private signing key, make-license.js, or vendor docs.
cp "$ROOT/server.js" "$ROOT/package.json" "$ROOT/LICENSE.txt" "$STAGE/"
cp -r "$ROOT/public" "$STAGE/public"
cp "$ROOT/assets/streamgraphics.ico" "$ROOT/assets/streamgraphics.png" "$STAGE/assets/"
cp "$HERE/launchers/StreamGraphics Pro.vbs" "$STAGE/"
cp "$HERE/launchers/StreamGraphics Pro (troubleshoot).bat" "$STAGE/"
cp "$HERE/README.txt" "$STAGE/"

echo ">> fetching Node runtime $NODE_VER (win-x64)"
if [ ! -f "$HERE/node-$NODE_VER.exe" ]; then
  curl -fsSL -o "$HERE/node-$NODE_VER.exe" "https://nodejs.org/dist/$NODE_VER/win-x64/node.exe"
fi
cp "$HERE/node-$NODE_VER.exe" "$ENGINE"

echo ">> guard: verify no secrets staged"
if grep -rlq "PRIVATE KEY" "$STAGE" 2>/dev/null || find "$STAGE" -name '*private*' -o -name 'make-license*' | grep -q .; then
  echo "!! ABORT: sensitive file found in stage"; exit 1
fi

echo ">> compiling installer with makensis"
makensis "$HERE/installer.nsi"

echo ">> DONE: $HERE/build/StreamGraphicsProSetup.exe"
ls -la "$HERE/build/StreamGraphicsProSetup.exe"
