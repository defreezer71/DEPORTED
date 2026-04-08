# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build

**Never edit `js/game.js` directly.** It is a generated file. Edit files in `js/src/` instead, then rebuild:

```bash
bash build.sh
```

This concatenates all `js/src/0*.js` files (in order) into `js/game.js`. Open `index.html` in a browser to test.

There are no tests and no linter. The server can be run locally with:

```bash
cd server && npm install && npm start
# or for dev (auto-reload):
cd server && npm run dev
```

The server defaults to port 8081 locally; on Render it uses `PORT=10000`.

## Architecture

This is a browser-based Battle Royale FPS built on Three.js with a Node.js WebSocket server for multiplayer.

### Client (`js/src/` — concatenated into `js/game.js`)

Modules are plain JS files concatenated in order — no bundler, no modules system at the file level (Three.js is imported via ES module at the top of `01_config.js`). All share a single global scope.

| File | Responsibility |
|------|---------------|
| `01_config.js` | `CONFIG` constants (island size, weapon stats, physics toggles) and the global `state` object (all mutable game state lives here) |
| `02_setup.js` | Three.js scene, camera, renderer initialization |
| `03_terrain.js` | Procedural ground mesh, stream, volcano, water plane |
| `04_world.js` | Cliff walls, prison compound, gate doors |
| `05_jungle.js` | Trees, bushes, rocks, volcano structure |
| `06_bots.js` | Bot AI: movement, shooting, pathfinding |
| `07_loot.js` | Loot spawning, ammo depots/crates |
| `08_weapons.js` | Weapon 3D model, bullet impacts, collision detection |
| `08b_physics.js` | Capsule sweep-and-slide physics at 60 Hz fixed timestep (toggled by `CONFIG.newPhysics`) |
| `09_audio.js` | Procedural audio via Web Audio API |
| `10_input.js` | Keyboard/mouse input, drone camera, music toggle |
| `11_gameplay.js` | Shooting logic, loot pickup, HUD, minimap |
| `12_main.js` | Game loop (`update()`), `init()`, event listeners, WebSocket message handling |

**Key globals:** `CONFIG` (constants), `state` (all game state), `camera`, `scene`, `renderer` (Three.js), `phys` (physics state when `CONFIG.newPhysics = true`).

**Physics:** Two systems exist. `CONFIG.newPhysics = true` (default) uses capsule sweep-and-slide in `08b_physics.js`. Set to `false` to fall back to the legacy AABB system in `08_weapons.js`.

### Server (`server/server.js`)

Pure Node.js WebSocket server (no framework). Manages:
- **Rooms**: auto-fill rooms (up to 20 players, immediate countdown) and PvP lobby rooms (waiting for majority-ready vote, 3-minute fill timer fallback)
- **Tick loop**: 20 Hz (`setInterval` at 50ms) — broadcasts world snapshots (player positions, HP, events) to all room members
- **Server-authoritative damage**: `shoot` messages are validated server-side (range check ≤600 units, damage capped at 200)
- **Anti-cheat**: teleport detection (rejects moves >3.5 units per tick)

WebSocket message types: `join`, `move`/`input`, `ready`, `shoot`, `chat` → `joined`, `lobbyState`, `startMatch`, `world`, `hit`, `chat`.

### Note on `src/` vs `js/src/`

The repo root has both a `src/` and a `js/src/` directory with identically-named files. **`build.sh` reads from `js/src/`** — that is the authoritative source. The root `src/` appears to be an older/duplicate copy.
