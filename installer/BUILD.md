# Building StreamGraphics Pro (Windows installer and macOS app)

The installer bundles the Windows Node runtime so end users install nothing else. It installs
**per-user** (into `%LOCALAPPDATA%\StreamGraphics Pro`), so it needs **no admin rights**, and the
app's data folders (`data/`, `public/uploads`, `public/media`) stay fully writable.

## Prerequisites
- [NSIS](https://nsis.sourceforge.io/) (`makensis`). On Debian/Ubuntu: `sudo apt install nsis`.
- `curl` and `bash` (to fetch the Node runtime and stage files).

## Build
```
cd installer
./build.sh
```
Output: `installer/build/StreamGraphicsProSetup.exe`

`build.sh` stages only end-user files, downloads `node.exe`, renames it to `sgpro-engine.exe`
(a unique name so the uninstaller only ever stops *our* process, never other Node apps),
and compiles `installer.nsi`.

The staging list, the safety guards and the smoke test live in **`stage-app.sh`**, shared with
the Mac build. Add a new server-side module there and both platforms pick it up. Two separate
hand-written lists is exactly how the Mac build would ship without a module while the Windows
build kept passing.

## What the installer does
- Welcome + License (shows `LICENSE.txt`) + choose-folder + install + finish (with "launch now").
- Creates Start Menu group (app, Troubleshoot console, Getting Started, Uninstall) and a Desktop shortcut.
- Registers an entry in Add/Remove Programs (per-user) with a working uninstaller.

## Shipping a new version
1. Bump `VERSION` in `installer.nsi` (and `VIProductVersion`) to match `package.json`.
2. `./build.sh`
3. Upload the resulting `.exe` to your download host (e.g. `streamgraphicspro.com/download/StreamGraphicsProSetup.exe`)
   and update `sgpro-version.json` so the in-app update banner points users to it.

### The version manifest, now that there are two platforms
`sgpro-version.json` may carry a **`macUrl`** beside `url`:

```json
{
  "version": "1.0.39",
  "url":     "https://streamgraphicspro.com/download/StreamGraphicsProSetup.exe",
  "macUrl":  "https://streamgraphicspro.com/download/StreamGraphics-Pro-mac.zip",
  "notes":   "Mac version, and choose-your-output on every panel"
}
```

`url` stays the Windows installer; `macUrl` is the Mac download. Leave `macUrl` out and a Mac
is told an update exists but is given **no** download link — deliberately, because the
alternative is handing a Mac customer a `.exe`. Windows is unaffected either way.

## Notes
- First time the app is reached from another PC on the LAN, Windows may prompt to allow network
  access for `sgpro-engine.exe` — that's expected; click Allow.
- Mac packaging is `build-mac.sh` — see below.

## The launcher .exe, and why it has to be signed separately

`StreamGraphics Pro.exe` is a tiny NSIS stub that starts the app. It exists so the shortcut
carries our icon and can be pinned to the taskbar — Windows allows neither for a `.vbs`.

Signing the installer does **not** sign the files it extracts. So the launcher — the one file
a customer clicks every single day — ships unsigned unless we sign it on its own. An unsigned
stub that silently starts another process is also close to the shape of a malware dropper, so
Defender flags it far more readily than the installer around it.

Because the stub's version resource is fixed (not the app version), the compiled file does not
change between releases. That means it is signed **once**:

1. Build normally. The unsigned stub lands at `installer/build/StreamGraphics Pro.exe`.
2. Send it to the certificate holder, who signs it with `tools/sign-release.ps1 -File <path>`.
3. Put the signed copy at `installer/launcher-signed/StreamGraphics Pro.exe` and commit it.

From then on `build.sh` uses that file verbatim and skips the compile. If it is missing, the
build still works but prints a warning — the release will trigger SmartScreen on the launcher.


---

# The macOS app

```
cd installer
./build-mac.sh              # Apple Silicon (default)
./build-mac.sh x64          # Intel
./build-mac.sh both
```
Output: `installer/build-mac/StreamGraphics-Pro-<version>-<arch>.zip`

Runs on Linux. It needs `curl`, `python3` with Pillow (for the icon), `tar` and `zip` — no Apple
tools, because there are none here.

## What it produces
A `StreamGraphics Pro.app` bundle: the app under `Contents/Resources/app`, the macOS Node runtime
beside it as `sgpro-engine`, a shell-script launcher at `Contents/MacOS/StreamGraphics Pro`, an
`Info.plist`, and an icon built from `assets/streamgraphics.png`.

Same guards as the Windows build, plus two of its own: the downloaded Node tarball is checked
against nodejs.org's published SHA-256, and the extracted binary is checked to be a Mach-O for
the architecture being built. An arm64 binary in an x64 build installs perfectly and then fails
with "Bad CPU type in executable", after signing and notarising.

## 🚨 It is UNSIGNED, and that is not optional to fix
Handing a customer the zip as it comes out means *"Apple could not verify this app is free of
malware"* — a wall on Apple Silicon, not a warning. Signing and notarising need an Apple
Developer ID and have to run on a Mac. The signing identity must never come to the build
machine, exactly as with the Windows certificate.

`build-mac/SIGN-AND-NOTARISE.txt` is written by every build with the full sequence. The two
things most easily got wrong:

- **Sign the engine before the app.** Signing the bundle does not sign a nested executable, and
  notarisation rejects the whole submission for the one binary that was missed.
- **Pass `entitlements.plist`.** The hardened runtime, which notarisation requires, blocks the
  JIT that any JavaScript engine needs. Without those two entitlements the app signs and
  notarises perfectly and then dies the moment it launches, with nothing in the log naming an
  entitlement as the cause.

## Where the app keeps the operator's work
On macOS it cannot be next to the app: writing inside a signed bundle invalidates the signature,
and a downloaded app may be run from a randomised read-only mount. So `server.js` puts it in
`~/Library/Application Support/StreamGraphics Pro`, and carries an existing folder across on
first run. Windows and Linux are deliberately unchanged.

`SG_DATA_DIR` overrides the location on any platform — that is how the build's own smoke test
avoids writing into the real `~/Library`.

## The icon
`mac/make-icns.py` writes the `.icns` container directly (Apple's `iconutil` is macOS-only). The
source art is 256x256, so the 512 and 1024 slots are left out rather than filled with an obvious
upscale. Supply a 1024px master and they appear on their own.
