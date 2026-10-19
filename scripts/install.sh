#!/bin/sh
set -e
cd "$(dirname "$0")/.."
for b in ffmpeg rubberband fluidsynth uv; do
  command -v "$b" >/dev/null || { echo "MISSING: $b - run: brew install ffmpeg rubberband fluid-synth uv"; exit 1; }
done
[ -x .venv/bin/python ] || uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python --no-deps -r requirements.lock
mkdir -p songs models
echo "ready: node server.mjs, then open http://localhost:4843 (models download on the first song, about 2 GB)"
