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
rm -rf "$HERE/build" && mkdir -p "$STAGE"
# One shared list of end-user files, used by this build and by build-mac.sh (see stage-app.sh).
. "$HERE/stage-app.sh"
stage_app "$ROOT" "$STAGE"
cp "$HERE/launchers/StreamGraphics Pro.vbs" "$STAGE/"
cp "$HERE/launchers/StreamGraphics Pro (troubleshoot).bat" "$STAGE/"
cp "$HERE/README.txt" "$STAGE/"

echo ">> fetching Node runtime $NODE_VER (win-x64)"
if [ ! -f "$HERE/node-$NODE_VER.exe" ]; then
  curl -fsSL -o "$HERE/node-$NODE_VER.exe" "https://nodejs.org/dist/$NODE_VER/win-x64/node.exe"
fi
cp "$HERE/node-$NODE_VER.exe" "$ENGINE"

echo ">> naming the engine so Windows' firewall prompt says StreamGraphics Pro"
# 🚨 Renaming node.exe to sgpro-engine.exe changes the FILENAME and nothing else. Windows'
# "Do you want to allow this app through the firewall?" dialog reads the PE version resource,
# not the filename, so it kept announcing "Node.js JavaScript Runtime" wanting network access.
# The customer sees an unknown runtime asking for the network on first launch of a paid product.
# rcedit rewrites those fields in place. Wine because we build on Linux.
RCEDIT="$HERE/tools/rcedit-x64.exe"
if [ ! -f "$RCEDIT" ] || ! command -v wine >/dev/null 2>&1; then
  echo "!! ABORT: need $RCEDIT and wine to name the engine."
  echo "!! Without this the firewall prompt says 'Node.js' again. Fix the toolchain, do not skip."
  exit 1
fi
WINEDEBUG=-all wine "$RCEDIT" "$ENGINE" \
  --set-version-string "FileDescription" "StreamGraphics Pro" \
  --set-version-string "ProductName"     "StreamGraphics Pro" \
  --set-version-string "CompanyName"     "Manhattan Beach Studios LLC" \
  --set-version-string "OriginalFilename" "sgpro-engine.exe" >/dev/null 2>&1

# Prove it took. A silent no-op here reintroduces the exact bug this step exists to fix.
if strings -el "$ENGINE" | grep -q "Node.js JavaScript Runtime"; then
  echo "!! ABORT: the engine still identifies itself as Node.js — rcedit did not apply."; exit 1
fi
if ! strings -el "$ENGINE" | grep -q "StreamGraphics Pro"; then
  echo "!! ABORT: the engine does not carry the StreamGraphics Pro name."; exit 1
fi
echo "   engine now identifies as StreamGraphics Pro"

echo ">> guards: no secrets, no stray control bytes"
guard_stage "$STAGE" || exit 1
echo "   stage is clean"

echo ">> smoke test: does the staged app actually start?"
smoke_test "$STAGE" "sgpro-engine.exe" || exit 1
echo "   staged app starts and serves every module's pages"

echo ">> the .exe launcher (so the app can be pinned to the taskbar)"
# Prefer a signed copy if we have one. The launcher is the file the customer actually clicks
# every day, so it needs a signature of its own — the installer's signature does not carry
# over to the files it extracts. Signing it once is enough: the stub has a fixed version and
# does not change between releases, so the same signed binary is reused every time.
SIGNED="$HERE/launcher-signed/StreamGraphics Pro.exe"
if [ -f "$SIGNED" ]; then
  echo "   using the signed launcher"
  cp "$SIGNED" "$STAGE/"
else
  echo "   !! no signed launcher - compiling an UNSIGNED one"
  echo "   !! customers will get a SmartScreen warning on this file. See BUILD.md."
  makensis "$HERE/launcher.nsi"
  cp "$HERE/build/StreamGraphics Pro.exe" "$STAGE/"
fi

echo ">> compiling installer with makensis"
# Feed the REAL version in from package.json. It used to be hardcoded in installer.nsi and was
# never bumped, so every installer since 1.0.4 reported "1.0.4" in its Properties - which makes
# two downloads sitting in the same folder impossible to tell apart, exactly when you most need
# to know which one you just signed.
VER="$(node -p "require('$ROOT/package.json').version")"
echo "   version $VER"
makensis "-DVERSION=$VER" "-DVERPE=$VER.0" "$HERE/installer.nsi"

echo ">> DONE: $HERE/build/StreamGraphicsProSetup.exe"
ls -la "$HERE/build/StreamGraphicsProSetup.exe"
