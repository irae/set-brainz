#!/usr/bin/env bash
# Clone Tracklistify into tools/ and install it with uv.
# Needs: git, uv, ffmpeg, deno (only for direct YouTube input).
set -euo pipefail

mkdir -p tools
[ -d tools/tracklistify ] || git clone --depth 1 https://github.com/betmoar/tracklistify.git tools/tracklistify
cd tools/tracklistify
uv sync
[ -e .env ] || cp .env.example .env
