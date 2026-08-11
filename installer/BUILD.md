# Building the StreamGraphics Pro Windows installer

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

`build.sh` stages only end-user files (it explicitly excludes the private signing key,
`make-license.js`, and vendor docs), downloads `node.exe`, renames it to `sgpro-engine.exe`
(a unique name so the uninstaller only ever stops *our* process, never other Node apps),
and compiles `installer.nsi`.

## What the installer does
- Welcome + License (shows `LICENSE.txt`) + choose-folder + install + finish (with "launch now").
- Creates Start Menu group (app, Troubleshoot console, Getting Started, Uninstall) and a Desktop shortcut.
- Registers an entry in Add/Remove Programs (per-user) with a working uninstaller.

## Shipping a new version
1. Bump `VERSION` in `installer.nsi` (and `VIProductVersion`) to match `package.json`.
2. `./build.sh`
3. Upload the resulting `.exe` to your download host (e.g. `streamgraphicspro.com/download/StreamGraphicsProSetup.exe`)
   and update `latest.json` so the in-app update banner points users to it.

## Notes
- First time the app is reached from another PC on the LAN, Windows may prompt to allow network
  access for `sgpro-engine.exe` — that's expected; click Allow.
- Mac packaging (a signed `.dmg`/`.pkg`) is a separate build done on macOS; not produced by this script.

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
