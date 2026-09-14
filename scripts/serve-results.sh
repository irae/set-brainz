#!/usr/bin/env bash
# Serve data/views/ over http so the YouTube embed works, then open the table.
# Usage: scripts/serve-results.sh <video-id>
set -euo pipefail

id="${1:?video id}"
cd data/views
python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1 &
sleep 1
xdg-open "http://localhost:8765/$id/tracklist.html"
wait
