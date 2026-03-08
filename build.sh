#!/bin/bash
# ============================================================
# BUILD SCRIPT — concatenates src/ files into js/game.js
# Usage: bash build.sh
# Run this after editing any file in src/ to rebuild game.js
# ============================================================

OUTPUT="js/game.js"

cat js/src/01_config.js \
    js/src/02_setup.js \
    js/src/03_terrain.js \
    js/src/04_world.js \
    js/src/05_jungle.js \
    js/src/06_bots.js \
    js/src/07_loot.js \
    js/src/08_weapons.js \
    js/src/09_audio.js \
    js/src/10_input.js \
    js/src/11_gameplay.js \
    js/src/12_main.js \
    > "$OUTPUT"

echo "✅ Built $OUTPUT ($(wc -l < $OUTPUT) lines)"
