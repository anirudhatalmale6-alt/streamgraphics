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
# NOTE: this is a hand-written list, so every new server-side module has to be added here too.
# The smoke test below exists precisely because that is easy to forget — 1.0.17 nearly shipped
# without obs-grab.js/vmix-grab.js, which would have made the app fail to start at all.
cp "$ROOT/server.js" "$ROOT/package.json" "$ROOT/LICENSE.txt" "$STAGE/"
cp "$ROOT/obs-grab.js" "$ROOT/vmix-grab.js" "$STAGE/"
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
# Check for the actual sensitive FILES (not the string "PRIVATE KEY", which legitimately
# appears inside the bundled Node/OpenSSL runtime). Also scan TEXT files (never the .exe) for a
# real PEM private-key header, in case a key was ever pasted into source.
BAD_FILES="$(find "$STAGE" \( -name '.license-private-key*' -o -name 'make-license*' -o -name 'VENDOR*' -o -name '*.pem' \) -print)"
BAD_TEXT="$(grep -rIl --exclude='*.exe' -- '-----BEGIN .*PRIVATE KEY-----' "$STAGE" 2>/dev/null || true)"
if [ -n "$BAD_FILES" ] || [ -n "$BAD_TEXT" ]; then
  echo "!! ABORT: sensitive item in stage:"; [ -n "$BAD_FILES" ] && echo "$BAD_FILES"; [ -n "$BAD_TEXT" ] && echo "$BAD_TEXT"; exit 1
fi

echo ">> smoke test: does the staged app actually start?"
# The file list above is hand-written, so a new require() in server.js that nobody remembered to
# stage produces an installer that looks perfect and dies on launch with MODULE_NOT_FOUND — on the
# customer's machine, after they've paid. So: boot the staged copy and make it answer a real
# request before we wrap it up. Tested on a COPY so the stage keeps no data/ files the app writes
# on first run, and on a free port so it can never collide with anything already running.
SMOKE="$(mktemp -d)"
trap 'rm -rf "$SMOKE"' EXIT
cp -r "$STAGE" "$SMOKE/app"
rm -f "$SMOKE/app/sgpro-engine.exe"                 # a Windows binary; the test runs on this machine's node
SMOKE_PORT="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
SG_NO_OPEN=1 PORT="$SMOKE_PORT" node "$SMOKE/app/server.js" >"$SMOKE/out.log" 2>&1 &
SMOKE_PID=$!
SMOKE_OK=""
for _ in $(seq 1 40); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$SMOKE_PORT/" 2>/dev/null; then SMOKE_OK=1; break; fi
  kill -0 "$SMOKE_PID" 2>/dev/null || break        # it died — stop waiting, go read the log
  sleep 0.25
done
# Ask for one page from every module, not just the home page. A missing file under public/
# doesn't stop the server booting — it 404s at the moment the operator needs it, on their
# machine, mid-setup. This is the cheapest place to find that out.
if [ -n "$SMOKE_OK" ]; then
  for P in /control /output /scoreboard /scoreboard-output /baseball /baseball-output \
           /lowerthird /lowerthird-output /shows /program-output /scorer /links /control-api \
           /prompter /prompter-output /prompter.css /sg-prompter.js; do
    if ! curl -fsS -o /dev/null "http://127.0.0.1:$SMOKE_PORT$P" 2>/dev/null; then
      echo "!! ABORT: the staged app does not serve $P"; SMOKE_OK=""; break
    fi
  done
fi
kill "$SMOKE_PID" 2>/dev/null || true
wait "$SMOKE_PID" 2>/dev/null || true
if [ -z "$SMOKE_OK" ]; then
  echo "!! ABORT: the staged app did not start or is missing a page. Its output:"; sed 's/^/   | /' "$SMOKE/out.log"; exit 1
fi
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
