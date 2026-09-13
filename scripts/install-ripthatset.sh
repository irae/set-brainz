#!/usr/bin/env bash
# Clone RipThatSet next to this repo and install it into its own venv with uv.
# Needs: git, uv, ffmpeg.
set -euo pipefail

[ -d ripthatset ] || git clone --depth 1 https://github.com/b1scoito/RipThatSet.git ripthatset
cd ripthatset
uv venv --python 3.12 .venv
uv pip install -e .

# Upstream bug: processor.py re-sorts segments alphabetically, so segment_1000
# lands before segment_101 and every timestamp after 100 is wrong.
sed -i 's/^\(\s*\)segment_files = sorted($/\1segment_files = (/' ripthatset/processor.py
