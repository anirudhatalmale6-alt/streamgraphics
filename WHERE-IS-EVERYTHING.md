# StreamGraphics Pro — where everything lives (the simple map)

There are only **4 things**. Three live on GitHub; one secret file lives on your computer.

## 1. The website (your marketing pages)
- **Repo:** `streamgraphicspro-website`
- **See it live now:** https://anirudhatalmale6-alt.github.io/streamgraphicspro-website/
- **Final home:** your `streamgraphicspro.com` (SiteGround) once you upload it.

## 2. The installer (the .exe customers download)
- **Lives at:** the `streamgraphics` repo's **Releases** page → latest `StreamGraphicsProSetup.exe`
- Your website's **Download** button already points here.
- **Final home:** `streamgraphicspro.com/download/StreamGraphicsProSetup.exe` once you upload it.

## 3. The source code (the actual app — what the .exe is built from)
- **Repo:** `streamgraphics` (this one)
- The master copy. Contains the app (`server.js`, `public/`), the installer recipe (`installer/`), and the license tools (`make-license.js`, `setup-key.js`).

## 4. The license keys — "key" means two different things
- **Customer keys** — the codes you sell. Each is just a line of text. You make one per customer with `node make-license.js`, then email it to them. They aren't stored in one place; **keep a simple spreadsheet** of who got which key. That's your record.
- **Your signing key** — **ONE secret file** on your computer: `.license-private-key.pem`. It's the master stamp that makes every customer key valid. **This is the only irreplaceable thing.**

---

## Back up the one secret file
The moment you create your signing key (`node setup-key.js`), copy **`.license-private-key.pem`** somewhere safe — a password manager, an encrypted USB stick, or your cloud drive.

- It's a **file, not a typed password.** It's portable — copy it to any computer with Node and you can make keys there. It is **not** locked to one machine.
- **Computer dies, but you have a backup:** restore the file anywhere, keep making keys. No problem.
- **Computer dies with no backup:** customers' existing keys keep working (already stamped), but you couldn't make new matching ones without an app update. So — back up that one file and this can never bite you.

## Customer keys today
A customer can paste their key on any machine (there's no per-computer lock yet — that "limit installs" behavior is an optional feature for later).
