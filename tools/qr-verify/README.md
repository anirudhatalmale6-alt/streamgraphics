# Verifying the QR encoder

`public/sg-qr.js` generates QR codes itself, offline, with no library and no web service. That is
the right call for a machine in a control room — but it means nothing catches a mistake for us.

A QR code that is subtly wrong still *looks* exactly like a QR code. You cannot eyeball it. When
the encoder was first written every data module was already correct and only the format-information
bits were placed in the wrong order — the codes looked perfect and not one of them would scan.

So the encoder is checked two ways, against things that were not written here.

These scripts are developer tools. They are not shipped in the installer and customers never see
them. They need Python with `qrcode`, `pyzbar`, `opencv-python`, `Pillow` and `playwright`.

## 1. Compare module-for-module with a reference implementation

```
python3 compare-to-reference.py dump-grids.js
```

Generates a few hundred random payloads across all three encoding modes (numeric, alphanumeric,
byte), random lengths up to 900 characters and all four error-correction levels, then compares our
grid against the Python `qrcode` package's grid, module by module. The reference is forced to use
the mask we chose, so this compares the *encoding*; the mask choice is scored separately, and a
different-but-valid mask is not a failure.

Expected: `220/220 identical to reference`, reaching version 33 or so — which matters, because
version 7 and above add the version-information blocks, a separate piece of the spec that shorter
codes never exercise.

## 2. Decode what the browser actually draws

```
python3 decode-rendered.py dump-svgs.js
```

Renders the real shipped SVG in headless Chromium — the same engine an OBS browser source runs —
screenshots it, and decodes the screenshot with two independent decoders (`pyzbar`, then OpenCV as
a second opinion). This covers the SVG path building and the quiet zone, not just the grid.

Expected: `40 / 40`.

Run both after any change to `sg-qr.js`.
