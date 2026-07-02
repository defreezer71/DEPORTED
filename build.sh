#!/bin/bash
OUTPUT="js/game.js"
# ── World files ──
# Duel/city build uses 03_city.js in place of the island trio
# (03_terrain / 04_world / 05_jungle). The island files are left untouched
# on the shelf — to restore the island, swap the two WORLD lines below.
# WORLD (island):  js/src/03_terrain.js js/src/04_world.js js/src/05_jungle.js
WORLD="js/src/03_city.js"
cat js/src/01_config.js js/src/02_setup.js $WORLD js/src/06_bots.js js/src/07_loot.js js/src/08_weapons.js js/src/08b_physics.js js/src/09_audio.js js/src/10_input.js js/src/11_gameplay.js js/src/12_main.js > "$OUTPUT"
echo "Built $OUTPUT"
