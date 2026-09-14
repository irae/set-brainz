#!/usr/bin/env bash
# Download the best audio-only stream of a YouTube video into data/audio/<video-id>/,
# then make an MP3 copy for players and for the identification tools.
# Usage: scripts/download-audio.sh <youtube-url>
set -euo pipefail

url="${1:?youtube url}"

yt-dlp -f bestaudio -o "data/audio/%(id)s/%(title)s.%(ext)s" "$url"

for src in data/audio/*/*.webm data/audio/*/*.m4a; do
  [ -e "$src" ] || continue
  mp3="${src%.*}.mp3"
  [ -e "$mp3" ] && continue
  ffmpeg -v error -i "$src" -vn -c:a libmp3lame -b:a 192k "$mp3"
done
