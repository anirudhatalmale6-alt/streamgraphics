#!/usr/bin/env python3
"""Build a macOS .icns from assets/streamgraphics.png, on Linux, with no Apple tools.

.icns is a plain container: the magic 'icns', a big-endian total length, then one entry per
size — a four-character type, a big-endian length, and the payload. Since 10.7 the payload may
be a PNG, which is what this writes. iconutil would do the same job in one line; iconutil is
macOS-only and this build runs here.

🚨 The source art is 256x256. Sizes ABOVE that are deliberately not written rather than
upscaled: macOS would rather scale 256 down for a 512 slot than show a soft, obviously
resampled icon, and a blurry app icon is the first thing a customer sees. Give this a 1024px
master and the two extra entries appear on their own.
"""
import struct, sys, io, os
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "assets/streamgraphics.png"
OUT = sys.argv[2] if len(sys.argv) > 2 else "installer/build/streamgraphics.icns"

# (icns type, pixel size).  ic11..ic14 are the @2x retina slots.
SLOTS = [("icp4", 16), ("icp5", 32), ("ic11", 32), ("icp6", 64), ("ic12", 64),
         ("ic07", 128), ("ic08", 256), ("ic13", 256), ("ic09", 512), ("ic10", 1024)]

src = Image.open(SRC).convert("RGBA")
native = min(src.size)
print(f"   source {SRC} is {src.size[0]}x{src.size[1]}")

entries, skipped = [], []
for typ, size in SLOTS:
    if size > native:
        skipped.append(f"{typ}({size})")
        continue
    buf = io.BytesIO()
    src.resize((size, size), Image.LANCZOS).save(buf, format="PNG", optimize=True)
    data = buf.getvalue()
    entries.append(struct.pack(">4sI", typ.encode("ascii"), len(data) + 8) + data)

if not entries:
    sys.exit("!! no icon sizes could be produced from " + SRC)

body = b"".join(entries)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "wb") as f:
    f.write(struct.pack(">4sI", b"icns", len(body) + 8) + body)

print(f"   wrote {OUT}  ({len(entries)} sizes, {len(body) + 8} bytes)")
if skipped:
    print(f"   no art for: {', '.join(skipped)} — supply a 1024px master to fill these in")
