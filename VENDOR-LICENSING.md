# StreamGraphics Pro — Licensing & Upgrades (vendor reference)

This is your private cheat-sheet for issuing license keys and handling upgrades.
It's for YOU (the seller), not for customers. Keep the signing key secret.

---

## How the licensing works (plain English)

- Every copy of the app runs in **Free** mode and shows a small watermark on the output.
- A **license key** is a short signed code. When a customer pastes it into the app's
  **License** card, the watermark disappears and Pro features unlock.
- Keys are verified **offline** — the app never needs the internet to check a key.
  Great for live events; the trade-off is there's no central server counting installs
  (see "What offline can't do" below).
- You mint keys with `make-license.js` using your secret signing key.

## Your signing key (KEEP SECRET)

- The file `.license-private-key.pem` is your private signing key. It is **git-ignored**
  and must **never** be shared, emailed, or committed. Anyone with it can mint keys.
- The matching public key is baked into the app, so the app can verify keys you sign.
- Back the private key up somewhere safe (password manager / offline drive). If you lose
  it, you can't sign new keys that existing installs will accept.

## Minting a key

From the app folder, in a terminal:

```
node make-license.js "Customer Name" pro ""
```

That prints a license key — copy the long line and email it to the customer. Examples:

```
node make-license.js "Jane's Sports LLC" pro ""                 lifetime, all versions (recommended for launch)
node make-license.js "Acme Church" pro "" 2027-12-31            expires end of 2027 (for a rental / trial)
node make-license.js "Beach Club" pro "" upto=1                 unlocks v1.x only; v2 is a paid upgrade
node make-license.js "Pro User" pro remote,extra_courts ""      lifetime + add-on features enabled
```

Arguments: `"Name"` `tier` `features` `[expiry YYYY-MM-DD]` `[upto=N]`
- **features**: comma-separated add-on flags you want that key to unlock (leave `""` for
  none). Current flags: `remote`, `extra_courts`, `template_packs` (add more as you build).
- **expiry**: leave off for no expiry. Set a date for time-limited/rental keys.
- **upto=N**: caps the key to major version N (see upgrades below). Leave off = lifetime.

## Upgrades & new versions

- Customers download the latest installer from your site anytime. The app also shows an
  in-app **"Update available"** banner when you publish a new version (see below).
- **Lifetime keys** (no `upto`) keep unlocking every new version forever — this is what
  you sell at launch. Simplest and most generous.
- **When you want to charge for a major upgrade later:** start minting NEW keys with
  `upto=N` (e.g. `upto=1` while you're on 1.x). Existing lifetime customers are untouched.
  When such a customer installs a newer major version, the watermark returns with a
  message telling them an upgrade is needed — that's your prompt to sell the upgrade key.

### Publishing an update notification

Host a small file called `latest.json` on your site (e.g. https://streamgraphicspro.com/latest.json):

```json
{ "version": "1.1.0", "url": "https://streamgraphicspro.com/download", "notes": "New ticker styles + bug fixes" }
```

Every running copy checks it in the background (cached ~6h) and shows the banner when
its own version is older. To change what customers see, just edit that one file.
(You can point the app at a different URL with the `SG_UPDATE_URL` environment variable.)

## What offline licensing CAN'T do (yet)

Because keys are verified offline, the app can't currently:
- limit how many computers a key is installed on, or
- detect / shut off a key that's been shared.

Enforcing that needs **online activation** (the app checks in with a licensing server the
first time it runs). That's a future "Phase B" backend that would also give you an admin
dashboard: capture buyer contact info, cap installs per key, revoke leaked keys, reissue
lost keys, and auto-email a key the moment a sale clears. Worth adding once sales volume
makes the manual step and sharing worth solving — not before.

## Fulfillment checklist (manual, launch phase)

1. Square emails you that you got a sale (buyer name + email).
2. Run `node make-license.js "Buyer Name" pro ""` and copy the key.
3. Email the customer their key with a one-line "paste this into the License card" note.
4. Done. Keep a simple spreadsheet of name / email / key / date until Phase B automates it.
