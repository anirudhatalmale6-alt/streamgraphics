# Render the REAL shipped SVG in a real browser (same engine as an OBS browser source),
# screenshot it, and decode the screenshot. This tests the path-building too, not just the grid.
import json, subprocess, sys, io
from playwright.sync_api import sync_playwright
from PIL import Image
from pyzbar.pyzbar import decode as zdecode
import cv2, numpy as np

texts = [
 "https://streamgraphicspro.com",
 "HTTPS://STREAMGRAPHICSPRO.COM/BUY",
 "8005551234",
 "Manhattan Beach Studios LLC - live broadcast graphics",
 "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
 "WIFI:T:WPA;S:StudioNet;P:sup3rs3cret;;",
 "BEGIN:VCARD\nVERSION:3.0\nN:Nicholas;Mark\nORG:Manhattan Beach Studios\nEND:VCARD",
 "x"*300, "9"*700, "A"*1000,
]
cases = [{"text": t, "level": lv} for t in texts for lv in "LMQH"]
out = subprocess.run(["node", sys.argv[1], json.dumps(cases)], capture_output=True, text=True)
if out.returncode: print("NODE FAIL", out.stderr[-1500:]); sys.exit(1)
svgs = json.loads(out.stdout)

ok = fail = 0; bad = []
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    pg.set_viewport_size({"width": 800, "height": 800})
    for c, s in zip(cases, svgs):
        pg.set_content('<body style="margin:0;background:#fff"><div style="width:760px;height:760px;padding:20px">'+s["svg"]+'</div></body>', wait_until="load")
        shot = pg.screenshot()
        img = Image.open(io.BytesIO(shot)).convert("L")
        res = zdecode(img)
        got = res[0].data.decode() if res else None
        if got != c["text"]:
            arr = np.array(img)
            d, _, _ = cv2.QRCodeDetector().detectAndDecode(arr)
            if d == c["text"]: ok += 1; continue
            fail += 1; bad.append((c["text"][:26], c["level"], "v%s"%s["version"], s["mode"], repr(got)[:34]))
        else: ok += 1
    b.close()
print(f"browser-rendered SVGs decoded: {ok} / {len(cases)}   failures: {fail}")
for x in bad[:12]: print("   ", x)
