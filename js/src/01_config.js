// Seeded RNG
var _seed = 123456;
function seededRand() {
  _seed ^= _seed << 13; _seed ^= _seed >> 17; _seed ^= _seed << 5;
  return ((_seed >>> 0) / 4294967296);
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js';

// ═══════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  islandSize: 253,
  volcanoRadius: 55,
  volcanoHeight: 22,       // Lower, more gradual
  cliffHeight: 35,
  cliffThickness: 10,
  waterBaseLevel: 0.05,

  prisonPos: { x: -105, z: 105 },
  prisonSize: 23,           // 15% larger
  prisonWallHeight: 10,

  moveSpeed: 8.64,          // −15% from 10.17 (player-tuned, second pass)
  adsSpeedMult: 0.65,
  strafeSpeedMult: 0.80,    // Lateral (A/D) input scaled to 80% of forward speed
  jumpForce: 9,
  gravity: 25,
  mouseSens: 0.0018,
  adsSens: 0.00108,
  adsFov: 55,
  normalFov: 75,
  playerHeight: 1.7,
  playerRadius: 0.25,
  moveSmoothing: 0.78,      // Acceleration smoothing — higher = smoother (~10 ticks to 90%)
  crouchHeight: 1.0,        // Camera height when crouched
  crouchSpeedMult: 0.5,     // 50% speed when crouched

  // ── Physics toggle ──
  // true  = new capsule sweep-and-slide (08b_physics.js) — sliding walls, fixed timestep, deterministic
  // false = legacy AABB system (checkCollisionAndStep) — original behaviour
  newPhysics: true,

  // ── Release profile ──
  // A "shelf" switch, like newPhysics: the battle-royale island build stays fully
  // intact and one flag-flip away. Nothing is deleted.
  //   mode:  'br'     = 20-player battle royale        | 'duel' = 1v1, first-to-2 kills, respawns
  //   world: 'island' = procedural volcano island      | 'arena' = Roman coliseum 1v1 MVP  ('city' = old flat plaza, shelved)
  // `mode` gates bots, the rising-water storm, matchmaking and win condition.
  // `world` selects the map; the actual geometry is swapped in build.sh (island
  // world files vs. city world files), so the island source stays untouched.
  // Baseline = current island BR; flipped to 'duel'/'city' at cutover once the
  // gates and city geometry are in place.
  mode: 'duel',
  world: 'arena',

  weapons: {
    m4: {
      name: 'M4', magSize: 30, fireRate: 130, auto: true,
      bodyDmg: 15, headDmg: 150,
      recoilHip: 0.020, recoilAds: 0.010,
      reloadTime: 2200, spread: 0.015, adsSpread: 0.0,
      range: 500,
    },
    pistol: {
      name: '1911', magSize: 15, fireRate: 180,
      bodyDmg: 15, headDmg: 150,
      recoilHip: 0.028, recoilAds: 0.014,
      reloadTime: 1500, spread: 0.025, adsSpread: 0.0,
      range: 400,
    }
  }
};

// ── Arena MVP (Roman coliseum, 1v1) — blockout parameters ──
// Source: docs/ARENA_BUILD_PARAMS.md. Consumed by js/src/03_arena.js to build the
// gray-box. Meters; origin (0,0) = center; +x east / +z south; 180° rotational
// symmetry (a point's partner = negate BOTH x and z). All values are tunables —
// adjust after the first walkthrough.
CONFIG.arena = {
  // Playable floor — 36m wide (x) × 56m long (z). Bowl walls enforce the real bound.
  bounds: { minX: -18, maxX: 18, minZ: -28, maxZ: 28 },
  floorColor: 0x33353a,   // legacy solid floor (superseded by A.floor paving below)

  // Floor paving palette — two-tone large-scale slabs + medallion/track/lane
  // inlays, merged into ONE vertex-colored buffer (03_arena.js). Kept dark on
  // purpose: the sun (dir 2.2) + blue hemisphere multiply these up to a readable
  // mid-grey; lighter values blow out. Muted warm greys only — no near-black/white
  // and no red/green (those stay reserved for HUD damage/kill language).
  floor: {
    slabA:     0x35342f,  // base paving grey (warm, muted)
    slabB:     0x3e3c34,  // second slab tone — ~15% lighter; low-contrast, no noise
    medallion: 0x444033,  // center medallion field (framing the dais)
    inlay:     0x4a4335,  // accent marble inlay — medallion border, track, lane lines
    groove:    0x2b2a24,  // dark seams — track edge + lane guides
    slab:      4.6,       // slab size (m): large paving = low visual frequency
  },

  // Podium wall — the field/stands barrier (breached only by the two tunnels).
  // 7m: unjumpable (jump apex ≈ 1.6m) and blocks all field-level shots, so it is
  // gameplay-equivalent to the old 18m wall; the decorative tiered stands rise
  // behind it (see the coliseum skin in 03_arena.js) to sell the height.
  wallHeight: 7,
  wallColor: 0xDCD3BC,    // warm marble podium (less blown-out in sun)
  tierColorDark: 0xA99B7C,

  // Central high ground — a circular stepped dais topped by the Atlas statue
  // (built in 03_arena.js). height drives the step count; MUST break the
  // spawn-to-spawn sightline. color = dais marble.
  monument: { x: 0, z: 0, sizeX: 11, sizeZ: 9, height: 2.0, color: 0xC9C2B0 },

  // Spawns sit at the very BACK of the tunnels, facing arena center (facing = +z/−z).
  spawns: [
    { id: 'A', x: 0, z: -42.5, facing:  1 },
    { id: 'B', x: 0, z:  42.5, facing: -1 },
  ],

  // Enclosed tunnels (ceiling + black walls) breaching the N/S walls; length 18.4
  // (+15%) = a longer, darker walk-in so the spawn reads as a shadowed corridor with
  // the bright arena framed ahead; height 6 = a taller/grander corridor.
  tunnel: { width: 6, length: 18.4, height: 6, color: 0x0a0a0c },

  // Cover objects — each has its 180°-rotational partner (negate x AND z).
  //   container 6×2.6×2.5m → full standing cover | crate 1.5³m → crouch cover.
  cover: [
    { id: 'pocketAL', type: 'container', x:  -8.1, z: -17, rotationY: 90 },
    { id: 'pocketAR', type: 'container', x:   8.1, z: -17, rotationY: 90 },
    { id: 'pocketBL', type: 'container', x:  -8.1, z:  17, rotationY: 90 },
    { id: 'pocketBR', type: 'container', x:   8.1, z:  17, rotationY: 90 },
    // Step-up crates for all four tunnel-mouth (pocket) containers — one hugging
    // the INNER (map-center) side of each container at its tunnel-facing back end,
    // so players exiting a tunnel can hop crate (top 1.5m) → container top (3m;
    // jump apex ~1.6m). Flush to the inner face (x ±5.9). Two 180° pairs (AR↔BL, AL↔BR).
    { id: 'stepAR',   type: 'crate',     x:   5.9, z: -20.5 },
    { id: 'stepAL',   type: 'crate',     x:  -5.9, z: -20.5 },
    { id: 'stepBR',   type: 'crate',     x:   5.9, z:  20.5 },
    { id: 'stepBL',   type: 'crate',     x:  -5.9, z:  20.5 },
    { id: 'laneWN',   type: 'container', x: -12, z:  -9, rotationY:  0 },
    { id: 'laneWS',   type: 'container', x: -12, z:   9, rotationY:  0 },
    { id: 'laneEN',   type: 'container', x:  12, z:  -9, rotationY:  0 },
    { id: 'laneES',   type: 'container', x:  12, z:   9, rotationY:  0 },
    { id: 'crateN',   type: 'crate',     x:-3.5, z:  -8, rotationY:  0 },
    { id: 'crateS',   type: 'crate',     x: 3.5, z:   8, rotationY:  0 },
    // Crate cover flanking the dais (east) + its 180° mirror (west). A 2-high
    // stack (stack:2) with a single crate flush alongside (−z), plus a single
    // crate on the stack's OUTER face (+x, further from the dais/stairs) → a
    // corner-wrapping cluster. Scooted ~2ft further out (x 8 → 8.6).
    { id: 'LstackE',  type: 'crate',     x:  8.6, z: -3,   stack: 2 },
    { id: 'LfootE',   type: 'crate',     x:  8.6, z: -4.5 },
    { id: 'LsideE',   type: 'crate',     x: 10.1, z: -3   },
    { id: 'LstackW',  type: 'crate',     x: -8.6, z:  3,   stack: 2 },
    { id: 'LfootW',   type: 'crate',     x: -8.6, z:  4.5 },
    { id: 'LsideW',   type: 'crate',     x:-10.1, z:  3   },
  ],
  containerSize: { x: 6.9, y: 3.0, z: 2.9 },   // +15% (more cover)
  crateSize:     { x: 1.5, y: 1.5, z: 1.5 },
  containerColor: 0x27578A,   // rustic navy
  crateColor:     0x7A6038,   // darker weathered wood
};

// Player spawn point, resolved from the active world so the initial camera
// (02_setup) and the physics seed are correct from load. Arena duel spawns come
// from CONFIG.arena.spawns (A = north tunnel mouth); this is the bootstrap default.
CONFIG.spawnPos =
    CONFIG.world === 'arena' ? { x: CONFIG.arena.spawns[0].x, z: CONFIG.arena.spawns[0].z }
  : CONFIG.world === 'city'  ? { x: 0, z: -50 }
  :                            CONFIG.prisonPos;

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
const state = {
  // Multiplayer
  ws: null,
  myId: null,
  inLobby: false,
  inputSeq: 0,
  remotePlayers: {},
  lastServerTick: 0,

  locked: false,
  moveForward: false, moveBack: false, moveLeft: false, moveRight: false,
  velocityY: 0, isGrounded: true,
  ads: false, crouching: false, smoothCameraHeight: 1.7,
  sliding: false, slideCooldown: 0,
  currentWeapon: 'm4',
  ammo: { m4: 0, pistol: 0 },
  reserveAmmo: { m4: 0, pistol: 0 },
  hp: 100, armor: 0,
  canFire: true, firing: false, nextFireAt: 0, reloading: false, reloadPhase: null, switching: false, switchPhase: null,
  shootingUntil: 0,   // performance.now() deadline — keeps the network "shooting" flag up briefly per shot

  nearbyLoot: null,
  kills: 0,
  // Match state
  matchTime: 0,
  sprintTimer: 0,
  waterRising: false,
  waterLevel: 0.05,
  waterRiseStart: 146,
  matchDuration: 600,
  waterDmgTimer: 0,
  // Game phase: 'lobby' → 'countdown' → 'playing' → 'gameover' | 'victory'
  phase: 'lobby',
  countdownTime: 10,
  playerDead: false,
  spectateIndex: 0,
  spectateMode: null,      // null | '1st' | '3rd'
  spectateYaw: 0,
  erupted: false,
  // Kill-cam
  killCamActive: false,
  killCamMode: 'follow',      // 'follow' = 3rd-person live behind killer | 'pov' = snapshot replay
  killCamShooterId: null,
  killCamBotIndex: -1,
  killCamBuffer: [],          // killer's snapshot replay data
  killCamPlayerBuffer: [],    // player's snapshot replay data (aligned to killer buffer)
  killCamShotTimes: [],       // relT values of killer's shots during the replay window
  killCamReplayDuration: 5.0,
  killCamPlayTime: 0,
  killCamDuration: 3.0,
  killCamVictimPos: null,
  playerSnapshots: [],        // rolling 30s of player position history
  // Stat tracking
  shotsFired: 0,
  shotsHit: 0,
};
