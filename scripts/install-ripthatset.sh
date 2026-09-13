#!/usr/bin/env bash
# Clone RipThatSet next to this repo and install it into its own venv with uv.
# Needs: git, uv, ffmpeg.
set -euo pipefail

[ -d ripthatset ] || git clone --depth 1 https://github.com/b1scoito/RipThatSet.git ripthatset
cd ripthatset
uv venv --python 3.12 .venv
uv pip install -e .
