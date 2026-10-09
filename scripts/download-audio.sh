#!/usr/bin/env bash
set -euo pipefail

id="${1:?set id}"
url="${2:?source url}"
root="$(cd "$(dirname "$0")/.." && pwd)"
data_dir="${SETBRAINZ_DATA_DIR:-$root/data}"

if [ -n "$(find "$data_dir/audio/$id" -mindepth 1 -maxdepth 1 -name '*.mp3' 2>/dev/null)" ]; then
  echo "audio already exists for set $id; remove the MP3 from audio/$id in the data folder to download again" >&2
  exit 1
fi
mkdir -p "$data_dir/audio/$id"
yt-dlp --no-playlist -f 'bestaudio/best' --extract-audio --audio-format mp3 --audio-quality 192K \
  -o "$data_dir/audio/$id/%(title)s.%(ext)s" "$url"
