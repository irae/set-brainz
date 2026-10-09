#!/usr/bin/env bash
set -euo pipefail

id="${1:?video id}"
root="$(cd "$(dirname "$0")/.." && pwd)"
data_dir="${SETBRAINZ_DATA_DIR:-$root/data}"
mp3s=("$data_dir/audio/$id/"*.mp3)
[ -e "${mp3s[0]}" ] || { echo "no MP3 audio for $id" >&2; exit 1; }
file="$(realpath "${mp3s[0]}")"
out="$data_dir/runs/$id/tracklistify"
mkdir -p "$out"

(cd "$root/tools/tracklistify" && uv run tracklistify -f all "$file") 2>&1 | tee "$out/run.log"

output_root="$root/tools/tracklistify/.tracklistify/output"
json="$(find "$output_root" -type f -name '*.json' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
[ -n "$json" ] || { echo "tracklistify wrote no json" >&2; exit 1; }
cp "$json" "$out/tracklist.json"
