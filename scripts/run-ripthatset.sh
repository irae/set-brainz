#!/usr/bin/env bash
# Identify tracks in one audio file with RipThatSet (Shazam backend).
# 12 s fixed chunks. One worker, so Shazam sees one request at a time.
# Do not run at the same time as Tracklistify: both share the Shazam limit.
# Usage: scripts/run-ripthatset.sh audio/<file>.mp3
set -euo pipefail

file="${1:?audio file}"
ripthatset/.venv/bin/ripthatset "$file" --cpu-count 1 --json-output ripthatset-run.json 2>&1 | tee ripthatset-run.log
