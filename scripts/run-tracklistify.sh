#!/usr/bin/env bash
# Identify tracks in one audio file with Tracklistify (Shazam backend).
# Defaults from tracklistify/.env: 60 s segments, 10 s overlap, 25 req/min.
# Output lands in tracklistify/.tracklistify/output/ as json, markdown and m3u.
# Usage: scripts/run-tracklistify.sh audio/<file>.mp3
set -euo pipefail

file="$(realpath "${1:?audio file}")"
cd tracklistify
uv run tracklistify -f all "$file" 2>&1 | tee ../tracklistify-run.log
