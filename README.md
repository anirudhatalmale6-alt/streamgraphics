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
- Teleprompter:       http://localhost:4000/prompter      · output: /prompter-output

### Setting up the OBS/vMix machine — don't type the links

Open **http://localhost:4000/links** (or the 🔗 button on the home page). It lists every
output and control link already built from this computer's network address, with a Copy
button on each, one that copies them all, and one that copies the whole page as an email
you can send to whoever is setting up the other computer.

That address matters: a link that says `localhost` points the *other* computer at itself,
so it can never work there. Every Copy link button in the app now hands out this
computer's network address instead. If the computer has several (Wi-Fi, Ethernet, a VPN,
or a virtual adapter left by Hyper-V/VirtualBox/Docker), the links page lets you pick
which one — if a link doesn't load on the far machine, pick the next address and copy again.

Every output page works the same in **OBS** (Browser Source) or **vMix** (Web Browser
input) or any browser, at 1920×1080. Each control panel has a **Copy link** button for
the output URL and a **Green screen** toggle (renders on solid green for a hardware
switcher that can't key transparency — leave it off for OBS/vMix, which key the
transparent background directly).

## Teleprompter

Its own module: a control panel at **/prompter** and an output at **/prompter-output**.
Type or paste the script, press Play, and it scrolls.

- **Transport.** Play/pause, jump back and ahead, back to the top, and speed up or down
  while it's running. The keys are the ones prompter operators already use:
  <kbd>space</kbd> start/stop, <kbd>←</kbd>/<kbd>→</kbd> slower/faster,
  <kbd>↑</kbd>/<kbd>↓</kbd> jump back/ahead, <kbd>Home</kbd> top,
  <kbd>PgUp</kbd>/<kbd>PgDn</kbd> previous/next section. Hold <kbd>Shift</kbd> for a bigger
  step. They work on the control panel **and** on the output window, and they're inert while
  you're typing in the script box.
- **Bookmarks.** Start any line with `##` and it becomes a bookmark — a button on the panel,
  a section marker on screen, and a Stream Deck key. They live in the text, so moving a
  section moves its bookmark with it. The first nine have a keyboard shortcut: press
  <kbd>1</kbd>…<kbd>9</kbd> to go straight to that section, from the panel or from the output
  window, and the number is printed on the button so you don't have to remember it. The
  Control API page lists a ready-made URL per section, addressed by name — rename a section
  and the Stream Deck key still lands on the right words.
- **Look.** Font, size, line spacing, column width, alignment, bold, text colour, background
  colour or fully transparent (key it over a shot), chroma, the reading indicator (line,
  arrows, both or none) and where it sits, and soft top/bottom edges.
- **Edit on screen.** Press **✎ Edit on screen** above the preview and the preview becomes
  the editor, at prompter size, in the prompter's own font and colours. It opens on the part
  of the script that is being read right now, not at the top, and a line wraps there exactly
  where it wraps on the glass — so a change made mid-show can be judged for length before it
  reaches the talent. Every keystroke is on air within half a second. **▸ Prompter to my
  cursor** sends the read to whatever line you're editing. <kbd>Esc</kbd> closes it.
- **Open a document.** *Open a document…* under the script box takes Word (`.docx`), rich
  text (`.rtf`) and plain text (`.txt`, `.md`) — or drag the file straight onto the box.
  Headings in the document become bookmarks on their own: a script written in Word with
  Heading 1 / Heading 2 per section arrives already marked up and already on your Stream Deck.
  Nothing is stored — the file is read and handed back to the page.
- **Put it on a monitor.** On the computer running the app (Chrome or Edge), *Find my
  monitors* lists your displays and sends the normal or mirrored output straight to the one
  you pick, full screen. From another device this is not possible in any browser — open the
  output over there and drag it across, or use it as a browser source. The panel says which
  case you're in rather than failing quietly.
- **Mirrored and normal at the same time.** `/prompter-output?mirror=1` is a separate
  address, so beam-splitter glass in front of the lens and a confidence monitor at the back
  of the room run from one script, in step. `?flip=1` mirrors vertically for a rig that
  reflects that way; both flags together do both.
- **Anywhere.** Either address works as an OBS Browser Source, a vMix Web Browser input, or
  just a browser window dragged full-screen onto a monitor.

**Why it doesn't drift or restart itself:** the scroll position lives on the server, the same
way the presenter timer's clock does. Every screen computes its own frame from that one
number, so two screens can't slide out of step however long the read runs — and a browser
source that reloads mid-take comes back where the script *is*, not at the top.

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
