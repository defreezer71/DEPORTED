#!/bin/bash
# ============================================================
# BUILD SCRIPT — concatenates src/ files into js/game.js
# Usage: bash build.sh
# Run this after editing any file in src/ to rebuild game.js
# ============================================================

OUTPUT="js/game.js"

cat src/01_config.js \
    src/02_setup.js \
    src/03_terrain.js \
    src/04_world.js \
    src/05_jungle.js \
    src/06_bots.js \
    src/07_loot.js \
    src/08_weapons.js \
    src/09_audio.js \
    src/10_input.js \
    src/11_gameplay.js \
    src/12_main.js \
    > "$OUTPUT"

echo "✅ Built $OUTPUT ($(wc -l < $OUTPUT) lines)"
