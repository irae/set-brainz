#!/usr/bin/env bash
# Clone Tracklistify next to this repo and install it with uv.
# Needs: git, uv, ffmpeg, deno (only for direct YouTube input).
set -euo pipefail

[ -d tracklistify ] || git clone --depth 1 https://github.com/betmoar/tracklistify.git
cd tracklistify
uv sync
[ -e .env ] || cp .env.example .env
