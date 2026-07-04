#!/bin/bash
# One-command render-workload capture. Rebuilds js/game.js first (so the probe
# reflects current js/src), then drives the game in headless Chrome and prints +
# records the draw-call / triangle / scene-census numbers.
#
#   bash tools/perf.sh            # rebuild, capture, print, append to history
#   bash tools/perf.sh --json     # raw JSON only (for piping / diffing)
#
# See tools/perf-capture.mjs for what is (and isn't) measured.
set -e
cd "$(dirname "$0")/.."
bash build.sh >/dev/null
exec node tools/perf-capture.mjs "$@"
