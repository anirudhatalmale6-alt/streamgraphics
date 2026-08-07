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
