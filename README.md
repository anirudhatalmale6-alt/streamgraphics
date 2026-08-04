# StreamGraphics — Milestone 1 (Timer engine)

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
   Output from ANOTHER computer:    http://192.168.1.50:4000/output
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
