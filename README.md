# StreamGraphics

A realtime livestream graphics engine. Open the URLs below and you'll see a home
page listing each graphic. Each has a CONTROL panel (drive it from any browser on
your network) and an OUTPUT page (add to OBS/vMix as a Browser Source, 1920×1080).

## Installing & launching

**Easiest (Windows):** double-click **`Start StreamGraphics.bat`**. It checks that
Node.js is installed (and tells you where to get it if not), starts the app, and your
browser opens to the home screen automatically. Keep that window open while you work;
close it to stop the app.

**Make it feel like an app (Windows):** double-click **`Create Desktop Shortcut.bat`**
once. It puts a **StreamGraphics Pro** icon on your Desktop that launches the app with
no console window (via `Start StreamGraphics (no window).vbs`). From then on, just
double-click the desktop icon.

**macOS:** double-click **`Start StreamGraphics.command`**.
**Linux:** run **`./start.sh`**.

All launchers just wrap one command — `node server.js` (Node 16+, no install step) —
so you can always run that directly instead. The app opens your browser to the home
screen on launch; set `SG_NO_OPEN=1` to skip that. URLs:
- Home:               http://localhost:4000/
- Timer control:      http://localhost:4000/control        · output: /output
- Scoreboard control: http://localhost:4000/scoreboard     · output: /scoreboard-output
- Lower-third control: http://localhost:4000/lowerthird    · output: /lowerthird-output

Every output page works the same in **OBS** (Browser Source) or **vMix** (Web Browser
input) or any browser, at 1920×1080. Each control panel has a **Copy link** button for
the output URL and a **Green screen** toggle (renders on solid green for a hardware
switcher that can't key transparency — leave it off for OBS/vMix, which key the
transparent background directly).

## Lower Third Builder (WYSIWYG)
Not a template — a canvas you build. Add **Text**, **Box**, and **Image** layers,
drag them on the 1920×1080 canvas (or type exact pixel X/Y/W/H), and style each one:
- Text: content, font, size, bold/italic, colour, alignment — as many text layers as
  you want (title, second title, subtitle…).
- Box: fill, opacity, corner radius — a small bar, two coloured bars, or one that
  spans the whole bottom of the screen.
- Image: any PNG/logo, with a shape (square / rounded / circle) and fit.
- Every layer has its own in/out **animation** and a **delay**, so layers stagger or
  group. Stack order (send back / bring front) controls what sits on top — so a logo
  never intrudes on a background.
The design is saved (survives restart) and persists in `data/lowerthird.json`;
"Reset to default" restores the starter design. Title-safe guide shown on the canvas.

### Reference image — grab it straight from your switcher
The builder can show a still of your actual programme behind the canvas, so you design
against the real shot instead of guessing. **Grab from switcher** offers two tabs:

- **OBS** — needs *Tools > WebSocket Server Settings > Enable WebSocket server*. Enter the
  address, port (4455) and the password OBS shows under **Show Connect Info**. Pick the live
  scene or any specific one. OBS sends the picture back down the connection, so this works
  **from any computer on the network**.
- **vMix** — needs *Settings > Web Controller > Enabled*. Pick **Program output** (what's on
  air) or any single input by name. Note vMix only answers on the machine's network address
  (192.168.x.x), never on `localhost` — it refuses loopback callers as browser scripts.

One difference worth knowing: vMix has no way to send a picture over the wire. It can only
**save a still to disk on the vMix machine**, so this reads that file back — which means
StreamGraphics has to be on the vMix computer, or pointed at a folder both can see. OBS has
no such restriction. Every grab is written under a fresh filename, so nothing is ever
overwritten and no stale picture can be served from a cache.

Passwords are never written to disk — the OBS password is kept for the session only.

## Troubleshooting
**"EADDRINUSE / port 4000 already in use"** — an earlier copy of StreamGraphics is
still running in another window. Either use that window, or close it (click it and
press Ctrl+C), or start this copy on a different port:
`$env:PORT=4001; node server.js` (PowerShell) / `PORT=4001 node server.js` (Mac/Linux).
Remember to use the same port in your browser and OBS URLs.

## Timer — speaker / confidence mode
Beyond countdown / count-up / countdown-to-time, the timer has a speaker mode: set a
**Warn at** time and the display turns amber under it; at zero it goes red and, if
**Count into overtime** is on, keeps counting NEGATIVE (with a pulse) for overtime.
Perfect on a confidence monitor. Turn the warning **Off** for a plain countdown.

## Scoreboard (Milestone 2)
A two-team match board, shipped configured for the beach-volley Center Court look
but reusable for any two-side match:
- Player names, seed, and a team colour per side.
- Per-game scoring with +/- buttons; a game shows "--" until it starts.
- **Restart Match** sets game 1 to 0 and the rest to "--". **Start Next Game**
  brings the next "--" up to 0 and makes it the active (highlighted) game.
- The active game's cell is highlighted, and any score flashes when it changes.
- Editable match info (presenter, title, round/bracket label) and look (highlight
  colour, label-strip colour, position, animation).
- Optional **backdrop image**: paste a URL to your own Photoshop art and the coded
  frame steps aside so only the live fields sit on top.

### Team Library (your roster, mail-merge style)
The Scoreboard control panel has a **Team Library** loaded from your spreadsheet.
- In each team card there's a **"load team from library"** dropdown — pick a team
  and its row colour, text colour, and logo fill in, and the two player dropdowns
  populate from that team's roster. Choose the two who are playing and you're set.
- **Logos:** your sheet lists filenames (e.g. `ucla.png`). Drop those PNG files into
  `public/logos/` and they resolve automatically.
- **Update the list:** export your spreadsheet as CSV and use **Import CSV** in the
  Team Library panel. Recognised columns: `TeamName, TeamLogo, TeamHex, TextColor,
  Player1…Player6` (extra `Player#` columns are picked up automatically).
- The library persists in `data/library.json`; the starter list ships in
  `data/teams.seed.json`.
- Browse buttons let you pick a local image for any logo/backdrop instead of URLs.
- **Chroma key**: add `?bg=green` (or magenta / blue / any hex) to the output URL
  to render on a solid key colour for a hardware switcher instead of transparency.

---

## Milestone 1 (Timer engine)

A realtime livestream graphics engine. You drive graphics from a **browser control
panel**, and they animate on a transparent **output page** that OBS or vMix pulls in
as a Browser Source — on the same PC or any other PC on your network. No Streamdeck,
no per-machine software.

Milestone 1 delivers the full pipeline plus the **timer family**:
- **Countdown** (set a duration, start/pause/reset, nudge ±)
- **Count-up** (elapsed time)
- **Countdown to a clock time** (e.g. count down to 7:00:00 PM)

…all with a live **Look** panel: colour, accent, background + opacity, size, font,
9 on-screen positions, and enter/exit animation. Take it on/off air with one button.

---

## What you need
- **Node.js 16 or newer** — free, 2-minute install from https://nodejs.org (pick the
  "LTS" button). That's the only requirement. No accounts, no paid services, no
  `npm install` step.

## Run it
1. Download this project (green **Code ▸ Download ZIP** button on GitHub) and unzip it.
2. Open a terminal / Command Prompt in the unzipped folder.
3. Run:
   ```
   node server.js
   ```
   (To use a different port: `PORT=4000 node server.js`)
4. The console prints three URLs, e.g.:
   ```
   Control panel (this computer):  http://localhost:4000/control
   Output for OBS/vMix (this PC):   http://localhost:4000/output
   Output from ANOTHER computer:    http://<this machine's LAN address>:4000/output
   ```

## Wire it into OBS or vMix
- **OBS:** Sources ▸ **+** ▸ **Browser** ▸ paste the **output** URL ▸ set Width **1920**,
  Height **1080** ▸ OK. The background is transparent, so it sits cleanly over your video.
- **vMix:** Add Input ▸ **Web Browser** ▸ paste the output URL ▸ 1920×1080.

**From a second PC on the same network:** use the `http://192.168.x.x:PORT/output`
address the console printed (the machine's LAN IP), not `localhost`.

> Windows may ask to allow Node through the firewall the first time — click **Allow**
> so other machines on your network can reach it.

## Drive it
Open the **control** URL in your browser (on any machine on the network). Pick a mode,
set the time, style it under **Look**, then **Take to air**. Everything updates on the
output instantly. Open the control panel on two devices and they stay in sync.

---

## How it's built (and where it's going)
- **Zero dependencies, pure Node.** The server serves the pages and relays state over
  Server-Sent Events; the control panel posts actions. That's why there's no install
  step and it runs anywhere.
- **Server-anchored clock.** Timers are computed from the server's clock, so every
  machine agrees and the display is perfectly smooth (rendered at 60fps locally).
- **Built to grow.** The state/transport is generic on purpose. The same foundation
  extends — with no rewrite — to more graphics (scoreboard, lower thirds), multiple
  independent feeds, multiple operators, live data (API/spreadsheet), and running over
  the internet instead of just the LAN. That's the roadmap from here.

Milestone 1 scope: the engine + the timer family, controlled from the browser over your
local network.
