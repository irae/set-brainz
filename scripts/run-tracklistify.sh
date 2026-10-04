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

newest="$(ls -td "$root"/tools/tracklistify/.tracklistify/output/*/ | head -1)"
cp "$newest"tracklist.* "$out/"
