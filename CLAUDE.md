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

This is a browser-based competitive FPS built on Three.js with a Node.js WebSocket server for multiplayer. The shipping build is a 1v1 arena duel (Roman coliseum map, first-to-2 kills, 3s respawn) — see the DUEL flag in server/server.js. The legacy island Battle Royale mode is retained behind that flag and in the git history but is not the current product.

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
- **Rooms**: auto-fill rooms (up to 20 players, immediate countdown) and PvP lobby rooms (waiting for majority-ready vote, 3-minute fill timer fallback). Room phase flips to `playing` shortly after `startMatch` (enables strict movement validation).
- **Tick loop**: 60 Hz (`setInterval` at 16ms) — broadcasts binary world snapshots `[0x01][count][uint32 serverTimeMs]` + 17 bytes/player (id, flags, hp, armor, yaw, x/y/z int16 ×100). Events (hits etc.) go as JSON per tick.
- **Inputs**: binary `0x02` packets (24 bytes: seq, pos, yaw, pitch, keys) sent by clients at 60 Hz; JSON `move`/`input` also accepted.
- **Lag compensation**: per-player ~1.2s position history; `shoot` carries `at` (the shooter's interpolation render time on the server clock) and the target is rewound up to 800ms for the range check (≤600 units, damage capped at 200, max 15 shots/s).
- **Movement validation** (`tryMove`): free outside `playing` (game-controlled teleports); during play a 50 u/s speed budget per elapsed time, self-healing resync after 10 consecutive rejections. Server spawn must match client `CONFIG.prisonPos`.

Client netcode (12_main.js): snapshots are stamped with server time; the client estimates clock offset (windowed max of serverT−arrival, smoothed) and interpolates remote players on the server timeline with an adaptive 60–150ms delay, extrapolating up to 200ms across snapshot gaps. When served from localhost the client connects to `ws://localhost:8081` instead of the production Render server.

WebSocket message types: `join`, `move`/`input`, `ready`, `shoot`, `chat` → `joined`, `lobbyState`, `startMatch`, binary world snapshot, `events`, `chat`.

### Note on source location

**`build.sh` reads from `js/src/`** — that is the only source directory. (A stale duplicate `src/` at the repo root was deleted in July 2026; if it reappears, it is wrong.)
