#!/usr/bin/env python3
"""Check every PowerShell script the way WINDOWS will actually read it.

Mark's signing script broke because I put a UTF-8 em dash in a comment. Windows
PowerShell 5.1 reads a BOM-less .ps1 as the system ANSI code page, so E2 80 94
arrives as three characters ending in U+201D - and PowerShell treats a smart
quote as a real string delimiter. One dash in a comment opened a string that
never closed, and the parse failed 25 lines later with a confusing error.

So: scripts must be pure ASCII, and must carry a BOM as a second line of defence.

    python3 tools/check-ps1.py
"""
import glob, os, sys

# Characters PowerShell will treat as quote delimiters if they ever reach it.
SMART = "‘’‚‛“”„‟"
HERE = os.path.dirname(os.path.abspath(__file__))

fails = []
for path in sorted(glob.glob(os.path.join(HERE, "*.ps1"))):
    name = os.path.basename(path)
    raw = open(path, "rb").read()

    has_bom = raw.startswith(b"\xef\xbb\xbf")
    body = raw[3:] if has_bom else raw
    text = body.decode("utf-8")

    non_ascii = sorted({c for c in text if ord(c) > 127})

    # The real test: decode it the way a BOM-less file lands on Windows, and see
    # whether any smart quote appears that isn't in the file we wrote.
    mojibake = body.decode("cp1252", errors="replace")
    smuggled = sorted({c for c in mojibake if c in SMART})

    ok = True
    if non_ascii:
        ok = False
        fails.append("%s: non-ASCII %s - use plain ASCII in .ps1" % (name, non_ascii))
    if not has_bom:
        ok = False
        fails.append("%s: no UTF-8 BOM - Windows PowerShell will guess the encoding" % name)
    if smuggled:
        ok = False
        fails.append("%s: reads as a quote character on Windows: %s" % (name, smuggled))
    print(("PASS  " if ok else "FAIL  ") + name +
          ("   BOM, ASCII-only" if ok else ""))

if fails:
    print("\n%d problem(s):" % len(fails))
    for f in fails:
        print("  " + f)
    sys.exit(1)
print("\nall PowerShell scripts safe for Windows PowerShell 5.1")
