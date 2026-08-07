#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js not found — install from https://nodejs.org"; exit 1; }
node server.js
