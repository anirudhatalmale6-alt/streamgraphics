#!/usr/bin/env bash
# Build the StreamGraphics Pro macOS app.
#
#   cd installer && ./build-mac.sh            # Apple Silicon (default)
#   cd installer && ./build-mac.sh x64        # Intel Macs
#   cd installer && ./build-mac.sh both
#
# Output: installer/build-mac/StreamGraphics-Pro-<version>-<arch>.zip
#
# 🚨 THIS BUILD PRODUCES AN UNSIGNED APP. That is not an oversight — signing and notarising
# require an Apple Developer ID and have to run on a Mac, and the signing identity must never
# come to this machine. The commands to finish the job are printed at the end and written into
# build-mac/SIGN-AND-NOTARISE.txt. Handing a customer the unsigned zip means "Apple could not
# verify this app is free of malware", which on Apple Silicon is a wall, not a warning.
set -euo pipefail

NODE_VER="v20.18.1"                       # must match build.sh — one runtime version, both platforms
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OUT="$HERE/build-mac"
VER="$(node -p "require('$ROOT/package.json').version")"
BUNDLE_ID="com.manhattanbeachstudios.streamgraphicspro"

. "$HERE/stage-app.sh"

ARCHS="${1:-arm64}"
[ "$ARCHS" = "both" ] && ARCHS="arm64 x64"

rm -rf "$OUT" && mkdir -p "$OUT"

for ARCH in $ARCHS; do
  case "$ARCH" in
    arm64) NODE_DIR="node-$NODE_VER-darwin-arm64"; MIN_OS="11.0";   HUMAN="Apple Silicon" ;;
    x64)   NODE_DIR="node-$NODE_VER-darwin-x64";   MIN_OS="10.15";  HUMAN="Intel" ;;
    *) echo "!! unknown arch '$ARCH' (use arm64, x64 or both)"; exit 1 ;;
  esac

  APP="$OUT/$ARCH/StreamGraphics Pro.app"
  RES="$APP/Contents/Resources"
  STAGE="$RES/app"
  echo ""
  echo ">> ===== building for $HUMAN ($ARCH) ====="
  echo ">> staging app files"
  mkdir -p "$APP/Contents/MacOS" "$RES"
  stage_app "$ROOT" "$STAGE"
  cp "$HERE/README.txt" "$STAGE/"

  echo ">> fetching the macOS Node runtime $NODE_VER ($ARCH)"
  TARBALL="$HERE/$NODE_DIR.tar.gz"
  if [ ! -f "$TARBALL" ]; then
    curl -fsSL -o "$TARBALL" "https://nodejs.org/dist/$NODE_VER/$NODE_DIR.tar.gz"
  fi
  # 🚨 Check the download against nodejs.org's own published SHA-256. A truncated or
  # proxy-mangled tarball extracts far enough to look fine and produces an app that crashes on
  # the customer's machine — after it has been signed and notarised.
  WANT="$(curl -fsSL "https://nodejs.org/dist/$NODE_VER/SHASUMS256.txt" | grep " $NODE_DIR.tar.gz\$" | cut -d' ' -f1)"
  GOT="$(sha256sum "$TARBALL" | cut -d' ' -f1)"
  if [ -z "$WANT" ] || [ "$WANT" != "$GOT" ]; then
    echo "!! ABORT: $NODE_DIR.tar.gz does not match nodejs.org's published checksum."
    echo "!!   published: ${WANT:-<could not fetch>}"
    echo "!!   downloaded: $GOT"
    rm -f "$TARBALL"; exit 1
  fi
  echo "   checksum matches nodejs.org"
  tar -xzf "$TARBALL" -C "$OUT" "$NODE_DIR/bin/node"
  # Named sgpro-engine so the macOS firewall prompt and Activity Monitor say something the
  # customer recognises, rather than a bare "node" asking to accept incoming connections.
  mv "$OUT/$NODE_DIR/bin/node" "$STAGE/sgpro-engine"
  rm -rf "$OUT/$NODE_DIR"
  chmod +x "$STAGE/sgpro-engine"

  # Prove it is the right architecture. A Mach-O for the wrong chip installs perfectly and then
  # refuses to launch with "Bad CPU type in executable" — and the arm64/x64 mix-up is one file
  # rename away at all times.
  MACHO="$(file -b "$STAGE/sgpro-engine")"
  case "$ARCH:$MACHO" in
    arm64:*arm64*) : ;;
    x64:*x86_64*)  : ;;
    *) echo "!! ABORT: sgpro-engine is not a $ARCH binary — file says: $MACHO"; exit 1 ;;
  esac
  echo "   engine is $MACHO"

  echo ">> the launcher"
  # macOS runs Contents/MacOS/<CFBundleExecutable>. A shell script is a perfectly valid bundle
  # executable, and exec'ing keeps ONE process — so the app's Dock icon, Cmd-Q and Force Quit all
  # act on the thing that is actually serving, instead of a shell that has already exited.
  cat > "$APP/Contents/MacOS/StreamGraphics Pro" <<'LAUNCHER'
#!/bin/sh
# StreamGraphics Pro — bundle launcher.
DIR="$(cd "$(dirname "$0")/../Resources/app" && pwd)"
cd "$DIR" || exit 1
exec "$DIR/sgpro-engine" "$DIR/server.js"
LAUNCHER
  chmod +x "$APP/Contents/MacOS/StreamGraphics Pro"

  echo ">> the icon"
  python3 "$HERE/mac/make-icns.py" "$ROOT/assets/streamgraphics.png" "$RES/streamgraphics.icns"

  echo ">> Info.plist"
  cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>                <string>StreamGraphics Pro</string>
  <key>CFBundleDisplayName</key>         <string>StreamGraphics Pro</string>
  <key>CFBundleIdentifier</key>          <string>$BUNDLE_ID</string>
  <key>CFBundleExecutable</key>          <string>StreamGraphics Pro</string>
  <key>CFBundleIconFile</key>            <string>streamgraphics</string>
  <key>CFBundlePackageType</key>         <string>APPL</string>
  <key>CFBundleShortVersionString</key>  <string>$VER</string>
  <key>CFBundleVersion</key>             <string>$VER</string>
  <key>LSMinimumSystemVersion</key>      <string>$MIN_OS</string>
  <key>NSHighResolutionCapable</key>     <true/>
  <key>NSHumanReadableCopyright</key>    <string>Manhattan Beach Studios LLC</string>
  <!-- The app serves its own control panels over the LAN so a Stream Deck, a phone or a second
       machine can reach them. Recent macOS asks the user before a local network connection is
       allowed, and the prompt shows this sentence — a prompt with no explanation is a prompt
       people decline. -->
  <key>NSLocalNetworkUsageDescription</key>
  <string>StreamGraphics Pro serves its control panels and graphics outputs to other devices on your network, such as a Stream Deck, a phone used as a remote, or a second computer running OBS.</string>
</dict>
</plist>
PLIST
  # 🚨 Not `plutil -lint`: the plutil on this machine is GNUstep's, which does not have -lint and
  # exits non-zero on everything, so the check would either always abort or, if waved through,
  # never check anything. plistlib is a real parser — and while it is open, confirm the keys
  # actually landed. A plist that parses but names an executable that is not there gives macOS's
  # "The application can't be opened", with nothing anywhere saying why.
  python3 - "$APP/Contents/Info.plist" "$VER" <<'PLCHECK' || exit 1
import plistlib, sys
path, want_ver = sys.argv[1], sys.argv[2]
try:
    with open(path, "rb") as f: pl = plistlib.load(f)
except Exception as e:
    print(f"!! ABORT: Info.plist does not parse: {e}"); sys.exit(1)
need = {"CFBundleName", "CFBundleIdentifier", "CFBundleExecutable", "CFBundleIconFile",
        "CFBundleShortVersionString", "CFBundleVersion", "LSMinimumSystemVersion",
        "NSLocalNetworkUsageDescription"}
missing = need - set(pl)
if missing:
    print("!! ABORT: Info.plist is missing " + ", ".join(sorted(missing))); sys.exit(1)
if pl["CFBundleShortVersionString"] != want_ver or pl["CFBundleVersion"] != want_ver:
    print(f"!! ABORT: Info.plist says {pl['CFBundleShortVersionString']}/{pl['CFBundleVersion']}, "
          f"package.json says {want_ver}"); sys.exit(1)
print(f"   Info.plist parses, names '{pl['CFBundleExecutable']}', version {pl['CFBundleVersion']}")
PLCHECK
  # The executable and icon the plist names must exist, with the exact name and the exec bit.
  EXEC_NAME="$(python3 -c "import plistlib,sys;print(plistlib.load(open(sys.argv[1],'rb'))['CFBundleExecutable'])" "$APP/Contents/Info.plist")"
  [ -x "$APP/Contents/MacOS/$EXEC_NAME" ] || { echo "!! ABORT: Contents/MacOS/$EXEC_NAME is missing or not executable"; exit 1; }
  [ -s "$RES/streamgraphics.icns" ] || { echo "!! ABORT: the icon is missing"; exit 1; }
  echo "   bundle executable and icon are present"

  echo ">> guards: no secrets, no stray control bytes"
  guard_stage "$STAGE" || exit 1
  echo "   stage is clean"

  echo ">> smoke test: does the staged app actually start?"
  smoke_test "$STAGE" "sgpro-engine" || exit 1
  echo "   staged app starts and serves every module's pages"

  echo ">> zipping"
  ZIP="$OUT/StreamGraphics-Pro-$VER-$ARCH.zip"
  ( cd "$OUT/$ARCH" && zip -qry "$ZIP" "StreamGraphics Pro.app" )
  echo "   $ZIP"
done

# ---------------------------------------------------------------------------------------------
# The instructions live in the repo (installer/mac/) rather than in a heredoc here, so they can
# be read on GitHub without downloading a build, and so there is one copy to correct.
cp "$HERE/mac/SIGN-AND-NOTARISE.txt" "$OUT/SIGN-AND-NOTARISE.txt"

cp "$HERE/mac/entitlements.plist" "$OUT/entitlements.plist"

echo ""
echo ">> DONE"
ls -la "$OUT"/*.zip
echo ""
echo "   🚨 These zips are UNSIGNED. Read $OUT/SIGN-AND-NOTARISE.txt before"
echo "      sending either of them to a customer."
