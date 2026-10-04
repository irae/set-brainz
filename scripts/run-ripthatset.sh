#!/usr/bin/env bash
set -euo pipefail

id="${1:?video id}"
root="$(cd "$(dirname "$0")/.." && pwd)"
data_dir="${SETBRAINZ_DATA_DIR:-$root/data}"
mp3s=("$data_dir/audio/$id/"*.mp3)
[ -e "${mp3s[0]}" ] || { echo "no MP3 audio for $id" >&2; exit 1; }
out="$data_dir/runs/$id/ripthatset"
mkdir -p "$out"

export TMPDIR="$data_dir/tmp"
mkdir -p "$TMPDIR"
"$root/tools/ripthatset/.venv/bin/ripthatset" "${mp3s[0]}" --cpu-count 1 --json-output "$out/run.json" 2>&1 | tee "$out/run.log"
