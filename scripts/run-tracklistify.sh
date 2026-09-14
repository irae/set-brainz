#!/usr/bin/env bash
# Identify tracks in the MP3 of one video with Tracklistify (Shazam backend).
# Defaults from tools/tracklistify/.env: 60 s segments, 10 s overlap, 25 req/min.
# Log and tracklist files land in data/runs/<video-id>/tracklistify/.
# Usage: scripts/run-tracklistify.sh <video-id>
set -euo pipefail

id="${1:?video id}"
mp3s=(data/audio/"$id"/*.mp3)
file="$(realpath "${mp3s[0]}")"
out="$PWD/data/runs/$id/tracklistify"
mkdir -p "$out"

(cd tools/tracklistify && uv run tracklistify -f all "$file") 2>&1 | tee "$out/run.log"

newest="$(ls -td tools/tracklistify/.tracklistify/output/*/ | head -1)"
cp "$newest"tracklist.* "$out/"
