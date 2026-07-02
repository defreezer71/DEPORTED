// ═══════════════════════════════════════════════════════════
// CITY ARENA — flat 120u duel map
// Replaces the island world files (03_terrain / 04_world / 05_jungle)
// in the build; see build.sh. The island source is left untouched on
// the shelf. To restore the island: swap the filenames back in build.sh
// and set CONFIG.world='island' / CONFIG.mode='br'.
//
// This module honours the same "world contract" the rest of the code
// expects from the island files:
//   • const half                      — world-bound clamp (12_main), loot, bots
//   • getTerrainHeight/GroundHeight    — physics floor + assorted consumers
//   • getVolcanoHeight                 — shooting LOS (returns 0 → never blocks)
//   • isInStream/isInCanalWater        — jungle-only no-ops (safety stubs)
//   • pushes solid geometry into `collidables` (movement, 08b_physics)
//     AND `targets` (bullet raycast in 11_gameplay) — same as prison walls,
//     so every building/crate/wall is real cover that blocks shots.
// ═══════════════════════════════════════════════════════════

const ARENA = 120;
const half = ARENA / 2;   // 60

// ── Flat-world contract: ground is y=0 everywhere, no volcano, no canal ──
function getTerrainHeight(x, z) { return 0; }
function getGroundHeight(x, z)  { return 0; }
function getVolcanoHeight(x, z) { return 0; }
function isInStream(x, z)       { return false; }
function isInCanalWater(x, z)   { return false; }

// ── Duel spawns (180°-rotationally symmetric). The server assigns A/B per
// player; the solo/map-test uses A. Kept here so client + server share the
// exact numbers (movement validation rejects a client/server spawn mismatch). ──
const CITY_SPAWNS = [
  { x: 0, z: -50, yaw: 0 },        // A — north end, faces +z toward center
  { x: 0, z:  50, yaw: Math.PI },  // B — south end, faces -z
];
CONFIG.spawnPos = CITY_SPAWNS[0];  // default client spawn (overrides the island default)

// ── Materials ──
const _groundMat = new THREE.MeshLambertMaterial({ color: 0x3b3d42 }); // asphalt plaza
const _bldgMat   = new THREE.MeshLambertMaterial({ color: 0x6b6f76 }); // corner buildings
const _sideMat   = new THREE.MeshLambertMaterial({ color: 0x585c63 }); // side buildings
const _monMat    = new THREE.MeshLambertMaterial({ color: 0x8a7f6a }); // monument (stone)
const _crateMat  = new THREE.MeshLambertMaterial({ color: 0x8a6a3a }); // crate cover
const _wallMat   = new THREE.MeshLambertMaterial({ color: 0x4a4d53 }); // perimeter facade

// ── Ground plane ──
{
  const g = new THREE.Mesh(new THREE.PlaneGeometry(ARENA, ARENA), _groundMat);
  g.rotation.x = -Math.PI / 2;
  g.receiveShadow = true;
  scene.add(g);
}

// ── Solid box helper — a visible box that blocks BOTH movement and bullets.
// Pushed to `collidables` (physics sweep) and `targets` (shot raycast), the
// same contract the prison walls use. updateMatrixWorld(true) so the physics
// Box3.setFromObject() and the raycaster both see a correct world transform. ──
function addCityBox(w, h, d, x, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  m.updateMatrixWorld(true);
  scene.add(m);
  collidables.push(m);
  targets.push(m);
  return m;
}

// ── Perimeter walls — ring at ±60, unjumpable (jump apex ≈ 1.6u) ──
{
  const H = 12, T = 2, span = ARENA + T;
  addCityBox(span, H, T, 0, -half - T / 2, _wallMat); // north
  addCityBox(span, H, T, 0,  half + T / 2, _wallMat); // south
  addCityBox(T, H, ARENA, -half - T / 2, 0, _wallMat); // west
  addCityBox(T, H, ARENA,  half + T / 2, 0, _wallMat); // east
}

// ── Buildings ──
// Corners (±24, ±38) @ 22×15, height 11 — also double as spawn cover.
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  addCityBox(22, 11, 15, sx * 24, sz * 38, _bldgMat);
}
// Side buildings (±52, 0) @ 10×28 — form the N–S flank alleys.
addCityBox(10, 11, 28, -52, 0, _sideMat);
addCityBox(10, 11, 28,  52, 0, _sideMat);

// ── Monument (0,0) @ 8×8×10 — kills the straight S1↔S2 spawn sightline ──
addCityBox(8, 10, 8, 0, 0, _monMat);

// ── Crates — full-block cover (block bullets + movement), ~1.6u tall ──
// (0, ±18), (±26, 0), (±12, ∓8) — 180°-symmetric advance cover.
for (const [cx, cz] of [[0, -18], [0, 18], [-26, 0], [26, 0], [-12, 8], [12, -8]]) {
  addCityBox(3, 1.6, 3, cx, cz, _crateMat);
}
