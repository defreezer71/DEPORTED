#!/bin/bash
OUTPUT="js/game.js"
# ── World files ──
# Duel build uses the Arena MVP (03_arena.js) in place of the island trio
# (03_terrain / 04_world / 05_jungle). The island files — and the older flat
# plaza (03_city.js) — are left untouched on the shelf; swap the WORLD line to
# restore either.
# WORLD (island):     js/src/03_terrain.js js/src/04_world.js js/src/05_jungle.js
# WORLD (old plaza):  js/src/03_city.js
WORLD="js/src/03_arena.js"
cat js/src/01_config.js js/src/02_setup.js $WORLD js/src/06_bots.js js/src/07_loot.js js/src/08_weapons.js js/src/08b_physics.js js/src/09_audio.js js/src/10_input.js js/src/11_gameplay.js js/src/12_main.js > "$OUTPUT"
echo "Built $OUTPUT"
