#!/usr/bin/env bash
# Copy the END-USER app files into a staging folder. Sourced by both builds.
#
#   stage_app <destination>
#
# 🚨 This list used to live inside build.sh, and build-mac.sh would have needed its own copy.
# Two hand-written lists of the same files is the same bug build.sh's smoke test was written to
# catch, only worse: the Windows build would keep passing while the Mac build shipped without a
# module nobody remembered to add, and the failure would land on a customer's machine.
# One list. Both builds. Add new server-side modules HERE.
#
# NEVER add: the private signing key, make-license.js, setup-key.js, or the vendor docs.

stage_app() {
  local ROOT="$1" STAGE="$2"
  mkdir -p "$STAGE/assets" "$STAGE/data"
  cp "$ROOT/server.js" "$ROOT/package.json" "$ROOT/LICENSE.txt" "$STAGE/"
  cp "$ROOT/obs-grab.js" "$ROOT/vmix-grab.js" "$STAGE/"
  cp -r "$ROOT/public" "$STAGE/public"
  cp "$ROOT/assets/streamgraphics.ico" "$ROOT/assets/streamgraphics.png" "$STAGE/assets/"

  # 🚨 public/uploads, public/media and public/logos are the OPERATOR'S folders. On a dev machine
  # they hold whatever was dragged in while testing — and `cp -r public` shipped all of it. Every
  # installer built so far carried two of my test PNGs to every customer. Nothing sensitive that
  # time; the mechanism would have carried a client's photo out just as happily, and the README
  # files are the only thing in there that belongs in a download.
  local d
  for d in uploads media logos; do
    if [ -d "$STAGE/public/$d" ]; then
      find "$STAGE/public/$d" -mindepth 1 ! -name 'README.txt' -delete
    fi
  done
}

# Both builds run these. A failure here must stop the build, never warn and carry on.
guard_stage() {
  local STAGE="$1"

  # The actual sensitive FILES — not the string "PRIVATE KEY", which legitimately appears inside
  # the bundled Node/OpenSSL runtime. Text files are scanned for a real PEM header too, in case a
  # key was ever pasted into source.
  local BAD_FILES BAD_TEXT
  BAD_FILES="$(find "$STAGE" \( -name '.license-private-key*' -o -name 'make-license*' -o -name 'setup-key*' -o -name 'VENDOR*' -o -name '*.pem' \) -print)"
  BAD_TEXT="$(grep -rIl --exclude='*.exe' --exclude='sgpro-engine' -- '-----BEGIN .*PRIVATE KEY-----' "$STAGE" 2>/dev/null || true)"
  if [ -n "$BAD_FILES" ] || [ -n "$BAD_TEXT" ]; then
    echo "!! ABORT: sensitive item in stage:"; [ -n "$BAD_FILES" ] && echo "$BAD_FILES"; [ -n "$BAD_TEXT" ] && echo "$BAD_TEXT"; return 1
  fi

  # 🚨 A NUL byte got into public/prompter-remote.js and SHIPPED in 1.0.28. It ran fine, which is
  # what made it invisible: the only symptom was `file` calling the source "data" and grep quietly
  # refusing to match it. Corruption that survives because it happens to be harmless today is
  # exactly the kind that bites later, so fail the build on it.
  local BADBYTES
  BADBYTES="$(node -e '
const fs=require("fs"), path=require("path");
const exts=new Set([".js",".html",".css",".json",".txt",".md"]);
const bad=[];
(function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) {
  const f=path.join(d,e.name);
  if (e.isDirectory()) walk(f);
  else if (exts.has(path.extname(e.name).toLowerCase())) {
    const b=fs.readFileSync(f);
    for (const c of b) if (c<9 || (c>13 && c<32)) { bad.push(f); break; }
  }
} })(process.argv[1]);
process.stdout.write(bad.join("\n"));
' "$STAGE")"
  if [ -n "$BADBYTES" ]; then
    echo "!! ABORT: control bytes in staged text files:"; echo "$BADBYTES"; return 1
  fi

  # Nothing of the builder's own in the operator's folders. stage_app empties them; this is the
  # check that says so out loud, because "I emptied it" and "it is empty" are not the same claim.
  local STRAY d
  for d in uploads media logos; do
    STRAY="$(find "$STAGE/public/$d" -mindepth 1 ! -name 'README.txt' -print 2>/dev/null)"
    if [ -n "$STRAY" ]; then
      echo "!! ABORT: dev files staged in public/$d — these would ship to every customer:"
      echo "$STRAY"; return 1
    fi
  done
  return 0
}

# Boot the staged copy and make it answer a real request for every module's pages.
#
# The staging list above is hand-written, so a new require() in server.js that nobody remembered
# to stage produces a build that looks perfect and dies on launch with MODULE_NOT_FOUND — on the
# customer's machine, after they have paid. A missing file under public/ is worse still: the
# server starts fine and 404s at the moment the operator needs the page, mid-setup.
#
# Runs on a COPY so the stage keeps none of the files the app writes on first run, on a free port
# so it can never collide, and with the bundled engine removed because it is a binary for the
# target platform, not this one.
smoke_test() {
  local STAGE="$1" ENGINE_NAME="$2"
  local SMOKE; SMOKE="$(mktemp -d)"
  cp -r "$STAGE" "$SMOKE/app"
  rm -f "$SMOKE/app/$ENGINE_NAME"
  local PORT; PORT="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
  # 🚨 SG_DATA_DIR pins the writable folder into the throwaway dir. Without it a macOS-shaped
  # build under test would be writing into the real ~/Library on the build machine.
  SG_NO_OPEN=1 SG_NO_SEEN=1 SG_DATA_DIR="$SMOKE/data" PORT="$PORT" node "$SMOKE/app/server.js" >"$SMOKE/out.log" 2>&1 &
  local PID=$! OK=""
  local i
  for i in $(seq 1 40); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then OK=1; break; fi
    kill -0 "$PID" 2>/dev/null || break        # it died — stop waiting, go read the log
    sleep 0.25
  done
  if [ -n "$OK" ]; then
    local P
    for P in /control /output /scoreboard /scoreboard-output /baseball /baseball-output /game /game-output \
             /lowerthird /lowerthird-output /shows /program-output /scorer /links /control-api \
             /prompter /prompter-output /prompter-remote /prompter-remote.js \
             /prompter.css /sg-prompter.js /sg-key.js /sg-screens.js /sg-output.js /sg-img.js \
             /api/folders; do
      if ! curl -fsS -o /dev/null "http://127.0.0.1:$PORT$P" 2>/dev/null; then
        echo "!! ABORT: the staged app does not serve $P"; OK=""; break
      fi
    done
  fi
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  if [ -z "$OK" ]; then
    echo "!! ABORT: the staged app did not start or is missing a page. Its output:"
    sed 's/^/   | /' "$SMOKE/out.log"; rm -rf "$SMOKE"; return 1
  fi
  rm -rf "$SMOKE"
  return 0
}
