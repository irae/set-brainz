#!/usr/bin/env bash
# Serve results/ over http so the YouTube embed works, then open the table.
# Usage: scripts/serve-results.sh
set -euo pipefail
cd results
python3 -m http.server 8765 >/dev/null 2>&1 &
sleep 1
xdg-open http://localhost:8765/tracklist.html
wait
