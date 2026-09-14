#!/usr/bin/env bash
# Identify tracks in the MP3 of one video with RipThatSet (Shazam backend).
# 12 s fixed chunks. One worker, so Shazam sees one request at a time.
# Do not run at the same time as Tracklistify: both share the Shazam limit.
# Log and JSON land in data/runs/<video-id>/ripthatset/.
# Usage: scripts/run-ripthatset.sh <video-id>
set -euo pipefail

id="${1:?video id}"
mp3s=(data/audio/"$id"/*.mp3)
out="data/runs/$id/ripthatset"
mkdir -p "$out"

# RipThatSet writes ~2500 WAV chunks to $TMPDIR. /tmp is RAM on Arch, so use disk.
export TMPDIR="$PWD/data/tmp"
mkdir -p "$TMPDIR"
tools/ripthatset/.venv/bin/ripthatset "${mp3s[0]}" --cpu-count 1 --json-output "$out/run.json" 2>&1 | tee "$out/run.log"
