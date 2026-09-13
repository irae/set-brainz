#!/usr/bin/env bash
# Download the best audio-only stream of a YouTube video into audio/,
# then make an MP3 copy for players and for the identification tools.
# Usage: scripts/download-audio.sh <youtube-url>
set -euo pipefail

url="${1:?youtube url}"
mkdir -p audio

yt-dlp -f bestaudio -o "audio/%(title)s [%(id)s].%(ext)s" "$url"

for src in audio/*.webm audio/*.m4a; do
  [ -e "$src" ] || continue
  mp3="${src%.*}.mp3"
  [ -e "$mp3" ] && continue
  ffmpeg -v error -i "$src" -vn -c:a libmp3lame -b:a 192k "$mp3"
done
