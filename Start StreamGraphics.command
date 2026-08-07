#!/bin/bash
# StreamGraphics Pro launcher for macOS — double-click to run.
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  StreamGraphics Pro needs Node.js, which doesn't seem to be installed."
  echo "  1) Go to https://nodejs.org  and download the \"LTS\" version."
  echo "  2) Install it."
  echo "  3) Double-click this file again."
  echo ""
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

echo ""
echo "  Starting StreamGraphics Pro... your browser will open in a moment."
echo "  Keep this window open while you work. Press Ctrl+C to stop."
echo ""
node server.js
