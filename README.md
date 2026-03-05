# Battle Royale FPS — Project Structure

## Files
```
index.html          ← HTML + CSS only (~426 lines). Rarely needs editing.
js/game.js          ← The built JS file. DO NOT edit directly — edit src/ files instead.
build.sh            ← Run after editing src/ files to rebuild js/game.js
src/                ← Edit these files!
  01_config.js      ~80 lines   — CONFIG constants + game STATE object
  02_setup.js       ~49 lines   — Three.js scene, camera, renderer setup
  03_terrain.js     ~315 lines  — Ground mesh, stream, volcano, water plane
  04_world.js       ~445 lines  — Cliff walls, prison compound, gate doors
  05_jungle.js      ~335 lines  — Trees, bushes, rocks, volcano structure
  06_bots.js        ~329 lines  — Bot AI: movement, shooting, pathfinding
  07_loot.js        ~295 lines  — Loot system + ammo depots/crates
  08_weapons.js     ~254 lines  — Weapon 3D model, bullet impacts, collision
  09_audio.js       ~449 lines  — Procedural audio via Web Audio API
  10_input.js       ~133 lines  — Input handling, drone camera, music toggle
  11_gameplay.js    ~322 lines  — Shooting, loot pickup, HUD, minimap
  12_main.js        ~666 lines  — Game loop, update(), init, event listeners
```

## Workflow for AI-assisted editing sessions

1. **Identify which file your change lives in** (see list above)
2. **Upload only that src/ file** to the chat (+ index.html if changing UI)
3. **Make the change**, download the updated file
4. **Run `bash build.sh`** to rebuild `js/game.js`
5. **Open index.html** in browser to test
6. **Git commit** when happy

## Example: Changing bot behavior
→ Upload only `src/06_bots.js` (~329 lines vs 4097 total)
→ 8x smaller context = much faster sessions

## Example: Changing audio
→ Upload only `src/09_audio.js` (~449 lines)

## Example: Changing UI/menus
→ Upload `index.html` + `src/10_input.js` + `src/11_gameplay.js`
