#!/usr/bin/env bash
# Clone Tracklistify into tools/ and install it with uv.
# Needs: git, uv, ffmpeg, deno (only for direct YouTube input).
set -euo pipefail

mkdir -p tools
# betmoar/tracklistify no longer exists. This fork keeps the same command and JSON fields.
[ -d tools/tracklistify ] || git clone --depth 1 https://github.com/marcopeise/tracklistify-extended.git tools/tracklistify
cd tools/tracklistify
uv sync
[ -e .env ] || cp .env.example .env
