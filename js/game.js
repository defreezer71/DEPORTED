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
// ═══════════════════════════════════════════════════════════
// THREE.JS SETUP
// ═══════════════════════════════════════════════════════════
const scene = new THREE.Scene();
scene.background = null;
scene.fog = new THREE.FogExp2(0x4a9fe8, 0.0018);

// ── Sky dome — gradient sphere viewed from inside ──
{
  const skyGeo = new THREE.SphereGeometry(880, 32, 20);
  const sp = skyGeo.attributes.position;
  const sc = new Float32Array(sp.count * 3);
  // [y threshold, r, g, b] — sampled top-down
  const stops = [
    [ 880,  0.075, 0.210, 0.520 ],  // zenith — deep blue (not black)
    [ 440,  0.072, 0.260, 0.640 ],  // upper sky
    [   0,  0.095, 0.400, 0.840 ],  // mid sky at horizon level
    [-880,  0.180, 0.580, 0.960 ],  // nadir — pale (underground, irrelevant)
  ];
  for (let i = 0; i < sp.count; i++) {
    const y = sp.getY(i);
    let s0 = stops[0], s1 = stops[stops.length - 1];
    for (let k = 0; k < stops.length - 1; k++) {
      if (y >= stops[k + 1][0]) { s0 = stops[k]; s1 = stops[k + 1]; break; }
    }
    const t = Math.max(0, Math.min(1, (s0[0] - y) / (s0[0] - s1[0])));
    sc[i*3]   = s0[1] + (s1[1] - s0[1]) * t;
    sc[i*3+1] = s0[2] + (s1[2] - s0[2]) * t;
    sc[i*3+2] = s0[3] + (s1[3] - s0[3]) * t;
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  window.skyDome = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false
  }));
  window.skyDome.renderOrder = -1;
  scene.add(window.skyDome);
}

// ── Clouds — low-poly faceted cumulus + straight jet contrails ──
{
  const _cd = new THREE.Object3D();

  // Faceted cloud geometry: a few flattened, jittered icosahedron lobes merged into
  // one non-indexed buffer (matches the polygon-art trees). Bottom is clamped flat.
  const cloudGeo = (() => {
    const lobes = [
      [ 0.0, 0.00,  0.0, 1.00],
      [ 1.15, 0.05,  0.20, 0.72],
      [-1.05, 0.02, -0.15, 0.66],
      [ 0.45, 0.38, -0.28, 0.58],
      [-0.45, 0.32,  0.25, 0.52],
    ];
    const pos = [];
    const v = new THREE.Vector3();
    for (const [lx, ly, lz, s] of lobes) {
      const g = new THREE.IcosahedronGeometry(1, 0);
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const n = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719 + s * 91.7) * 43758.5453;
        v.multiplyScalar(0.85 + (n - Math.floor(n)) * 0.30);
        // squash vertically, offset, flatten the underside
        const wy = Math.max(v.y * 0.55 * s + ly, -0.30);
        pos.push(v.x * s + lx, wy, v.z * 0.80 * s + lz);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.computeVertexNormals(); // non-indexed → per-face normals = facets
    return g;
  })();
  // Lambert + soft emissive: sunlit facets go white, undersides a gentle blue-grey
  const cloudMat = new THREE.MeshLambertMaterial({
    color: 0xdde6ee, emissive: 0x4d5866, fog: false
  });

  const PUFF_COUNT = 12;
  const puffInst = new THREE.InstancedMesh(cloudGeo, cloudMat, PUFF_COUNT);
  for (let i = 0; i < PUFF_COUNT; i++) {
    const angle  = (i / PUFF_COUNT) * Math.PI * 2 + seededRand() * 0.5; // evenly spaced
    const radius = 60 + seededRand() * 560;
    const s      = 22 + seededRand() * 26;
    _cd.position.set(Math.cos(angle) * radius, 130 + seededRand() * 110, Math.sin(angle) * radius);
    _cd.scale.set(s, s * (0.8 + seededRand() * 0.4), s);
    _cd.rotation.set(0, seededRand() * Math.PI * 2, 0);
    _cd.updateMatrix();
    puffInst.setMatrixAt(i, _cd.matrix);
  }
  puffInst.instanceMatrix.needsUpdate = true;
  scene.add(puffInst);

  // ── Jet contrails — long straight lines crossing the whole sky ──
  // 256×16 canvas: crisp head (right) dissolving into a wider faint tail (left)
  const tc = document.createElement('canvas');
  tc.width = 256; tc.height = 16;
  const tx = tc.getContext('2d');
  for (let px = 0; px < 256; px++) {
    const t = px / 255;                       // 0 = tail, 1 = head
    const spread = 6.5 - t * 3.0;             // tail wider (dispersed), head tighter
    // Envelope rises from nothing at the tail, peaks near the head, then dissolves —
    // both ends fade out so a trail never visibly "stops" mid-sky.
    const env = Math.sin(Math.min(1, t / 0.85) * Math.PI * 0.5) * (t > 0.92 ? (1 - t) / 0.08 : 1);
    const alpha = 0.90 * env;
    const grad = tx.createLinearGradient(0, 8 - spread, 0, 8 + spread);
    grad.addColorStop(0,   'rgba(255,255,255,0)');
    grad.addColorStop(0.5, `rgba(255,255,255,${alpha.toFixed(2)})`);
    grad.addColorStop(1,   'rgba(255,255,255,0)');
    tx.fillStyle = grad;
    tx.fillRect(px, 0, 1, 16);
  }
  const trailTex = new THREE.CanvasTexture(tc);
  const trailMat = new THREE.MeshBasicMaterial({
    map: trailTex, transparent: true, opacity: 0.85,
    depthWrite: false, side: THREE.DoubleSide, fog: false
  });

  // Each contrail: its own compass heading, offset sideways from the island centre
  // so the set crisscrosses the sky instead of converging overhead.
  const TRAIL_COUNT = 6;
  const trailInst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), trailMat, TRAIL_COUNT);
  trailInst.renderOrder = 1;
  for (let i = 0; i < TRAIL_COUNT; i++) {
    const heading = (i / TRAIL_COUNT) * Math.PI + seededRand() * 0.45; // spread headings
    const offset  = (seededRand() - 0.5) * 700;                       // sideways from centre
    const along   = (seededRand() - 0.5) * 300;                       // shift along the line
    const px2 = Math.cos(heading + Math.PI / 2) * offset + Math.cos(heading) * along;
    const pz2 = Math.sin(heading + Math.PI / 2) * offset + Math.sin(heading) * along;
    _cd.position.set(px2, 330 + seededRand() * 90, pz2);
    _cd.scale.set(2100 + seededRand() * 400, 26 + seededRand() * 18, 1);  // span the sky, soft-fading ends
    _cd.rotation.set(-Math.PI / 2, 0, -heading);
    _cd.updateMatrix();
    trailInst.setMatrixAt(i, _cd.matrix);
  }
  trailInst.instanceMatrix.needsUpdate = true;
  scene.add(trailInst);
}

// Sun
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(32, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xFFEE88, fog: false })
);
sunMesh.position.set(210, 367, -157);
sunMesh.renderOrder = 0;
// The visible sun DISC lives on layer 1: the in-game camera enables layer 1 (below) so
// the sun still shows in play, but the menu drone camera stays on layer 0 and never
// orbits into a giant sun. The sun LIGHT is a separate object — lighting is unchanged.
sunMesh.layers.set(1);
scene.add(sunMesh);

const camera = new THREE.PerspectiveCamera(CONFIG.normalFov, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(CONFIG.spawnPos.x, CONFIG.playerHeight, CONFIG.spawnPos.z);
camera.layers.enable(1);   // see the sun disc (layer 1); the menu drone camera does not
const weaponScene = new THREE.Scene();
const weaponAmbient = new THREE.AmbientLight(0xffffff, 0.8);
weaponScene.add(weaponAmbient);
const weaponSun = new THREE.DirectionalLight(0xffffff, 0.6);
weaponSun.position.set(1, 2, 1);
weaponScene.add(weaponSun);
const weaponCamera = new THREE.PerspectiveCamera(CONFIG.normalFov, window.innerWidth / window.innerHeight, 0.01, 10);
weaponCamera.position.set(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
// Adaptive resolution. The render scale (pixel ratio) is the dominant GPU fill
// cost — at 1.5× on a laptop GPU, screen-filling moments (clustered bodies, the
// full-screen damage vignette, shadows) blow the pixel budget and drop frames.
// Normal play stays at the full 1.5× (no visible change); the game loop
// (_adaptResolution) only lowers it toward 0.7 while frames are actually heavy and
// raises it straight back when they clear — so 60fps holds through the heavy spots
// and you only ever lose sharpness mid-action, where it's invisible.
window._maxPR = Math.min(window.devicePixelRatio, 1.5);
window._minPR = 0.7;
window._curPR = window._maxPR;
renderer.setPixelRatio(window._curPR);
renderer.setClearColor(0x1a4d8a, 1);
renderer.shadowMap.enabled = true;
renderer.autoClear = false;
// The world is static — only characters move — so we don't regenerate the shadow
// map every frame. autoUpdate off; the loop sets needsUpdate at ~30Hz (12_main.js).
renderer.shadowMap.autoUpdate = false;
// PCF (not PCFSoft): soft shadows multiply the per-pixel tap count across the
// whole frame — too costly at this resolution for a barely visible difference.
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.domElement.style.position = 'fixed';
renderer.domElement.style.inset = '0';
renderer.domElement.style.zIndex = '0';
document.body.appendChild(renderer.domElement);

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const collidables = [];
const targets = [];
const lootItems = [];
const bots = [];

// Debug hooks — game.js is an ES module, so expose key objects for console tuning.
window.DBG = { state, scene, camera, bots, THREE, renderer };

// Draw-call probe — run DBG.perfProbe() in the console anywhere (e.g. standing in
// the prison or at the canal) to see exactly where the draw calls go: total scene
// meshes, how many cast shadows, and the split between the main pass and the
// shadow pass. Renders twice (with/without shadows) to measure the shadow cost.
window.DBG.perfProbe = function () {
  let meshes = 0, visible = 0, casters = 0, instanced = 0, skinned = 0;
  scene.traverse(o => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    meshes++;
    if (o.visible) visible++;
    if (o.castShadow) casters++;
    if (o.isInstancedMesh) instanced++;
    if (o.isSkinnedMesh) skinned++;
  });
  // Current-view draw-call split (main vs shadow pass) + live tri count for this view.
  const wasEnabled = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  const withShadow = renderer.info.render.calls, tris = renderer.info.render.triangles;
  renderer.shadowMap.enabled = false;
  renderer.render(scene, camera);
  const mainOnly = renderer.info.render.calls;
  // 360° yaw sweep from where you're standing — quantifies the no-occlusion-culling
  // swing in draw calls (face the open island and the whole map draws even behind
  // walls; face a cliff and almost nothing does). Shadows off for speed; the camera
  // is restored afterward and the next frame re-derives it from state.yaw anyway.
  const savedQuat = camera.quaternion.clone();
  const sweepEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  let minC = Infinity, maxC = 0, minYaw = 0, maxYaw = 0, minT = Infinity, maxT = 0;
  for (let k = 0; k < 24; k++) {
    sweepEuler.set(-0.12, (k / 24) * Math.PI * 2, 0);
    camera.quaternion.setFromEuler(sweepEuler);
    camera.updateMatrixWorld(true);
    renderer.render(scene, camera);
    const c = renderer.info.render.calls, t = renderer.info.render.triangles;
    if (c < minC) { minC = c; minYaw = k * 15; }
    if (c > maxC) { maxC = c; maxYaw = k * 15; }
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }
  camera.quaternion.copy(savedQuat);
  camera.updateMatrixWorld(true);
  renderer.shadowMap.enabled = wasEnabled;
  renderer.shadowMap.needsUpdate = true;
  const mem = renderer.info.memory;
  console.log(`[probe] scene meshes ${meshes} | visible ${visible} | skinned ${skinned} | shadow-casters ${casters} | instanced ${instanced} | geom ${mem.geometries} | tex ${mem.textures}`);
  console.log(`[probe] this view — draw calls total ${withShadow} = main ${mainOnly} + shadow ${withShadow - mainOnly} | tris ${(tris/1000)|0}k`);
  console.log(`[probe] 360° sweep — calls ${minC} (@${minYaw}°) … ${maxC} (@${maxYaw}°) | tris ${(minT/1000)|0}k … ${(maxT/1000)|0}k`);
  // Return a structured snapshot too, so a headless harness (tools/perf-capture.mjs)
  // can read the numbers reliably instead of scraping console text. These COUNTS are
  // GPU-independent and exact even under software rendering; frame *time* is not
  // captured here (that needs a real on-device GPU).
  return {
    ts: new Date().toISOString(),
    world: (typeof CONFIG !== 'undefined' && CONFIG.world) || null,
    mode:  (typeof CONFIG !== 'undefined' && CONFIG.mode)  || null,
    scene: { meshes, visible, skinned, shadowCasters: casters, instanced,
             geometries: mem.geometries, textures: mem.textures,
             programs: renderer.info.programs ? renderer.info.programs.length : null },
    view:  { calls: withShadow, mainCalls: mainOnly, shadowCalls: withShadow - mainOnly, tris },
    sweep: { minCalls: minC, minCallsYaw: minYaw, maxCalls: maxC, maxCallsYaw: maxYaw,
             minTris: minT, maxTris: maxT },
    shadowsEnabled: wasEnabled,
  };
};

// ═══════════════════════════════════════════════════════════
// LIGHTING
// ═══════════════════════════════════════════════════════════
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const sun = new THREE.DirectionalLight(0xfffbe8, 2.2);
sun.position.set(210, 367, -157);
sun.castShadow = true;
// 1024² (was 2048²): quarters the shadow fill/regeneration cost. The faceted,
// low-poly art hides the lower resolution well.
sun.shadow.mapSize.set(1024, 1024);
// The shadow frustum used to be 340×340 — the WHOLE island — so every shadow
// update re-rendered every tree, prison mesh and column on the map, a huge fixed
// draw-call cost. Now it's a small box that FOLLOWS the player (updated each frame
// in the game loop), so the shadow pass only draws casters near you. Bonus: 1024²
// over a 140×140 area is far sharper than over 340×340.
sun.shadow.camera.near = 1; sun.shadow.camera.far = 360;
sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
sun.shadow.bias = -0.0004; // tighter texels — small negative bias avoids acne
scene.add(sun);
scene.add(sun.target); // directional light + target follow the player each frame
// Light travel direction (sun → origin), kept constant so the SHADING direction
// never changes even as we slide the light to keep the player centered.
window._sunDir = sun.position.clone().normalize().negate();
window._sunDist = 170; // how far up-light the sun sits from the player
scene.add(new THREE.HemisphereLight(0x4488ff, 0x2d7a0a, 0.7));

// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// ARENA — Roman coliseum 1v1 MVP (gray-box blockout)
// Replaces the island world files (03_terrain / 04_world / 05_jungle) in the
// build; see build.sh. Also supersedes the older flat "city plaza" (03_city.js),
// which stays on the shelf. Built from CONFIG.arena (docs/ARENA_BUILD_PARAMS.md).
//
// Honours the same "world contract" as the island files:
//   • const half                    — world-bound safety clamp (12_main, physics)
//   • getTerrainHeight/GroundHeight  — physics floor (flat, y=0)
//   • getVolcanoHeight               — shooting LOS (0 → never blocks)
//   • isInStream/isInCanalWater      — jungle-only no-ops (safety stubs)
//   • pushes solid geometry into `collidables` (movement) AND `targets` (bullet
//     raycast, 11_gameplay) so every wall/container/crate is real cover.
//
// GRAY-BOX ONLY: axis-aligned boxes, flat Lambert colors, no Roman detailing and
// no instancing yet (that is the skinning pass, step 4 of the spec). Perf budget:
// no realtime shadows (disabled below); 1 dir + 1 ambient light from 02_setup.
// ═══════════════════════════════════════════════════════════

const A = CONFIG.arena;

// Safety-net world clamp. The arena is rectangular with tunnels poking past the
// bowl (z ≈ ±38), so `half` is a loose square net that contains everything while
// the bowl-wall collision does the real containment.
const half = 48;

// ── Flat-world contract ──
function getTerrainHeight(x, z) { return 0; }
function getGroundHeight(x, z)  { return 0; }
function getVolcanoHeight(x, z) { return 0; }
function isInStream(x, z)       { return false; }
function isInCanalWater(x, z)   { return false; }

// Duel spawns (server assigns A/B; solo/map-test uses A). Kept aligned with the
// server spawn — movement validation rejects a client/server spawn mismatch.
const ARENA_SPAWNS = A.spawns;

// ── Materials (muted palette so player silhouettes read loudest on screen) ──
// (Floor uses its own vertex-colored merged buffer — see the paving block below.)
const _wallMat      = new THREE.MeshLambertMaterial({ color: A.wallColor });
const _tunnelMat    = new THREE.MeshBasicMaterial({ color: A.tunnel.color }); // unlit flat black — enclosed tunnel; no lighting gradient means no dither/banding
const _monMat       = new THREE.MeshLambertMaterial({ color: A.monument.color });
const _containerMat = (() => {
  // Corrugated shipping-container skin — vertical ridges (highlight+shadow bands)
  // baked into a CanvasTexture over the base blue, plus darker top/bottom rails.
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#' + A.containerColor.toString(16).padStart(6, '0');
  x.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 128; i += 8) {
    x.fillStyle = 'rgba(255,255,255,0.10)'; x.fillRect(i, 0, 3, 64);      // ridge highlight
    x.fillStyle = 'rgba(0,0,0,0.16)';       x.fillRect(i + 4, 0, 3, 64);  // ridge shadow
  }
  x.fillStyle = 'rgba(0,0,0,0.30)'; x.fillRect(0, 0, 128, 6); x.fillRect(0, 58, 128, 6); // rails
  return new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) });
})();
const _crateMat = (() => {
  // Wooden crate skin — vertical planks with grain + gaps, a raised border frame with
  // corner bolts, and a diagonal cross-brace board. One CanvasTexture on all 6 faces.
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#7a5c34'; g.fillRect(0, 0, 128, 128);
  const planks = 5, pw = 128 / planks;
  for (let i = 0; i < planks; i++) {
    g.fillStyle = 'rgba(' + (92 + Math.random() * 30 | 0) + ',' + (70 + Math.random() * 24 | 0) + ',' + (42 + Math.random() * 18 | 0) + ',0.55)';
    g.fillRect(i * pw + 1, 0, pw - 2, 128);
    g.strokeStyle = 'rgba(40,28,14,0.28)'; g.lineWidth = 1;
    for (let k = 0; k < 3; k++) { const gx = i * pw + 3 + Math.random() * (pw - 6); g.beginPath(); g.moveTo(gx, 0); g.lineTo(gx + Math.random() * 4 - 2, 128); g.stroke(); }
    g.fillStyle = 'rgba(18,11,4,0.55)'; g.fillRect(i * pw + pw - 1.5, 0, 1.5, 128);   // plank gap
  }
  g.lineWidth = 15; g.strokeStyle = '#5f4426';                                        // diagonal brace board
  g.beginPath(); g.moveTo(16, 112); g.lineTo(112, 16); g.stroke();
  g.strokeStyle = 'rgba(255,222,170,0.10)'; g.lineWidth = 2; g.beginPath(); g.moveTo(11, 107); g.lineTo(107, 11); g.stroke();
  const fr = 12;                                                                       // border frame rails
  g.fillStyle = '#5a4126';
  g.fillRect(0, 0, 128, fr); g.fillRect(0, 128 - fr, 128, fr); g.fillRect(0, 0, fr, 128); g.fillRect(128 - fr, 0, fr, 128);
  g.fillStyle = 'rgba(255,226,176,0.16)'; g.fillRect(0, 0, 128, 2); g.fillRect(0, 0, 2, 128); g.fillRect(0, fr - 2, 128, 2); g.fillRect(fr - 2, 0, 2, 128);
  g.fillStyle = 'rgba(0,0,0,0.32)';       g.fillRect(0, 126, 128, 2); g.fillRect(126, 0, 2, 128); g.fillRect(0, 128 - fr, 128, 2); g.fillRect(128 - fr, 0, 2, 128);
  g.fillStyle = '#241f18';                                                             // iron bolts at joints
  for (const p of [[6, 6], [122, 6], [6, 122], [122, 122], [64, 6], [64, 122], [6, 64], [122, 64]]) { g.beginPath(); g.arc(p[0], p[1], 2.3, 0, 7); g.fill(); }
  return new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) });
})();

const DEG = Math.PI / 180;

// Solid box — visible, blocks BOTH movement (collidables) and bullets (targets),
// the same contract the prison walls use. updateMatrixWorld(true) so the physics
// Box3.setFromObject() and the raycaster see a correct world transform. For 0°/90°
// rotations the world AABB stays tight (90° just swaps x/z extents), so the AABB
// collider matches the visible box exactly. No shadows (MVP perf budget).
function addArenaBox(w, h, d, x, z, mat, rotYdeg = 0, yCenter = h / 2) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, yCenter, z);
  if (rotYdeg) m.rotation.y = rotYdeg * DEG;
  m.updateMatrixWorld(true);
  scene.add(m);
  collidables.push(m);
  targets.push(m);
  return m;
}

// ── Aged limestone-block material (shared by both barrel-vault tunnels). Baked into
// one CanvasTexture: warm base + running-bond courses with mortar shadow lines, per-
// block tint variation, grime noise and top-down weathering streaks. RepeatWrapping
// so tunnel UVs (arc-length × length, ~1.6 u/block) tile it. DoubleSide so the vault
// shell lights from inside regardless of winding. Zero extra geometry — the block
// look is entirely in the texture. ──
const _stoneTex = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#a99a7d'; g.fillRect(0, 0, 256, 256);           // warm limestone base
  for (let i = 0; i < 1600; i++) {                                // grime speckle
    g.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.06) + ')';
    g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, Math.random() * 2 + 0.4, 0, 7); g.fill();
  }
  const rows = 3, rh = 256 / rows, cols = 3, cw = 256 / cols;     // chunky voussoir-scale blocks
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) ? cw / 2 : 0;                             // running bond
    for (let ci = -1; ci < cols; ci++) {
      const bx = ci * cw + off, by = r * rh;
      g.fillStyle = 'rgba(' + (150 + Math.random() * 40 | 0) + ',' + (135 + Math.random() * 35 | 0) +
                    ',' + (105 + Math.random() * 30 | 0) + ',' + (0.22 + Math.random() * 0.28) + ')';
      g.fillRect(bx + 1.5, by + 1.5, cw - 3, rh - 3);            // per-block tint
      g.strokeStyle = 'rgba(38,30,20,0.60)'; g.lineWidth = 2.5;
      g.strokeRect(bx + 1.5, by + 1.5, cw - 3, rh - 3);          // mortar shadow
      g.strokeStyle = 'rgba(255,246,224,0.14)'; g.lineWidth = 1; // top/left highlight
      g.beginPath(); g.moveTo(bx + 3, by + rh - 3); g.lineTo(bx + 3, by + 3); g.lineTo(bx + cw - 3, by + 3); g.stroke();
    }
  }
  for (let i = 0; i < 9; i++) {                                   // top-down weathering streaks
    const x = Math.random() * 256, grd = g.createLinearGradient(x, 0, x, 256);
    grd.addColorStop(0, 'rgba(18,14,9,0.20)'); grd.addColorStop(1, 'rgba(18,14,9,0)');
    g.fillStyle = grd; g.fillRect(x, 0, 6 + Math.random() * 12, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
})();
// Unlit stone: the block look is all in the texture and depth is baked into vertex
// colors (buildVaultTunnel), so we dodge the scene's green HemisphereLight ground-
// bounce (0x2d7a0a) that would tint the vault's downward-facing inner ceiling.
//   _stoneMat     — vertex-colored, for the vault mesh.
//   _stoneFlatMat — plain (no per-vertex colors), for stone boxes (the tympanum).
const _stoneMat     = new THREE.MeshBasicMaterial({ map: _stoneTex, vertexColors: true, side: THREE.DoubleSide });
const _stoneFlatMat = new THREE.MeshBasicMaterial({ map: _stoneTex, side: THREE.DoubleSide });

// ── Invisible thin collider box — movement only (collidables), NOT drawn and NOT a
// bullet target. Used for the barrel-vault tunnels: an AABB collider can't be a
// concave vault, so the visible vault mesh can't double as the mover-collider; these
// simple boxes define the passable corridor and are occluded behind the vault. ──
function addTunnelCollider(w, h, d, x, z, yCenter = h / 2) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), _tunnelMat);
  m.position.set(x, yCenter, z);
  m.visible = false;
  m.updateMatrixWorld(true);
  scene.add(m);
  collidables.push(m);
  return m;
}

// ── Roman barrel-vault tunnel — ONE merged BufferGeometry (1 draw call). Cross-
// section: vertical side walls up to the springline (yS = H−R), then a semicircle of
// radius R = W/2 over the top; extruded straight from the mouth to the back. Contains
// the arch shell + a paved floor + the back cap (sealing the spawn). Renders + stops
// bullets (pushed to `targets`); movement is handled by addTunnelCollider boxes. ──
function buildVaultTunnel(zMouth, zBack, W, H, gapOuter, wallTop, mat) {
  const R = W / 2, yS = H - R, NA = 12, BLK = 3.6;    // BLK = world units per texture tile
  const prof = [];                                    // inner-surface profile, left→right, with arc-length s
  let s = 0;
  const add = (x, y) => {
    if (prof.length) { const p = prof[prof.length - 1]; s += Math.hypot(x - p.x, y - p.y); }
    prof.push({ x, y, s });
  };
  add(-R, 0); add(-R, yS);                            // left wall
  for (let i = 1; i <= NA; i++) { const a = Math.PI - (i / NA) * Math.PI; add(R * Math.cos(a), yS + R * Math.sin(a)); }
  add(R, 0);                                          // right wall (down to floor)

  const N = prof.length, pos = [], uv = [], col = [], idx = [];
  const warm = (b) => col.push(b, b * 0.98, b * 0.94);  // a hair warm
  // Baked faux-shading: crown darker than floor, and the back (spawn) end much
  // darker than the bright mouth so the corridor falls into shadow toward the
  // player and the arena reads as a lit reveal ahead. Both ends pulled well down
  // for a dim stone vault — a dark frame around the bright arena reveal (mouth
  // 0.62, deep back 0.24).
  const shade = (y, near) => warm((1.0 - 0.42 * (y / H)) * (near ? 0.62 : 0.24));

  // ── Arch shell (two rings: mouth, back) ──
  for (let r = 0; r < 2; r++) {
    const z = r === 0 ? zMouth : zBack;
    for (let i = 0; i < N; i++) { pos.push(prof[i].x, prof[i].y, z); uv.push(prof[i].s / BLK, z / BLK); shade(prof[i].y, r === 0); }
  }
  for (let i = 0; i < N - 1; i++) idx.push(i, N + i, i + 1, i + 1, N + i, N + i + 1);

  // ── Paved floor (just above the concourse) ──
  const fb = pos.length / 3, fY = 0.02;
  pos.push(-R, fY, zMouth, R, fY, zMouth, -R, fY, zBack, R, fY, zBack);
  uv.push(-R / BLK, zMouth / BLK, R / BLK, zMouth / BLK, -R / BLK, zBack / BLK, R / BLK, zBack / BLK);
  shade(0, true); shade(0, true); shade(0, false); shade(0, false);
  idx.push(fb, fb + 2, fb + 1, fb + 1, fb + 2, fb + 3);

  // ── Solid back cap — a flat stone wall sealing the spawn end (uniform dark, no
  // gradient swirl); spans past the arch and is pulled a touch inward so it OCCLUDES
  // the stand structure that used to poke through the old fan cap. ──
  const zCap = zBack + Math.sign(zMouth - zBack) * 0.3, cb = pos.length / 3;
  pos.push(-gapOuter, 0, zCap, gapOuter, 0, zCap, -gapOuter, wallTop, zCap, gapOuter, wallTop, zCap);
  uv.push(-gapOuter / BLK, 0, gapOuter / BLK, 0, -gapOuter / BLK, wallTop / BLK, gapOuter / BLK, wallTop / BLK);
  for (let k = 0; k < 4; k++) warm(0.15);   // dark back wall behind the spawn
  idx.push(cb, cb + 1, cb + 2, cb + 2, cb + 1, cb + 3);

  // ── Mouth facade — fills the bowl-wall gap AROUND the arch (side strips + the band
  // above the arch up to the wall top) so the stands aren't visible through the gap.
  // Leaves the arched doorway itself open. ──
  const face = (x0, x1, y0, y1) => {
    const q = pos.length / 3;
    pos.push(x0, y0, zMouth, x1, y0, zMouth, x0, y1, zMouth, x1, y1, zMouth);
    uv.push(x0 / BLK, y0 / BLK, x1 / BLK, y0 / BLK, x0 / BLK, y1 / BLK, x1 / BLK, y1 / BLK);
    for (let k = 0; k < 4; k++) warm(0.96);
    idx.push(q, q + 1, q + 2, q + 2, q + 1, q + 3);
  };
  face(-gapOuter, -R, 0, wallTop);                    // left strip
  face(R, gapOuter, 0, wallTop);                      // right strip
  const arch = [], top = [];                          // band between the arch curve and the wall top
  for (let i = 0; i <= NA; i++) {
    const a = Math.PI - (i / NA) * Math.PI, x = R * Math.cos(a), y = yS + R * Math.sin(a);
    let q = pos.length / 3; pos.push(x, y, zMouth);       uv.push(x / BLK, y / BLK);       warm(0.96); arch.push(q);
    q = pos.length / 3;     pos.push(x, wallTop, zMouth); uv.push(x / BLK, wallTop / BLK); warm(0.96); top.push(q);
  }
  for (let i = 0; i < NA; i++) idx.push(arch[i], arch[i + 1], top[i], top[i], arch[i + 1], top[i + 1]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, mat);
  m.updateMatrixWorld(true);
  scene.add(m);
  targets.push(m);                                    // bullets stop on the vault; movement uses the boxes
  return m;
}

// ── Arena floor — two-tone large-scale paving with a center medallion (framing
// the dais), a perimeter track frame and long-axis lane guides. Everything is
// merged into ONE vertex-colored BufferGeometry: 1 draw call, a few hundred tris,
// zero textures. Design brief (docs): big low-contrast slabs give strafe motion-
// parallax WITHOUT the high-frequency checkerboard noise that hurts target
// acquisition; medallion/track/lanes are positional callouts. Flat quads a few mm
// apart in y (base < overlays) dodge z-fighting. Purely decorative — not pushed to
// collidables/targets; the physics floor stays flat at y=0. The coliseum skin's
// dark stone concourse (below) fills the tunnels + everything past the bounds. ──
{
  const b = A.bounds, F = A.floor;
  const pos = [], col = [];
  const hex = (h) => [ (h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255 ];
  const cSlabA = hex(F.slabA), cSlabB = hex(F.slabB);
  const cMed   = hex(F.medallion), cInlay = hex(F.inlay), cGroove = hex(F.groove);

  // One top-facing XZ quad at height y in a flat color (winding matches the +y
  // face used elsewhere in this file; normals are forced up so lighting is right).
  function quad(x0, z0, x1, z1, y, c) {
    const v = [ [x0, z1], [x1, z1], [x1, z0],  [x0, z1], [x1, z0], [x0, z0] ];
    for (const [px, pz] of v) { pos.push(px, y, pz); col.push(c[0], c[1], c[2]); }
  }
  // Concentric ring band (annulus) between radii ri..ro as `seg` quads.
  function ring(ri, ro, y, c, seg = 72) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const P = (r, a) => [Math.cos(a) * r, Math.sin(a) * r];
      const [ix0, iz0] = P(ri, a0), [ix1, iz1] = P(ri, a1);
      const [ox0, oz0] = P(ro, a0), [ox1, oz1] = P(ro, a1);
      for (const [px, pz] of [[ix0,iz0],[ox0,oz0],[ox1,oz1], [ix0,iz0],[ox1,oz1],[ix1,iz1]])
        { pos.push(px, y, pz); col.push(c[0], c[1], c[2]); }
    }
  }
  // Rectangular border frame (4 strips) of thickness t, inset `ins` from bounds.
  function frame(ins, t, y, c) {
    const x0 = b.minX + ins, x1 = b.maxX - ins, z0 = b.minZ + ins, z1 = b.maxZ - ins;
    quad(x0, z0, x1, z0 + t, y, c);       // north edge
    quad(x0, z1 - t, x1, z1, y, c);       // south edge
    quad(x0, z0, x0 + t, z1, y, c);       // west edge
    quad(x1 - t, z0, x1, z1, y, c);       // east edge
  }

  // ── Layer 1: two-tone slabs (running-bond ashlar; tone persists in runs so
  // same-color slabs clump into LARGE shapes rather than salt-and-pepper). ──
  const S = F.slab, yBase = 0.012;
  let seed = 0x9e3779b1 >>> 0;            // deterministic per-load layout
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let row = 0;
  for (let z = b.minZ; z < b.maxZ - 1e-3; z += S, row++) {
    const z1 = Math.min(z + S, b.maxZ);
    const off = (row & 1) ? -S / 2 : 0;   // running bond: half-slab row offset
    let tone = rnd() < 0.5 ? cSlabA : cSlabB;
    for (let x = b.minX + off; x < b.maxX - 1e-3; x += S) {
      const x0 = Math.max(x, b.minX), x1 = Math.min(x + S, b.maxX);
      if (x1 - x0 < 0.05) continue;
      if (rnd() < 0.4) tone = (tone === cSlabA) ? cSlabB : cSlabA;  // occasional flip
      quad(x0, z, x1, z1, yBase, tone);
    }
  }

  // ── Layer 2 (overlays, +y so they win the depth test over the slabs) ──
  // Center medallion: a broad ring hugging the dais base (r 7.8), with an inlay
  // border and a dark seam separating it from the field — the mid-control marker.
  ring(7.9, 8.25, 0.020, cGroove);        // inner seam against the dais
  ring(8.25, 10.4, 0.018, cMed);          // medallion field
  ring(10.4, 10.8, 0.022, cInlay);        // outer inlay border
  ring(10.8, 11.1, 0.020, cGroove);       // outer seam

  // Perimeter track frame — the coliseum's field boundary, inset from the walls.
  frame(1.4, 0.35, 0.020, cInlay);        // bright boundary line
  frame(1.75, 0.18, 0.022, cGroove);      // thin groove just inside it

  // Long-axis lane guides — two thin lines down the flank routes (x ≈ ±11.5),
  // reading toward the objective; they duck under the lane containers at z ≈ ±9.
  for (const lx of [-11.5, 11.5]) quad(lx - 0.14, b.minZ + 2, lx + 0.14, b.maxZ - 2, 0.018, cInlay);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
  const N = pos.length / 3, norm = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) norm[i * 3 + 1] = 1;   // all faces point straight up
  geo.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  const floor = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(floor);
}

// ── Bowl walls — ring the playable bounds at A.wallHeight (unjumpable), breached
// only by the two tunnels on the north (−z) and south (+z) short ends. ──
{
  const b = A.bounds, H = A.wallHeight, T = 1;
  const gapHalf = A.tunnel.width / 2;               // 3
  const xL = b.minX - T / 2, xR = b.maxX + T / 2;   // ∓18.5
  const zN = b.minZ - T / 2, zS = b.maxZ + T / 2;   // ∓28.5
  const depth = b.maxZ - b.minZ;                    // 56

  // East / West — solid full-length
  addArenaBox(T, H, depth, xL, 0, _wallMat);
  addArenaBox(T, H, depth, xR, 0, _wallMat);

  // North / South — split into two segments around the tunnel gap. The gap is
  // widened by the wall thickness (T) so the tunnel side walls sit INSIDE it
  // rather than overlapping the podium — that overlap caused the mouth z-fight.
  const innerGap = gapHalf + T;                     // 4
  const segW  = (-innerGap) - xL;                   // 14.5
  const segCx = (xL + (-innerGap)) / 2;             // -11.25
  for (const zc of [zN, zS]) {
    addArenaBox(segW, H, T,  segCx, zc, _wallMat);  // left of gap
    addArenaBox(segW, H, T, -segCx, zc, _wallMat);  // right of gap
  }
}

// ── Tunnels — Roman STONE BARREL VAULTS breaching the N/S walls; the spawn sits at
// the back and the player walks the vaulted corridor out into the bright bowl (the
// "walkout" reveal). Each tunnel is ONE visible mesh (arch shell + floor + back cap,
// buildVaultTunnel) that renders and stops bullets; movement is walled by invisible
// thin boxes (an AABB collider can't be a concave vault). ──
{
  const t = A.tunnel, b = A.bounds, T = 1;
  const gapHalf = t.width / 2;                       // 3
  for (const side of [-1, 1]) {                      // -1 = north (−z), +1 = south (+z)
    const zWall  = side < 0 ? b.minZ : b.maxZ;       // ∓28  (mouth, at the bowl wall)
    const zOuter = zWall + side * t.length;          // ∓42  (back, behind the spawn)
    const zMid   = (zWall + zOuter) / 2;             // ∓35
    // Movement colliders (invisible) — side walls, ceiling, back cap
    addTunnelCollider(T, t.height, t.length, -(gapHalf + T / 2), zMid);
    addTunnelCollider(T, t.height, t.length,  (gapHalf + T / 2), zMid);
    // Back cap: the visible wall sits at zCap (see buildVaultTunnel). Stop the player
    // ~1u IN FRONT of it (arena-side) with a thick box so the camera can never reach
    // the wall plane — previously the collider face sat behind the wall, letting you
    // clip your view through it. Bulk extends away from the arena.
    const zCap = zOuter - side * 0.3;
    const capThick = 2;
    const capInner = zCap - side * 1.0;                       // arena-facing stop plane
    addTunnelCollider(t.width + T, t.height, capThick, 0, capInner + side * (capThick / 2));
    addTunnelCollider(t.width + T, 0.6, t.length, 0, zMid, t.height + 0.3);
    // Visible barrel-vault skin (1 draw call) — mouth at the wall, cap at the back,
    // facade filling the bowl-wall gap (gapHalf+T) up to the wall top
    buildVaultTunnel(zWall, zOuter, t.width, t.height, gapHalf + T, A.wallHeight, _stoneMat);
  }
}

// ── Monument — central CIRCULAR stepped dais (climbable from any side) topped by
// a bronze Atlas hoisting the globe. The dais + the statue's solid core break the
// straight spawn-to-spawn sightline; both are collidable (movement + bullets). ──
{
  const m = A.monument;

  // Merge many transformed geometries into ONE flat-shaded BufferGeometry (bake
  // each part's matrix, drop the index → per-face normals = the arena's faceted
  // look). Lets the whole dais + the whole statue each render in a single call.
  function mergeGeos(geos) {
    let n = 0;
    const nis = geos.map(g => { const ni = g.index ? g.toNonIndexed() : g; n += ni.attributes.position.count; return ni; });
    const pos = new Float32Array(n * 3);
    let o = 0;
    for (const ni of nis) { const a = ni.attributes.position.array; pos.set(a, o); o += a.length; }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.computeVertexNormals();
    return out;
  }
  // Invisible box collider at a world AABB → blocks MOVEMENT only, 0 draw calls
  // (Box3.setFromObject ignores .visible). Bullets are NOT raycast against these: a
  // square AABB around the round dais (corners jut past the steps) and an oversized
  // column around the thin figure would stop shots that visually miss. Bullets hit the
  // visible marble/bronze meshes instead (pushed to `targets` below), so hit-reg
  // matches exactly what's drawn.
  function addCollider(w, h, d, x, y, z) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), _monMat);
    c.visible = false; c.position.set(m.x + x, y, m.z + z);
    c.updateMatrixWorld(true);
    scene.add(c); collidables.push(c);
  }

  // ── Dais — concentric ziggurat steps (wide+short base → narrow summit),
  // climbable from any side. DOUBLED to 10 steps (riser 0.20, half of before) at
  // the SAME radii/circumference. Visuals merge into one marble mesh; each step
  // gets an invisible box collider so the physics still steps up the small risers. ──
  const marble = [];
  const STEPS = Math.max(2, Math.round(m.height / 0.2));   // 10 (riser 0.20) for height 2.0
  const rBottom = 7.8, rTop = 3.3;
  for (let k = 0; k < STEPS; k++) {
    const top = (k + 1) * (m.height / STEPS);
    const r   = rBottom + (rTop - rBottom) * (k / (STEPS - 1));
    const g = new THREE.CylinderGeometry(r, r, top, 24); g.translate(m.x, top / 2, m.z);
    marble.push(g);
    addCollider(2 * r, top, 2 * r, 0, top / 2, 0);         // AABB == the drum's box (climb riser 0.20)
  }

  // ── ATLAS — a bronze titan hoisting the celestial globe. Rebuilt as an
  // anatomical figure: tapered "bone" cylinders strung between joints (organic
  // limbs, a waist-pinched torso, both arms raised to the globe overhead) + a
  // faceted head. All bronze parts MERGE into ONE mesh (1 draw call); a single
  // invisible core collider + the pedestal keep the sightline broken / shots
  // blocked. Built directly in world space (no group), feet on the pedestal top. ──
  const _bronze = new THREE.MeshLambertMaterial({ color: 0x7a5c34, emissive: 0x1c1408 });
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const bronze = [];
  // Tapered cylinder between two joints (r0 at p0, r1 at p1).
  const bone = (p0, p1, r0, r1, seg = 8) => {
    const dir = new THREE.Vector3().subVectors(p1, p0), len = dir.length() || 1e-4;
    const g = new THREE.CylinderGeometry(r1, r0, len, seg);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.clone().normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5), q, V(1, 1, 1)));
    return g;
  };
  const blob = (r, x, y, z, sy = 1) => { const g = new THREE.IcosahedronGeometry(r, 0); if (sy !== 1) g.scale(1, sy, 1); g.translate(m.x + x, y, m.z + z); return g; };
  const box  = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(m.x + x, y, m.z + z); return g; };
  const at   = (p) => new THREE.Vector3(m.x + p.x, p.y, m.z + p.z);   // shift a local joint to world x/z

  const pedH = 1.7, F = m.height + pedH;              // summit (m.height) → feet at F
  marble.push((() => { const g = new THREE.CylinderGeometry(1.55, 1.85, pedH, 22); g.translate(m.x, m.height + pedH / 2, m.z); return g; })());

  for (const s of [-1, 1]) {                          // legs + feet
    const hip = at(V(s * 0.42, F + 2.85, 0)), knee = at(V(s * 0.40, F + 1.45, 0.06)), ankle = at(V(s * 0.42, F + 0.18, 0));
    bronze.push(bone(hip, knee, 0.34, 0.24));         // thigh
    bronze.push(bone(knee, ankle, 0.24, 0.13));       // shin
    bronze.push(box(0.34, 0.20, 0.62, s * 0.42, F + 0.10, 0.16));  // foot
  }
  bronze.push(box(0.98, 0.62, 0.64, 0, F + 3.0, 0));                 // pelvis / hips
  bronze.push(bone(at(V(0, F + 3.15, 0)), at(V(0, F + 4.05, 0)), 0.46, 0.40)); // waist (pinch)
  bronze.push(bone(at(V(0, F + 4.05, 0)), at(V(0, F + 5.15, 0)), 0.42, 0.58)); // chest (broaden)
  bronze.push(bone(at(V(-0.72, F + 5.2, 0)), at(V(0.72, F + 5.2, 0)), 0.26, 0.26)); // clavicle bar
  for (const s of [-1, 1]) bronze.push(blob(0.30, s * 0.72, F + 5.2, 0));          // deltoids
  bronze.push(bone(at(V(0, F + 5.05, 0)), at(V(0, F + 5.7, 0.03)), 0.20, 0.17));   // neck
  bronze.push(blob(0.44, 0, F + 6.1, 0.05, 1.08));                                 // head
  for (const s of [-1, 1]) {                          // arms raised to the globe
    const sh = at(V(s * 0.72, F + 5.2, 0)), el = at(V(s * 0.92, F + 6.25, 0.08)), wr = at(V(s * 0.34, F + 7.65, 0.05));
    bronze.push(bone(sh, el, 0.22, 0.17));            // upper arm
    bronze.push(bone(el, wr, 0.17, 0.12));            // forearm
    bronze.push(blob(0.17, s * 0.34, F + 7.7, 0.05)); // hand
  }
  // Tilted armillary sphere held overhead — open bronze rings + polar axis.
  {
    const R = 3.5, sy = F + 7.1 + R, TILT = 0.4;   // globe 2.5× larger; raised so its bottom still rests on the hands
    const ringAngles = [[Math.PI / 2, 0], [Math.PI / 2, 0.6], [0, 0], [0, Math.PI / 3], [0, (2 * Math.PI) / 3]];
    for (const [rx, ry] of ringAngles) {
      const g = new THREE.TorusGeometry(R, 0.19, 6, 30);
      g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, TILT, 'XYZ')));
      g.translate(m.x, sy, m.z); bronze.push(g);
    }
    const axis = new THREE.CylinderGeometry(0.17, 0.17, R * 2.4, 8);
    axis.applyMatrix4(new THREE.Matrix4().makeRotationZ(TILT)); axis.translate(m.x, sy, m.z);
    bronze.push(axis);
  }

  // Visible meshes carry the bullet hitbox (raycast targets) so shots register on the
  // exact round steps / thin figure the player sees — no phantom corner/column hits.
  const daisMesh = new THREE.Mesh(mergeGeos(marble), _monMat);    // dais + pedestal — 1 draw call
  scene.add(daisMesh);  targets.push(daisMesh);
  // Scale the whole Atlas figure + globe 2× about the feet (F) — a towering statue;
  // pedestal/dais unchanged. Baked into the geometry so the merged mesh stays at
  // identity and the bullet raycast sees the true size.
  {
    const S = 2, sMat = new THREE.Matrix4()
      .makeTranslation(m.x, F, m.z)
      .multiply(new THREE.Matrix4().makeScale(S, S, S))
      .multiply(new THREE.Matrix4().makeTranslation(-m.x, -F, -m.z));
    for (const g of bronze) g.applyMatrix4(sMat);
  }
  const atlasMesh = new THREE.Mesh(mergeGeos(bronze), _bronze);   // whole figure + globe — 1 draw call
  scene.add(atlasMesh); targets.push(atlasMesh);
  // Invisible cores — MOVEMENT only (keep players out of the statue; the tall dais +
  // pedestal meshes above already block the eye-level spawn-to-spawn sightline).
  addCollider(3.4, pedH, 3.4, 0, m.height + pedH / 2, 0);  // pedestal core
  addCollider(2.6, 12.0, 2.0, 0, F + 6.0, 0);              // body core (2× figure)
}

// ── Cover — containers (full standing cover) + crates (crouch cover). Each entry
// in A.cover already carries its 180°-rotational partner. ──
for (const c of A.cover) {
  const isContainer = c.type === 'container';
  const sz  = isContainer ? A.containerSize : A.crateSize;
  const mat = isContainer ? _containerMat : _crateMat;
  // `stack` (crates) piles N boxes vertically — each box is its own collider +
  // bullet target, so a 2-high stack reads as full standing cover.
  const n = c.stack || 1;
  for (let s = 0; s < n; s++) {
    addArenaBox(sz.x, sz.y, sz.z, c.x, c.z, mat, c.rotationY || 0, sz.y * (s + 0.5));
  }
}

// ═══════════════════════════════════════════════════════════
// COLISEUM SKIN — "New Rome": American-Roman coliseum dressing.
// Purely DECORATIVE and NON-COLLIDABLE — none of this is pushed to `collidables`
// or `targets`, so the gameplay blockout above is untouched. It wraps the field:
// tiered arcade stands rising behind the podium, hung US flags, ornate tunnel
// gates, a stone concourse, and "USA" painted on the field. All repeated pieces
// are InstancedMesh (1 draw call each) to hold the frame budget; no shadows.
// Reference: docs/DEPORTED_Arena_MVP_Build_Spec.md + the coliseum concept art.
// ═══════════════════════════════════════════════════════════
{
  const _dummy = new THREE.Object3D();

  // Append one axis-aligned box (12 tris, outward-wound) to a flat position array
  // — the house pattern (see 02_setup clouds): non-indexed buffers + per-face
  // normals give the chunky faceted look. Used to merge many boxes into one mesh.
  function pushBox(arr, w, h, d, cx, cy, cz) {
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const y0 = cy - h / 2, y1 = cy + h / 2;
    const z0 = cz - d / 2, z1 = cz + d / 2;
    const quad = (ax,ay,az, bx,by,bz, cx2,cy2,cz2, dx,dy,dz) =>
      arr.push(ax,ay,az, bx,by,bz, cx2,cy2,cz2,  ax,ay,az, cx2,cy2,cz2, dx,dy,dz);
    quad(x0,y0,z1, x1,y0,z1, x1,y1,z1, x0,y1,z1); // +z
    quad(x1,y0,z0, x0,y0,z0, x0,y1,z0, x1,y1,z0); // -z
    quad(x1,y0,z1, x1,y0,z0, x1,y1,z0, x1,y1,z1); // +x
    quad(x0,y0,z0, x0,y0,z1, x0,y1,z1, x0,y1,z0); // -x
    quad(x0,y1,z1, x1,y1,z1, x1,y1,z0, x0,y1,z0); // +y
    quad(x0,y0,z0, x1,y0,z0, x1,y0,z1, x0,y0,z1); // -y
  }
  function facetedGeo(positions) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals();
    return g;
  }
  function addMerged(positions, mat) {
    const m = new THREE.Mesh(facetedGeo(positions), mat);
    scene.add(m);
    return m;
  }
  // Yaw so a piece's local +Z faces the arena center (0,0).
  const faceCenter = (px, pz) => Math.atan2(-px, -pz);
  // Ramanujan ellipse-perimeter approx (for even bay spacing per tier).
  const ellipseCirc = (rx, rz) => Math.PI * (3*(rx+rz) - Math.sqrt((3*rx+rz)*(rx+3*rz)));

  // ── Materials ──
  const _standMat   = new THREE.MeshLambertMaterial({ color: 0xE0D8C4 }); // warm marble (less sun blowout)
  const _standDark  = new THREE.MeshLambertMaterial({ color: 0xCEC5AE }); // subtle tier contrast
  const _corniceMat = new THREE.MeshLambertMaterial({ color: 0xD6CDB6 });
  const _gateMat    = new THREE.MeshLambertMaterial({ color: 0xE6DECB }); // Capitol marble

  // ── Dusk plain — one huge warm ground disc that fills under the whole arena AND
  // rings the coliseum out to the horizon, so the arena sits in an open landscape
  // instead of on a floating dark square (this replaces the old 170×170 concourse:
  // a round disc leaves no straight edge to catch the eye). A radial vertex gradient
  // holds a dark stone tone under the stands (r<~144u), warms to sunlit dust in the
  // mid-ring, then fades to the fog-horizon tone at the rim; the disc is wide enough
  // (r≈1200) that its edge is fully swallowed by fog. Unlit (Basic) so the low sunset
  // sun can't flatten it to near-black. ──
  {
    const R = 1200, geo = new THREE.CircleGeometry(R, 96);
    const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3);
    const cInner = new THREE.Color(0x39322a);  // dark stone under the stands (was the concourse)
    const cMid   = new THREE.Color(0x7a5c3c);  // warm sunlit dust
    const cRim   = new THREE.Color(0x3a2a22);  // fog-horizon tone (matches the warmed fog)
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i)) / R;   // 0 center → 1 rim
      if (r < 0.12)      tmp.copy(cInner);
      else if (r < 0.5)  tmp.copy(cInner).lerp(cMid, (r - 0.12) / 0.38);
      else               tmp.copy(cMid).lerp(cRim, (r - 0.5) / 0.5);
      cols[i * 3] = tmp.r; cols[i * 3 + 1] = tmp.g; cols[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const plain = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
    plain.rotation.x = -Math.PI / 2;
    plain.position.y = -0.05;    // just beneath the paved arena floor
    plain.renderOrder = -1;
    scene.add(plain);
  }

  // ── Distant city ring — a dark modern skyline encircling the coliseum out near
  // the fog line, so the arena reads as a stadium dropped into a city (DEPORTED's
  // satire). Heavy fog at r≈470-830 means detail is irrelevant — pure silhouettes.
  // One InstancedMesh, built once with a fixed seed (stable skyline): ~1 draw call. ──
  {
    const N = 90, cityGeo = new THREE.BoxGeometry(1, 1, 1);
    const city = new THREE.InstancedMesh(cityGeo, new THREE.MeshBasicMaterial({ color: 0x2b2a33 }), N);
    let seed = 1337; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2 + (rnd() - 0.5) * 0.06;
      const rad = 470 + rnd() * 360;                       // 470–830u out
      const w = 18 + rnd() * 46, d = 18 + rnd() * 46;
      const h = 34 + rnd() * rnd() * 190;                  // mostly low blocks, a few towers
      const px = Math.cos(th) * rad, pz = Math.sin(th) * rad;
      _dummy.position.set(px, h / 2, pz);                  // base on the plain
      _dummy.rotation.set(0, faceCenter(px, pz), 0);
      _dummy.scale.set(w, h, d);
      _dummy.updateMatrix();
      city.setMatrixAt(i, _dummy.matrix);
    }
    city.instanceMatrix.needsUpdate = true;
    scene.add(city);
  }

  // ── Tiered arcade stands — concentric elliptical rings of blocky "arch" bays
  // (2 columns + a lintel) that step UP and OUT, enclosing the field like a
  // coliseum. The ellipse (rx 30 / rz 42) clears the rectangular podium corners. ──
  const TIERS = 10, RX0 = 30, RZ0 = 42, TIER_RUN = 3.5, TIER_RISE = 4.6;
  const BW = 5.4, COL_W = 1.6, BAY_D = 3.2, TH = 7.0, LINTEL = 1.3;

  // One reusable bay geometry (local: base at y=0, front toward +Z).
  const bayPos = [];
  pushBox(bayPos, COL_W, TH, BAY_D, -(BW - COL_W) / 2, TH / 2, 0);
  pushBox(bayPos, COL_W, TH, BAY_D,  (BW - COL_W) / 2, TH / 2, 0);
  pushBox(bayPos, BW,   LINTEL, BAY_D, 0, TH - LINTEL / 2, 0);
  const bayGeo = facetedGeo(bayPos);

  // Cornice cap geometry (thin wide block) for the top rim.
  const corPos = [];
  pushBox(corPos, BW + 0.4, 0.9, BAY_D + 1.4, 0, 0, 0);
  const corGeo = facetedGeo(corPos);

  for (let t = 0; t < TIERS; t++) {
    const rx = RX0 + t * TIER_RUN, rz = RZ0 + t * TIER_RUN;
    const baseY = t * TIER_RISE;
    const count = Math.max(12, Math.round(ellipseCirc(rx, rz) / BW));
    const inst = new THREE.InstancedMesh(bayGeo, t % 2 ? _standDark : _standMat, count);
    for (let i = 0; i < count; i++) {
      const th = (i / count) * Math.PI * 2;
      const px = Math.cos(th) * rx, pz = Math.sin(th) * rz;
      // Skip any bay that falls inside a tunnel's footprint (its inner ring reaches
      // into the now-longer tunnel) — otherwise a white bay pokes into the black
      // corridor. Leaves a clean entrance breach in the stands (like a vomitorium).
      const inTun = Math.abs(px) < (A.tunnel.width / 2 + 2) &&
                    Math.abs(pz) > A.bounds.maxZ - 1 &&
                    Math.abs(pz) < A.bounds.maxZ + A.tunnel.length + 1;
      _dummy.position.set(px, baseY, pz);
      _dummy.rotation.set(0, faceCenter(px, pz), 0);
      _dummy.scale.setScalar(inTun ? 0 : 1);
      _dummy.updateMatrix();
      inst.setMatrixAt(i, _dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);

    // Cornice rim on the outermost tier's top edge.
    if (t === TIERS - 1) {
      const cor = new THREE.InstancedMesh(corGeo, _corniceMat, count);
      for (let i = 0; i < count; i++) {
        const th = (i / count) * Math.PI * 2;
        const px = Math.cos(th) * rx, pz = Math.sin(th) * rz;
        _dummy.position.set(px, baseY + TH, pz);
        _dummy.rotation.set(0, faceCenter(px, pz), 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        cor.setMatrixAt(i, _dummy.matrix);
      }
      cor.instanceMatrix.needsUpdate = true;
      scene.add(cor);
    }
  }

  // ── Roman arcade facade + foundation — the exterior is a proper Colosseum front:
  // two storeys of round-arched bays with engaged piers, a horizontal string course
  // between them and a plain attic on top, all rooted on a wider base plinth so the
  // building sits in the ground instead of floating. Arched bays are ExtrudeGeometry
  // (real round openings, not painted) instanced around the ellipse; the flat courses
  // reuse the box-band ring. A dark backing drum makes the arches read as deep shadow.
  // Everything instanced — a handful of draw calls, no textures. ──
  {
    const RXF = 64, RZF = 76, NB = 44, PW = 2.1, D = 2.4;  // facade radii, bay count, pier width, depth
    const unit = new THREE.BoxGeometry(1, 1, 1);

    // Flat protruding ring (plinth / string course / cornice / attic / backing).
    const band = (rx, rz, yb, yt, thick, mat) => {
      const N = 72, m = new THREE.InstancedMesh(unit, mat, N);
      const w = (ellipseCirc(rx, rz) / N) * 1.2;   // ~20% overlap → seamless ring
      for (let i = 0; i < N; i++) {
        const th = (i / N) * Math.PI * 2, px = Math.cos(th) * rx, pz = Math.sin(th) * rz;
        _dummy.position.set(px, (yb + yt) / 2, pz);
        _dummy.rotation.set(0, faceCenter(px, pz), 0);
        _dummy.scale.set(w, yt - yb, thick);
        _dummy.updateMatrix();
        m.setMatrixAt(i, _dummy.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
      scene.add(m);
    };

    // One arcade bay: a solid stone panel with a round-topped opening cut through it.
    const archBay = (LH, springH) => {
      const chord = ellipseCirc(RXF, RZF) / NB, BW = chord * 1.06, ow = BW - 2 * PW;
      const s = new THREE.Shape();
      s.moveTo(-BW / 2, 0); s.lineTo(BW / 2, 0); s.lineTo(BW / 2, LH);
      s.lineTo(-BW / 2, LH); s.lineTo(-BW / 2, 0);
      const h = new THREE.Path();
      h.moveTo(-ow / 2, 0); h.lineTo(-ow / 2, springH);
      h.absarc(0, springH, ow / 2, Math.PI, 0, true);    // semicircle over the top
      h.lineTo(ow / 2, 0); h.lineTo(-ow / 2, 0);
      s.holes.push(h);
      const g = new THREE.ExtrudeGeometry(s, { depth: D, bevelEnabled: false, curveSegments: 8 });
      g.translate(0, 0, -D / 2);                          // centre depth on the ellipse
      return g;
    };
    // Instance an arcade-bay geometry around the ellipse at a given base height.
    const arcadeRing = (geo, baseY, mat) => {
      const m = new THREE.InstancedMesh(geo, mat, NB);
      for (let i = 0; i < NB; i++) {
        const th = (i / NB) * Math.PI * 2, px = Math.cos(th) * RXF, pz = Math.sin(th) * RZF;
        _dummy.position.set(px, baseY, pz);
        _dummy.rotation.set(0, faceCenter(px, pz), 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        m.setMatrixAt(i, _dummy.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
      scene.add(m);
    };

    const _facadeMat = new THREE.MeshLambertMaterial({ color: 0xC9BE9F }); // weathered marble
    const _plinthMat = new THREE.MeshLambertMaterial({ color: 0x8f836a }); // darker foundation stone
    const _backMat   = new THREE.MeshLambertMaterial({ color: 0x2b2820 }); // deep shadow behind arches

    band(62.4, 74.4,  0,    49,   2.0, _backMat);      // dark backing drum → arches read as shadow
    arcadeRing(archBay(19, 12),  4,  _facadeMat);      // storey 1 arches — y 4–23
    band(65.0, 77.0, 22.5, 25.0, 2.9, _facadeMat);     // string course between the storeys
    arcadeRing(archBay(17, 11), 25, _facadeMat);       // storey 2 arches — y 25–42
    band(65.0, 77.0, 41.5, 44.0, 2.9, _facadeMat);     // upper string course
    band(64.3, 76.3, 44.0, 48.0, 2.5, _facadeMat);     // plain attic storey
    band(66.5, 78.5,  0,    4.2,  3.4, _plinthMat);    // base plinth — wider ledge at the ground
    band(64.6, 76.6, 47.5, 50.5, 3.2, _corniceMat);    // crowning cornice
  }

  // ── Blind arcade on the podium — the walls enclosing the fight get a Roman
  // arch rhythm (pilasters + round arches on the inner face) instead of flat walls. ──
  {
    const b = A.bounds, H = A.wallHeight, gap = A.tunnel.width / 2 + 1;
    const runs = [
      { fixed: b.maxX, dir: -1, axis: 'z', a0: b.minZ, a1: b.maxZ },   // E wall
      { fixed: b.minX, dir:  1, axis: 'z', a0: b.minZ, a1: b.maxZ },   // W wall
    ];
    for (const zf of [b.minZ, b.maxZ]) {                                // N/S wall segments
      const dir = zf < 0 ? 1 : -1;
      runs.push({ fixed: zf, dir, axis: 'x', a0: b.minX, a1: -gap });
      runs.push({ fixed: zf, dir, axis: 'x', a0: gap,    a1: b.maxX });
    }
    const pil = [], arch = [];
    for (const r of runs) {
      const len = r.a1 - r.a0, n = Math.max(1, Math.round(len / 4.2)), step = len / n;
      for (let i = 0; i <= n; i++) {
        const a = r.a0 + i * step;
        pil.push(r.axis === 'z' ? { x: r.fixed + r.dir * 0.35, z: a } : { x: a, z: r.fixed + r.dir * 0.35 });
      }
      for (let i = 0; i < n; i++) {
        const a = r.a0 + (i + 0.5) * step;
        arch.push(r.axis === 'z'
          ? { x: r.fixed + r.dir * 0.35, z: a, ry: Math.PI / 2 }   // arch spans z (E/W walls)
          : { x: a, z: r.fixed + r.dir * 0.35, ry: 0 });           // arch spans x (N/S walls)
      }
    }
    const pilInst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, H - 0.5, 0.55), _standMat, pil.length);
    pil.forEach((p, i) => { _dummy.position.set(p.x, (H - 0.5) / 2, p.z); _dummy.rotation.set(0, 0, 0); _dummy.scale.setScalar(1); _dummy.updateMatrix(); pilInst.setMatrixAt(i, _dummy.matrix); });
    pilInst.instanceMatrix.needsUpdate = true; scene.add(pilInst);
    // Round blind arches (half-torus rainbows) between the pilasters near the top.
    const archInst = new THREE.InstancedMesh(new THREE.TorusGeometry(1.7, 0.22, 6, 14, Math.PI), _standMat, arch.length);
    arch.forEach((p, i) => { _dummy.position.set(p.x, H - 2.3, p.z); _dummy.rotation.set(0, p.ry, 0); _dummy.scale.setScalar(1); _dummy.updateMatrix(); archInst.setMatrixAt(i, _dummy.matrix); });
    archInst.instanceMatrix.needsUpdate = true; scene.add(archInst);
    // Invisible collidable liner at the arcade front, per run, so the projecting
    // pilasters/arches are SOLID (players stop at them instead of walking through
    // to the wall behind). One box per run — 0 draw calls (visible=false).
    for (const r of runs) {
      const off = r.dir * 0.4;
      const w = r.axis === 'z' ? 0.5 : (r.a1 - r.a0);
      const d = r.axis === 'z' ? (r.a1 - r.a0) : 0.5;
      const cx = r.axis === 'z' ? r.fixed + off : (r.a0 + r.a1) / 2;
      const cz = r.axis === 'z' ? (r.a0 + r.a1) / 2 : r.fixed + off;
      const liner = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), _standMat);
      liner.position.set(cx, H / 2, cz);
      liner.visible = false;
      liner.updateMatrixWorld(true);
      scene.add(liner); collidables.push(liner);
    }
  }

  // ── US flag banners hung on the inner face of the stands, facing the field ──
  function usFlagTex() {
    const c = document.createElement('canvas'); c.width = 190; c.height = 100;
    const x = c.getContext('2d');
    const sh = 100 / 13;
    for (let i = 0; i < 13; i++) { x.fillStyle = (i % 2 === 0) ? '#b22234' : '#ffffff'; x.fillRect(0, i * sh, 190, sh + 0.6); }
    x.fillStyle = '#3c3b6e'; x.fillRect(0, 0, 190 * 0.42, sh * 7);
    x.fillStyle = '#fff';
    for (let r = 0; r < 5; r++) for (let s = 0; s < 6; s++) {
      x.beginPath(); x.arc(6 + s * 12 + (r % 2 ? 6 : 0), 6 + r * (sh * 7 / 5), 2, 0, Math.PI * 2); x.fill();
    }
    return new THREE.CanvasTexture(c);
  }
  {
    const flagMat = new THREE.MeshBasicMaterial({ map: usFlagTex(), side: THREE.DoubleSide });
    const FLAGS = 26, fw = 9.0, fh = 5.0;             // bigger so they read from the top rim
    // Hung along the very TOP tier of the arena, floated just inside the rim.
    const FLAG_TIER = TIERS - 1;
    const rx = RX0 + FLAG_TIER * TIER_RUN - 2.5;
    const rz = RZ0 + FLAG_TIER * TIER_RUN - 2.5;
    const fy = FLAG_TIER * TIER_RISE + TH * 0.55;
    const inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(fw, fh), flagMat, FLAGS);
    for (let i = 0; i < FLAGS; i++) {
      const th = (i / FLAGS) * Math.PI * 2 + 0.08;
      const px = Math.cos(th) * rx, pz = Math.sin(th) * rz;
      _dummy.position.set(px, fy, pz);
      _dummy.rotation.set(0, faceCenter(px, pz), 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      inst.setMatrixAt(i, _dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
  }

  // ── Entrance colonnade — Ionic fluted marble columns flanking each tunnel
  // mouth, tied by an entablature beam with a blue-and-gold swag. Built as per-part
  // InstancedMeshes so all four columns cost only a handful of draw calls. Columns
  // sit on the FIELD side of the podium (clear of the podium + tunnel planes → no
  // z-fight, and no stray pillar poking into the tunnel). ──
  const SWAG_W = 384, SWAG_H = 170;                 // texture px; drives the mesh aspect
  function swagTex() {
    // American bunting VALANCE: a blue star rail with DEEP red/white/blue gore-fans
    // draping below it. The fans are drawn as semicircles then vertically stretched
    // (scale) into long elliptical drops, so the bunting hangs low over the tunnel
    // mouth. Transparent below the drape so it reads as scalloped cloth.
    const railH = 22, drop = 122;
    const c = document.createElement('canvas'); c.width = SWAG_W; c.height = SWAG_H;
    const x = c.getContext('2d');
    x.clearRect(0, 0, SWAG_W, SWAG_H);
    x.fillStyle = '#1a2a6c'; x.fillRect(0, 0, SWAG_W, railH);             // star rail
    x.fillStyle = '#fff';
    for (let i = 0; i < 24; i++) { x.beginPath(); x.arc(8 + i * 16, railH / 2, 2.4, 0, Math.PI * 2); x.fill(); }
    const fans = 6, fw = SWAG_W / fans, R = fw / 2, gores = 6;
    const cols = ['#b22234', '#ffffff', '#1a2a6c'];
    x.save();
    x.translate(0, railH);
    x.scale(1, drop / R);                            // stretch each semicircle into a deep drape
    for (let f = 0; f < fans; f++) {
      const cx = f * fw + fw / 2;
      for (let g = 0; g < gores; g++) {
        x.fillStyle = cols[g % 3];
        x.beginPath(); x.moveTo(cx, 0);
        x.arc(cx, 0, R, Math.PI * (g / gores), Math.PI * ((g + 1) / gores)); x.closePath(); x.fill();
      }
    }
    x.restore();
    return new THREE.CanvasTexture(c);
  }
  {
    const COL_H = 11.0, SR = 0.9, CX = 5.2;           // taller, thicker, wider-spread → grand
    const cols = [];
    for (const zEnd of [A.bounds.minZ, A.bounds.maxZ]) {
      const cz = zEnd - Math.sign(zEnd) * 1.8;        // onto the field
      cols.push({ x: -CX, z: cz }, { x: CX, z: cz });
    }
    const N = cols.length;
    // 16-sided faceted shaft reads as fluting; slight entasis taper. Ionic-ish
    // capital = echinus drum + abacus block + two rolled volute scrolls.
    const shaftInst  = new THREE.InstancedMesh(new THREE.CylinderGeometry(SR * 0.86, SR, COL_H, 16), _gateMat, N);
    const plinthInst = new THREE.InstancedMesh(new THREE.BoxGeometry(SR * 2.6, 0.7, SR * 2.6), _gateMat, N);
    const baseInst   = new THREE.InstancedMesh(new THREE.CylinderGeometry(SR * 1.25, SR * 1.4, 0.7, 16), _gateMat, N);
    const echInst    = new THREE.InstancedMesh(new THREE.CylinderGeometry(SR * 1.3, SR * 0.95, 0.55, 16), _gateMat, N);
    const abacusInst = new THREE.InstancedMesh(new THREE.BoxGeometry(SR * 3.0, 0.5, SR * 2.2), _gateMat, N);
    const voluteInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12), _gateMat, N * 2);
    const put = (inst, i, x, y, z, rx = 0, ry = 0, rz = 0) => {
      _dummy.position.set(x, y, z); _dummy.rotation.set(rx, ry, rz); _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix(); inst.setMatrixAt(i, _dummy.matrix);
    };
    const baseTop = 0.7;
    cols.forEach((c, i) => {
      put(plinthInst, i, c.x, 0.35, c.z);
      put(baseInst,   i, c.x, baseTop + 0.35, c.z);
      put(shaftInst,  i, c.x, baseTop + COL_H / 2, c.z);
      put(echInst,    i, c.x, baseTop + COL_H + 0.28, c.z);
      put(abacusInst, i, c.x, baseTop + COL_H + 0.7, c.z);
      for (const s of [-1, 1]) put(voluteInst, i * 2 + (s > 0 ? 1 : 0), c.x + s * SR * 1.05, baseTop + COL_H + 0.45, c.z, 0, 0, Math.PI / 2);
    });
    [plinthInst, baseInst, shaftInst, echInst, abacusInst, voluteInst].forEach(m => { m.instanceMatrix.needsUpdate = true; scene.add(m); });

    // The columns above are decorative InstancedMeshes — give each pillar an
    // INVISIBLE box collider so players can't walk through it (and it stops shots
    // like every other solid). Box faces sit tangent to the shaft (side = 2·SR);
    // Box3.setFromObject (physics) and the bullet raycast both ignore .visible.
    const colH = baseTop + COL_H + 1;
    for (const c of cols) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(SR * 2, colH, SR * 2), _gateMat);
      col.visible = false;
      col.position.set(c.x, colH / 2, c.z);
      col.updateMatrixWorld(true);
      scene.add(col); collidables.push(col); targets.push(col);
    }

    // Grand entablature beam, hanging swag, and a black tympanum filling the gap
    // between the tunnel top and the beam — so the TOP of the black opening is
    // hidden and the entrance reads as a tall, bottomless dark portal.
    const swagMat = new THREE.MeshBasicMaterial({ map: swagTex(), side: THREE.DoubleSide, transparent: true, depthWrite: false });
    const beamY = baseTop + COL_H + 2.0, beamH = 2.6, beamD = 2.5, beamBot = beamY - beamH / 2;
    for (const zEnd of [A.bounds.minZ, A.bounds.maxZ]) {
      const toCenter = -Math.sign(zEnd);
      const cz = zEnd + toCenter * 1.8;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * CX + 3.4, beamH, beamD), _gateMat);
      beam.position.set(0, beamY, cz);
      scene.add(beam);
      const tymH = beamBot - A.tunnel.height;
      if (tymH > 0.3) {
        // White marble back wall for the decorative gallery (pillars added below).
        const tym = new THREE.Mesh(new THREE.BoxGeometry(2 * CX - 0.4, tymH, 0.6), _gateMat);
        tym.position.set(0, A.tunnel.height + tymH / 2, zEnd + toCenter * 0.5);
        scene.add(tym);
      }
      // Large American bunting draped over the entrance — placed in FRONT of the
      // columns (and well ahead of the black tympanum, which was hiding it) so it
      // always reads. Wide enough to span the tunnel top and tall enough that the
      // scalloped fans drape over the TOP HALF of the (tunnel.height-tall) mouth.
      const swagW = 2 * CX + 3, swagH = swagW * (SWAG_H / SWAG_W);   // keep texture aspect
      const swag = new THREE.Mesh(new THREE.PlaneGeometry(swagW, swagH), swagMat);
      // Sits FLUSH against the beam's front face (cz + half-depth toward the field,
      // + a hair) so it never clips into the box; top rail level with the beam top
      // so it drapes down over the beam like a normally-hung banner.
      swag.position.set(0, (beamY + beamH / 2) - swagH / 2, cz + toCenter * (beamD / 2 + 0.12));
      swag.rotation.y = toCenter > 0 ? 0 : Math.PI;
      swag.renderOrder = 2;
      scene.add(swag);
    }

    // ── Decorative entrance gallery — a row of small marble pillars standing in FRONT
    // of the white wall (the tympanum above). Purely ornamental: up at y≈6–12 and
    // unreachable, so no colliders. InstancedMeshes span BOTH mouths (a few calls). ──
    {
      const GN = 6, gR = 0.30;                        // pillars per mouth, shaft radius
      const gBot = A.tunnel.height + 0.15;            // sits just above the arch top
      const gCapY = beamBot - 0.4;                    // capitals tucked under the beam
      const gShaftH = Math.max(1.5, gCapY - gBot - 0.7);
      const gShaftY = gBot + 0.35 + gShaftH / 2;
      const spanX = 2 * CX - 1.8;                     // fit within the white wall's width
      const total = GN * 2;
      const gShaft = new THREE.InstancedMesh(new THREE.CylinderGeometry(gR * 0.9, gR, gShaftH, 12), _gateMat, total);
      const gBase  = new THREE.InstancedMesh(new THREE.BoxGeometry(gR * 2.5, 0.30, gR * 2.5), _gateMat, total);
      const gCap   = new THREE.InstancedMesh(new THREE.BoxGeometry(gR * 2.7, 0.35, gR * 2.7), _gateMat, total);
      let gi = 0;
      for (const zEnd of [A.bounds.minZ, A.bounds.maxZ]) {
        const toCenter = -Math.sign(zEnd);
        const gz = zEnd + toCenter * 1.05;            // in front of the white wall (wall at +0.5)
        for (let k = 0; k < GN; k++) {
          const gx = -spanX / 2 + (k / (GN - 1)) * spanX;
          put(gBase,  gi, gx, gBot + 0.15, gz);
          put(gShaft, gi, gx, gShaftY, gz);
          put(gCap,   gi, gx, gCapY, gz);
          gi++;
        }
        // Cross-beam sill (impost course) the pillars stand on — spans the wall width.
        const sill = new THREE.Mesh(new THREE.BoxGeometry(2 * CX - 0.4, 0.55, 1.3), _gateMat);
        sill.position.set(0, gBot - 0.275, zEnd + toCenter * 0.75);
        scene.add(sill);
      }
      [gShaft, gBase, gCap].forEach(m => { m.instanceMatrix.needsUpdate = true; scene.add(m); });
    }
  }

  // (Ground "USA" removed — flags live only around the outer arena now.)
}

// ── Perf budget: no realtime shadows for the MVP. Keep 02_setup's 1 dir + 1
// ambient light; just stop the sun from casting (kills the shadow pass). ──
renderer.shadowMap.enabled = false;
// ── SUNSET — a low, warm sun tucked behind the tall outer stands, a dusk sky,
// and a dimmer/warmer fill so the whole arena reads as golden hour. ──
const _sunLow = [250, 70, -195];   // ~12° elevation → the disc sits behind the stands
if (typeof sun !== 'undefined' && sun) {
  sun.castShadow = false;
  sun.intensity = 1.35;
  sun.color.setHex(0xffb060);      // warm sunset light
  sun.position.set(_sunLow[0], _sunLow[1], _sunLow[2]);
}
if (typeof sunMesh !== 'undefined' && sunMesh) {
  sunMesh.position.set(_sunLow[0], _sunLow[1], _sunLow[2]);
  if (sunMesh.material) sunMesh.material.color.setHex(0xffcf6a);  // warm disc
}
// Dim + warm the ambient fill for dusk.
const _amb = scene.children.find(o => o.isAmbientLight);
if (_amb) { _amb.intensity = 0.33; _amb.color.setHex(0xffdcc0); }
// Kill the island's grass-green ground-bounce: the HemisphereLight's ground color
// (0x2d7a0a) tints every downward/shadowed face green. The arena floor is stone, so
// re-tint the bounce warm and mute the sky half to a dusk indigo — arena only, so the
// island keeps its grass bounce.
const _hemi = scene.children.find(o => o.isHemisphereLight);
if (_hemi) { _hemi.groundColor.setHex(0x6a5a3e); _hemi.color.setHex(0x3a4a6a); _hemi.intensity = 0.5; }
// Warm the fog from the island's daytime blue to a dusk brown so the ground plain
// dissolves into a golden horizon. Fog only tints scene geometry — the sky dome is
// fog:false, so the carefully-tuned horizon glow is untouched.
if (scene.fog) scene.fog.color.setHex(0x3a2a22);
// Re-tint the sky dome to a sunset gradient (deep indigo zenith → warm horizon glow).
if (window.skyDome && window.skyDome.geometry && window.skyDome.geometry.attributes.color) {
  const sp = window.skyDome.geometry.attributes.position;
  const col = window.skyDome.geometry.attributes.color, sc = col.array;
  // Tall sunset: the warm→plum→purple gradient is stretched high up the dome (was
  // mostly spent by y=360) so the colour reads well above the arena wall. Horizon
  // glow kept as-is — user likes it.
  const stops = [
    [ 880, 0.07, 0.06, 0.22 ],   // zenith — deep indigo
    [ 820, 0.22, 0.11, 0.34 ],   // high dusk — purple pushed higher again (+15%)
    [ 503, 0.48, 0.18, 0.33 ],   // dark-red / plum band (mid-high)
    [ 212, 0.80, 0.34, 0.32 ],   // warm red band
    [   0, 0.98, 0.56, 0.30 ],   // horizon glow
    [-880, 0.60, 0.34, 0.28 ],
  ];
  for (let i = 0; i < sp.count; i++) {
    const y = sp.getY(i);
    let s0 = stops[0], s1 = stops[stops.length - 1];
    for (let k = 0; k < stops.length - 1; k++) {
      if (y >= stops[k + 1][0]) { s0 = stops[k]; s1 = stops[k + 1]; break; }
    }
    const t = Math.max(0, Math.min(1, (s0[0] - y) / (s0[0] - s1[0])));
    sc[i * 3]     = s0[1] + (s1[1] - s0[1]) * t;
    sc[i * 3 + 1] = s0[2] + (s1[2] - s0[2]) * t;
    sc[i * 3 + 2] = s0[3] + (s1[3] - s0[3]) * t;
  }
  col.needsUpdate = true;
}
// BOTS — AI with shooting, prison spawn, ammo seeking
// Rendering: GLTF SkinnedMesh clones with AnimationMixer
// ═══════════════════════════════════════════════════════════
const BOT_NAMES = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Golf','Hotel','India','Juliet',
  'Kilo','Lima','Mike','November','Oscar','Papa','Quebec','Romeo','Sierra','Tango'];

// Duel mode is player-vs-player only — no bots. The AI/character code below
// stays intact (the character rig loader is also used for remote players);
// spawnBots() simply loops zero times. Flip mode to 'br' to bring bots back.
const BOT_COUNT = CONFIG.mode === 'duel' ? 0 : 10;

// ── GLTF character system ──
// Each animation is a separate GLB (mesh + animation from same export = matching bind pose).
// Each bot gets one clone per animation; only the active one is visible.
const _animGltfs = {};        // animName → gltf (rifle set)
const _animGltfsPistol = {};  // animName → gltf (pistol set, falls back to rifle clips)
let characterReady = false;
let botInstMeshes = [];  // world-space hitbox meshes for raycasting

const _gltfLoader = new GLTFLoader();

async function loadCharacterAssets() {
  const loadGlb = path => new Promise((res, rej) =>
    _gltfLoader.load(path, res, null, rej));

  const animFiles = {
    aimIdle:        'models/StandingRifleV2.glb?v=3',
    rifleIdle:      'models/RifleIdle.glb',
    walk:           'models/RunningRifle.glb',
    walkBack:       'models/WalkingBackwards.glb',
    death:          'models/StandingDeathV2.glb?v=3',
    fire:           'models/RifleFiringV2.glb?v=3',
    reload:         'models/Reloading.glb',
    jump:           'models/RifleJump.glb',
    crouchIdle:     'models/IdleCrouch.glb',
    crouchWalk:     'models/CrouchWalking.glb',
    crouchWalkBack: 'models/CrouchWalkingBackwards.glb',
  };

  // Pistol-specific overrides — states not listed here share the rifle clips
  // (death, reload, crouchWalk, crouchWalkBack).
  const pistolFiles = {
    aimIdle:    'models/PistolAim.glb',
    rifleIdle:  'models/PistolIdle.glb',
    walk:       'models/PistolRun.glb',
    walkBack:   'models/PistolWalkBack.glb',
    fire:       'models/PistolFire.glb',
    jump:       'models/PistolJump.glb',
    crouchIdle: 'models/PistolKneelIdle.glb',
  };

  for (const [name, path] of Object.entries(animFiles)) {
    try {
      const gltf = await loadGlb(path);
      _animGltfs[name] = gltf;
      const clip = gltf.animations?.[0];
      console.log(`[Char] ${name}: ${clip ? clip.duration.toFixed(2)+'s' : 'NO CLIP'}`);
    } catch(e) { console.warn('Failed to load', name, path, e); }
  }

  // Pistol set: load overrides (deduped — PistolIdle is used twice), fall back to rifle
  const _pistolLoaded = {};
  for (const [name, path] of Object.entries(pistolFiles)) {
    try {
      if (!_pistolLoaded[path]) _pistolLoaded[path] = await loadGlb(path);
      _animGltfsPistol[name] = _pistolLoaded[path];
      const clip = _animGltfsPistol[name].animations?.[0];
      console.log(`[Char/pistol] ${name}: ${clip ? clip.duration.toFixed(2)+'s' : 'NO CLIP'}`);
    } catch(e) { console.warn('Failed to load pistol anim', name, path, '— falling back to rifle clip'); }
  }
  for (const name of Object.keys(animFiles)) {
    if (!_animGltfsPistol[name]) _animGltfsPistol[name] = _animGltfs[name];
  }

  characterReady = true;
  console.log('Character assets ready:', Object.keys(_animGltfs).join(', '));
  _getCharScale(); // do the one-time scale-probe clone now, not mid-countdown
  _warmCharacterShaders(); // compile the skinned-mesh program now (menu) — not on the first countdown render
  // Stagger attach (1 bot/frame in updateBots) instead of cloning all 10 idle rigs
  // in a single frame — that one-frame burst was the remaining load-in glitch.
  for (let i = 0; i < bots.length; i++) _attachQueue.push(i);

  // Replace old box kill-cam player mesh with a real Dummy character clone
  if (_animGltfs['aimIdle']) {
    const pg = _animGltfs['aimIdle'];
    const { scale: pscale, footOffset: pfoot } = _measureScale(pg);
    const pclone = SkeletonUtils.clone(pg.scene);
    pclone.scale.setScalar(pscale);
    window._playerMeshFootOffset = pfoot;
    pclone.traverse(_prepCharMesh);
    const pmixer = new THREE.AnimationMixer(pclone);
    const pclip = pg.animations?.[0];
    if (pclip) { pmixer.clipAction(pclip).setLoop(THREE.LoopRepeat).play(); }
    let phips = null;
    pclone.traverse(o => { if (!phips && o.isBone && o.name.toLowerCase().includes('hips')) phips = o; });
    pclone.visible = false;
    scene.add(pclone);
    if (window._playerMesh) window._playerMesh.visible = false;
    window._playerMesh = pclone;
    window._playerMeshMixer = pmixer;
    window._playerMeshHips = phips ? { bone: phips, rx: phips.position.x, ry: phips.position.y } : null;
  }
}

function _findBone(root, namePart) {
  let found = null;
  root.traverse(o => { if (!found && o.isBone && o.name.includes(namePart)) found = o; });
  return found;
}

// Prep a character's meshes for shadow casting. Frustum culling stays OFF: a
// SkinnedMesh culls against its bind-pose bounding sphere, which is unreliable for
// an animated, root-motion rig — up close the body would wrongly cull out (leaving
// the gun floating). Each character is only ~1 draw call anyway, so culling them
// saved almost nothing; correctness wins.
function _prepCharMesh(child) {
  if (!child.isMesh) return;
  child.castShadow = true;
  child.frustumCulled = false;
}

// Character shadow LOD with a hard caster cap. Only the nearest few characters
// within range cast shadows — when 10 bots bunch up (canal, prison) their shadows
// overlap into a blob anyway, so capping to the closest handful is invisible but
// bounds the shadow pass (each caster is a second skinned render). Re-traverses a
// rig only when its on/off state actually flips. `_shadowOn` is cleared in
// _setBotAnim when the active rig swaps so the new mesh re-applies.
const _SHADOW_CHAR_DIST2 = 48 * 48;
const _SHADOW_MAX_CASTERS = 4;
const _shadowCandidates = [];
const _byDist2 = (a, b) => a._dist2 - b._dist2;
function _updateAllCharShadows() {
  _shadowCandidates.length = 0;
  for (const b of bots) {
    if (!b.alive || !b.mesh) continue;
    const dx = b.pos.x - camera.position.x, dz = b.pos.z - camera.position.z;
    b._dist2 = dx * dx + dz * dz;
    _shadowCandidates.push(b);
  }
  if (typeof state !== 'undefined' && state.remotePlayers) {
    for (const id in state.remotePlayers) {
      const pu = state.remotePlayers[id].puppet;
      if (!pu || !pu.alive || !pu.mesh) continue;
      const dx = pu.pos.x - camera.position.x, dz = pu.pos.z - camera.position.z;
      pu._dist2 = dx * dx + dz * dz;
      _shadowCandidates.push(pu);
    }
  }
  _shadowCandidates.sort(_byDist2); // in place — small list (≤~30), no alloc
  for (let i = 0; i < _shadowCandidates.length; i++) {
    const ent = _shadowCandidates[i];
    const want = i < _SHADOW_MAX_CASTERS && ent._dist2 < _SHADOW_CHAR_DIST2;
    if (ent._shadowOn === want) continue;
    ent._shadowOn = want;
    ent.mesh.traverse(c => { if (c.isMesh) c.castShadow = want; });
  }
}

// Shared bot-gun colors + one merged, vertex-colored material. Each gun was ~13
// separate part meshes = ~13 draw calls; with 10 visible bots clustered (canal,
// prison) that's ~130 draw calls just for guns. Merged into a single geometry per
// gun, each gun is 1 draw call. Visuals are identical (flat per-part colors ride
// in vertex colors instead of per-part materials).
const _bgCols = { blk: 0x0d0d0d, drk: 0x161616, mtl: 0x303030, wood: 0x7a4a1a, wdDk: 0x5a3010 };
const _gunMergeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const _gunMergeDummy = new THREE.Object3D();
function _mergeParts(parts) {
  let total = 0;
  const processed = [];
  for (const p of parts) {
    const g = p.geo.toNonIndexed();
    _gunMergeDummy.position.set(p.px, p.py, p.pz);
    _gunMergeDummy.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
    _gunMergeDummy.scale.set(1, 1, 1);
    _gunMergeDummy.updateMatrix();
    g.applyMatrix4(_gunMergeDummy.matrix); // bake offset/rotation into verts + normals
    total += g.attributes.position.count;
    processed.push({ g, c: new THREE.Color(p.color) });
  }
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let off = 0;
  for (const { g, c } of processed) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    for (let i = 0; i < n; i++) { col[(off+i)*3] = c.r; col[(off+i)*3+1] = c.g; col[(off+i)*3+2] = c.b; }
    off += n;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
  return geo;
}

function _makeBotGun() {
  const C = _bgCols;
  const B  = (w,h,d) => new THREE.BoxGeometry(w,h,d);
  const Cy = (rt,rb,h,s=8) => new THREE.CylinderGeometry(rt,rb,h,s);
  const PI2 = Math.PI/2;
  const parts = [];
  // No castShadow (merged mesh defaults to it off) — the body rig's shadow covers
  // the silhouette; a gun shadow nobody sees isn't worth a shadow-pass draw.
  const add = (geo, color, px,py,pz, rx=0,ry=0,rz=0) => parts.push({ geo, color, px,py,pz, rx,ry,rz });
  // Barrel
  add(Cy(0.015,0.017,0.330,8), C.drk,   0, 0.000,-0.465, PI2,0,0);
  add(Cy(0.024,0.024,0.030,8), C.mtl,   0, 0.000,-0.520, PI2,0,0);
  add(Cy(0.026,0.026,0.040,8), C.mtl,   0, 0.000,-0.650, PI2,0,0);
  // Handguard
  add(B(0.052,0.022,0.215), C.wood,   0, 0.014,-0.425);
  add(B(0.056,0.024,0.215), C.wdDk,   0,-0.016,-0.425);
  // Upper receiver
  add(B(0.058,0.026,0.205), C.drk,    0, 0.013,-0.215);
  add(B(0.060,0.008,0.205), C.mtl,    0, 0.026,-0.215);
  // Lower receiver
  add(B(0.056,0.050,0.205), C.drk,    0,-0.027,-0.215);
  // Magazine — ONE tilted box. A stepped multi-box "curve" reads as a separate
  // block glued onto the clip at bot-viewing distances.
  add(B(0.042,0.195,0.072), C.blk,    0,-0.150,-0.262, 0.18,0,0);
  add(B(0.044,0.014,0.074), C.mtl,    0,-0.250,-0.280, 0.18,0,0);  // base pad
  // Pistol grip
  add(B(0.038,0.094,0.046), C.wood,   0,-0.126,-0.130,-0.30,0,0);
  // Stock arms — run flush from the receiver back (rear edge z=-0.112) to the
  // butt plate; short enough that the butt doesn't clip into the chest
  add(B(0.008,0.008,0.214), C.drk,   -0.028, 0.002, -0.005);
  add(B(0.008,0.008,0.214), C.drk,   -0.028,-0.032, -0.005);
  add(B(0.012,0.064,0.020), C.mtl,   -0.028,-0.015,  0.112);
  // Front sight
  add(B(0.034,0.006,0.014), C.mtl,    0, 0.031,-0.570);
  return new THREE.Mesh(_mergeParts(parts), _gunMergeMat);
}

// 1911-style pistol for bots holding the secondary. Built barrel-forward (-z),
// grip down/back (+y down, +z back), origin near the grip so it seats in the palm.
function _makeBotPistol() {
  const C = _bgCols;
  const B  = (w,h,d) => new THREE.BoxGeometry(w,h,d);
  const Cy = (rt,rb,h,s=8) => new THREE.CylinderGeometry(rt,rb,h,s);
  const PI2 = Math.PI/2;
  const parts = [];
  const add = (geo, color, px,py,pz, rx=0,ry=0,rz=0) => parts.push({ geo, color, px,py,pz, rx,ry,rz });
  // Slide (top), barrel along -z
  add(B(0.026,0.030,0.200), C.mtl,  0, 0.020, -0.030);
  // Muzzle / bushing
  add(Cy(0.011,0.011,0.022,8), C.drk, 0, 0.020, -0.135, PI2,0,0);
  // Frame beneath the slide
  add(B(0.024,0.022,0.182), C.drk,  0,-0.004, -0.020);
  // Trigger guard
  add(B(0.018,0.030,0.010), C.drk,  0,-0.030,  0.012);
  add(B(0.020,0.008,0.044), C.drk,  0,-0.030, -0.012);
  // Grip — angled down and slightly back
  add(B(0.030,0.110,0.040), C.wood, 0,-0.070,  0.045, -0.30,0,0);
  // Magazine baseplate
  add(B(0.032,0.014,0.042), C.blk,  0,-0.124,  0.062, -0.30,0,0);
  // Hammer
  add(B(0.012,0.020,0.012), C.drk,  0, 0.030,  0.080);
  // Rear sight
  add(B(0.020,0.008,0.012), C.blk,  0, 0.038,  0.058);
  // Front sight
  add(B(0.006,0.010,0.008), C.blk,  0, 0.038, -0.120);
  return new THREE.Mesh(_mergeParts(parts), _gunMergeMat);
}

function _measureScale(gltf) {
  const probe = SkeletonUtils.clone(gltf.scene);
  probe.updateMatrixWorld(true);
  let boneMinY = Infinity, boneMaxY = -Infinity;
  probe.traverse(o => {
    if (o.isBone) {
      const wp = new THREE.Vector3();
      o.getWorldPosition(wp);
      boneMinY = Math.min(boneMinY, wp.y);
      boneMaxY = Math.max(boneMaxY, wp.y);
    }
  });
  const charH = (boneMaxY > boneMinY) ? (boneMaxY - boneMinY) : 0;
  const scale = charH > 0.001 ? (CONFIG.playerHeight * 1.2) / charH : 0.0105;
  // footOffset lifts the mesh so feet land exactly on bot.pos.y
  const footOffset = charH > 0.001 ? -boneMinY * scale : 0;
  return { scale, footOffset };
}

function _cloneForAnim(animName, gltf, botIndex, scale) {
  const clone = SkeletonUtils.clone(gltf.scene);
  clone.scale.setScalar(scale);

  clone.traverse(_prepCharMesh);

  // Mixer — same GLB as clone, bind poses guaranteed to match
  const mixer = new THREE.AnimationMixer(clone);
  let clip = gltf.animations?.[0];

  let action = null;
  let actionB = null;
  if (clip) {
    action = mixer.clipAction(clip);
    if (animName === 'death' || animName === 'fire' || animName === 'jump' || animName === 'reload') {
      // Single-play, hold last frame — triggered on demand
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      // Two LoopOnce actions — manually crossfaded so we never hard-wrap back to frame 0.
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      action.time = Math.random() * clip.duration;

      actionB = mixer.clipAction(clip.clone());
      actionB.setLoop(THREE.LoopOnce, 1);
      actionB.clampWhenFinished = true;
    }
  }

  // Cache hips bone + its bind-pose XY so we can zero root-motion drift each frame.
  // In this FBX-sourced GLB, bone.x = world-X, bone.y = world-Z (forward), bone.z = world-Y (height).
  let hipsBone = null;
  clone.traverse(o => { if (!hipsBone && o.isBone && o.name.toLowerCase().includes('hips')) hipsBone = o; });
  const hipsRestX = hipsBone ? hipsBone.position.x : 0;
  const hipsRestY = hipsBone ? hipsBone.position.y : 0;

  // Cache hand bones for gun attachment. Match the wrist bone (e.g. "mixamorigRightHand"),
  // not the finger bones (RightHandIndex1, …), so prefer the shortest matching name.
  let rightHandBone = null, leftHandBone = null, rightForeArmBone = null;
  clone.traverse(o => {
    if (!o.isBone) return;
    const n = o.name.toLowerCase().replace(/[^a-z]/g, '');
    if (n.includes('righthand') && (!rightHandBone || o.name.length < rightHandBone.name.length)) rightHandBone = o;
    if (n.includes('lefthand')  && (!leftHandBone  || o.name.length < leftHandBone.name.length))  leftHandBone = o;
    if (n.includes('rightforearm') && (!rightForeArmBone || o.name.length < rightForeArmBone.name.length)) rightForeArmBone = o;
  });

  clone.visible = false;
  return { scene: clone, mixer, action, actionB, clipDur: clip?.duration ?? 0, xfActive: false, xfProg: 0, hipsBone, hipsRestX, hipsRestY, rightHandBone, leftHandBone, rightForeArmBone };
}

function _addWorldHitboxes(bot, index) {
  const mat = new THREE.MeshBasicMaterial();
  // Body cylinder — covers torso + legs up to the shoulders (~1.5), radius wide
  // enough to catch outstretched arms/hands on the rifle and feet mid-stride
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 8), mat.clone());
  body.userData.botIndex = index;
  body.userData.isHead = false;
  body.visible = false; // invisible but raycaster still detects it
  scene.add(body);
  botInstMeshes.push(body);
  // Head sphere
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), mat.clone());
  head.userData.botIndex = index;
  head.userData.isHead = true;
  head.visible = false;
  scene.add(head);
  botInstMeshes.push(head);
  bot.hitbox = body;
  bot.hitboxHead = head;
}

function _setBotAnim(bot, animName) {
  if (!bot.animScenes) return;
  // Always allow re-triggering fire (rapid shots restart the clip)
  if (bot.activeAnim === animName && animName !== 'fire') return;
  // Lazy-clone this rig the first time it's requested (see _attachBotMesh).
  let target = bot.animScenes[animName];
  if (!target && bot._gltfMap && bot._gltfMap[animName]) {
    target = bot.animScenes[animName] =
      _cloneForAnim(animName, bot._gltfMap[animName], bot._animIndex, bot._animScale);
  }
  // DETACH inactive rigs from the scene graph — three r128 recurses into
  // invisible subtrees in updateMatrixWorld, so merely hiding them leaves
  // ~65 bones per rig × 10 rigs per character burning matrix updates every
  // frame. Re-adding is cheap (no GPU re-upload; renderer caches survive).
  // for..in (not Object.values) so this allocates nothing per call.
  for (const k in bot.animScenes) {
    const data = bot.animScenes[k];
    if (data === target) continue;
    data.scene.visible = false;
    if (data.scene.parent) scene.remove(data.scene);
  }
  if (target) {
    if (!target.scene.parent) scene.add(target.scene);
    target.scene.visible = true;
    if ((animName === 'death' || animName === 'fire' || animName === 'jump' || animName === 'reload') && target.action) target.action.reset().play();
    bot.mesh = target.scene;
    bot._shadowOn = undefined; // new rig attached — re-apply shadow LOD next frame
  }
  bot.activeAnim = animName;
}

// Scale/footOffset is identical for every character (same source rig) — measure
// once (it does a throwaway clone) and cache, instead of per bot at spawn.
let _charScaleCache = null;
function _getCharScale() {
  if (!_charScaleCache) {
    _charScaleCache = _animGltfs['aimIdle'] ? _measureScale(_animGltfs['aimIdle']) : { scale: 0.0105, footOffset: 0 };
  }
  return _charScaleCache;
}

// Compile the skinned-mesh shader program ahead of time. The first time any
// character renders, three lazily links its program — a one-frame stall. We do it
// here (right when assets finish loading, while the menu is up) by briefly adding a
// throwaway idle rig to the scene and calling renderer.compile, so the first bot
// appearing during the countdown doesn't hitch. The rig is removed immediately and
// never drawn to screen.
let _charShadersWarmed = false;
function _warmCharacterShaders() {
  if (_charShadersWarmed || !_animGltfs['rifleIdle']) return;
  if (typeof renderer === 'undefined' || typeof scene === 'undefined' || typeof camera === 'undefined') return;
  _charShadersWarmed = true;
  try {
    const { scale } = _getCharScale();
    const warm = _cloneForAnim('rifleIdle', _animGltfs['rifleIdle'], 999, scale);
    scene.add(warm.scene);
    renderer.compile(scene, camera); // links the program for the rig's material
    scene.remove(warm.scene);
  } catch (e) { console.warn('shader pre-warm skipped', e); }
}

function _attachBotMesh(bot, index) {
  if (!characterReady) return;
  bot.animScenes = {};
  bot.activeAnim = null;
  bot.mesh = null;

  const { scale, footOffset } = _getCharScale();
  bot.footOffset = footOffset;

  // Lazy: don't clone all ~13 rigs up front (cloning every bot's full set in one
  // frame is the load-in freeze). Stash what _setBotAnim needs to clone each rig
  // the first time it's actually used. During countdown a bot only needs idle.
  bot._gltfMap = bot.weapon === 'pistol' ? _animGltfsPistol : _animGltfs;
  bot._animIndex = index;
  bot._animScale = scale;

  bot.gunMesh = bot.weapon === 'pistol' ? _makeBotPistol() : _makeBotGun();
  bot.gunMesh.visible = false;
  scene.add(bot.gunMesh);

  _addWorldHitboxes(bot, index);
  _setBotAnim(bot, 'rifleIdle');
  _queueBotPrewarm(bot);
}

// Rig cloning is the heaviest one-time CPU cost (SkeletonUtils.clone + mixer
// binding of a 66-bone rig, a few ms each, ~12 per character). Doing it lazily
// during combat caused mid-fight dips; doing it all at spawn caused a freeze. So:
// clone idle immediately (staggered attach, 1/frame), then pre-warm the rest a few
// per frame — which lands during the ~10s countdown while the player is idle
// watching the timer, NOT during the fight. Combat then runs with every rig ready.
const _attachQueue = [];
const _prewarmQueue = []; // flat [bot, animName, bot, animName, ...]
function _queueBotPrewarm(ent) {
  if (!ent._gltfMap) return;
  for (const animName in ent._gltfMap) {
    if (!ent.animScenes[animName]) _prewarmQueue.push(ent, animName);
  }
}
function _drainCharWork() {
  // Attach is prioritized so bots appear promptly (1 idle clone/frame).
  if (_attachQueue.length) {
    const idx = _attachQueue.shift();
    if (bots[idx] && !bots[idx].animScenes) _attachBotMesh(bots[idx], idx);
    return;
  }
  // Then pre-warm exactly ONE rig/frame — gentlest possible spread (~130 clones over
  // ~2s, well inside the 10s idle countdown), so the countdown barely dips and
  // combat starts fully warm.
  while (_prewarmQueue.length) {
    const ent = _prewarmQueue.shift();
    const animName = _prewarmQueue.shift();
    if (!ent._removed && ent.animScenes && !ent.animScenes[animName] && ent._gltfMap && ent._gltfMap[animName]) {
      const data = _cloneForAnim(animName, ent._gltfMap[animName], ent._animIndex, ent._animScale);
      data.scene.visible = false; // inactive — stays detached until _setBotAnim picks it
      ent.animScenes[animName] = data;
      return; // exactly one clone this frame
    }
  }
}

// True once every bot's full rig set (idle + all pre-warmed anims) is cloned and
// the work queues are drained. Used to hold the match countdown until loading is
// finished, so the heavy one-time clone cost lands on the loading hold instead of
// dropping frames during the countdown / early match.
function charLoadComplete() {
  if (!characterReady) return false;
  if (_attachQueue.length || _prewarmQueue.length) return false;
  for (const b of bots) { if (!b.animScenes) return false; }
  return true;
}

function findBotByMesh(mesh) {
  const idx = mesh?.userData?.botIndex;
  if (idx === undefined || idx === null) return null;
  const bot = bots[idx];
  return (bot && bot.alive) ? bot : null;
}
function findBotByInstance(mesh) { return findBotByMesh(mesh); }

// Kept for player kill-cam mesh in 12_main.js
function _makeICETex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 80;
  const x = c.getContext('2d');
  x.fillStyle = '#E06820'; x.fillRect(0, 0, 256, 80);
  x.font = 'bold 63px Arial Black, Impact, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#111111'; x.fillText('I.C.E.', 128, 40);
  x.strokeStyle = '#111111'; x.lineWidth = 2; x.strokeText('I.C.E.', 128, 40);
  return new THREE.CanvasTexture(c);
}
function _makeBagTex() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#C89040'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2400; i++) {
    const px = Math.random() * 128, py = Math.random() * 128;
    const v = (Math.random() - 0.5) * 28;
    x.fillStyle = `rgba(${v>0?255:0},${v>0?200:100},0,${Math.abs(v)/120})`;
    x.fillRect(px, py, 1.5, 1.5);
  }
  x.strokeStyle = 'rgba(80,50,10,0.12)'; x.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const lx = 15 + Math.random() * 98;
    x.beginPath(); x.moveTo(lx, 0); x.lineTo(lx + (Math.random()-0.5)*10, 128); x.stroke();
  }
  return new THREE.CanvasTexture(c);
}

loadCharacterAssets();

function createBot(x, z, name, index) {
  const h = getGroundHeight(x, z);
  const bot = {
    index,
    pos: new THREE.Vector3(x, h, z),
    yaw: 0,
    swing: 0,
    deadY: h,
    name,
    hp: 100,
    alive: true,
    // ~1 in 4 bots carries the pistol — visual variety only, AI/damage unchanged
    weapon: Math.random() < 0.25 ? 'pistol' : 'rifle',
    hasAmmo: true,
    moveDir: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
    moveTimer: 2 + Math.random() * 4,
    speed: 1.5 + Math.random() * 1.5,
    walkPhase: Math.random() * 6.28,
    shootCooldown: 0,
    shootAccuracy: 0.12 + Math.random() * 0.16,
    aggroRange: 30 + Math.random() * 20,
    ammoTimer: 0,
    reloadTimer: 55 + Math.random() * 20,
    exitDelay: 0,
    exitedPrison: false,
    velocityY: 0,
    isGrounded: true,
    canalJumpCount: 0,
    canalLandTimer: 0,
    waypoint: null,
    fleeTarget: null,
    prefersCrouch: Math.random() < 0.4,
    crouching: false,
    crouchTimer: 0,
    snapshots: [],
    shotTimes: [],
    mesh: null,
    mixer: null,
    currentAnimName: null,
    currentAction: null,
  };
  bots.push(bot);
  // Queue the attach (1/frame in updateBots) rather than cloning a rig synchronously
  // here — spawnBots makes all 10 at once, and that burst was the countdown load-in
  // glitch. index === array position (see spawnBots), which _drainCharWork relies on.
  if (characterReady) _attachQueue.push(index);
  return bot;
}

let _botShootUnlockedAt = Infinity; // set when match goes live

// Bot AI scratch — reused each frame (a fresh Vector3/Raycaster per engaging
// bot per frame was measurable GC churn with 20 bots)
const _aiEye = new THREE.Vector3(), _aiDir = new THREE.Vector3();
const _aiRay = new THREE.Raycaster();

// Gun sync helpers — reused each frame to avoid GC
const _gunPos = new THREE.Vector3();
const _gunQuat = new THREE.Quaternion();
const _gunOffVec = new THREE.Vector3();
const _gunRotQ = new THREE.Quaternion();
const _gunRotE = new THREE.Euler();

// --- Two-hand fit (live-tunable) ------------------------------------------
// Dial these from the browser console; changes apply every frame to all bots.
//   grip / fore : contact points on the gun mesh (METERS, gun-local).
//                 grip = pistol grip → right hand; fore = handguard → left hand.
//   rPalm/lPalm : wrist→palm offset (METERS, in each hand-bone's local frame) so the
//                 gun seats in the palm, not at the wrist bone.
//   roll        : extra roll about the barrel (RADIANS) to correct cant.
window.GUN_FIT = window.GUN_FIT || {
  grip:  [0, -0.090, -0.135],   // top of pistol grip, web of the right hand
  fore:  [0, -0.045, -0.500],   // underside of front handguard, cupped by the left palm
  rPalm: [0, 0.06, 0.01],       // hand-bone local: fingers run along +y, palm ≈ 60% to middle-finger base
  lPalm: [0, 0.07, 0.01],
  roll:  0,
  scaleMin: 0.9, scaleMax: 1.15,
};
// 1911 pistol: one real contact (the right palm). The gun is GLUED to the right
// hand bone with one fixed rotation (`rot`, hand-local Euler XYZ) — the pistol
// clips animate the hand as if it's holding the gun, so a single calibrated
// constant is correct in every pose. (The old forearm heuristic pointed the
// barrel along elbow→wrist and went backwards whenever the wrist cocked.)
window.PISTOL_FIT = window.PISTOL_FIT || {
  grip:  [0, -0.060, -0.020],   // contact on the gun seated at the palm — z tuned so the slide rear sits over the fist, not past the fingertips
  rPalm: [0, 0.02, 0.02],       // shorter than the rifle's — seats the slide rear into the thumb web
  mid:   [0, 0, -0.16],         // two-hand poses: seat offset in gun space (x right, y up, z backward) from the RIGHT-HAND anchor — z pushes the grip forward so it lands in the palm with the trigger under the index finger. (grip pin stays shared with the walk wrist-glue, so tune the clasp seat here, not via grip)
  rot:   [1.857, -0.195, -1.785], // hand→gun rotation: barrel along the forearm line at the PistolAim pose (probe-calibrated)
  roll:  0,                     // extra roll about the barrel (radians)
  scaleMin: 1.0, scaleMax: 1.0,
  // Pistol clips with an extended RIGHT (aiming) arm → seat the gun in the right
  // palm with the barrel along the right-forearm aim line; the left hand only
  // supports. PistolIdle (standing) is one of these. Not in this list → bent-arm
  // wrist-glue via `rot`. Live-tunable: push/splice anim names in the console
  // (e.g. PISTOL_FIT.twoHand.push('walk')) to test the moving poses.
  twoHand: ['aimIdle', 'fire', 'rifleIdle', 'walk', 'walkBack'],
};
// Toggle the two-hand fit (default on). Set window.GUN_AUTOFIT = false to use GUN_OFF instead.
if (window.GUN_AUTOFIT === undefined) window.GUN_AUTOFIT = true;
// Fallback single-hand offset (used if a left-hand bone is missing).
window.GUN_OFF = window.GUN_OFF || { px: 0.0, py: 0.0, pz: 0.0, rx: Math.PI / 2, ry: 0, rz: 0 };

const _GUN_UP_LOCAL = new THREE.Vector3(0, 1, 0); // gun's up: sights up, magazine down
// Scratch — reused each frame to avoid GC
const _hR = new THREE.Vector3(), _hL = new THREE.Vector3();
const _qR = new THREE.Quaternion(), _qL = new THREE.Quaternion();
const _palmR = new THREE.Vector3(), _palmL = new THREE.Vector3();
const _tgtR = new THREE.Vector3(), _tgtL = new THREE.Vector3();
const _gripV = new THREE.Vector3(), _foreV = new THREE.Vector3(), _axisL = new THREE.Vector3();
const _wFwd = new THREE.Vector3(), _wUp = new THREE.Vector3(0, 1, 0), _faP = new THREE.Vector3();
const _bx = new THREE.Vector3(), _by = new THREE.Vector3();
const _wx = new THREE.Vector3(), _wy = new THREE.Vector3();
const _mLocalInv = new THREE.Matrix4(), _mWorld = new THREE.Matrix4(), _mRot = new THREE.Matrix4();
const _qFit = new THREE.Quaternion(), _rollQ = new THREE.Quaternion();

// ── Shared character visual update — used by bots AND remote-player puppets ──
// `bot` is any entity with: pos (Vector3), yaw, alive, deadY, footOffset, weapon,
// animScenes, activeAnim (set via _setBotAnim first), gunMesh. Handles smooth yaw,
// anim scene placement, mixer/crossfade updates, and the two-hand gun fit.
function updateCharacterVisual(bot, dt) {
  // Smooth yaw rotation
  const targetYaw = bot.yaw;
  if (bot._smoothYaw === undefined) bot._smoothYaw = targetYaw;
  const yawDiff = Math.atan2(Math.sin(targetYaw - bot._smoothYaw), Math.cos(targetYaw - bot._smoothYaw));
  bot._smoothYaw += yawDiff * Math.min(1, dt * 8);

  // for..in (not Object.entries) — runs every frame per character, must not allocate.
  for (const animName in bot.animScenes) {
    const data = bot.animScenes[animName];
    if (!data.scene.parent) continue; // detached by _setBotAnim — skip entirely
    const fo = bot.footOffset ?? 0;
    if (!bot.alive) {
      data.scene.position.set(bot.pos.x, bot.deadY + fo, bot.pos.z);
    } else {
      data.scene.position.set(bot.pos.x, bot.pos.y + fo, bot.pos.z);
      data.scene.rotation.y = bot._smoothYaw;
    }
    if (data.scene.visible) {
      data.mixer.update(dt);

      // Kill root-motion XY drift (forward/lateral). bone.z = world-Y (height), leave it alone.
      // Skip stationary anims: their hips translation is weight-shift sway with the legs
      // counter-rotating to keep the feet planted — pinning the hips there transfers the
      // sway to the feet, which then "ice-skate" across the ground while idle.
      if (data.hipsBone && animName !== 'death'
          && animName !== 'rifleIdle' && animName !== 'aimIdle' && animName !== 'crouchIdle') {
        data.hipsBone.position.x = data.hipsRestX;
        data.hipsBone.position.y = data.hipsRestY;
      }

      // Manual crossfade loop — blend action→actionB near the clip end to avoid snap.
      // Uses direct weight control (no crossFadeTo) to prevent binding destruction.
      if (data.actionB && animName !== 'death') {
        const BLEND = 0.20;
        const remaining = data.clipDur - data.action.time;

        if (!data.xfActive && remaining < BLEND) {
          data.xfActive = true;
          data.xfProg = 0;
          data.actionB.reset();
          data.actionB.setEffectiveWeight(0);
          data.actionB.play();
        }

        if (data.xfActive) {
          data.xfProg = Math.min(1, data.xfProg + dt / BLEND);
          data.action.setEffectiveWeight(1 - data.xfProg);
          data.actionB.setEffectiveWeight(data.xfProg);
          if (data.xfProg >= 1) {
            data.action.setEffectiveWeight(0);
            const tmp = data.action; data.action = data.actionB; data.actionB = tmp;
            data.xfActive = false;
          }
        }
      }
    }
  }

  // Sync gun mesh into the hands. Two-hand fit: pistol grip → right hand,
  // handguard → left hand, barrel aligned to the line between the two hands.
  if (bot.gunMesh) {
    const activeData = bot.animScenes[bot.activeAnim];
    const rhBone = activeData?.rightHandBone;
    const lhBone = activeData?.leftHandBone;
    if (rhBone && bot.alive) {
      activeData.scene.updateMatrixWorld(true);
      const F = bot.weapon === 'pistol' ? window.PISTOL_FIT : window.GUN_FIT;
      rhBone.getWorldPosition(_hR);
      rhBone.getWorldQuaternion(_qR);
      if (!bot._gunGripRel) bot._gunGripRel = new THREE.Quaternion();

      // Contact points on the gun this frame, and the right-palm target (wrist + palm offset).
      _gripV.set(F.grip[0], F.grip[1], F.grip[2]);
      _palmR.set(F.rPalm[0], F.rPalm[1], F.rPalm[2]).applyQuaternion(_qR);
      _tgtR.copy(_hR).add(_palmR);

      // Reload/death let the left hand leave the gun — keep it glued to the right hand
      // only. Pistols never use the two-hand fit: both hands clasp the same point,
      // so the right→left palm axis is degenerate sideways noise.
      const anim = bot.activeAnim;
      const gripped = window.GUN_AUTOFIT && lhBone && anim !== 'reload' && anim !== 'death'
        && bot.weapon !== 'pistol';

      let fitOk = false;
      if (gripped) {
        lhBone.getWorldPosition(_hL);
        lhBone.getWorldQuaternion(_qL);
        _foreV.set(F.fore[0], F.fore[1], F.fore[2]);
        _palmL.set(F.lPalm[0], F.lPalm[1], F.lPalm[2]).applyQuaternion(_qL);
        _tgtL.copy(_hL).add(_palmL);
        // Degenerate-pose guard: if the hands drift too close together or stack
        // near-vertically (idle sway frames), the palm line is garbage — aligning
        // the barrel to it makes the rifle go vertical with random roll.
        const _spanW = _tgtL.distanceTo(_tgtR);
        fitOk = _spanW > 0.16 && Math.abs(_tgtL.y - _tgtR.y) / _spanW < 0.8;
      }

      if (fitOk) {

        // Fit gun size to the hand span (clamped). Recomputed each gripped frame so live
        // tuning applies instantly; reload/death reuse the last value via the else branch.
        const spanLocal = _foreV.distanceTo(_gripV);
        const raw = spanLocal > 1e-4 ? _tgtR.distanceTo(_tgtL) / spanLocal : 1;
        const clamped = Math.min(F.scaleMax, Math.max(F.scaleMin, raw));
        // Smooth toward the target scale so the gun doesn't pulse as the hands
        // move apart/together through the walk cycle.
        bot._gunFitScale = bot._gunFitScale
          ? bot._gunFitScale + (clamped - bot._gunFitScale) * 0.12
          : clamped;

        // Gun-local frame: barrel axis = grip→fore, up = gun up. Inverse = transpose (orthonormal).
        _axisL.copy(_foreV).sub(_gripV).normalize();
        _bx.crossVectors(_GUN_UP_LOCAL, _axisL);
        if (_bx.lengthSq() < 1e-8) _bx.set(1, 0, 0); else _bx.normalize();
        _by.crossVectors(_axisL, _bx).normalize();
        _mLocalInv.makeBasis(_bx, _by, _axisL).transpose();

        // World frame: forward = right→left palm, up = world up (keeps the gun upright).
        _wFwd.copy(_tgtL).sub(_tgtR);
        if (_wFwd.lengthSq() < 1e-8) _wFwd.set(Math.sin(bot._smoothYaw), 0, Math.cos(bot._smoothYaw));
        _wFwd.normalize();
        _wx.crossVectors(_wUp, _wFwd);
        if (_wx.lengthSq() < 1e-8) _wx.set(1, 0, 0); else _wx.normalize();
        _wy.crossVectors(_wFwd, _wx).normalize();
        _mWorld.makeBasis(_wx, _wy, _wFwd);
        _mRot.multiplyMatrices(_mWorld, _mLocalInv);
        _qFit.setFromRotationMatrix(_mRot);
        if (F.roll) _qFit.multiply(_rollQ.setFromAxisAngle(_axisL, F.roll));
        // Remember orientation relative to the right wrist, for reload/death reuse.
        bot._gunGripRel.copy(_qR).invert().multiply(_qFit);
      } else if (bot.weapon === 'pistol' && anim !== 'reload' && anim !== 'death') {
        const faBone = activeData.rightForeArmBone;
        const _twoHand = F.twoHand || ['aimIdle', 'fire'];
        if (faBone && lhBone && _twoHand.includes(anim)) {
          // Extended-arm two-handed poses: the gun lives in the RIGHT PALM and
          // the straighter right arm is the aiming arm; the left hand only
          // supports nearby (we don't seat to it). Anchor on the right hand +
          // right-forearm aim line — NOT the clasp midpoint, which floats the
          // gun out between the two hands. Basis is rebuilt right-handed from
          // cross products (never a negated makeBasis column → no det -1 mirror).
          faBone.getWorldPosition(_faP);
          _wFwd.copy(_hR).sub(_faP);   // right forearm → hand
          // Bots aim by yaw (horizontal), but the PistolAim/Idle clips angle the
          // forearm UP, tilting the gun skyward out of the palm. Flatten the aim
          // toward horizontal: barrelLevel 0 = fully level, 1 = follow the arm.
          _wFwd.y *= (F.barrelLevel ?? 0);
          if (_wFwd.lengthSq() < 1e-8) _wFwd.set(Math.sin(bot._smoothYaw), 0, Math.cos(bot._smoothYaw));
          _wFwd.normalize();
          _axisL.copy(_wFwd).negate(); // basis z (right-handed; gun barrel is -z)
          _wx.crossVectors(_wUp, _axisL);
          if (_wx.lengthSq() < 1e-8) _wx.set(1, 0, 0); else _wx.normalize();
          _wy.crossVectors(_axisL, _wx).normalize();
          _mWorld.makeBasis(_wx, _wy, _axisL);
          _qFit.setFromRotationMatrix(_mWorld);
          // Seat in the right palm: start at the right hand, then a tunable
          // offset in gun space (x right, y up, z backward) to settle the grip.
          _tgtR.copy(_hR);
          const M = F.mid || [0, 0, 0];
          _tgtR.addScaledVector(_wx, M[0]).addScaledVector(_wy, M[1]).addScaledVector(_axisL, M[2]);
        } else {
          // Bent-arm poses (idle/run/kneel/jump): glue to the right hand with the
          // calibrated hand→gun rotation — the hand is animated holding the gun,
          // so the gun tracks it naturally.
          const r = F.rot || [0, 0, 0];
          _qFit.copy(_qR).multiply(_gunRotQ.setFromEuler(_gunRotE.set(r[0], r[1], r[2])));
        }
        if (F.roll) _qFit.multiply(_rollQ.setFromAxisAngle(_axisL.set(0, 0, 1), F.roll));
        bot._gunFitScale = 1;
        bot._gunGripRel.copy(_qR).invert().multiply(_qFit);
      } else {
        // Rifle on degenerate palm-line frames (kneel/idle sway) and reload/death:
        // glue the gun to the right hand via the last good two-hand orientation.
        // The hand keeps holding the rifle through these poses, so following the
        // wrist looks right — aiming down the forearm here pointed the rifle
        // backwards whenever the forearm swung sideways (kneeling).
        if (bot._gunFitScale) {
          _qFit.copy(_qR).multiply(bot._gunGripRel);
        } else {
          const o = window.GUN_OFF;
          _qFit.copy(_qR).multiply(_gunRotQ.setFromEuler(_gunRotE.set(o.rx, o.ry, o.rz)));
        }
      }

      // Smooth the orientation so anim/fit-mode switches (scene swaps pop the
      // pose) can't pop the gun between frames — but track fast within a pose,
      // or the gun visibly lags the arms while the bot whips around to a target.
      if (bot._fitAnim !== anim) { bot._fitAnim = anim; bot._fitBlend = 0.15; }
      if (!bot._qGunSm) { bot._qGunSm = new THREE.Quaternion().copy(_qFit); bot._fitBlend = 0; }
      else {
        const smRate = bot._fitBlend > 0 ? 14 : 40;
        bot._fitBlend -= dt;
        bot._qGunSm.slerp(_qFit, Math.min(1, dt * smRate));
      }

      const scale = bot._gunFitScale || 1;
      bot.gunMesh.scale.setScalar(scale);
      bot.gunMesh.quaternion.copy(bot._qGunSm);
      // Seat the grip contact exactly in the right palm.
      _gunOffVec.copy(_gripV).applyQuaternion(bot._qGunSm).multiplyScalar(scale);
      bot.gunMesh.position.copy(_tgtR).sub(_gunOffVec);
      bot.gunMesh.visible = true;
    } else {
      bot.gunMesh.visible = false;
    }
  }
}

// ── Remote-player puppets — the bot character rig driven by network data ──
let _puppetSeq = 100; // index offset past bot indices (only used for per-clone variation)
function createCharacterPuppet(weapon = 'rifle') {
  if (!characterReady) return null;
  const { scale, footOffset } = _getCharScale();
  const ent = {
    pos: new THREE.Vector3(), yaw: 0, alive: true, deadY: 0, weapon,
    animScenes: {}, activeAnim: null, footOffset, mesh: null,
    // Lazy clone, same as bots — avoids a 13-rig clone hitch each time a remote
    // player first comes into view in a full lobby. Pre-warm fills in the rest.
    _gltfMap: weapon === 'pistol' ? _animGltfsPistol : _animGltfs,
    _animIndex: _puppetSeq++,
    _animScale: scale,
  };
  ent.gunMesh = weapon === 'pistol' ? _makeBotPistol() : _makeBotGun();
  ent.gunMesh.visible = false;
  scene.add(ent.gunMesh);
  _setBotAnim(ent, 'rifleIdle');
  _queueBotPrewarm(ent); // background-clone the rest, same as bots
  return ent;
}
function removeCharacterPuppet(ent) {
  if (!ent) return;
  ent._removed = true; // any queued pre-warm clones for this ent become no-ops
  for (const d of Object.values(ent.animScenes)) scene.remove(d.scene);
  if (ent.gunMesh) scene.remove(ent.gunMesh);
}

// Bots only spawn in Auto Join (bot match) mode — called from startBotMatch()
function spawnBots() {
  _botShootUnlockedAt = Date.now() + 60000;
  for (let i = 0; i < BOT_COUNT; i++) {
    const row = Math.floor(i / 5);
    const col = i % 5;
    const px = CONFIG.prisonPos.x - CONFIG.prisonSize / 2 + 5 + col * ((CONFIG.prisonSize - 10) / 4);
    const pz = CONFIG.prisonPos.z - CONFIG.prisonSize / 2 + 5 + row * ((CONFIG.prisonSize - 10) / 3);
    const bot = createBot(px, pz, BOT_NAMES[i] || 'Bot', i);
    // Stagger prison exit so all 10 don't switch idle→walk + activate AI on the
    // single frame the gate opens (that synchronized burst was the countdown-zero
    // hitch). ~0.12s apart also reads more naturally — bots file out, not burst.
    bot.exitDelay = i * 0.12;
    // Assign a spread-out first waypoint so bots fan across the map immediately
    const sectorAngle = (i / BOT_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const sectorR = 55 + Math.random() * 55;
    bot.waypoint = { x: Math.cos(sectorAngle) * sectorR, z: Math.sin(sectorAngle) * sectorR };
  }
}

function updateBots(dt) {
  _drainCharWork(); // ≤1 rig clone/frame: staggered attach + background pre-warm
  // Per-frame budget for bot line-of-sight raycasts (each is intersectObjects
  // against ALL collidables). A cluster of bots whose fire cooldowns align would
  // otherwise fire N scene-wide raycasts on the same frame — the CPU spike behind
  // the canal/combat drops. Cap it; deferred bots retry next frame (~tens of ms,
  // imperceptible). This is bot-only — real players run no AI.
  let losBudget = 4;
  for (const bot of bots) {
    if (!bot.alive) continue;

    // Always record snapshots — even during countdown so kill-cam always has history
    const snapNow = Date.now();
    const lastSnap = bot.snapshots[bot.snapshots.length - 1];
    if (!lastSnap || snapNow - lastSnap.t >= 50) {
      // Pre-compute exact aim angles toward the player for kill-cam replay
      const _sdx = camera.position.x - bot.pos.x;
      const _sdz = camera.position.z - bot.pos.z;
      const _sdist = Math.sqrt(_sdx * _sdx + _sdz * _sdz) || 0.001;
      const _sdy = (camera.position.y - 0.5) - (bot.pos.y + 1.65); // player body-center vs bot eye
      const _sAimYaw = Math.atan2(-_sdx, -_sdz);   // camera convention (same as follow-cam formula)
      const _sAimPitch = -Math.atan2(_sdy, _sdist);
      bot.snapshots.push({ t: snapNow, x: bot.pos.x, y: bot.pos.y, z: bot.pos.z, yaw: bot.yaw,
        aimYaw: _sAimYaw, aimPitch: _sAimPitch });
      const snapCutoff = snapNow - 30000;
      while (bot.snapshots.length > 2 && bot.snapshots[0].t < snapCutoff) bot.snapshots.shift();
    }

    // Phase check — don't move during lobby/countdown
    if (state.phase === 'lobby' || state.phase === 'countdown') continue;

    const bx = bot.pos.x, bz = bot.pos.z;

    // Check if bot is still inside prison
    const inPrison = Math.abs(bx - prison.x) < pw / 2 && Math.abs(bz - prison.z) < pw / 2;

    // If in prison or near gate, head for exit
    if (inPrison || (Math.abs(bx - (prison.x + pw/2)) < 8 && Math.abs(bz - prison.z) < pw/2 && bot.exitDelay <= 0 && !bot.exitedPrison)) {
      bot.exitDelay -= dt;
      if (bot.exitDelay > 0) {
        bot.walkPhase += dt * 1;
        bot.swing = Math.sin(bot.walkPhase) * 0.1;
        continue;
      }
      const wallX = prison.x + pw / 2;
      if (bx < wallX + 3) {
        bot.moveDir.set(1, 0, (prison.z - bz) * 0.3).normalize();
      } else {
        bot.exitedPrison = true;
        const ang = Math.atan2(-prison.z, -prison.x) + (Math.random() - 0.5) * 0.8;
        const rd = 50 + Math.random() * 40;
        bot.waypoint = { x: Math.cos(ang) * rd, z: Math.sin(ang) * rd };
      }
      bot.speed = 8.4;
      const newX = bx + bot.moveDir.x * bot.speed * dt;
      const newZ = bz + bot.moveDir.z * bot.speed * dt;
      bot.pos.x = newX;
      bot.pos.z = newZ;
      const th = getGroundHeight(bot.pos.x, bot.pos.z);
      bot.pos.y += (th - bot.pos.y) * Math.min(1, dt * 18);
      bot.yaw = Math.atan2(bot.moveDir.x, bot.moveDir.z);
      bot.walkPhase += dt * bot.speed * 3;
      bot.swing = Math.sin(bot.walkPhase) * 0.4;
      continue;
    }

    const dx = camera.position.x - bx;
    const dz = camera.position.z - bz;
    const distToPlayer = Math.sqrt(dx * dx + dz * dz);

    // Reload cycle — trigger once per minute, play clip once then rearm
    if (bot.hasAmmo && bot.exitedPrison) {
      bot.reloadTimer -= dt;
      if (bot.reloadTimer <= 0) {
        bot.hasAmmo = false;
        bot.ammoTimer = bot.animScenes?.reload?.clipDur ?? 3.3;
      }
    }
    if (!bot.hasAmmo && bot.exitedPrison) {
      bot.ammoTimer -= dt;
      if (bot.ammoTimer <= 0) {
        bot.hasAmmo = true;
        bot.reloadTimer = 55 + Math.random() * 20;
      }
    }

    // ── TOP PRIORITY: engage player if in range ──
    const engaging = bot.hasAmmo && distToPlayer < bot.aggroRange && !state.playerDead && Date.now() >= _botShootUnlockedAt;
    if (engaging) {
      bot.yaw = Math.atan2(dx, dz);
      bot.shootCooldown -= dt;
      // Line-of-sight + volcano occlusion are only needed at the instant the bot
      // wants to fire, so run them only when the cooldown is up — not every frame.
      // With a cluster of bots all engaging at once (the canal chokepoint), this is
      // the difference between ~10 full raycasts PER FRAME and ~10 per second.
      if (bot.shootCooldown <= 0 && losBudget > 0) {
        losBudget--;
        _aiEye.set(bx, bot.pos.y + 1.7, bz);
        _aiDir.set(dx, camera.position.y - _aiEye.y, dz).normalize();
        _aiRay.set(_aiEye, _aiDir);
        _aiRay.far = distToPlayer;
        const losHits = _aiRay.intersectObjects(collidables, false);
        let volcanoBlocking = false;
        // Only run the 20-step volcano sample when the bot→player line actually
        // passes over the volcano footprint (most fights don't) — cheap 2D
        // closest-approach-to-center test first.
        const _segLen2 = dx * dx + dz * dz;
        const _tc = _segLen2 > 0 ? Math.max(0, Math.min(1, -(bx * dx + bz * dz) / _segLen2)) : 0;
        const _cx = bx + dx * _tc, _cz = bz + dz * _tc;
        if (_cx * _cx + _cz * _cz <= CONFIG.volcanoRadius * CONFIG.volcanoRadius) {
          const stepSize = distToPlayer / 20;
          for (let s = 1; s < 20; s++) {
            const t = s * stepSize;
            const volH = getVolcanoHeight(_aiEye.x + _aiDir.x * t, _aiEye.z + _aiDir.z * t);
            if (volH > 0.8 && _aiEye.y + _aiDir.y * t < volH - 0.1) { volcanoBlocking = true; break; }
          }
        }
        if (losHits.length > 0 || volcanoBlocking) {
          // Blocked — retry shortly (not next frame) so an occluded bot near the
          // player doesn't re-raycast at 60Hz.
          bot.shootCooldown = 0.12 + Math.random() * 0.08;
        } else {
        bot.shootCooldown = 0.8 + Math.random() * 1.5;
        const fireDur = bot.animScenes?.fire?.clipDur ?? 0.8;
        bot.fireAnimUntil = Date.now() + fireDur * 1000;
        bot.shotTimes.push(Date.now());
        if (bot.shotTimes.length > 200) bot.shotTimes.shift();
        const hitChance = Math.max(0.08, 0.48 - distToPlayer * 0.005 - bot.shootAccuracy);
        if (Math.random() < hitChance) {
          const dmg = 8 + Math.floor(Math.random() * 7);
          const prevHp = state.hp;
          if (state.armor > 0) { state.armor = Math.max(0, state.armor - dmg); }
          else { state.hp = Math.max(0, state.hp - dmg); }
          if (prevHp > 0 && state.hp <= 0) {
            state.killCamBotIndex = bots.indexOf(bot);
            state.killCamShooterId = null;
            window._killCamBot = bot; // direct reference — avoids indexOf returning -1
            // Push a precise snapshot at the exact kill frame so the replay ends aimed perfectly
            const _ksNow = Date.now();
            const _ksdx = camera.position.x - bot.pos.x;
            const _ksdz = camera.position.z - bot.pos.z;
            const _ksdist = Math.sqrt(_ksdx * _ksdx + _ksdz * _ksdz) || 0.001;
            const _ksdy = (camera.position.y - 0.5) - (bot.pos.y + 1.65);
            bot.snapshots.push({
              t: _ksNow, x: bot.pos.x, y: bot.pos.y, z: bot.pos.z, yaw: bot.yaw,
              aimYaw: Math.atan2(-_ksdx, -_ksdz),
              aimPitch: -Math.atan2(_ksdy, _ksdist),
            });
            state.killShotAbsTime = _ksNow;
          }
          updateHUD();
          const dv = document.getElementById('damage-vignette');
          dv.classList.add('show');
          setTimeout(() => dv.classList.remove('show'), 350);
          SFX.hitmarker();
        }
        playNoise(0.06, 0.08 * Math.max(0.2, 1 - distToPlayer / 80), 3000, 'bandpass');
        }
      }
    }

    // ── MOVEMENT: always pick a destination and walk to it ──
    if (state.waterRising) {
      if (!bot.fleeTarget) {
        const botIdx = bots.indexOf(bot);
        const angle = (botIdx / bots.length) * Math.PI * 2;
        const r = 15 + (botIdx % 5) * 5;
        bot.fleeTarget = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
      }
      const arrived = Math.sqrt((bx - bot.fleeTarget.x) ** 2 + (bz - bot.fleeTarget.z) ** 2) < 4;
      if (arrived) {
        const curAngle = Math.atan2(bz, bx);
        const orbitR = Math.sqrt(bx * bx + bz * bz) || 20;
        const nextAngle = curAngle + 0.4;
        bot.fleeTarget = { x: Math.cos(nextAngle) * orbitR, z: Math.sin(nextAngle) * orbitR };
      }
      bot.moveDir.set(bot.fleeTarget.x - bx, 0, bot.fleeTarget.z - bz).normalize();
      bot.speed = 8.4;
      bot.yaw = Math.atan2(bot.moveDir.x, bot.moveDir.z);
    } else {
      if (!bot.waypoint || Math.sqrt((bx - bot.waypoint.x) ** 2 + (bz - bot.waypoint.z) ** 2) < 6) {
        const angle = Math.random() * Math.PI * 2;
        const r = 80 + Math.random() * 90;
        bot.waypoint = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
      }
      bot.moveDir.set(bot.waypoint.x - bx, 0, bot.waypoint.z - bz).normalize();
      bot.speed = engaging ? 3.35 : 5.05;
      if (!engaging) bot.yaw = Math.atan2(bot.moveDir.x, bot.moveDir.z);
    }

    let newX = bx + bot.moveDir.x * bot.speed * dt;
    let newZ = bz + bot.moveDir.z * bot.speed * dt;

    const atBoundary = Math.abs(newX) >= half - 12 || Math.abs(newZ) >= half - 12;
    const atVolcano = getVolcanoHeight(newX, newZ) > (state.waterRising ? 40 : 18);

    // Canal crossing: two walls (inner r≈83.75, outer r≈86.25), padded to ~82.75–84.75 and ~85.25–87.25.
    // Strategy: force radially inward movement while in the canal zone, then bounce-jump until clear.
    const CANAL_MIN = 82.0, CANAL_MAX = 87.5;
    const maxNow = Math.max(Math.abs(bx), Math.abs(bz));
    const inCanalZone = maxNow >= CANAL_MIN && maxNow <= CANAL_MAX;
    const approachingCanal = maxNow > CANAL_MAX && Math.max(Math.abs(newX), Math.abs(newZ)) <= CANAL_MAX;

    if (!inCanalZone) { bot.canalJumpCount = 0; bot.canalLandTimer = 0; }

    // Steer toward waypoint while crossing canal — keeps bots spread at different crossing angles
    if (inCanalZone || approachingCanal) {
      const wpx = bot.waypoint ? bot.waypoint.x : 0, wpz = bot.waypoint ? bot.waypoint.z : 0;
      const wd = Math.sqrt((wpx - bx) ** 2 + (wpz - bz) ** 2) || 1;
      bot.moveDir.set((wpx - bx) / wd, 0, (wpz - bz) / wd);
      newX = bx + bot.moveDir.x * bot.speed * dt;
      newZ = bz + bot.moveDir.z * bot.speed * dt;
      // Lock yaw so character keeps facing its travel direction, not snapping mid-jump
      bot.yaw = Math.atan2(bot.moveDir.x, bot.moveDir.z);
    }

    // Jump on canal entry from outside
    if (approachingCanal && bot.isGrounded) {
      bot.velocityY = 7.2; bot.isGrounded = false; bot.canalJumpCount = 1; bot.canalLandTimer = 0;
    }
    // Bounce-jump: wait 0.1s after landing before next jump so bot travels a bit further
    if (bot.canalJumpCount >= 1 && bot.canalJumpCount < 2 && inCanalZone) {
      if (!bot.isGrounded) {
        bot.canalLandTimer = 0.1;
      } else if (bot.canalLandTimer > 0) {
        bot.canalLandTimer -= dt;
      } else {
        bot.velocityY = 7.2; bot.isGrounded = false; bot.canalJumpCount++;
      }
    }

    const bypassCollision = inCanalZone || bot.canalJumpCount > 0;
    if (!atBoundary && !atVolcano && (bypassCollision || !checkBotCollision(newX, newZ))) {
      bot.pos.x = newX;
      bot.pos.z = newZ;
    } else if (!bypassCollision) {
      const angle = Math.random() * Math.PI * 2;
      const r = 30 + Math.random() * 50;
      bot.waypoint = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
      bot.fleeTarget = null;
    }

    // Jump physics
    bot.velocityY -= 22 * dt;
    bot.pos.y += bot.velocityY * dt;
    const th = getGroundHeight(bot.pos.x, bot.pos.z);
    if (bot.pos.y <= th) {
      bot.pos.y = th;
      bot.velocityY = 0;
      bot.isGrounded = true;
    }

    bot.walkPhase += dt * bot.speed * 3;
    bot.swing = Math.sin(bot.walkPhase) * 0.4;
  }

  // Update bot mesh positions and advance animation mixers
  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i];
    if (!bot.animScenes) continue;

    // Determine target animation
    const isEngaging = bot.alive && bot.hasAmmo && !state.playerDead && Date.now() >= _botShootUnlockedAt &&
      (Math.sqrt((bot.pos.x - camera.position.x) ** 2 + (bot.pos.z - camera.position.z) ** 2) < bot.aggroRange);
    const isFiring = bot.alive && bot.fireAnimUntil && Date.now() < bot.fireAnimUntil;

    // Crouch toggle — some bots randomly crouch when engaging
    if (isEngaging) {
      bot.crouchTimer -= dt;
      if (bot.crouchTimer <= 0) {
        bot.crouching = bot.prefersCrouch && Math.random() < 0.65;
        bot.crouchTimer = 4 + Math.random() * 6;
      }
    } else {
      bot.crouching = false;
      bot.crouchTimer = 0;
    }

    // Is bot moving backward relative to the direction it's facing?
    const _fx = Math.sin(bot.yaw), _fz = Math.cos(bot.yaw);
    const _moveDot = bot.moveDir.x * _fx + bot.moveDir.z * _fz;
    const isMoving = bot.speed > 0.5;
    const movingBack = isEngaging && isMoving && _moveDot < -0.3;

    const inLobby = state.phase === 'lobby' || state.phase === 'countdown';
    let targetAnim;
    if (!bot.alive)                    targetAnim = 'death';
    else if (inLobby)                  targetAnim = 'rifleIdle';
    else if (!bot.isGrounded)          targetAnim = 'jump';
    else if (!bot.hasAmmo && bot.exitedPrison) targetAnim = 'reload';
    else if (isFiring)                 targetAnim = 'fire';
    else if (bot.crouching)            targetAnim = isMoving ? (movingBack ? 'crouchWalkBack' : 'crouchWalk') : 'crouchIdle';
    else if (movingBack)               targetAnim = 'walkBack';
    else if (isEngaging && !isMoving)  targetAnim = 'aimIdle';
    else if (!isEngaging && !isMoving) targetAnim = 'rifleIdle';
    else                               targetAnim = 'walk';

    if (bot._dbgAnim) targetAnim = bot._dbgAnim; // headless test rig: force a pose
    _setBotAnim(bot, targetAnim);
    updateCharacterVisual(bot, dt);

    // Update world-space hitbox positions. Head bone measures 1.78 above the feet
    // on the normalized rig — the old 1.6 put "headshots" at the upper chest.
    if (bot.hitbox) {
      if (bot.alive) {
        bot.hitbox.position.set(bot.pos.x, bot.pos.y + 0.75, bot.pos.z);
        bot.hitboxHead.position.set(bot.pos.x, bot.pos.y + 1.78, bot.pos.z);
      } else {
        // Move dead hitboxes out of the way so they can't be shot
        bot.hitbox.position.set(0, -999, 0);
        bot.hitboxHead.position.set(0, -999, 0);
      }
    }
  }

  // Shadow caster selection — once per frame, after all character positions are set
  // (bots above + remote puppets earlier this frame).
  _updateAllCharShadows();

  // Update kill-cam player dummy mesh
  if (window._playerMeshMixer && window._playerMesh && window._playerMesh.visible) {
    window._playerMeshMixer.update(dt);
    if (window._playerMeshHips) {
      window._playerMeshHips.bone.position.x = window._playerMeshHips.rx;
      window._playerMeshHips.bone.position.y = window._playerMeshHips.ry;
    }
  }
}

function damageBot(bot, dmg, isHead) {
  if (!bot.alive) return;
  bot.hp -= dmg;
  if (bot.hp <= 0) {
    bot.alive = false;
    state.kills++;
    SFX.kill_chaching();
    document.getElementById('kills-val').textContent = state.kills;
    addKillFeedEntry(bot.name, isHead);
    bot.deadY = getGroundHeight(bot.pos.x, bot.pos.z);
  }
}


// Kill feed
const killFeedEntries = [];
function addKillFeedEntry(botName, isHead) {
  const el = document.getElementById('kill-feed');
  killFeedEntries.push({ name: botName, head: isHead, time: Date.now() });
  if (killFeedEntries.length > 5) killFeedEntries.shift();
  el.innerHTML = killFeedEntries.map(e =>
    `<div class="entry">You ${e.head ? '⊕' : '→'} ${e.name}${e.head ? ' (headshot)' : ''}</div>`
  ).join('');
  setTimeout(() => {
    const idx = killFeedEntries.length > 0 ? killFeedEntries.findIndex(e => e.time === killFeedEntries[0].time) : -1;
    if (idx >= 0) killFeedEntries.splice(idx, 1);
    el.innerHTML = killFeedEntries.map(e =>
      `<div class="entry">You ${e.head ? '⊕' : '→'} ${e.name}</div>`
    ).join('');
  }, 5000);
}

// ═══════════════════════════════════════════════════════════
// LOOT SYSTEM
// ═══════════════════════════════════════════════════════════
const LOOT_TYPES = {
  ammo_m4: { label: 'M4 Ammo x30', color: 0xccaa44, height: 0.15 },
  ammo_pistol: { label: '1911 Ammo x15', color: 0xcc8833, height: 0.12 },
  health: { label: 'Health Pack +50', color: 0x44cc66, height: 0.15 },
  armor: { label: 'Armor +100', color: 0x4488cc, height: 0.15 },
};

function spawnLoot(x, z, type) {
  const h = getTerrainHeight(x, z);
  if (getVolcanoHeight(x, z) > 1) return;
  const info = LOOT_TYPES[type];

  const lootGroup = new THREE.Group();

  if (type === 'ammo_m4' || type === 'ammo_pistol') {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.2, 0.25),
      new THREE.MeshLambertMaterial({ color: 0x5a4a2a })
    );
    lootGroup.add(box);
    for (let b = 0; b < 3; b++) {
      const bullet = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.12, 6),
        new THREE.MeshLambertMaterial({ color: 0xccaa44 })
      );
      bullet.position.set((b - 1) * 0.08, 0.15, 0);
      lootGroup.add(bullet);
    }
  } else if (type === 'health') {
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.25, 0.35),
      new THREE.MeshLambertMaterial({ color: 0xeeeeee })
    );
    lootGroup.add(pack);
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.06), new THREE.MeshBasicMaterial({ color: 0xdd2222 }));
    crossH.position.y = 0.13;
    lootGroup.add(crossH);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.2), new THREE.MeshBasicMaterial({ color: 0xdd2222 }));
    crossV.position.y = 0.13;
    lootGroup.add(crossV);
  } else if (type === 'armor') {
    const vest = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.35, 0.25),
      new THREE.MeshLambertMaterial({ color: 0x445566 })
    );
    lootGroup.add(vest);
    for (const s of [-0.15, 0.15]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, 0.25), new THREE.MeshLambertMaterial({ color: 0x334455 }));
      strap.position.set(s, 0.22, 0);
      lootGroup.add(strap);
    }
  }

  lootGroup.position.set(x, h + 0.2, z);
  lootGroup.castShadow = true;
  lootGroup.userData = { lootType: type, label: info.label, baseY: lootGroup.position.y };
  scene.add(lootGroup);
  lootItems.push(lootGroup);
  if (lootGroup.children.length > 0) windowPanes.push(lootGroup.children[0]);
}

// ═══════════════════════════════════════════════════════════
// AMMO DEPOTS — Roman temples at 3 corners
// OBB collision: walls use obbCollidables (picked up by 08b_physics.js)
// which transforms the player to local shed space for correct diagonal physics.
// ═══════════════════════════════════════════════════════════
const windowPanes = [];
const obbCollidables = []; // read by 08b_physics.js _moveHorizontal/_depenetrate
const obbFloors = [];      // raised floor surfaces (shed podium steps) — checked in _physStep

const depotCorners = [
  { x:  half - 16, z:  half - 16 },
  { x:  half - 16, z: -half + 16 },
  { x: -half + 16, z: -half + 16 },
];

const crateM4Mat  = new THREE.MeshPhongMaterial({ color: 0x4a5a18, shininess: 18 });
const crate19Mat  = new THREE.MeshPhongMaterial({ color: 0x5a3810, shininess: 18 });
const crateArMat  = new THREE.MeshPhongMaterial({ color: 0x0a2a5a, shininess: 22 });
const crateHpMat  = new THREE.MeshPhongMaterial({ color: 0x991111, shininess: 18 });
const crateWhite  = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 22 });
const crateBlack  = new THREE.MeshLambertMaterial({ color: 0x111111 });
const crateStrip  = new THREE.MeshPhongMaterial({ color: 0x999999, shininess: 55 });
const crateCorner = new THREE.MeshPhongMaterial({ color: 0x666666, shininess: 65 });
const depotCrates = [];

// Ammo depots are BR only — duel is fixed-loadout, no pickups. Declarations
// above (windowPanes/obbCollidables/obbFloors/depotCrates) stay defined (empty)
// so physics + shot raycast still resolve them.
if (CONFIG.mode === 'br') depotCorners.forEach(({ x, z }) => {
  const h = getTerrainHeight(x, z);
  const rotY = Math.atan2(-x, -z);
  const cosR = Math.cos(rotY), sinR = Math.sin(rotY);
  // local (shed) → world XZ
  const toWorld = (lx, lz) => [x + lx * cosR - lz * sinR, z + lx * sinR + lz * cosR];

  const group = new THREE.Group();
  group.position.set(x, h, z);
  group.rotation.y = rotY;
  scene.add(group);

  // Dimensions — 10% larger than original
  const bw = 19.8, bd = 13.2, wallH = 8.25, wt = 0.75;
  const colR = 0.666, colH = wallH;

  // Roman temple materials — Lambert responds to scene lighting (depth/shading)
  const stone     = new THREE.MeshLambertMaterial({ color: 0xD8D2C8 }); // warm limestone
  const stoneDk   = new THREE.MeshLambertMaterial({ color: 0xB8B2A8 }); // unused, kept for safety
  const stoneCeil = new THREE.MeshBasicMaterial({ color: 0xB0ACA4 });   // unlit ceiling — avoids green hemisphere tint
  const roofMat   = new THREE.MeshBasicMaterial({ color: 0x5B2C8B });   // royal purple roof (unlit — no z-fight)

  // Helper — add mesh as child of rotated group (local coords)
  const addM = (geo, mat, lx, ly, lz, rx, ry, rz) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(lx, ly, lz);
    if (rx != null) m.rotation.x = rx;
    if (ry != null) m.rotation.y = ry;
    if (rz != null) m.rotation.z = rz;
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    targets.push(m); // bullet impacts on shed surfaces
    return m;
  };

  // ── Podium steps — 5 steps, total platform height 0.96 ──
  addM(new THREE.BoxGeometry(bw + 9.0, 0.22, bd + 9.0), stone, 0, 0.11, 0);  // outermost
  addM(new THREE.BoxGeometry(bw + 7.0, 0.20, bd + 7.0), stone, 0, 0.32, 0);
  addM(new THREE.BoxGeometry(bw + 5.0, 0.18, bd + 5.0), stone, 0, 0.51, 0);
  addM(new THREE.BoxGeometry(bw + 3.0, 0.18, bd + 3.0), stone, 0, 0.69, 0);
  addM(new THREE.BoxGeometry(bw + 1.0, 0.18, bd + 1.0), stone, 0, 0.87, 0);  // innermost

  // OBB floor entries — one per step, player snaps up incrementally
  obbFloors.push({ shedX: x, shedZ: z, cosR, sinR, hw: (bw + 9.0) / 2, hd: (bd + 9.0) / 2, topY: h + 0.22 });
  obbFloors.push({ shedX: x, shedZ: z, cosR, sinR, hw: (bw + 7.0) / 2, hd: (bd + 7.0) / 2, topY: h + 0.42 });
  obbFloors.push({ shedX: x, shedZ: z, cosR, sinR, hw: (bw + 5.0) / 2, hd: (bd + 5.0) / 2, topY: h + 0.60 });
  obbFloors.push({ shedX: x, shedZ: z, cosR, sinR, hw: (bw + 3.0) / 2, hd: (bd + 3.0) / 2, topY: h + 0.78 });
  obbFloors.push({ shedX: x, shedZ: z, cosR, sinR, hw: (bw + 1.0) / 2, hd: (bd + 1.0) / 2, topY: h + 0.96 });

  // ── Solid side walls (local ±X) ──
  for (const sx of [-1, 1]) {
    const wx = sx * (bw / 2 - wt / 2);
    addM(new THREE.BoxGeometry(wt, wallH, bd), stone, wx, wallH / 2, 0);
  }

  // ── Column helper: base disk + shaft + 3 ring bands + echinus neck + capital ──
  const groove = new THREE.MeshLambertMaterial({ color: 0x9E9A94 }); // darker — groove shadow
  const addCol = (lx, lz) => {
    // Only the shaft casts a shadow. The base/rings/neck hug the shaft, whose
    // shadow already covers them — but each one is a draw call in the shadow
    // pass, and 16 columns × 3 temples × 5 trim parts was ~240 calls/frame.
    addM(new THREE.CylinderGeometry(colR * 1.28, colR * 1.28, 0.22, 12), stone, lx, 0.11, lz).castShadow = false;
    addM(new THREE.CylinderGeometry(colR, colR * 1.06, colH, 12), stone, lx, colH / 2, lz);
    // Three ring bands at 20%, 48%, 76% of shaft height
    for (const frac of [0.20, 0.48, 0.76])
      addM(new THREE.CylinderGeometry(colR + 0.055, colR + 0.055, 0.09, 12), groove, lx, colH * frac, lz).castShadow = false;
    // Echinus — flared neck from shaft top up to capital
    addM(new THREE.CylinderGeometry(colR * 1.38, colR * 1.02, 0.26, 12), stone, lx, colH + 0.13, lz).castShadow = false;
  };

  // Front face (+Z = bd/2) — 5 columns, player walks between them (gap ≈ 2.65 units)
  const colXs = Array.from({ length: 5 }, (_, k) => -bw / 2 + 1.5 + (bw - 3.0) / 4 * k);
  for (const cx of colXs) addCol(cx, bd / 2);

  // Back face (-Z = -bd/2) — 5 columns, open like the front
  for (const cx of colXs) addCol(cx, -bd / 2);

  // Side faces — 3 columns per side, visual only (side wall OBBs block)
  const sideColZs = [-bd / 2 + 2.0, 0, bd / 2 - 2.0];
  for (const sx of [-1, 1]) for (const cz of sideColZs) addCol(sx * bw / 2, cz);

  // ── Entablature ──
  const entY = wallH, entH = 1.0;
  addM(new THREE.BoxGeometry(bw + colR * 2 + 0.8, entH, bd + colR * 2 + 0.8), stoneCeil, 0, entY + entH / 2, 0);
  addM(new THREE.BoxGeometry(bw + colR * 2 + 1.2, 0.22, bd + colR * 2 + 1.2), roofMat, 0, entY + entH + 0.11, 0);

  // ── Pediment (triangular gable) — front (+Z) and back (-Z) ──
  const pedBaseY = entY + entH + 0.22;
  const ridgeH   = 2.0;
  const pedW     = bw + colR * 2 + 0.8;
  const rakeAng  = Math.atan2(ridgeH, pedW / 2);
  const rakeLen  = Math.sqrt((pedW / 2) ** 2 + ridgeH ** 2) + 0.3;
  for (const pz of [-1, 1]) {
    const pzp = pz * (bd / 2 + colR + 0.4);
    addM(new THREE.BoxGeometry(pedW, ridgeH, wt), stone, 0, pedBaseY + ridgeH / 2, pzp);
    addM(new THREE.BoxGeometry(pedW + 0.2, 0.22, wt + 0.06), stone, 0, pedBaseY + 0.11, pzp);
    for (const sx of [-1, 1]) {
      addM(new THREE.BoxGeometry(rakeLen, 0.22, wt + 0.08), roofMat,
        sx * pedW / 4, pedBaseY + ridgeH / 2, pzp, null, null, -sx * rakeAng);
    }
  }

  // ── Roof — two panels sloping left/right from center ridge ──
  const panelHW = bw / 2 + colR + 0.4; // horizontal half-width of each panel
  const roofAng = Math.atan2(ridgeH, panelHW);
  const panelDiag = Math.sqrt(panelHW ** 2 + ridgeH ** 2) + 0.3;
  const panelD   = bd + colR * 2 + 0.5;
  for (const sx of [-1, 1]) {
    addM(new THREE.BoxGeometry(panelDiag, 0.30, panelD), roofMat,
      sx * panelHW / 2, pedBaseY + ridgeH / 2, 0, null, null, -sx * roofAng);
  }
  addM(new THREE.BoxGeometry(0.40, 0.42, panelD), roofMat, 0, pedBaseY + ridgeH - 0.1, 0);

  // No floor collider needed — terrain height handles the floor naturally.

  // ── OBB wall colliders ──
  // lcx/lcz = center in Three.js LOCAL shed space (matches visual wall positions exactly).
  // Physics applies Three.js inverse rotation: local = R^T*(world-shed)
  // where R = [[cosR,sinR],[-sinR,cosR]] (Three.js Y-rotation matrix, XZ rows).
  const wallTop = h + wallH + entH + 0.5;

  // Left side wall — visual center at local lx=-(bw/2-wt/2), lz=0
  obbCollidables.push({ shedX: x, shedZ: z, lcx: -(bw / 2 - wt / 2), lcz: 0,
                        hx: wt / 2 + 0.5, hz: bd / 2, cosR, sinR, minY: h, maxY: wallTop });

  // Right side wall — visual center at local lx=+(bw/2-wt/2), lz=0
  obbCollidables.push({ shedX: x, shedZ: z, lcx: bw / 2 - wt / 2, lcz: 0,
                        hx: wt / 2 + 0.5, hz: bd / 2, cosR, sinR, minY: h, maxY: wallTop });

  // ── OBB column colliders — front AND back face, player walks BETWEEN them ──
  for (const cx of colXs) {
    obbCollidables.push({ shedX: x, shedZ: z, lcx: cx, lcz: bd / 2,
                          hx: colR + 0.08, hz: colR + 0.08, cosR, sinR, minY: h, maxY: h + colH });
    obbCollidables.push({ shedX: x, shedZ: z, lcx: cx, lcz: -(bd / 2),
                          hx: colR + 0.08, hz: colR + 0.08, cosR, sinR, minY: h, maxY: h + colH });
  }

  // ── Crates — 2×2 grid inside the shed ──
  const cs = 1.05, crateLocalY = 0.96 + cs / 2; // sit on top of podium (podium top = 0.96)

  [
    { lx: -3.0, lz: -2.5, mat: crateM4Mat,  type: 'depot_ammo_m4',    label: '[F] +10 M4 Ammo',     icon: 'ammo_large'  },
    { lx:  3.0, lz: -2.5, mat: crate19Mat,  type: 'depot_ammo_pistol', label: '[F] +10 Pistol Ammo', icon: 'ammo_small'  },
    { lx: -3.0, lz:  2.5, mat: crateArMat,  type: 'depot_armor',       label: '[F] Full Armor',       icon: 'armor'       },
    { lx:  3.0, lz:  2.5, mat: crateHpMat,  type: 'depot_health',      label: '[F] +50 Health',       icon: 'health'      },
  ].forEach(({ lx, lz, mat, type, label, icon }) => {
    // All crate parts added to group in LOCAL coords — Three.js handles world transform.
    const cy = h + crateLocalY; // absolute world Y (for pickup system)

    const crate = new THREE.Mesh(new THREE.BoxGeometry(cs, cs, cs), mat);
    crate.position.set(lx, crateLocalY, lz);
    crate.castShadow = true;
    crate.userData = { lootType: type, label, depot: true, baseY: cy,
                       shedX: x, shedZ: z, shedHW: bw / 2, shedHD: bd / 2 };
    group.add(crate); depotCrates.push(crate); windowPanes.push(crate);
    // OBB collider so player can't walk through crates
    obbCollidables.push({ shedX: x, shedZ: z, lcx: lx, lcz: lz,
      hx: cs / 2 + 0.1, hz: cs / 2 + 0.1, cosR, sinR,
      minY: h + crateLocalY - cs / 2, maxY: h + crateLocalY + cs / 2 });

    for (const py of [-0.32, 0, 0.32]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(cs + 0.03, 0.055, cs + 0.03), crateBlack);
      line.position.set(lx, crateLocalY + py, lz); group.add(line);
    }
    for (const ex of [-1, 1]) for (const ez of [-1, 1]) {
      const br = new THREE.Mesh(new THREE.BoxGeometry(0.13, cs + 0.05, 0.13), crateCorner);
      br.position.set(lx + ex * (cs / 2 - 0.01), crateLocalY, lz + ez * (cs / 2 - 0.01));
      group.add(br);
    }
    const strap = new THREE.Mesh(new THREE.BoxGeometry(cs + 0.05, 0.08, cs + 0.05), crateStrip);
    strap.position.set(lx, crateLocalY, lz); group.add(strap);

    const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.055, 0.74), crateWhite);
    plaque.position.set(lx, crateLocalY + cs / 2 + 0.028, lz); group.add(plaque);

    const iconLY = crateLocalY + cs / 2; // local Y above crate top

    if (icon === 'ammo_large') {
      const brass    = new THREE.MeshPhongMaterial({ color: 0xc8960c, shininess: 45 });
      const case_m   = new THREE.MeshPhongMaterial({ color: 0x8b6914, shininess: 35 });
      const greenTip = new THREE.MeshPhongMaterial({ color: 0x336622, shininess: 55 });
      const primMat  = new THREE.MeshPhongMaterial({ color: 0xaaaaaa, shininess: 65 });
      const cas  = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.068, 0.32, 12), case_m);
      cas.position.set(lx, iconLY + 0.20, lz); group.add(cas);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.072, 0.08, 12), brass);
      neck.position.set(lx, iconLY + 0.40, lz); group.add(neck);
      const bod  = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.24, 12), brass);
      bod.position.set(lx, iconLY + 0.56, lz); group.add(bod);
      const tipp = new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.19, 12), greenTip);
      tipp.position.set(lx, iconLY + 0.78, lz); group.add(tipp);
      const prim = new THREE.Mesh(new THREE.CylinderGeometry(0.070, 0.070, 0.032, 12), primMat);
      prim.position.set(lx, iconLY + 0.05, lz); group.add(prim);
    } else if (icon === 'ammo_small') {
      const brass = new THREE.MeshPhongMaterial({ color: 0xb06010, shininess: 40 });
      const silv  = new THREE.MeshPhongMaterial({ color: 0xdddddd, shininess: 75 });
      const cas  = new THREE.Mesh(new THREE.CylinderGeometry(0.080, 0.075, 0.22, 10), brass);
      cas.position.set(lx, iconLY + 0.17, lz); group.add(cas);
      const bod  = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.080, 0.10, 10), silv);
      bod.position.set(lx, iconLY + 0.33, lz); group.add(bod);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), silv);
      dome.position.set(lx, iconLY + 0.38, lz); group.add(dome);
    } else if (icon === 'armor') {
      const shBlue  = new THREE.MeshPhongMaterial({ color: 0x1a44cc, shininess: 32 });
      const shLight = new THREE.MeshPhongMaterial({ color: 0x7799ff, shininess: 55 });
      const shBody = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.38, 0.11), shBlue);
      shBody.position.set(lx, iconLY + 0.34, lz); group.add(shBody);
      const shL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.25, 0.11), shBlue);
      shL.rotation.z = 0.42; shL.position.set(lx - 0.26, iconLY + 0.42, lz); group.add(shL);
      const shR = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.25, 0.11), shBlue);
      shR.rotation.z = -0.42; shR.position.set(lx + 0.26, iconLY + 0.42, lz); group.add(shR);
      const shEmb = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.28, 0.12), shLight);
      shEmb.position.set(lx, iconLY + 0.35, lz); group.add(shEmb);
    } else if (icon === 'health') {
      const crossRed = new THREE.MeshPhongMaterial({ color: 0xdd1111, shininess: 22 });
      const border = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.60, 0.09), crateWhite);
      border.position.set(lx, iconLY + 0.28, lz - 0.01); group.add(border);
      const hb = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.18, 0.11), crossRed);
      hb.position.set(lx, iconLY + 0.28, lz + 0.01); group.add(hb);
      const vb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.56, 0.11), crossRed);
      vb.position.set(lx, iconLY + 0.28, lz + 0.01); group.add(vb);
    }
  });

  group.updateMatrixWorld(true);
});

// Scattered outer-ring loot removed — all loot now comes from the depot sheds
// (the 3 Roman-temple depots above) only. spawnLoot() is kept as the floating-
// pickup factory in case it's wanted later (e.g. bot-death drops); nothing calls
// it now, so lootItems stays empty and the pickup loops simply no-op.
// ═══════════════════════════════════════════════════════════
// WEAPON MODEL
// ═══════════════════════════════════════════════════════════
const weaponGroup = new THREE.Group();
weaponScene.add(weaponCamera);
weaponCamera.add(weaponGroup);
scene.add(camera);

// muzzle flash state — declared before createWeaponModel so function can assign into them
var muzzleFlashGroup = null;
var muzzleFlashMats  = [];
var muzzleFlashLight = null;
var _muzzleTimer = 0;
var MUZZLE_DUR = 0.060;

function createWeaponModel(type) {
  while (weaponGroup.children.length) weaponGroup.remove(weaponGroup.children[0]);

  const mBlack  = new THREE.MeshPhongMaterial({ color: 0x0d0d0d, shininess: 50 });
  const mDark   = new THREE.MeshPhongMaterial({ color: 0x161616, shininess: 40 });
  const mMetal  = new THREE.MeshPhongMaterial({ color: 0x272727, shininess: 90,  specular: new THREE.Color(0x444444) });
  const mEdge   = new THREE.MeshPhongMaterial({ color: 0x424242, shininess: 140, specular: new THREE.Color(0x888888) });
  const mChrome = new THREE.MeshPhongMaterial({ color: 0x585858, shininess: 220, specular: new THREE.Color(0xbbbbbb) });
  const mLens   = new THREE.MeshPhongMaterial({ color: 0x001122, shininess: 300, specular: new THREE.Color(0x224488), emissive: new THREE.Color(0x000811) });
  const mWood   = new THREE.MeshPhongMaterial({ color: 0x7a4a1a, shininess: 15 });
  const mWoodDk = new THREE.MeshPhongMaterial({ color: 0x5a3010, shininess: 10 });
  const mGlove  = new THREE.MeshPhongMaterial({ color: 0x1a2410, shininess: 8 });
  const mGlvL   = new THREE.MeshPhongMaterial({ color: 0x283418, shininess: 12 });
  const mSkin   = new THREE.MeshPhongMaterial({ color: 0xc4a882, shininess: 5 });

  function add(geo, mat, px, py, pz, rx, ry, rz) {
    rx = rx||0; ry = ry||0; rz = rz||0;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    if (rx||ry||rz) m.rotation.set(rx, ry, rz);
    weaponGroup.add(m); return m;
  }
  const B  = (w,h,d) => new THREE.BoxGeometry(w,h,d);
  const Cy = (rt,rb,h,s) => new THREE.CylinderGeometry(rt,rb,h,s||10);
  const PI2 = Math.PI/2;

  if (type === 'm4') {

    // ── BARREL (short AK-style, ~300mm) ──
    add(Cy(0.015,0.017,0.330,10), mDark,   0, 0.000,-0.465, PI2,0,0);  // main barrel
    add(Cy(0.024,0.024,0.022,10), mMetal,  0, 0.000,-0.520, PI2,0,0);  // gas block
    add(Cy(0.005,0.005,0.185, 6), mDark,   0, 0.028,-0.445, PI2,0,0);  // gas tube
    // Krink-style expansion chamber muzzle device
    add(Cy(0.022,0.016,0.016,10), mMetal,  0, 0.000,-0.628, PI2,0,0);  // rear shoulder
    add(Cy(0.028,0.028,0.038,10), mMetal,  0, 0.000,-0.650, PI2,0,0);  // expansion body
    add(Cy(0.020,0.028,0.010,10), mEdge,   0, 0.000,-0.672, PI2,0,0);  // front taper
    add(Cy(0.014,0.014,0.008, 8), mChrome, 0, 0.000,-0.680, PI2,0,0);  // crown

    // ── HANDGUARD (wood) ──
    add(B(0.052,0.022,0.215), mWood,   0, 0.014,-0.425);
    add(B(0.056,0.024,0.215), mWoodDk, 0,-0.016,-0.425);
    for (let s=0; s<4; s++) {
      add(B(0.006,0.016,0.020), mBlack,  0.029, 0.008,-0.348+s*0.052);
      add(B(0.006,0.016,0.020), mBlack, -0.029, 0.008,-0.348+s*0.052);
    }

    // ── UPPER RECEIVER (AK dust cover) ──
    add(B(0.058,0.026,0.205), mDark,   0, 0.013,-0.215);
    add(B(0.060,0.008,0.205), mMetal,  0, 0.026,-0.215);   // top surface
    // Side charging handle (right)
    add(B(0.006,0.015,0.026), mMetal,  0.034, 0.006,-0.178);
    add(B(0.018,0.010,0.010), mEdge,   0.044, 0.010,-0.178);
    // Ejection port
    add(B(0.005,0.022,0.048), mEdge,   0.033,-0.002,-0.210);
    add(B(0.003,0.017,0.042), mBlack,  0.034,-0.002,-0.210);

    // ── LOWER RECEIVER ──
    add(B(0.056,0.050,0.205), mDark,   0,-0.027,-0.215);
    add(B(0.060,0.010,0.022), mMetal,  0,-0.002,-0.115);   // upper ledge
    // AK-style selector lever (right side)
    add(B(0.005,0.010,0.058), mMetal,  0.034,-0.004,-0.194);
    add(B(0.005,0.022,0.010), mEdge,   0.034,-0.004,-0.174);
    // Trigger guard
    add(B(0.055,0.010,0.052), mMetal,  0,-0.074,-0.166);
    add(Cy(0.008,0.008,0.055,8), mMetal, 0,-0.080,-0.166, 0,0,PI2);
    add(B(0.008,0.022,0.007), mChrome, 0,-0.057,-0.166);   // trigger

    // ── CURVED AK MAGAZINE ──
    add(B(0.042,0.060,0.072), mBlack,  0,-0.106,-0.260, 0.09,0,0);   // top section
    add(B(0.040,0.062,0.070), mBlack,  0,-0.168,-0.268, 0.19,0,0);   // mid curve
    add(B(0.040,0.060,0.070), mDark,   0,-0.226,-0.258, 0.27,0,0);   // lower body
    add(B(0.042,0.013,0.072), mMetal,  0,-0.268,-0.244, 0.27,0,0);   // base pad
    add(B(0.006,0.175,0.010), mMetal,  0,-0.178,-0.265, 0.16,0,0);   // rear spine rib
    add(B(0.044,0.010,0.010), mMetal,  0,-0.098,-0.258);              // mag catch groove

    // ── AK PISTOL GRIP (wood) ──
    add(B(0.038,0.094,0.046), mWood,   0,-0.126,-0.130,-0.30,0,0);
    add(B(0.040,0.012,0.048), mDark,   0,-0.190,-0.138,-0.30,0,0);
    for (let f=0;f<3;f++) add(B(0.040,0.004,0.040), mDark, 0,-0.108+f*-0.023,-0.128,-0.30,0,0);
    add(B(0.002,0.082,0.040), mEdge,   0.021,-0.128,-0.129,-0.30,0,0);
    add(B(0.002,0.082,0.040), mEdge,  -0.021,-0.128,-0.129,-0.30,0,0);

    // ── SKELETON SIDE-FOLDING STOCK (AKS-style) ──
    add(B(0.016,0.040,0.012), mMetal, -0.028,-0.012,-0.020);  // hinge block
    add(B(0.008,0.008,0.145), mDark,  -0.028, 0.002, 0.062);  // top arm
    add(B(0.008,0.008,0.145), mDark,  -0.028,-0.032, 0.062);  // bottom arm
    add(B(0.008,0.038,0.008), mDark,  -0.028,-0.015, 0.038);  // front brace
    add(B(0.008,0.038,0.008), mDark,  -0.028,-0.015, 0.092);  // mid brace
    add(B(0.012,0.064,0.020), mEdge,  -0.028,-0.015, 0.144);  // shoulder plate

    // ── AK FRONT SIGHT (open U-hood, tapered post) ──
    add(B(0.034,0.006,0.014), mMetal,  0, 0.031,-0.570);        // base wings
    add(Cy(0.001,0.004,0.020,4), mChrome, 0, 0.040,-0.570);     // tapered sight post (pointy tip)
    add(B(0.004,0.020,0.010), mMetal, -0.014, 0.040,-0.570);    // hood left
    add(B(0.004,0.020,0.010), mMetal,  0.014, 0.040,-0.570);    // hood right

    // ── AK REAR LEAF SIGHT — open U-notch (no leaf body/notch plug so view is clear) ──
    add(B(0.040,0.006,0.014), mMetal,  0,      0.030,-0.152);   // base
    add(B(0.010,0.022,0.010), mChrome,-0.018,  0.040,-0.152);   // left ear
    add(B(0.010,0.022,0.010), mChrome, 0.018,  0.040,-0.152);   // right ear

    // ── MUZZLE FLASH SETUP ──
    muzzleFlashMats  = [];
    muzzleFlashGroup = new THREE.Group();
    muzzleFlashGroup.position.set(0, 0, -0.698);
    muzzleFlashGroup.visible = false;
    weaponGroup.add(muzzleFlashGroup);
    var mkFM = function(col) {
      return new THREE.MeshBasicMaterial({
        color: col, transparent: true, opacity: 1.0,
        depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      });
    };
    var fgeoA = new THREE.PlaneGeometry(0.112, 0.112);
    var fgeoB = new THREE.PlaneGeometry(0.058, 0.170);
    var fgeoC = new THREE.PlaneGeometry(0.044, 0.044);
    for (var fi=0;fi<3;fi++) {
      var fm = mkFM(0xffee44);
      var fp = new THREE.Mesh(fgeoA, fm);
      fp.rotation.z = fi * Math.PI/3;
      muzzleFlashGroup.add(fp);
      muzzleFlashMats.push(fm);
    }
    var bm1 = mkFM(0xff9900); var bm2 = mkFM(0xff9900);
    var beam1 = new THREE.Mesh(fgeoB, bm1); beam1.rotation.z =  Math.PI/4;
    var beam2 = new THREE.Mesh(fgeoB, bm2); beam2.rotation.z = -Math.PI/4;
    muzzleFlashGroup.add(beam1, beam2);
    muzzleFlashMats.push(bm1, bm2);
    var cm = mkFM(0xffffff);
    muzzleFlashGroup.add(new THREE.Mesh(fgeoC, cm));
    muzzleFlashMats.push(cm);
    muzzleFlashLight = new THREE.PointLight(0xffcc33, 0, 10);
    muzzleFlashGroup.add(muzzleFlashLight);

    // ── LEFT HAND (wrapped around handguard) ──
    add(B(0.060,0.046,0.050), mGlove,  0,-0.048,-0.450, 0.04,0,0);
    add(B(0.014,0.038,0.042), mGlvL,  -0.032,-0.042,-0.444, 0.04,0,0); // thumb
    for (let f=0;f<4;f++) add(B(0.058,0.012,0.036), mGlvL, 0,-0.028+f*-0.018,-0.462, 0.04,0,0);
    add(B(0.044,0.038,0.118), mSkin,  -0.005,-0.050,-0.368, 0, 0.12,0);

    // ── RIGHT HAND (trigger grip) ──
    add(B(0.054,0.064,0.055), mGlove,  0,-0.108,-0.113);
    add(B(0.014,0.058,0.050), mGlvL,  -0.030,-0.106,-0.111); // thumb
    add(B(0.012,0.018,0.044), mGlvL,   0.022,-0.072,-0.111); // index on trigger
    for (let f=0;f<3;f++) add(B(0.050,0.012,0.046), mGlvL, 0,-0.093+f*-0.018,-0.102);
    add(B(0.044,0.038,0.116), mSkin,  -0.001,-0.080,-0.046, 0,-0.10,0);

  } else {
    // ── 1911 PISTOL (unchanged) ──
    const metalDark  = new THREE.MeshLambertMaterial({ color: 0x141414 });
    const metalMid   = new THREE.MeshLambertMaterial({ color: 0x252525 });
    const metalLight = new THREE.MeshLambertMaterial({ color: 0x3e3e3e });
    const metalShine = new THREE.MeshLambertMaterial({ color: 0x505050 });
    const wood       = new THREE.MeshLambertMaterial({ color: 0x52320e });
    const woodLight  = new THREE.MeshLambertMaterial({ color: 0x6e4a1a });
    const skin       = new THREE.MeshLambertMaterial({ color: 0xc4a882 });
    const glove      = new THREE.MeshLambertMaterial({ color: 0x2a3820 });
    const gloveLight = new THREE.MeshLambertMaterial({ color: 0x3a5030 });
    const pOff = -0.18;
    add(B(0.034,0.044,0.230), metalDark,  0.15, 0.000,-0.10+pOff);
    add(B(0.036,0.008,0.230), metalLight, 0.15, 0.022,-0.10+pOff);
    for (let s=0;s<5;s++) add(B(0.036,0.036,0.003), metalShine, 0.15,0.002,-0.010+pOff-s*0.008);
    add(B(0.004,0.022,0.050), metalShine, 0.168,0.004,-0.065+pOff);
    add(B(0.004,0.008,0.028), metalMid,   0.130,-0.010,-0.080+pOff);
    add(B(0.032,0.038,0.175), metalMid,   0.15,-0.036,-0.065+pOff);
    add(B(0.032,0.008,0.058), metalMid,   0.15,-0.052,-0.060+pOff);
    add(B(0.034,0.028,0.008), metalMid,   0.15,-0.042,-0.085+pOff);
    add(B(0.010,0.024,0.007), metalShine, 0.15,-0.038,-0.064+pOff);
    add(B(0.004,0.008,0.018), metalShine, 0.130,0.006,-0.040+pOff);
    add(B(0.012,0.018,0.012), metalDark,  0.15,0.024, 0.008+pOff);
    add(B(0.008,0.010,0.008), metalShine, 0.15,0.030, 0.002+pOff);
    add(B(0.005,0.078,0.042), wood,       0.168,-0.090,-0.005+pOff, -0.18,0,0);
    add(B(0.005,0.078,0.042), wood,       0.132,-0.090,-0.005+pOff, -0.18,0,0);
    add(B(0.005,0.006,0.040), woodLight,  0.168,-0.062,-0.004+pOff, -0.18,0,0);
    add(B(0.005,0.006,0.040), woodLight,  0.132,-0.062,-0.004+pOff, -0.18,0,0);
    add(B(0.032,0.090,0.042), metalDark,  0.15,-0.090, 0.002+pOff, -0.18,0,0);
    add(B(0.026,0.010,0.034), metalLight, 0.15,-0.140,-0.008+pOff);
    add(Cy(0.010,0.010,0.068,8),  metalMid,   0.15,0.005,-0.255+pOff, PI2,0,0);
    add(Cy(0.020,0.020,0.155,10), metalDark,  0.15,0.004,-0.305+pOff, PI2,0,0);
    for (let r=0;r<6;r++) add(Cy(0.022,0.022,0.006,10), metalMid, 0.15,0.004,-0.238+pOff-r*0.020, PI2,0,0);
    add(Cy(0.020,0.016,0.012,10), metalLight, 0.15,0.004,-0.387+pOff, PI2,0,0);
    // ── REAR SIGHT — open U-notch (near hammer, z≈-0.185) ──
    add(B(0.028,0.006,0.010), metalDark,  0.15,  0.022,-0.005+pOff);  // base
    add(B(0.008,0.020,0.010), metalShine, 0.138, 0.032,-0.005+pOff);  // left ear
    add(B(0.008,0.020,0.010), metalShine, 0.162, 0.032,-0.005+pOff);  // right ear
    // ── FRONT SIGHT — tapered post (near muzzle, z≈-0.390) ──
    add(B(0.024,0.005,0.010), metalDark,  0.15,  0.020,-0.210+pOff);  // base
    add(Cy(0.002,0.004,0.018,4), metalShine, 0.15, 0.031,-0.210+pOff);  // tapered post
    add(B(0.064,0.052,0.072), glove,      0.15,-0.064, 0.002+pOff);
    add(B(0.014,0.048,0.068), gloveLight, 0.130,-0.062, 0.000+pOff);
    // Forearm — extended toward the camera from the original 0.148-long block
    // (which left a visible gap once ADS pulls the pistol close to camera);
    // far edge stays anchored at the hand, only the near edge reaches further.
    add(B(0.058,0.050,0.22), skin,       0.130,-0.065, 0.12+pOff, 0,-0.08,0);
  }

  const wp = type === 'm4' ? {x:0.25,y:-0.22,z:-0.38} : {x:0.2,y:-0.2,z:-0.3};
  weaponGroup.position.set(wp.x, wp.y, wp.z);
  weaponGroup.rotation.set(0, 0, 0);
}
createWeaponModel('m4');
let weaponBobPhase = 0;

// ═══════════════════════════════════════════════════════════
// MUZZLE FLASH CONTROL
// ═══════════════════════════════════════════════════════════
function showMuzzleFlash() {
  if (!muzzleFlashGroup) return;
  muzzleFlashGroup.visible = true;
  _muzzleTimer = MUZZLE_DUR;
  if (muzzleFlashLight) muzzleFlashLight.intensity = 8.0;
  muzzleFlashGroup.rotation.z = Math.random() * Math.PI * 2;
  for (var i=0;i<muzzleFlashMats.length;i++) muzzleFlashMats[i].opacity = 1.0;
}

function updateMuzzleFlash(dt) {
  if (!muzzleFlashGroup || _muzzleTimer <= 0) {
    if (muzzleFlashGroup) muzzleFlashGroup.visible = false;
    if (muzzleFlashLight) muzzleFlashLight.intensity = 0;
    return;
  }
  _muzzleTimer -= dt;
  var t = Math.max(0, _muzzleTimer / MUZZLE_DUR);
  for (var i=0;i<muzzleFlashMats.length;i++) muzzleFlashMats[i].opacity = t;
  if (muzzleFlashLight) muzzleFlashLight.intensity = 8.0 * t;
  if (_muzzleTimer <= 0) {
    muzzleFlashGroup.visible = false;
    if (muzzleFlashLight) muzzleFlashLight.intensity = 0;
  }
}

// ═══════════════════════════════════════════════════════════
// BULLET IMPACTS
// ═══════════════════════════════════════════════════════════
// ── Impact particle pool ──
// Old code allocated 4–7 new Mesh + SphereGeometry + MeshBasicMaterial on every
// bullet hit and scene.remove()+dispose()'d them on expiry — heavy GC + GPU churn
// during sustained fire (~10 hits/s × 4–7 = 40–70 allocs/s), a top cause of the
// "frames drop when I shoot" hitching. Now: one shared geometry + material and a
// fixed ring pool of meshes toggled visible. No per-hit allocation, no add/remove.
const _IMPACT_POOL = 64;
const _impactGeo = new THREE.SphereGeometry(0.02, 4, 3);
const _impactMat = new THREE.MeshBasicMaterial({ color: 0xccbb88 });
const impactParticles = [];
let _impactHead = 0;
for (let i = 0; i < _IMPACT_POOL; i++) {
  const p = new THREE.Mesh(_impactGeo, _impactMat);
  p.visible = false;
  p.userData = { vel: new THREE.Vector3(), life: 0 };
  scene.add(p);
  impactParticles.push(p);
}

function spawnImpact(pos, normal) {
  const count = 4 + Math.floor(Math.random() * 4);
  for (let i = 0; i < count; i++) {
    const p = impactParticles[_impactHead];
    _impactHead = (_impactHead + 1) % _IMPACT_POOL; // ring: oldest recycled if saturated
    p.position.copy(pos);
    const dir = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2)
      .add(normal.clone().multiplyScalar(2));
    p.userData.vel.copy(dir.multiplyScalar(0.8 + Math.random() * 1.5));
    p.userData.life = 0.25 + Math.random() * 0.3;
    p.visible = true;
  }
}

// ── Bullet tracer pool ──
// Same zero-allocation philosophy as the impact pool: one InstancedMesh (a
// single draw call for every live tracer) + a fixed slot ring. A tracer is a
// short bright streak racing from muzzle to impact — purely the visual read of
// the shot line (Krunker-style); hitscan damage stays instant.
const _TRACER_POOL = 24;
const _TRACER_LEN = 7;       // streak length (world units)
const _TRACER_SPEED = 360;   // visual travel speed (units/s)
const _tracerGeo = new THREE.BoxGeometry(0.0245, 0.0245, 1); // unit-z, scaled to len per instance — -30% from prior pass
const _tracerMat = new THREE.MeshBasicMaterial({
  color: 0xffd9a0, blending: THREE.AdditiveBlending, transparent: true,
  opacity: 0.294, depthWrite: false, // -30% from prior pass
});
const tracerMesh = new THREE.InstancedMesh(_tracerGeo, _tracerMat, _TRACER_POOL);
tracerMesh.frustumCulled = false; // instances span the arena; stale instanced bounds would cull them
scene.add(tracerMesh);
const _tracers = [];
for (let i = 0; i < _TRACER_POOL; i++) {
  _tracers.push({ active: false, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, traveled: 0 });
}
let _tracerHead = 0, _tracerLive = 0;
const _trTmp = new THREE.Object3D();                    // matrix scratch — no per-frame allocation
const _trZero = new THREE.Matrix4().makeScale(0, 0, 0); // hides an inactive slot
const _trVec = new THREE.Vector3();
for (let i = 0; i < _TRACER_POOL; i++) tracerMesh.setMatrixAt(i, _trZero); // all hidden at boot

function spawnTracer(from, to) {
  _trVec.copy(to).sub(from);
  const d = _trVec.length();
  if (d < 2) return; // point-blank — no visible line to draw (checked BEFORE touching a slot)
  const t = _tracers[_tracerHead];
  _tracerHead = (_tracerHead + 1) % _TRACER_POOL;
  t.from.copy(from);
  t.dir.copy(_trVec).divideScalar(d);
  t.dist = d;
  t.traveled = 0;
  if (!t.active) _tracerLive++;
  t.active = true;
}

// Remote shots know only origin + direction — clamp the streak against static
// world geometry so it doesn't sail through cover. One raycast per remote shot
// (≤10/s), negligible.
const _trRay = new THREE.Raycaster();
function spawnTracerRay(from, dir, maxDist) {
  _trRay.set(from, dir);
  _trRay.far = maxDist;
  const hits = _trRay.intersectObjects(targets, false);
  _trVec.copy(dir).multiplyScalar(hits.length > 0 ? hits[0].distance : maxDist).add(from);
  spawnTracer(from, _trVec);
}

function updateTracers(dt) {
  if (_tracerLive === 0) return; // nothing in flight — skip the matrix upload
  for (let i = 0; i < _TRACER_POOL; i++) {
    const t = _tracers[i];
    if (!t.active) { tracerMesh.setMatrixAt(i, _trZero); continue; }
    t.traveled += _TRACER_SPEED * dt;
    // Done once the TAIL (traveled − LEN, unclamped) passes the end point. The
    // old check compared the wall-clamped tail against dist, which could never
    // trigger for shots shorter than the streak length — immortal tracers on
    // every close-range hit.
    if (t.traveled - _TRACER_LEN >= t.dist) { t.active = false; _tracerLive--; tracerMesh.setMatrixAt(i, _trZero); continue; }
    const head = Math.min(t.traveled, t.dist);
    const tail = Math.max(t.traveled - _TRACER_LEN, 0);
    _trTmp.position.copy(t.dir).multiplyScalar((head + tail) / 2).add(t.from);
    _trVec.copy(_trTmp.position).add(t.dir);
    _trTmp.lookAt(_trVec);
    _trTmp.scale.set(1, 1, Math.max(head - tail, 0.1));
    _trTmp.updateMatrix();
    tracerMesh.setMatrixAt(i, _trTmp.matrix);
  }
  tracerMesh.instanceMatrix.needsUpdate = true;
}

// ═══════════════════════════════════════════════════════════
// COLLISION — pre-cached bounding boxes for performance
// ═══════════════════════════════════════════════════════════
const playerBB = new THREE.Box3();
const objBB = new THREE.Box3();

// Cache: static objects get their BB computed once at startup.
// Dynamic objects (gate doors) are flagged and recomputed each frame.
const collidableCache = []; window._collidableCache = collidableCache; // { bb: Box3, dynamic: bool, obj: mesh }

function buildCollisionCache() {
  collidableCache.length = 0;
  for (const obj of collidables) {
    obj.updateMatrixWorld(true); // force world matrix before BB compute
    // Gate doors are the only moving collidables, and they're island-only
    // (removed in the city build) — short-circuit before referencing them.
    const isDynamic = CONFIG.world === 'island' && (obj === gateDoorL || obj === gateDoorR);
    const bb = new THREE.Box3().setFromObject(obj);
    collidableCache.push({ bb, dynamic: isDynamic, obj });
  }
}

function refreshDynamicColliders() {
  for (const entry of collidableCache) {
    if (entry.dynamic) entry.bb.setFromObject(entry.obj);
  }
}

function checkCollisionAndStep(newPos) {
  const r = CONFIG.playerRadius;
  const currentH = state.crouching ? CONFIG.crouchHeight : CONFIG.playerHeight;
  const feetY = newPos.y - currentH;
  const headY = newPos.y;

  let blocked = false;
  let stepUpY = 0;

  for (const entry of collidableCache) {
    const bb = entry.bb;

    // Y band: skip colliders entirely below feet or entirely above head
    if (bb.max.y <= feetY || bb.min.y >= headY) continue;

    // XZ circle-vs-AABB: closest point on box to player centre
    // Replaces old square test which snagged on box corners.
    const cx = Math.max(bb.min.x, Math.min(newPos.x, bb.max.x));
    const cz = Math.max(bb.min.z, Math.min(newPos.z, bb.max.z));
    const dx = newPos.x - cx;
    const dz = newPos.z - cz;
    if (dx * dx + dz * dz >= r * r) continue;

    // Step-up: roll over small ledges (<= 0.4 m)
    const heightAboveFeet = bb.max.y - feetY;
    if (heightAboveFeet > 0 && heightAboveFeet <= 0.4) {
      stepUpY = Math.max(stepUpY, bb.max.y + currentH + 0.01);
    } else {
      blocked = true;
      break;
    }
  }
  return { blocked, stepUpY };
}

// Bot collision check — uses cache
function checkBotCollision(x, z, botSelf) {
  for (const entry of collidableCache) {
    const bb = entry.bb;
    if (x > bb.min.x - 0.5 && x < bb.max.x + 0.5 &&
        z > bb.min.z - 0.5 && z < bb.max.z + 0.5) {
      return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// PHYSICS — Capsule sweep-and-slide, fixed timestep
// Velocity-based movement: ground accel/friction, air control, slide
// Toggled by CONFIG.newPhysics in 01_config.js
// ═══════════════════════════════════════════════════════════

const PHYS = {
  FIXED_STEP:  1 / 60,   // 60 Hz fixed timestep — deterministic, same result every run
  STEP_HEIGHT: 0.45,     // Max ledge auto-step (curbs, terrain lips)
  SKIN_WIDTH:  0.015,    // Stop just before surface to prevent tunneling
  MAX_ITER:    4,        // Max slide iterations per step (handles corners)
  STEP_SMOOTH: 12.0,     // Camera-Y catch-up rate on stairs (higher = snappier, lower = floatier)

  // ── Movement feel (Quake-family model) ──
  GROUND_FRICTION:   9.0,   // Higher = stops faster. ~3 steps to stop
  GROUND_ACCEL:      11.0,  // Higher = reaches max speed faster. ~4 steps to full
  AIR_ACCEL:         1.4,   // Weak mid-air steering — momentum carries through jumps
  SLIDE_BOOST:       1.35,  // Velocity multiplier on slide trigger
  SLIDE_FRICTION:    0.22,  // Friction multiplier while sliding (low = long slide)
  SLIDE_MIN_TRIGGER: 0.85,  // Must be moving at >= this fraction of moveSpeed to slide
  SLIDE_COOLDOWN:    1.0,   // Seconds before another slide can trigger
};

let _physAccum = 0;     // Leftover time between fixed steps
let _prevCrouch = false; // Edge-detect crouch press for slide trigger

// Capsule state.
//   pos = FEET position in world space (not eye/camera)
//   vel = world velocity (XYZ) — horizontal components now persistent
//   grounded = true when standing on something
const phys = {
  pos:      new THREE.Vector3(),
  vel:      new THREE.Vector3(),
  grounded: false,
};
if (window.DBG) window.DBG.phys = phys;

// Call once after buildCollisionCache() to seed phys from camera
function physInit() {
  phys.pos.set(
    camera.position.x,
    camera.position.y - CONFIG.playerHeight,
    camera.position.z
  );
  phys.vel.set(0, 0, 0);
  phys.grounded = true;
  _physAccum = 0;
  _prevCrouch = false;
  state.sliding = false;
  state.slideCooldown = 0;
  state.camFeetY = phys.pos.y;
}

// ── Sweep a 2D point (px,pz) moving by (dx,dz) against axis-aligned rect [x0,x1]x[z0,z1]
// Returns { t, nx, nz } on contact, null if no contact in [0,1).
// nx/nz is the outward face normal of the rect at contact.
function _sweep2D(px, pz, dx, dz, x0, x1, z0, z1) {
  let tEnter = 0, tExit = 1;
  let nx = 0, nz = 0;

  // X slab
  if (Math.abs(dx) < 1e-9) {
    if (px <= x0 || px >= x1) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (x0 - px) * inv;
    let t2 = (x1 - px) * inv;
    let n  = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; n = 1; }
    if (t1 > tEnter) { tEnter = t1; nx = n; nz = 0; }
    tExit = Math.min(tExit, t2);
  }

  // Z slab
  if (Math.abs(dz) < 1e-9) {
    if (pz <= z0 || pz >= z1) return null;
  } else {
    const inv = 1 / dz;
    let t1 = (z0 - pz) * inv;
    let t2 = (z1 - pz) * inv;
    let n  = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; n = 1; }
    if (t1 > tEnter) { tEnter = t1; nx = 0; nz = n; }
    tExit = Math.min(tExit, t2);
  }

  if (tEnter >= tExit || tEnter >= 1 || tExit <= 0) return null;
  // Started overlapping — depenetration handles this separately
  if (tEnter < 0) return null;

  return { t: tEnter, nx, nz };
}

// ── Push player out of any colliders they're currently inside ──
// Called as a safety pass after each fixed step.
function _depenetrate(pos, radius, height) {
  for (const entry of collidableCache) {
    const bb = entry.bb;
    if (bb.max.y <= pos.y || bb.min.y >= pos.y + height) continue;

    const cx = (bb.min.x + bb.max.x) * 0.5;
    const cz = (bb.min.z + bb.max.z) * 0.5;
    const hx = (bb.max.x - bb.min.x) * 0.5 + radius;
    const hz = (bb.max.z - bb.min.z) * 0.5 + radius;

    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const ox = hx - Math.abs(dx);
    const oz = hz - Math.abs(dz);

    if (ox <= 0 || oz <= 0) continue;

    if (ox < oz) {
      pos.x += ox * Math.sign(dx || 1);
    } else {
      pos.z += oz * Math.sign(dz || 1);
    }
  }

  // OBB depenetration — local center stored in shed-local space; Three.js inverse used.
  // Three.js Y-rotation: world = shed + R*local  where R=[[cosR,sinR],[-sinR,cosR]]
  // Inverse:            local = R^T*(world-shed) = [[cosR,-sinR],[sinR,cosR]]*(world-shed)
  for (const obb of obbCollidables) {
    if (obb.maxY <= pos.y || obb.minY >= pos.y + height) continue;
    const dx = pos.x - obb.shedX;
    const dz = pos.z - obb.shedZ;
    const lx = (dx * obb.cosR - dz * obb.sinR) - obb.lcx;
    const lz = (dx * obb.sinR + dz * obb.cosR) - obb.lcz;
    const ox = obb.hx + radius - Math.abs(lx);
    const oz = obb.hz + radius - Math.abs(lz);
    if (ox <= 0 || oz <= 0) continue;
    let pushLX = 0, pushLZ = 0;
    if (ox < oz) { pushLX = ox * Math.sign(lx || 1); }
    else          { pushLZ = oz * Math.sign(lz || 1); }
    // R * push_local: world_x += cosR*pushLX + sinR*pushLZ
    pos.x += pushLX * obb.cosR + pushLZ * obb.sinR;
    pos.z += -pushLX * obb.sinR + pushLZ * obb.cosR;
  }
}

// ── Horizontal sweep-and-slide ──
// Moves pos.x/z by (deltaX, deltaZ), bouncing/sliding off colliders up to MAX_ITER times.
// If `vel` is provided, the stored velocity is clipped against each wall normal hit —
// this prevents pressure buildup against walls that would release as a lurch.
// Returns the Y of any ledge we should step up onto (0 = no step needed).
function _moveHorizontal(pos, deltaX, deltaZ, radius, height, stepHeight, vel) {
  let rx = deltaX, rz = deltaZ;
  let stepUpY = 0;

  for (let iter = 0; iter < PHYS.MAX_ITER; iter++) {
    const len = Math.sqrt(rx * rx + rz * rz);
    if (len < 1e-7) break;

    let tMin = 1.0, hitNX = 0, hitNZ = 0, isStep = false;

    for (const entry of collidableCache) {
      const bb = entry.bb;
      const bbTop = bb.max.y;
      const bbBot = bb.min.y;
      const playerTop = pos.y + height;

      // Step-up: box top is above feet AND within step height
      const heightAboveFeet = bbTop - pos.y;
      const couldStep = heightAboveFeet > 0 && heightAboveFeet <= stepHeight;
      // Full body block: box Y range overlaps player Y range (and is not a step)
      const yOverlap = !couldStep && bbTop > pos.y + 0.01 && bbBot < playerTop - 0.01;

      if (!yOverlap && !couldStep) continue;

      // Expand BB by capsule radius (Minkowski sum in XZ plane)
      const hit = _sweep2D(
        pos.x, pos.z, rx, rz,
        bb.min.x - radius, bb.max.x + radius,
        bb.min.z - radius, bb.max.z + radius
      );
      if (!hit || hit.t >= tMin) continue;

      tMin   = hit.t;
      isStep = couldStep;
      hitNX  = isStep ? 0 : hit.nx;
      hitNZ  = isStep ? 0 : hit.nz;
      if (isStep) stepUpY = Math.max(stepUpY, bbTop);
    }

    // OBB sweep — local center in shed space; Three.js inverse used (same as depenetrate)
    for (const obb of obbCollidables) {
      const bbTop = obb.maxY, bbBot = obb.minY;
      const heightAboveFeet = bbTop - pos.y;
      const couldStepO = heightAboveFeet > 0 && heightAboveFeet <= stepHeight;
      const yOverlapO = !couldStepO && bbTop > pos.y + 0.01 && bbBot < pos.y + height - 0.01;
      if (!yOverlapO && !couldStepO) continue;
      const dx = pos.x - obb.shedX;
      const dz = pos.z - obb.shedZ;
      const lx  = (dx * obb.cosR - dz * obb.sinR) - obb.lcx;
      const lz  = (dx * obb.sinR + dz * obb.cosR) - obb.lcz;
      const ldx = rx * obb.cosR - rz * obb.sinR;
      const ldz = rx * obb.sinR + rz * obb.cosR;
      const hit = _sweep2D(lx, lz, ldx, ldz, -obb.hx, obb.hx, -obb.hz, obb.hz);
      if (!hit || hit.t >= tMin) continue;
      tMin = hit.t;
      isStep = couldStepO;
      if (isStep) {
        hitNX = 0; hitNZ = 0;
        stepUpY = Math.max(stepUpY, bbTop);
      } else {
        // R * local_normal: world_x = cosR*nx + sinR*nz
        hitNX = hit.nx * obb.cosR + hit.nz * obb.sinR;
        hitNZ = -hit.nx * obb.sinR + hit.nz * obb.cosR;
      }
    }

    // Advance to contact point, pulled back by SKIN_WIDTH to avoid flush contact
    const moveFrac = Math.max(0, tMin - PHYS.SKIN_WIDTH / Math.max(len, 0.001));
    pos.x += rx * moveFrac;
    pos.z += rz * moveFrac;

    if (tMin >= 1.0) break;   // No collision — fully resolved
    if (isStep)     break;   // Step-up — Y is handled below in main tick

    // Slide: scale remaining delta by (1-t), then strip wall-normal component
    const remainFrac = 1.0 - tMin;
    rx *= remainFrac;
    rz *= remainFrac;
    const dot = rx * hitNX + rz * hitNZ;
    rx -= dot * hitNX;
    rz -= dot * hitNZ;

    // Clip stored velocity against the wall too — kills pressure buildup
    if (vel) {
      const vdot = vel.x * hitNX + vel.z * hitNZ;
      if (vdot < 0) {
        vel.x -= vdot * hitNX;
        vel.z -= vdot * hitNZ;
      }
    }
  }

  return stepUpY;
}

// ── One fixed-timestep physics tick ──
function _physStep(fixedDt, inputDir, speed) {
  const radius = CONFIG.playerRadius;
  const height = state.crouching ? CONFIG.crouchHeight : CONFIG.playerHeight;

  // Gravity
  if (!phys.grounded || phys.vel.y > 0) {
    phys.vel.y -= CONFIG.gravity * fixedDt;
  }

  // ── Slide state machine ──
  if (state.slideCooldown > 0) state.slideCooldown -= fixedDt;
  const hSpeedNow = Math.sqrt(phys.vel.x * phys.vel.x + phys.vel.z * phys.vel.z);
  if (!state.sliding) {
    const crouchJustPressed = state.crouching && !_prevCrouch;
    if (crouchJustPressed && phys.grounded && state.slideCooldown <= 0 &&
        hSpeedNow >= CONFIG.moveSpeed * PHYS.SLIDE_MIN_TRIGGER) {
      state.sliding = true;
      phys.vel.x *= PHYS.SLIDE_BOOST;
      phys.vel.z *= PHYS.SLIDE_BOOST;
    }
  } else {
    const slideEnd = !state.crouching ||
                     (phys.grounded && hSpeedNow < CONFIG.moveSpeed * CONFIG.crouchSpeedMult);
    if (slideEnd) {
      state.sliding = false;
      state.slideCooldown = PHYS.SLIDE_COOLDOWN;
    }
  }
  _prevCrouch = state.crouching;

  // ── Horizontal velocity: friction then acceleration (Quake-family) ──
  if (phys.grounded) {
    const fric = PHYS.GROUND_FRICTION * (state.sliding ? PHYS.SLIDE_FRICTION : 1);
    const hSpeed = Math.sqrt(phys.vel.x * phys.vel.x + phys.vel.z * phys.vel.z);
    if (hSpeed > 1e-4) {
      const drop  = hSpeed * fric * fixedDt;
      const scale = Math.max(0, hSpeed - drop) / hSpeed;
      phys.vel.x *= scale;
      phys.vel.z *= scale;
    } else {
      phys.vel.x = 0;
      phys.vel.z = 0;
    }
  }

  const wishLen = Math.sqrt(inputDir.x * inputDir.x + inputDir.z * inputDir.z);
  if (wishLen > 1e-6) {
    const wdx = inputDir.x / wishLen;
    const wdz = inputDir.z / wishLen;
    const wishSpeed = speed * Math.min(1, wishLen);
    // No steering during a grounded slide — the slide is a commitment
    const accel = phys.grounded
      ? (state.sliding ? 0 : PHYS.GROUND_ACCEL)
      : PHYS.AIR_ACCEL;
    if (accel > 0) {
      const cur = phys.vel.x * wdx + phys.vel.z * wdz;
      const add = wishSpeed - cur;
      if (add > 0) {
        const a = Math.min(accel * wishSpeed * fixedDt, add);
        phys.vel.x += wdx * a;
        phys.vel.z += wdz * a;
      }
    }
  }

  // Horizontal movement — displacement now comes from velocity, not input
  const stepUpY = _moveHorizontal(
    phys.pos,
    phys.vel.x * fixedDt,
    phys.vel.z * fixedDt,
    radius, height, PHYS.STEP_HEIGHT, phys.vel
  );

  // Vertical movement
  phys.pos.y += phys.vel.y * fixedDt;

  // Ceiling — eject player down if head overlaps any collider from below.
  // Runs unconditionally (not just vel.y>0) so slope-walking into a canopy is caught too.
  {
    const headY = phys.pos.y + height;
    for (const entry of collidableCache) {
      const bb = entry.bb;
      if (headY > bb.min.y && phys.pos.y < bb.min.y &&
          phys.pos.x > bb.min.x - radius && phys.pos.x < bb.max.x + radius &&
          phys.pos.z > bb.min.z - radius && phys.pos.z < bb.max.z + radius) {
        phys.pos.y = bb.min.y - height;
        if (phys.vel.y > 0) phys.vel.y = 0;
        break;
      }
    }
  }

  // Floor: terrain + any object top we might be standing on
  let floorY = getTerrainHeight(phys.pos.x, phys.pos.z);
  for (const entry of collidableCache) {
    const bb = entry.bb;
    if (phys.pos.x > bb.min.x - radius && phys.pos.x < bb.max.x + radius &&
        phys.pos.z > bb.min.z - radius && phys.pos.z < bb.max.z + radius) {
      const feetH = phys.pos.y;
      if (feetH >= bb.max.y - 0.6 && feetH <= bb.max.y + 1.2) {
        floorY = Math.max(floorY, bb.max.y);
      }
    }
  }

  // OBB floor check — shed podium steps (rotation-aware)
  // No lower-Y guard: use Math.max so terrain always wins if higher than podium
  for (const fl of obbFloors) {
    const fdx = phys.pos.x - fl.shedX;
    const fdz = phys.pos.z - fl.shedZ;
    const flx = fdx * fl.cosR - fdz * fl.sinR;
    const flz = fdx * fl.sinR + fdz * fl.cosR;
    if (Math.abs(flx) <= fl.hw && Math.abs(flz) <= fl.hd) {
      floorY = Math.max(floorY, fl.topY);
    }
  }

  // Promote step-up ledge to floor so we land on it
  if (stepUpY > 0) floorY = Math.max(floorY, stepUpY);

  // Land on floor
  if (phys.pos.y <= floorY) {
    phys.pos.y    = floorY;
    phys.vel.y    = 0;
    phys.grounded = true;
  } else if (phys.pos.y > floorY + 0.15) {
    phys.grounded = false;
  }

  // Water float — keep eyes 0.5 above surface (chest-deep look)
  state.isSwimming = false;
  if (state.waterRising) {
    const waterAboveKnee = state.waterLevel > floorY + 0.8;
    const floatFeetY     = state.waterLevel + 0.5 - height;
    if (waterAboveKnee && phys.pos.y < floatFeetY) {
      phys.pos.y       = floatFeetY;
      phys.vel.y       = 0;
      phys.grounded    = true;
      state.isSwimming = true;
    }
  }

  // World bounds — track the active map (island 253 / city 120) via `half`.
  const bound = half - 1;
  phys.pos.x = Math.max(-bound, Math.min(bound, phys.pos.x));
  phys.pos.z = Math.max(-bound, Math.min(bound, phys.pos.z));

  // Safety depenetration (catches any residual overlap)
  _depenetrate(phys.pos, radius, height);
}

// ── Main entry — called from game loop each frame ──
// inputDir : normalized THREE.Vector3 (XZ desired direction, y is ignored)
// speed    : movement speed already adjusted for ADS / sprint / crouch / swim
function physicsUpdate(dt, inputDir, speed) {
  // Pick up any jump triggered by input.js via state.velocityY
  if (state.velocityY > phys.vel.y) {
    phys.vel.y    = state.velocityY;
    phys.grounded = false;
  }

  // Step at fixed 60Hz — spiral-of-death guard (max 5 steps per frame)
  _physAccum += dt;
  let steps = 0;
  while (_physAccum >= PHYS.FIXED_STEP && steps < 5) {
    _physStep(PHYS.FIXED_STEP, inputDir, speed);
    _physAccum -= PHYS.FIXED_STEP;
    steps++;
  }

  // Smooth camera height for crouch transition — extra-fast drop while sliding
  const targetHeight = state.crouching ? CONFIG.crouchHeight : CONFIG.playerHeight;
  const lerpRate = state.sliding ? 18 : (state.crouching ? 14 : 7);
  state.smoothCameraHeight += (targetHeight - state.smoothCameraHeight) * Math.min(1, dt * lerpRate);

  // Step smoothing — the physics feet position snaps up/down a full step in a single
  // tick, which pops the camera on stairs. Lag a rendered feet-Y behind the true feet-Y
  // so the camera glides. Airborne motion and anything bigger than a step (jumps, falls,
  // teleports) are tracked exactly, so there's no input lag on real vertical movement.
  if (state.camFeetY === undefined) state.camFeetY = phys.pos.y;
  const feetDelta = phys.pos.y - state.camFeetY;
  if (!phys.grounded || Math.abs(feetDelta) > PHYS.STEP_HEIGHT + 0.3) {
    state.camFeetY = phys.pos.y;                                       // snap — real vertical motion
  } else {
    state.camFeetY += feetDelta * Math.min(1, dt * PHYS.STEP_SMOOTH);  // glide — step smoothing
  }

  // Sync camera to capsule (eye = smoothed feet + smooth crouch height)
  camera.position.set(phys.pos.x, state.camFeetY + state.smoothCameraHeight, phys.pos.z);

  // Sync shared state so input.js / gameplay / HUD stay consistent
  state.isGrounded = phys.grounded;
  state.velocityY  = phys.vel.y;
}
// AUDIO SYSTEM — Procedural sounds via Web Audio API
// ═══════════════════════════════════════════════════════════
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// Master compressor/limiter — prevents clipping when many sounds fire at once
let masterCompressor = null;
function getMaster() {
  const ctx = ensureAudio();
  if (!masterCompressor) {
    masterCompressor = ctx.createDynamicsCompressor();
    masterCompressor.threshold.value = -6;
    masterCompressor.knee.value = 3;
    masterCompressor.ratio.value = 4;
    masterCompressor.attack.value = 0.001;
    masterCompressor.release.value = 0.1;
    // Master gain boost after compression
    const masterGain = ctx.createGain();
    masterGain.gain.value = 3.71;
    masterCompressor.connect(masterGain).connect(ctx.destination);
  }
  return masterCompressor;
}

// Shared short delay+feedback send, used only by bird() to give chirps a
// sense of open-air distance instead of landing dry/synthetic on the ear.
let _birdAir = null;
function getBirdAir() {
  const ctx = ensureAudio();
  if (!_birdAir) {
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.085;
    const feedback = ctx.createGain(); feedback.gain.value = 0.22;
    const wetGain = ctx.createGain(); wetGain.gain.value = 0.55;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    delay.connect(feedback).connect(delay); // feedback loop
    delay.connect(lp).connect(wetGain).connect(getMaster());
    _birdAir = delay;
  }
  return _birdAir;
}

function playNoise(duration, volume, filterFreq, filterType) {
  const ctx = ensureAudio();
  const bufferSize = ctx.sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    // Ultra-sharp attack in first 0.4% for a hard crack transient, then fast decay
    const attackFrac = bufferSize * 0.004;
    const env = i < attackFrac
      ? (i / attackFrac)
      : Math.pow(1 - (i - attackFrac) / (bufferSize - attackFrac), 2.2);
    // Bake volume directly into sample data so it's truly louder, not just gain-scaled
    data[i] = (Math.random() * 2 - 1) * env * Math.min(volume, 1.0);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(Math.min(volume, 1.0), ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  const filter = ctx.createBiquadFilter();
  filter.type = filterType || 'lowpass';
  filter.frequency.value = filterFreq || 2000;
  filter.Q.value = 1.5;
  src.connect(filter).connect(gain).connect(getMaster());
  src.start(); src.stop(ctx.currentTime + duration);
}

function playTone(freq, duration, volume, type) {
  const ctx = ensureAudio();
  const osc = ctx.createOscillator();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  // Pitch drops for explosive boom character
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.3), ctx.currentTime + duration * 0.7);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(Math.min(volume, 1.0), ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  // For bass tones, add a lowshelf boost
  if (freq < 100) {
    const bassBoost = ctx.createBiquadFilter();
    bassBoost.type = 'lowshelf';
    bassBoost.frequency.value = 120;
    bassBoost.gain.value = 10; // +10dB bass shelf
    osc.connect(bassBoost).connect(gain).connect(getMaster());
  } else {
    osc.connect(gain).connect(getMaster());
  }
  osc.start(); osc.stop(ctx.currentTime + duration);
}

// Sharp impulse — true dirac-like spike for gun crack character
function playImpulse(volume) {
  const ctx = ensureAudio();
  // Very short buffer — just a few ms of exponential decay from a spike
  const dur = 0.018;
  const bufSize = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) {
    // True impulse: max at sample 0, exponential decay, alternating sign for crack
    const decay = Math.exp(-i / (bufSize * 0.08));
    d[i] = (i % 2 === 0 ? 1 : -1) * decay * volume;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  // High-pass to keep it snappy, not bassy
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 3000;
  src.connect(hp).connect(getMaster());
  src.start(); src.stop(ctx.currentTime + dur);
}

const SFX = {
  gunshot_m4() {
    const ctx = ensureAudio();
    const t0 = ctx.currentTime;
    // ── Layer 1: Muzzle blast transient — convolution-style burst ──
    const blastBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.003), ctx.sampleRate);
    const bd = blastBuf.getChannelData(0);
    for (let i = 0; i < bd.length; i++) bd[i] = (1 - i/bd.length) * (Math.random()*2-1);
    const blast = ctx.createBufferSource(); blast.buffer = blastBuf;
    const blastGain = ctx.createGain(); blastGain.gain.value = 1.8;
    const blastHp = ctx.createBiquadFilter(); blastHp.type = 'highpass'; blastHp.frequency.value = 2000;
    blast.connect(blastHp).connect(blastGain).connect(getMaster());
    blast.start(t0);
    // ── Layer 2: Crack body — shaped noise 5ms-60ms ──
    const crackBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.06), ctx.sampleRate);
    const cd = crackBuf.getChannelData(0);
    for (let i = 0; i < cd.length; i++) {
      const env = Math.exp(-i / (cd.length * 0.15));
      cd[i] = (Math.random()*2-1) * env;
    }
    const crack = ctx.createBufferSource(); crack.buffer = crackBuf;
    const crackBp = ctx.createBiquadFilter(); crackBp.type = 'bandpass'; crackBp.frequency.value = 2800; crackBp.Q.value = 0.6;
    const crackGain = ctx.createGain(); crackGain.gain.value = 1.1;
    crack.connect(crackBp).connect(crackGain).connect(getMaster());
    crack.start(t0 + 0.003);
    // ── Layer 3: Pressure wave — pitch-dropping tone ──
    const wave = ctx.createOscillator(); wave.type = 'sine';
    wave.frequency.setValueAtTime(180, t0);
    wave.frequency.exponentialRampToValueAtTime(18, t0 + 0.45);
    const waveGain = ctx.createGain();
    waveGain.gain.setValueAtTime(0.85, t0);
    waveGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55);
    wave.connect(waveGain).connect(getMaster());
    wave.start(t0); wave.stop(t0 + 0.55);
    // ── Layer 4: Sub thump ──
    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(80, t0 + 0.01);
    sub.frequency.exponentialRampToValueAtTime(22, t0 + 0.4);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0, t0);
    subGain.gain.linearRampToValueAtTime(0.7, t0 + 0.02);
    subGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
    sub.connect(subGain).connect(getMaster());
    sub.start(t0 + 0.01); sub.stop(t0 + 0.5);
    // ── Layer 5: Room tail — reverberant low rumble ──
    setTimeout(() => playNoise(0.5, 0.12, 280, 'lowpass'), 60);
    // ── Layer 6: Mechanical bolt click ──
    setTimeout(() => {
      playNoise(0.018, 0.22, 4200, 'highpass');
      playTone(1800, 0.015, 0.1, 'square');
    }, 95);
  },
  gunshot_pistol() {
    const ctx = ensureAudio();
    const t0 = ctx.currentTime;
    // ── Silenced pistol — subsonic thwip, minimal report ──
    // Layer 1: Mechanical click of the action
    const clickBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.008), ctx.sampleRate);
    const ckd = clickBuf.getChannelData(0);
    for (let i = 0; i < ckd.length; i++) ckd[i] = (1 - i/ckd.length) * (Math.random()*2-1) * 0.5;
    const click = ctx.createBufferSource(); click.buffer = clickBuf;
    const clickHp = ctx.createBiquadFilter(); clickHp.type = 'highpass'; clickHp.frequency.value = 1800;
    const clickGain = ctx.createGain(); clickGain.gain.value = 0.18;
    click.connect(clickHp).connect(clickGain).connect(getMaster());
    click.start(t0);
    // Layer 2: Suppressed thwip
    const thwipBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate);
    const td = thwipBuf.getChannelData(0);
    for (let i = 0; i < td.length; i++) {
      const env = Math.exp(-i / (td.length * 0.12));
      td[i] = (Math.random()*2-1) * env;
    }
    const thwip = ctx.createBufferSource(); thwip.buffer = thwipBuf;
    const thwipBp = ctx.createBiquadFilter(); thwipBp.type = 'bandpass'; thwipBp.frequency.value = 900; thwipBp.Q.value = 1.5;
    const thwipGain = ctx.createGain(); thwipGain.gain.value = 0.22;
    thwip.connect(thwipBp).connect(thwipGain).connect(getMaster());
    thwip.start(t0 + 0.004);
    // Layer 3: Tiny bass puff — gas venting through baffles
    const puff = ctx.createOscillator(); puff.type = 'sine';
    puff.frequency.setValueAtTime(280, t0);
    puff.frequency.exponentialRampToValueAtTime(80, t0 + 0.06);
    const puffGain = ctx.createGain();
    puffGain.gain.setValueAtTime(0.12, t0);
    puffGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
    puff.connect(puffGain).connect(getMaster());
    puff.start(t0); puff.stop(t0 + 0.08);
    // Layer 4: Slide cycle
    setTimeout(() => playNoise(0.015, 0.08, 3200, 'highpass'), 55);
  },
  // Reverted to the original timeline — the rescaled-to-reloadTime version
  // (spread events across the full 1500/2200ms) tested worse than this.
  reload() {
    // Mag release click
    setTimeout(() => {
      playTone(2200, 0.02, 0.05, 'square');
      playNoise(0.03, 0.04, 4000, 'highpass');
    }, 0);
    // Mag sliding out
    setTimeout(() => {
      playNoise(0.15, 0.03, 800, 'bandpass');
      playTone(300, 0.08, 0.02, 'sawtooth');
    }, 150);
    // New mag insertion — metallic slide
    setTimeout(() => {
      playNoise(0.04, 0.05, 3000, 'highpass');
      playTone(1800, 0.03, 0.04, 'square');
    }, 450);
    // Mag click/lock
    setTimeout(() => {
      playTone(2500, 0.015, 0.06, 'square');
      playNoise(0.02, 0.05, 5000, 'highpass');
    }, 550);
    // Bolt/charging handle
    setTimeout(() => {
      playNoise(0.06, 0.05, 2000, 'bandpass');
      playTone(600, 0.04, 0.03, 'sawtooth');
    }, 700);
  },
  hitmarker() {
    playTone(1800, 0.06, 0.22, 'sine');
    playTone(2200, 0.04, 0.16, 'sine');
  },
  headshot() {
    // Sharp metallic ping — instant attack, fast ring-out
    const ctx = ensureAudio();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.value = 2800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.36, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
    osc.connect(g).connect(getMaster());
    osc.start(t0); osc.stop(t0 + 0.18);
  },
  kill() {
    playTone(820, 0.12, 0.14, 'sine'); // Single lower ding
  },
  pickup() {
    playTone(600, 0.08, 0.1, 'sine');
    setTimeout(() => playTone(900, 0.1, 0.1, 'sine'), 60);
  },
  empty_click() {
    playTone(400, 0.03, 0.08, 'square');
  },
  // Short synthesized vocal grunt on taking damage — a saw-tooth pitch-drop
  // through a vocal-range bandpass (formant-ish), same procedural-only
  // approach as the rest of this file (no audio assets).
  hit_grunt() {
    const ctx = ensureAudio();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150 + Math.random() * 25, t0);
    osc.frequency.exponentialRampToValueAtTime(65, t0 + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0, t0);
    g.gain.linearRampToValueAtTime(0.24, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.20);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 1.1;
    osc.connect(bp).connect(g).connect(getMaster());
    osc.start(t0); osc.stop(t0 + 0.20);
    playNoise(0.09, 0.09, 850, 'bandpass');
  },
  footstep() {
    // Was near-inaudible — pure noise bursts with no low-end weight got lost
    // under gunfire/ambience. Added a real body-boom oscillator layer (like
    // kill_chaching's thump) plus ~1.5x on the noise volumes.
    const ctx = ensureAudio();
    const t0 = ctx.currentTime;
    const thump = ctx.createOscillator(); thump.type = 'sine';
    thump.frequency.setValueAtTime(100 + Math.random() * 20, t0);
    thump.frequency.exponentialRampToValueAtTime(46, t0 + 0.05);
    const thumpG = ctx.createGain();
    thumpG.gain.setValueAtTime(0.255, t0); // -15%
    thumpG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
    thump.connect(thumpG).connect(getMaster());
    thump.start(t0); thump.stop(t0 + 0.09);
    const crush = 120 + Math.random() * 80;
    playNoise(0.07, 0.27, crush, 'lowpass');   // -15%
    playNoise(0.035, 0.145, 180, 'lowpass');   // -15%
    setTimeout(() => playNoise(0.045, 0.094, 400, 'bandpass'), 20); // -15%
  },
  water_damage() {
    playNoise(0.15, 0.04, 800, 'lowpass');
    playTone(200, 0.1, 0.03, 'sine');
  },
  weapon_switch() {
    playTone(500, 0.04, 0.06, 'square');
    setTimeout(() => playTone(700, 0.03, 0.06, 'square'), 50);
  },
  kill_chaching() {
    // Deep satisfying elimination thump — low impact + rising confirm tone
    const ctx = ensureAudio();
    const t0 = ctx.currentTime;
    // Heavy low thump
    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(90, t0);
    sub.frequency.exponentialRampToValueAtTime(32, t0 + 0.18);
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0.0, t0);
    subG.gain.linearRampToValueAtTime(0.55, t0 + 0.012);
    subG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    sub.connect(subG).connect(getMaster());
    sub.start(t0); sub.stop(t0 + 0.25);
    // Mid body punch
    playNoise(0.08, 0.22, 320, 'lowpass');
    // Two-note rising confirm — not shrill, feels earned
    setTimeout(() => playTone(380, 0.12, 0.13, 'sine'), 60);
    setTimeout(() => playTone(570, 0.14, 0.11, 'sine'), 145);
  },
  bird() {
    const ctx = ensureAudio();
    // Weighted toward the two pleasant species (warbler/dove); the trill and
    // long-whistle were the harshest/most piercing of the four and are now
    // rarer as well as individually softened below.
    const roll = Math.random();
    const species = roll < 0.38 ? 0 : roll < 0.68 ? 2 : roll < 0.86 ? 1 : 3;
    // Shared "open air" send — a short delay+feedback bus so bird calls read
    // as distant/outdoor instead of dry synth tones landing right on the ear.
    const air = getBirdAir();
    if (species === 0) {
      // Melodic tropical warbler — smooth FM chirps with natural envelope
      const base = 1800 + Math.random() * 600;
      const notes = 5 + Math.floor(Math.random() * 4);
      for (let i = 0; i < notes; i++) {
        const t = i * 110 + Math.random() * 40;
        setTimeout(() => {
          const ctx2 = ensureAudio();
          const t0 = ctx2.currentTime;
          const osc = ctx2.createOscillator(); osc.type = 'sine';
          const noteF = base + Math.sin(i * 1.8) * 400 + Math.random() * 120;
          osc.frequency.setValueAtTime(noteF, t0);
          osc.frequency.linearRampToValueAtTime(noteF * 1.08, t0 + 0.04);
          osc.frequency.linearRampToValueAtTime(noteF * 0.97, t0 + 0.09);
          const g = ctx2.createGain();
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(0.045, t0 + 0.015);
          g.gain.linearRampToValueAtTime(0.032, t0 + 0.06);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.11);
          osc.connect(g).connect(getMaster());
          g.connect(air);
          osc.start(t0); osc.stop(t0 + 0.12);
        }, t);
      }
    } else if (species === 1) {
      // Rapid staccato finch trill — was the most piercing species (base up to
      // 3100Hz, no filtering); lowered range + added a lowpass to take the edge off.
      const base = 2100 + Math.random() * 400;
      const chirps = 6 + Math.floor(Math.random() * 5);
      for (let i = 0; i < chirps; i++) {
        setTimeout(() => {
          const ctx2 = ensureAudio();
          const t0 = ctx2.currentTime;
          const osc = ctx2.createOscillator(); osc.type = 'sine';
          const f = base + (Math.random() - 0.5) * 250;
          osc.frequency.setValueAtTime(f, t0);
          osc.frequency.linearRampToValueAtTime(f * 1.10, t0 + 0.025);
          const g = ctx2.createGain();
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(0.030, t0 + 0.008);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.055);
          const lp = ctx2.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3400;
          osc.connect(lp).connect(g).connect(getMaster());
          g.connect(air);
          osc.start(t0); osc.stop(t0 + 0.06);
        }, i * 75 + Math.random() * 20);
      }
    } else if (species === 2) {
      // Deep coo — tropical dove with natural vibrato
      const base = 480 + Math.random() * 180;
      const coos = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < coos; i++) {
        setTimeout(() => {
          const ctx2 = ensureAudio();
          const t0 = ctx2.currentTime;
          const osc = ctx2.createOscillator(); osc.type = 'sine';
          osc.frequency.setValueAtTime(base, t0);
          osc.frequency.linearRampToValueAtTime(base * 1.06, t0 + 0.06);
          osc.frequency.linearRampToValueAtTime(base * 0.94, t0 + 0.22);
          osc.frequency.linearRampToValueAtTime(base * 0.88, t0 + 0.30);
          const g = ctx2.createGain();
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(0.042, t0 + 0.04);
          g.gain.setValueAtTime(0.038, t0 + 0.18);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
          osc.connect(g).connect(getMaster());
          g.connect(air);
          osc.start(t0); osc.stop(t0 + 0.33);
        }, i * 400 + Math.random() * 60);
      }
    } else {
      // Long descending whistle — was the other piercing species (started at
      // 2600Hz, unfiltered); lowered the start pitch and added a lowpass so
      // it reads as a mellow oriole call instead of a screech.
      const ctx2 = ensureAudio();
      const t0 = ctx2.currentTime;
      const osc = ctx2.createOscillator(); osc.type = 'sine';
      const startF = 1850 + Math.random() * 350;
      osc.frequency.setValueAtTime(startF, t0);
      osc.frequency.linearRampToValueAtTime(startF * 0.72, t0 + 0.35);
      osc.frequency.linearRampToValueAtTime(startF * 0.58, t0 + 0.6);
      const g = ctx2.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.040, t0 + 0.03);
      g.gain.setValueAtTime(0.033, t0 + 0.3);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.65);
      const lp = ctx2.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
      osc.connect(lp).connect(g).connect(getMaster());
      g.connect(air);
      osc.start(t0); osc.stop(t0 + 0.66);
    }
  },
  insect() {
    // Cicada-like: amplitude modulated bandpass noise — 20% louder
    const ctx = ensureAudio();
    const dur = 1.5 + Math.random() * 2.5;
    const bufSize = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const d = buf.getChannelData(0);
    const modFreq = 40 + Math.random() * 60;
    for (let i = 0; i < bufSize; i++) {
      const am = 0.5 + 0.5 * Math.sin((i / ctx.sampleRate) * modFreq * Math.PI * 2);
      d[i] = (Math.random() * 2 - 1) * am * 0.018; // was 0.015, +20%
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 5000 + Math.random() * 3000;
    filter.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1.2, ctx.currentTime + 0.3); // was 1.0, +20%
    gain.gain.linearRampToValueAtTime(1.2, ctx.currentTime + dur - 0.3);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
    src.connect(filter).connect(gain).connect(getMaster());
    src.start(); src.stop(ctx.currentTime + dur);
  },
  wind() {
    // Multi-layer wind — low rumble through trees + high whistle + random gusts
    const gustVol = 0.03 + Math.random() * 0.025;
    playNoise(4 + Math.random() * 4, gustVol, 150 + Math.random() * 100, 'lowpass');
    playNoise(3 + Math.random() * 3, gustVol * 0.6, 600 + Math.random() * 300, 'bandpass');
    // Occasional high whistle through leaves
    if (Math.random() < 0.4) {
      setTimeout(() => playNoise(1.5, 0.012, 2800 + Math.random() * 800, 'bandpass'), Math.random() * 1000);
    }
  },
  gate_creak() {
    const ctx = ensureAudio();
    const t0 = ctx.currentTime;
    // ── Single prominent intercom buzz ──
    const buzz = ctx.createOscillator(); buzz.type = 'square';
    buzz.frequency.value = 120;
    const buzzGain = ctx.createGain();
    buzzGain.gain.setValueAtTime(0.0, t0);
    buzzGain.gain.linearRampToValueAtTime(0.176, t0 + 0.05);  // ramp up
    buzzGain.gain.setValueAtTime(0.176, t0 + 0.65);           // hold
    buzzGain.gain.linearRampToValueAtTime(0.0, t0 + 0.85);   // fade out
    const buzzLp = ctx.createBiquadFilter(); buzzLp.type = 'lowpass'; buzzLp.frequency.value = 800;
    buzz.connect(buzzLp).connect(buzzGain).connect(getMaster());
    buzz.start(t0); buzz.stop(t0 + 0.85);
    // ── Gate swings open after buzz ends ──
    setTimeout(() => {
      const dur = 1.6;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        const t = i / d.length;
        const mod = 0.5 + 0.5 * Math.sin(t * 28) * Math.sin(t * 11);
        const env = t < 0.05 ? t/0.05 : t > 0.8 ? (1-t)/0.2 : 1;
        d[i] = (Math.random()*2-1) * mod * env * 0.096;
      }
      const src = ctx.createBufferSource(); src.buffer = buf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 1.2;
      const g = ctx.createGain(); g.gain.value = 0.80;
      src.connect(bp).connect(g).connect(getMaster());
      src.start();
      playTone(68, 1.12, 0.18, 'sawtooth');
      playTone(102, 0.96, 0.10, 'sawtooth');
    }, 900);
    // ── Final slam ──
    setTimeout(() => {
      playTone(62, 0.20, 0.5, 'sine');
      playNoise(0.144, 0.3, 500, 'lowpass');
      playNoise(0.064, 0.15, 2500, 'highpass');
    }, 2450);
  }
};

// Ambient sound timer
let ambientTimer = 3 + Math.random() * 5;

// Footstep timer
let footstepTimer = 0;

// ═══════════════════════════════════════════════════════════
// INPUT
// ═══════════════════════════════════════════════════════════
const overlay = document.getElementById('overlay');
const crosshair = document.getElementById('crosshair');
const hitmarker = document.getElementById('hitmarker');
const muzzleFlash = document.getElementById('muzzle-flash');
const waterWarning = document.getElementById('water-warning');
const streamBoostEl = document.getElementById('sb');
const sprintCdEl = document.getElementById('sprint-cd');
const adsVignette = document.getElementById('ads-vignette');
const waterVignette = document.getElementById('water-vignette');
const reloadMsg = document.getElementById('reload-msg');
const pickupPrompt = document.getElementById('pickup-prompt');

// ── Canonical look state — yaw and pitch are the source of truth.
//    physicsStep reads these and sets camera.quaternion each tick.
//    Never mutate camera.quaternion directly from mouse input.
// Arena duel: face the bootstrap spawn toward the arena center. yaw 0 looks down
// −z, so a spawn whose `facing` is +z needs yaw π. Island/BR keep 0.
state.yaw   = (CONFIG.world === 'arena' && CONFIG.arena)
  ? ((CONFIG.arena.spawns[0].facing > 0) ? Math.PI : 0)
  : 0;
state.shakeOffset = new THREE.Vector3();
state.physicsTime = 0;
state.pitch = 0;

// ── Drone camera for menu background ──
const droneCamera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 1, 1200);
const droneClock = { angle: 0, height: 95, radius: 156 };
const overlayCanvas = document.getElementById('overlay-canvas');
overlayCanvas.width = window.innerWidth;
overlayCanvas.height = window.innerHeight;
overlayCanvas.style.position = 'absolute';
overlayCanvas.style.inset = '0';
// Use a second renderer for drone view
const droneRenderer = new THREE.WebGLRenderer({ canvas: overlayCanvas, antialias: false });
droneRenderer.setSize(window.innerWidth, window.innerHeight);
droneRenderer.setPixelRatio(1);
droneRenderer.setClearColor(0x1a4d8a, 1);
droneRenderer.shadowMap.enabled = false;
function updateDroneCamera(dt) {
  droneClock.angle += dt * 0.04; // Very slow orbit
  const cx = Math.cos(droneClock.angle) * droneClock.radius;
  const cz = Math.sin(droneClock.angle) * droneClock.radius;
  // Gentle altitude drift
  droneClock.height = 90 + Math.sin(droneClock.angle * 0.7) * 8;
  droneCamera.position.set(cx, droneClock.height, cz);
  // Aim near the arena rim (y≈50), not the floor — a gentler downward pitch keeps the
  // city skyline on the horizon in frame instead of tilting it off the top edge.
  droneCamera.lookAt(
    Math.sin(droneClock.angle * 1.3) * 20,
    50,
    Math.cos(droneClock.angle * 0.9) * 20
  );
}

// Music toggle — separate from game start
window.toggleMenuMusic = function toggleMenuMusic() {
  const music = document.getElementById('menu-music');
  const btn = document.getElementById('music-toggle-btn');
  if (!music || !btn) return;
  if (music.paused) {
    music.volume = 0.75;
    music.play().catch(() => {});
    btn.textContent = '■  Stop Theme Song';
    btn.classList.add('playing');
  } else {
    music.pause();
    // Removed: music.currentTime = 0  — so resume picks up where it left off
    btn.textContent = '♪  Play Theme Song';
    btn.classList.remove('playing');
  }
}

overlay.addEventListener('click', (e) => {
  if (state.playerDead) return;
  if (e.target.id === 'music-toggle-btn' || e.target.closest('#music-toggle-btn')) return;
  if (state.pendingLock) {
    state.pendingLock = false;
    const pl = document.getElementById('click-to-play');
    if (pl) pl.style.setProperty('display', 'none', 'important');
    renderer.domElement.requestPointerLock();
    return;
  }
  // Only re-acquire pointer lock if a game mode is active (not on main menu)
  if (!state.gameMode) return;
  renderer.domElement.requestPointerLock();
});
renderer.domElement.addEventListener('click', () => {
  if (state.playerDead) return; // keep mouse free for menu buttons
  // Always lock on click if match just started (pendingLock set by startMatch handler)
  if (state.pendingLock) {
    state.pendingLock = false;
    const pl = document.getElementById('click-to-play');
    if (pl) pl.style.setProperty('display', 'none', 'important');
    renderer.domElement.requestPointerLock();
    return;
  }
  if (!document.pointerLockElement && (state.phase !== 'lobby' || state.inLobby)) {
    renderer.domElement.requestPointerLock();
  }
});
document.addEventListener('pointerlockchange', () => {
  state.locked = !!document.pointerLockElement;
  if (!state.locked) state.firing = false; // never leave the trigger stuck after unlock
  // In lobby or pvp mode — never show main menu overlay on ESC
  if (state.inLobby || state.gameMode === 'pvp') {
    overlay.classList.add('hidden');
    return;
  }
  if (state.phase === 'lobby' && !state.locked) {
    overlay.classList.remove('hidden');
  } else if (state.locked) {
    overlay.classList.add('hidden');
  }
});

// ── Mouse look — accumulate into state.yaw / state.pitch only.
//    Camera quaternion is reconstructed from these each physics tick.
//    This makes look state serializable and fully deterministic.
document.addEventListener('mousemove', (e) => {
  if (!state.locked) return;
  const sens = state.ads ? CONFIG.adsSens : CONFIG.mouseSens;
  state.yaw   -= e.movementX * sens;
  state.pitch -= e.movementY * sens;
  state.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, state.pitch));
});

document.addEventListener('keydown', (e) => {
  // During warmup lobby: Escape unlocks mouse so player can click Ready Up
  if (state.inLobby && e.code === 'Escape') {
    document.exitPointerLock();
    return;
  }
  // During warmup lobby: Enter = Ready Up
  if (state.inLobby && e.code === 'Enter') {
    if (window.toggleReady) window.toggleReady();
    return;
  }
  if (!state.locked) return;
  switch (e.code) {
    case 'KeyW': state.moveForward = true; break;
    case 'KeyS': state.moveBack = true; break;
    case 'KeyA': state.moveLeft = true; break;
    case 'KeyD': state.moveRight = true; break;
    case 'Space':
      if (state.isGrounded && !state.isSwimming) { state.velocityY = CONFIG.jumpForce; state.isGrounded = false; }
      break;
    case 'Digit1':
      if (state.currentWeapon !== 'm4' && !state.reloading && !state.switching) { switchWeapon('m4'); }
      break;
    case 'Digit2':
      if (state.currentWeapon !== 'pistol' && !state.reloading && !state.switching) { switchWeapon('pistol'); }
      break;
    case 'KeyR': reload(); break;
    case 'KeyF': if (!e.repeat) pickupLoot(); break;
    case 'Tab': break; // Don't capture tab
    case 'ShiftLeft': case 'ShiftRight': state.crouching = true; break;
  }
});

document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': state.moveForward = false; break;
    case 'KeyS': state.moveBack = false; break;
    case 'KeyA': state.moveLeft = false; break;
    case 'KeyD': state.moveRight = false; break;
    case 'ShiftLeft': case 'ShiftRight': state.crouching = false; break;
  }
});

document.addEventListener('mousedown', (e) => {
  if (!state.locked) return;
  if (e.button === 0) { state.firing = true; shoot(); } // fire now; auto weapons keep going via the update loop
  if (e.button === 2) { state.ads = true; crosshair.style.display = 'none'; adsVignette.classList.add('active'); }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) state.firing = false;
  if (e.button === 2) { state.ads = false; crosshair.style.display = ''; adsVignette.classList.remove('active'); }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// REMOTE PLAYER HIT DETECTION
// ═══════════════════════════════════════════════════════════

// Collect all live remote player sub-meshes for the raycast
function getRemotePlayerMeshes() {
  const meshes = [];
  for (const rp of Object.values(state.remotePlayers || {})) {
    if (rp.mesh && !rp.dead) {
      rp.mesh.traverse(child => { if (child.isMesh) meshes.push(child); });
    }
  }
  return meshes;
}

// Walk up parent chain to find which remote player owns a hit mesh
function findRemotePlayerByPart(obj) {
  for (const [id, rp] of Object.entries(state.remotePlayers || {})) {
    if (!rp.mesh || rp.dead) continue;
    let cur = obj;
    while (cur) {
      if (cur === rp.mesh) return { id, rp };
      cur = cur.parent;
    }
  }
  return null;
}

// Called by 12_main.js when a hit event arrives in a world snapshot
function applyHitEvent(evt) {
  // We are the target — apply the server-authoritative HP/armor. Fields are
  // hp/armor/dead; the old targetHp/targetArmor names never matched what the
  // server sends, so armor silently desynced — which matters in duel where
  // everyone spawns with armor=100.
  if (evt.target === state.myId) {
    if (evt.hp !== undefined)    state.hp    = evt.hp;
    else state.hp = Math.max(0, state.hp - evt.damage);
    if (evt.armor !== undefined) state.armor = evt.armor;
    SFX.hit_grunt();
    if (state.hp <= 0 && evt.shooter) {
      state.killCamShooterId = evt.shooter;
      state.killCamBotIndex = -1;
    }
    updateHUD();
    return;
  }
  // Remote player is the target
  const rp = (state.remotePlayers || {})[evt.target];
  if (!rp) return;
  if (evt.hp !== undefined) rp.hp = evt.hp;
  else rp.hp = Math.max(0, (rp.hp !== undefined ? rp.hp : 100) - evt.damage);
  if (evt.dead || rp.hp <= 0) {
    rp.dead = true;
    if (rp.mesh) rp.mesh.visible = false;
  }
}

// Fire-and-forget shoot message to server. `at` is the interpolation render time
// (server clock) — the server rewinds the target to that moment for lag compensation.
function sendShoot(targetId, damage, headshot) {
  const sock = (state && state.ws) ? state.ws : (typeof ws !== 'undefined' ? ws : null);
  if (sock && sock.readyState === 1) {
    const at = Math.round(state.renderServerTime || 0);
    sock.send(JSON.stringify({ type: 'shoot', targetId, damage, headshot, at }));
  }
}

// ── Floating damage numbers ── pooled DOM spans; CSS keyframes do the whole
// rise/fade so there's zero per-frame JS. Screen position is captured at hit
// time (Krunker-style — numbers don't track the target afterwards).
const _DMG_POOL = 12;
const _dmgEls = [];
let _dmgHead = 0;
const _dmgProj = new THREE.Vector3();
function showDamageNumber(dmg, isHead, worldPos) {
  const host = document.getElementById('dmg-numbers');
  if (!host) return;
  _dmgProj.copy(worldPos).project(camera);
  if (_dmgProj.z > 1) return; // behind the camera
  let el = _dmgEls[_dmgHead];
  if (!el) { el = document.createElement('div'); host.appendChild(el); _dmgEls[_dmgHead] = el; }
  _dmgHead = (_dmgHead + 1) % _DMG_POOL;
  el.textContent = dmg;
  el.className = 'dmg-num ' + (isHead ? 'head' : 'body');
  el.style.left = ((_dmgProj.x * 0.5 + 0.5) * window.innerWidth + (Math.random() - 0.5) * 28) + 'px';
  el.style.top  = ((-_dmgProj.y * 0.5 + 0.5) * window.innerHeight - 8) + 'px';
  void el.offsetWidth; // restart the CSS animation when a slot recycles
  el.classList.add('pop');
}

// SHOOTING — First shot accurate, spread accumulates with rapid fire
// ═══════════════════════════════════════════════════════════
const raycaster = new THREE.Raycaster();
let hitmarkerTimeout = null, crosshairResetTimeout = null;
let spreadAccum = 0;        // Accumulated spread from rapid fire
let burstShots = 0;         // Consecutive shots in the current burst (resets after 400ms pause)
let lastShotTime = 0;

function shoot() {
  if (!state.canFire || state.reloading || state.playerDead || (state.phase !== 'playing' && !state.inLobby)) return;
  const now = performance.now();
  // Cadence gate — timestamp-based, not setTimeout (which drifts ±5-15ms/shot
  // and made sustained fire rhythm mushy). state.canFire is now purely the
  // reload/switch gate; fire rate lives here.
  if (now < (state.nextFireAt || 0)) return;
  const wep = CONFIG.weapons[state.currentWeapon];
  if (state.ammo[state.currentWeapon] <= 0) {
    state.nextFireAt = now + 250; // throttle empty-click spam under held trigger
    SFX.empty_click();
    reload();
    return;
  }

  // Slot accumulator: while firing continuously, schedule from the previous slot
  // so cadence averages exactly fireRate regardless of frame timing; after a
  // pause, restart from now.
  const sched = state.nextFireAt || 0;
  state.nextFireAt = (now - sched < wep.fireRate) ? sched + wep.fireRate : now + wep.fireRate;

  state.ammo[state.currentWeapon]--;
  state.shotsFired++;
  // Hold the network shooting flag up briefly so remote clients see a firing
  // stance across click gaps (rapid fire keeps refreshing it).
  state.shootingUntil = performance.now() + 450;

  const isM4 = state.currentWeapon === 'm4';

  // Gunshot sound
  if (isM4) { SFX.gunshot_m4(); showMuzzleFlash(); }
  else SFX.gunshot_pistol();

  // Burst model: the first 6 shots of a burst fly true (ADS = laser), then
  // scatter ramps in per shot AND the recoil climb below steepens — sustained
  // fire drifts upward and blooms, so bursts win at range, spray wins up close.
  // A 400ms pause resets the burst.
  const timeSinceLast = now - lastShotTime;
  if (timeSinceLast > 400) burstShots = 0;
  burstShots++;
  lastShotTime = now;
  const overBurst = Math.max(0, burstShots - 6);
  spreadAccum = Math.min(overBurst * 0.0045, 0.022);

  // Spread: base weapon spread + burst bloom (ADS stays tighter) — captured BEFORE recoil
  const baseSpread = state.ads ? wep.adsSpread : wep.spread;
  const totalSpread = baseSpread + spreadAccum * (state.ads ? 0.55 : 1);
  const dir = new THREE.Vector3(
    (Math.random() - 0.5) * totalSpread,
    (Math.random() - 0.5) * totalSpread,
    -1
  ).normalize();
  dir.applyQuaternion(camera.quaternion); // Use pre-recoil direction
  const shotOrigin = camera.position.clone();

  // Recoil (camera kick) — applied AFTER capturing shot direction. The climb
  // multiplier grows over the burst (×1 → ×~2 by shot 12): early shots kick
  // gently, a long spray walks the muzzle up and must be pulled down.
  const recoil = state.ads ? wep.recoilAds : wep.recoilHip;
  const climb = 1 + Math.min(burstShots - 1, 11) * 0.09;
  state.pitch += recoil * climb * (0.7 + Math.random() * 0.3);
  state.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, state.pitch));
  state.yaw += (Math.random() - 0.5) * recoil * (0.3 + (climb - 1) * 0.3);

  weaponGroup.position.z += 0.06;
  weaponGroup.rotation.x -= 0.08;

  // (Old screen-projected DOM #muzzle-flash removed — the 3D muzzleFlashGroup
  // on the barrel, shown via showMuzzleFlash(), is the only local flash now.)

  crosshair.classList.add('fired');
  clearTimeout(crosshairResetTimeout);
  crosshairResetTimeout = setTimeout(() => crosshair.classList.remove('fired'), 150);

  raycaster.set(shotOrigin, dir);
  raycaster.far = wep.range || 500;

  const remoteTargets = getRemotePlayerMeshes();
  const intersects = raycaster.intersectObjects([...targets, ...remoteTargets, ...botInstMeshes], false);

  // Volcano terrain LOS — sample along ray; if ray dips below volcano surface it's blocked
  function shotBlockedByVolcano(origin, direction, maxDist) {
    const steps = 80;
    // Always check full volcano diameter, not just to target — catches bots behind volcano
    const checkDist = Math.max(maxDist, CONFIG.volcanoRadius * 2.2);
    const stepSize = checkDist / steps;
    for (let s = 1; s <= steps; s++) {
      const t = s * stepSize;
      const px = origin.x + direction.x * t;
      const py = origin.y + direction.y * t;
      const pz = origin.z + direction.z * t;
      const volH = getVolcanoHeight(px, pz);
      // Tight tolerance: block if ray travels through any part of volcano body
      if (volH > 0.8 && py < volH - 0.1) return t;
    }
    return null;
  }

  const targetDist = intersects.length > 0 ? intersects[0].distance : (wep.range || 500);
  // Check full range so volcano behind player origin is still caught
  const blockDist = shotBlockedByVolcano(shotOrigin, dir, Math.max(targetDist, CONFIG.volcanoRadius * 2.2));

  // Check window panes — glass blocks bullets
  const paneHits = raycaster.intersectObjects(windowPanes, false);
  const paneDist = paneHits.length > 0 ? paneHits[0].distance : Infinity;

  let shotEnd = null; // where the bullet visually stopped — feeds the tracer

  if (intersects.length > 0) {
    const hit = intersects[0];
    if (paneDist < hit.distance) {
      // Shot stopped by window glass
      shotEnd = paneHits[0].point;
      spawnImpact(paneHits[0].point, paneHits[0].face ? paneHits[0].face.normal : new THREE.Vector3(0, 1, 0));
    } else if (blockDist !== null && blockDist < hit.distance) {
      // Shot stopped by volcano terrain
      shotEnd = new THREE.Vector3(shotOrigin.x + dir.x * blockDist, shotOrigin.y + dir.y * blockDist, shotOrigin.z + dir.z * blockDist);
      spawnImpact(shotEnd, new THREE.Vector3(0, 1, 0));
    } else {
      const isBotHit = hit.object.userData.botIndex !== undefined;
      const isHead = hit.object.userData.isHead === true;
      const dmg = isHead ? wep.headDmg : wep.bodyDmg;

      shotEnd = hit.point;
      spawnImpact(hit.point, hit.face ? hit.face.normal : new THREE.Vector3(0, 1, 0));

      const bot = isBotHit ? findBotByMesh(hit.object) : null;
      if (bot) {
        hitmarker.classList.add('show');
        hitmarker.style.filter = isHead ? 'hue-rotate(200deg) brightness(2)' : 'none';
        clearTimeout(hitmarkerTimeout);
        hitmarkerTimeout = setTimeout(() => hitmarker.classList.remove('show'), 120);

        if (isHead) SFX.headshot();
        else SFX.hitmarker();

        state.shotsHit++;
        showDamageNumber(dmg, isHead, hit.point);
        const wasAlive = bot.alive;
        damageBot(bot, dmg, isHead);
        if (wasAlive && !bot.alive) SFX.kill_chaching();
      } else if (!isBotHit) {
        // Not a bot — check remote players
        const remoteHit = findRemotePlayerByPart(hit.object);
        if (remoteHit && !remoteHit.rp.dead) {
          hitmarker.classList.add('show');
          hitmarker.style.filter = isHead ? 'hue-rotate(200deg) brightness(2)' : 'none';
          clearTimeout(hitmarkerTimeout);
          hitmarkerTimeout = setTimeout(() => hitmarker.classList.remove('show'), 120);
          if (isHead) SFX.headshot(); else SFX.hitmarker();
          state.shotsHit++;
          showDamageNumber(dmg, isHead, hit.point);
          // No friendly fire during warmup lobby — hitmarker shows but no damage sent
          if (!state.inLobby) sendShoot(remoteHit.id, dmg, isHead);
        }
      }
    }
  } else if (paneDist < Infinity) {
    // Shot hit window glass with no target behind it
    shotEnd = paneHits[0].point;
    spawnImpact(paneHits[0].point, paneHits[0].face ? paneHits[0].face.normal : new THREE.Vector3(0, 1, 0));
  }

  // Tracer — from the true barrel tip, transformed through the actual weapon
  // geometry (not a generic camera-relative guess, which is why the pistol's
  // tracer used to launch from the side of the model instead of the muzzle).
  // Pistol tip = the barrel crown mesh in createWeaponModel (08_weapons.js):
  // x=0.15,y=0.004 matches the barrel cylinders; z=-0.567-0.006 is the crown's
  // front face (half its 0.012 height beyond the cylinder's center).
  const muzzle = (isM4
    ? new THREE.Vector3(0.03, -0.01, -0.925)
    : new THREE.Vector3(0.15, 0.004, -0.573)
  ).applyMatrix4(weaponGroup.matrixWorld);
  if (!shotEnd) shotEnd = shotOrigin.clone().addScaledVector(dir, raycaster.far);
  spawnTracer(muzzle, shotEnd);

  updateHUD();
}

function switchWeapon(toWeapon) {
  state.switching = true;
  state.canFire = false;
  state.switchPhase = 'down';
  SFX.weapon_switch();
  const halfReload = CONFIG.weapons[state.currentWeapon].reloadTime / 2;
  // Weapon goes down
  setTimeout(() => {
    state.currentWeapon = toWeapon;
    createWeaponModel(toWeapon);
    crosshair.classList.toggle('weapon-pistol', toWeapon === 'pistol');
    state.switchPhase = 'up';
    updateHUD();
    // Weapon comes back up
    setTimeout(() => {
      state.switching = false;
      state.canFire = true;
      state.switchPhase = null;
    }, halfReload / 2);
  }, halfReload / 2);
}

function reload() {
  if (state.reloading) return;
  const wep = CONFIG.weapons[state.currentWeapon];
  if (state.ammo[state.currentWeapon] >= wep.magSize || state.reserveAmmo[state.currentWeapon] <= 0) return;
  state.reloading = true; state.canFire = false;
  state.reloadPhase = 'down'; // Animation phase
  reloadMsg.classList.add('show');
  SFX.reload();
  setTimeout(() => {
    const needed = wep.magSize - state.ammo[state.currentWeapon];
    const loaded = Math.min(needed, state.reserveAmmo[state.currentWeapon]);
    state.ammo[state.currentWeapon] += loaded;
    state.reserveAmmo[state.currentWeapon] -= loaded;
    state.reloadPhase = 'up'; // Start coming back up
    reloadMsg.classList.remove('show');
    updateHUD();
    setTimeout(() => {
      state.reloading = false; state.canFire = true;
      state.reloadPhase = null;
    }, 300); // Brief delay for weapon to come back up
  }, wep.reloadTime);
}

// ═══════════════════════════════════════════════════════════
// LOOT PICKUP
// ═══════════════════════════════════════════════════════════
function pickupLoot() {
  if (!state.nearbyLoot) return;
  const loot = state.nearbyLoot;
  const type = loot.userData.lootType;

  // Depot crates — repeatable, never consumed
  if (loot.userData.depot) {
    if (type === 'depot_ammo_m4')    { state.reserveAmmo.m4     += 10; SFX.pickup(); }
    if (type === 'depot_ammo_pistol'){ state.reserveAmmo.pistol  += 10; SFX.pickup(); }
    if (type === 'depot_armor')      { state.armor = 100;               SFX.pickup(); }
    if (type === 'depot_health')     { state.hp = 100; updateHUD(); SFX.pickup(); }
    updateHUD();
    return;
  }

  SFX.pickup();
  if (type === 'health' && state.hp >= 100) return;
  if (type === 'armor'  && state.armor >= 100) return;
  switch (type) {
    case 'ammo_m4':     state.reserveAmmo.m4     += 30; break;
    case 'ammo_pistol': state.reserveAmmo.pistol  += 15; break;
    case 'health':      state.hp = 100; break;
    case 'armor':       state.armor = 100; break;
  }
  // Remove floor loot from scene
  if (loot.isGroup) {
    loot.traverse(function(child) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  } else {
    if (loot.geometry) loot.geometry.dispose();
    if (loot.material) loot.material.dispose();
  }
  scene.remove(loot);
  const idx = lootItems.indexOf(loot);
  if (idx >= 0) lootItems.splice(idx, 1);
  state.nearbyLoot = null;
  pickupPrompt.classList.remove('show');
  updateHUD();
}

// ═══════════════════════════════════════════════════════════
// HUD
// ═══════════════════════════════════════════════════════════
function updateHUD() {
  const wep = CONFIG.weapons[state.currentWeapon];
  document.getElementById('wep-name').textContent = wep.name;
  document.getElementById('ammo-current').textContent = state.ammo[state.currentWeapon];
  document.getElementById('ammo-reserve').textContent = state.reserveAmmo[state.currentWeapon];
  document.getElementById('hp-val').textContent = state.hp;
  document.getElementById('hp-bar').style.width = state.hp + '%';
  document.getElementById('armor-val').textContent = state.armor;
  document.getElementById('armor-bar').style.width = state.armor + '%';
  document.getElementById('reserve-m4').textContent = state.reserveAmmo.m4;
  document.getElementById('reserve-pistol').textContent = state.reserveAmmo.pistol;
}

// ═══════════════════════════════════════════════════════════
// MINIMAP
// ═══════════════════════════════════════════════════════════
const mCtx = document.getElementById('minimap-canvas').getContext('2d');
function drawMinimap() {
  // Scale to the actual map size (island 253 / city 120) via `half`.
  const w = 150, h = 150, mapSize = half * 2, scale = w / mapSize, cx = w / 2, cy = h / 2;
  mCtx.fillStyle = '#0a6699'; mCtx.fillRect(0, 0, w, h);
  const iSize = mapSize * scale;
  mCtx.fillStyle = (CONFIG.world === 'city') ? '#33363c' : '#3a5a2a';
  mCtx.fillRect(cx - iSize / 2, cy - iSize / 2, iSize, iSize);

  // Island-only minimap features — volcano / canal / flood / prison all live
  // in the removed island world files. City draws just the arena + player.
  if (CONFIG.world === 'island') {
  // Volcano
  mCtx.beginPath();
  mCtx.arc(cx, cy, CONFIG.volcanoRadius * scale, 0, Math.PI * 2);
  mCtx.fillStyle = '#5a4a3a'; mCtx.fill();

  // Canal (square)
  mCtx.strokeStyle = '#1199dd'; mCtx.lineWidth = 3;
  const _cr = _CANAL_R * scale;
  mCtx.strokeRect(cx - _cr, cy - _cr, _cr * 2, _cr * 2);

  // Water flood level — show as blue fill covering submerged areas
  if (state.waterRising && state.waterLevel > 0.5) {
    let floodRadius = CONFIG.volcanoRadius;
    for (let testR = CONFIG.volcanoRadius; testR > 0; testR -= 1) {
      const t = 1 - testR / CONFIG.volcanoRadius;
      const smooth = t * t * t * (t * (t * 6 - 15) + 10);
      if (smooth * CONFIG.volcanoHeight > state.waterLevel) {
        floodRadius = testR;
        break;
      }
    }
    mCtx.fillStyle = 'rgba(15, 100, 180, 0.5)';
    mCtx.fillRect(cx - iSize / 2, cy - iSize / 2, iSize, iSize);
    mCtx.save();
    mCtx.beginPath();
    mCtx.arc(cx, cy, floodRadius * scale, 0, Math.PI * 2);
    mCtx.clip();
    mCtx.fillStyle = '#5a4a3a';
    mCtx.beginPath();
    mCtx.arc(cx, cy, floodRadius * scale, 0, Math.PI * 2);
    mCtx.fill();
    mCtx.restore();
  }

  // Prison
  mCtx.fillStyle = '#808080';
  mCtx.fillRect(cx + prison.x * scale - pw * scale / 2, cy + prison.z * scale - pw * scale / 2, pw * scale, pw * scale);
  }

  // Bots (alive = red dots)
  bots.forEach(b => {
    if (!b.alive) return;
    mCtx.fillStyle = '#ff4444';
    mCtx.beginPath();
    mCtx.arc(cx + b.pos.x * scale, cy + b.pos.z * scale, 2, 0, Math.PI * 2);
    mCtx.fill();
  });

  // Loot
  lootItems.forEach(l => {
    mCtx.fillStyle = '#' + l.material.color.getHexString();
    mCtx.fillRect(cx + l.position.x * scale - 1, cy + l.position.z * scale - 1, 2, 2);
  });

  // Player
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const angle = Math.atan2(dir.x, dir.z);
  const px = cx + camera.position.x * scale, pz = cy + camera.position.z * scale;
  mCtx.save(); mCtx.translate(px, pz); mCtx.rotate(-angle);
  mCtx.beginPath(); mCtx.moveTo(0, -5); mCtx.lineTo(-3, 3); mCtx.lineTo(3, 3); mCtx.closePath();
  mCtx.fillStyle = '#fff'; mCtx.fill(); mCtx.restore();
}

// ── CHAT ─────────────────────────────────────────────────────────────
window._chatActive = false;

var _chatColors = ['#7ecfff','#ffcc55','#88ff88','#ff9966','#cc88ff','#ff6688','#55ddcc','#ffdd88'];
function _chatColor(id) {
  var h = 0;
  for (var i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return _chatColors[Math.abs(h) % _chatColors.length];
}

function addChatMessage(senderId, text) {
  var now = new Date();
  var ts = '[' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0') + '] ';
  var log = document.getElementById('chat-log');
  if (!log) return;
  var msg = document.createElement('div');
  msg.className = 'chat-msg';
  var tsSpan = document.createElement('span');
  tsSpan.style.color = 'rgba(255,255,255,0.4)';
  tsSpan.textContent = ts;
  var name = document.createElement('span');
  name.className = 'chat-name';
  name.style.color = _chatColor(senderId);
  name.textContent = senderId.slice(0, 12) + ': ';
  msg.appendChild(tsSpan);
  msg.appendChild(name);
  var textSpan = document.createElement('span');
  textSpan.style.color = '#cccccc';
  textSpan.textContent = text;
  msg.appendChild(textSpan);
  log.appendChild(msg);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 8) log.removeChild(log.firstChild);

}

function sendChat(text) {
  if (!text || !text.trim()) return;
  var trimmed = text.trim().slice(0, 120);
  addChatMessage(state.myId || 'You', trimmed);
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'chat', text: trimmed }));
  }
}

function setupChat() {
  var input     = document.getElementById('chat-input');
  var inputRow  = document.getElementById('chat-input-row');
  var container = document.getElementById('chat-container');
  var minBtn    = document.getElementById('chat-minimize');
  var sendBtn   = document.getElementById('chat-send');
  if (!input) return;

  // Always show
  if (inputRow)  inputRow.style.display  = 'flex';

  // Minimize / restore
  var minimized = false;
  var chatBody = document.getElementById('chat-body');
  if (minBtn) {
    minBtn.innerHTML = '&#8722;';
    minBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      minimized = !minimized;
      if (chatBody) chatBody.style.display = minimized ? 'none' : 'flex';
      minBtn.innerHTML = minimized ? '&#43;' : '&#8722;';
    });
  }

  // Click input -> exit pointer lock so player can type
  input.addEventListener('mousedown', function(e) {
    e.stopPropagation();
    window._chatActive = true;
    if (document.pointerLockElement) document.exitPointerLock();
  });

  // Enter sends, Escape clears, all other keys blocked from game
  input.addEventListener('keydown', function(e) {
    if (e.code === 'Enter') {
      sendChat(input.value);
      input.value = '';
      input.blur();
      window._chatActive = false;
      e.preventDefault();
      e.stopPropagation();
    } else if (e.code === 'Escape') {
      input.value = '';
      input.blur();
      window._chatActive = false;
      e.preventDefault();
      e.stopPropagation();
    } else {
      e.stopPropagation();
    }
  }, true);

  // Send button
  if (sendBtn) {
    sendBtn.addEventListener('click', function() {
      sendChat(input.value);
      input.value = '';
      input.blur();
      window._chatActive = false;
    });
  }

  // Track focus
  input.addEventListener('focus', function() { window._chatActive = true; });
  input.addEventListener('blur',  function() { window._chatActive = false; });
}
// ── END CHAT ──────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════
// GAME LOOP
// ═══════════════════════════════════════════════════════════
const clock = new THREE.Clock();
const moveVec = new THREE.Vector3();
const smoothedMove = new THREE.Vector3(); // Smoothed movement for weapon bob / footsteps
const fwd = new THREE.Vector3();
const rgt = new THREE.Vector3();
let minimapTimer = 0;
let perfFrames = 0, perfLastTime = 0;
let _mainTris = 0, _mainCalls = 0; // main-scene renderer.info, snapshotted right after the world render
let headBobPhase = 0;
let landingBobY = 0, landingBobVel = 0;
let wasGrounded = true;
let landingCooldown = 0;
let weaponJumpY = 0, weaponJumpVel = 0;

// ── Fixed timestep physics ──
// Physics always steps at exactly 64Hz regardless of render framerate.
// This makes player position 100% predictable from inputs alone —
// required for server-side reconciliation in multiplayer.
const FIXED_DT = 1 / 64;
let physicsAccumulator = 0;

// Frame counters for work that doesn't need to run every frame.
let _shadowFrame = 0;     // shadow map regenerates on even frames (~30Hz)
let _waterWaveFrame = 0;  // water wave displacement updates on even frames

// ── Adaptive resolution ──
// Measure FPS over short windows and nudge the renderer pixel ratio: down when
// we're below target (free up GPU fill), up when we have headroom. Drops fast and
// recovers slowly so it settles instead of oscillating. This is what holds 60fps
// through the fill-heavy spots (clustered bodies, damage vignette, shadows).
let _prAccum = 0, _prFrames = 0;
function _adaptResolution(dt) {
  _prAccum += dt; _prFrames++;
  if (_prAccum < 0.25) return;     // re-evaluate ~4×/second so it reacts quickly
  const fps = _prFrames / _prAccum;
  _prAccum = 0; _prFrames = 0;
  let pr = window._curPR;
  if (fps < 57 && pr > window._minPR) {
    // Drop proportional to how far below 60 we are — a crater (e.g. 30fps when shot)
    // drops hard and instantly, a small dip eases down.
    const deficit = (58 - fps) / 58;
    pr = Math.max(window._minPR, +(pr - Math.max(0.1, deficit * 1.3)).toFixed(2));
  } else if (fps > 59.5 && pr < window._maxPR) {
    pr = Math.min(window._maxPR, +(pr + 0.07).toFixed(2)); // recover gently to avoid oscillation
  }
  if (pr !== window._curPR) {
    window._curPR = pr;
    renderer.setPixelRatio(pr); // three re-applies setSize internally
  }
}

// Reused per-frame scratch — hoisted out of update() to avoid heap churn / GC hitches.
const _lootLookDir = new THREE.Vector3();
const _lootWP = new THREE.Vector3();
const _lootToVec = new THREE.Vector3();
const _lootScan = [];                 // refilled in place, never reallocated
const _restPos = new THREE.Vector3();
const _wepTargetPos = new THREE.Vector3();

// ── Instanced Ash Cloud Pool — 1 draw call for ALL ash particles ──
const ASH_POOL_SIZE = 300;
const ashGeo = new THREE.SphereGeometry(1, 5, 4);
const ashMat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.7, color: 0x686868, depthWrite: false });
const ashMesh = new THREE.InstancedMesh(ashGeo, ashMat, ASH_POOL_SIZE);
ashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
ashMesh.frustumCulled = false;
ashMesh.renderOrder = 2;
ashMesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 150, 0), 800);

// ── Eruption plume — organic camera-facing smoke ──

// Build N organic blob textures (spline-outlined, not circular)
function _makePlumeTexture(variant) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d'), cx = 128, cy = 128;
  // Generate control points around an irregular closed curve
  const N = 8 + (variant % 3);
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + variant * 0.8;
    const baseR = 72 + 22 * Math.sin(variant * 2.3 + i * 1.9);
    const r = baseR + ((i * 7 + variant * 13) % 28) - 14;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  // Smooth closed catmull-rom path
  ctx.beginPath();
  const L = pts.length;
  for (let i = 0; i < L; i++) {
    const p0 = pts[(i - 1 + L) % L], p1 = pts[i];
    const p2 = pts[(i + 1) % L],     p3 = pts[(i + 2) % L];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6, cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6, cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    if (i === 0) ctx.moveTo(p1[0], p1[1]);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
  }
  ctx.closePath();
  const dark = 38 + (variant % 3) * 8;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 95);
  g.addColorStop(0,    `rgba(${dark+22},${dark+22},${dark+22},0.90)`);
  g.addColorStop(0.45, `rgba(${dark+10},${dark+10},${dark+10},0.78)`);
  g.addColorStop(0.78, `rgba(${dark},${dark},${dark},0.40)`);
  g.addColorStop(1,    'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fill();
  // Add a couple of offset sub-blobs to break circularity further
  for (let b = 0; b < 3; b++) {
    const ba = variant * 1.1 + b * 2.1, br = 28 + b * 9;
    const bx = cx + Math.cos(ba) * 38, by = cy + Math.sin(ba) * 32;
    const bg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    bg.addColorStop(0,   `rgba(${dark+15},${dark+15},${dark+15},0.55)`);
    bg.addColorStop(0.6, `rgba(${dark},${dark},${dark},0.25)`);
    bg.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI*2); ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}
const _plumeTex = Array.from({ length: 6 }, (_, i) => _makePlumeTexture(i));

const PLUME_COUNT = 140;
const PLUME_MAX_Y = 165;
const _plumeGroup = new THREE.Group();
_plumeGroup.position.set(0, CONFIG.volcanoHeight, 0);
_plumeGroup.visible = false;
_plumeGroup.renderOrder = 2;
scene.add(_plumeGroup);

const _plumeData = [];
const _plumeQuat = new THREE.Quaternion();
const _spinAxis  = new THREE.Vector3(0, 0, 1);
const _spinQ     = new THREE.Quaternion();
let _plumeFadeT  = 0;

for (let i = 0; i < PLUME_COUNT; i++) {
  const mat = new THREE.MeshBasicMaterial({
    map: _plumeTex[i % 6], transparent: true, opacity: 0,
    depthWrite: false, side: THREE.DoubleSide, fog: false
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = 2; mesh.frustumCulled = false;
  _plumeGroup.add(mesh);
  _plumeData.push({
    mesh, mat,
    y:          (i / PLUME_COUNT) * PLUME_MAX_Y,   // evenly staggered — no gaps
    speed:      11 + Math.random() * 10,
    angle:      Math.random() * Math.PI * 2,
    radMult:    0.5 + Math.random() * 1.0,
    baseSize:   9 + Math.random() * 10,
    scaleRatio: 0.75 + Math.random() * 0.55,        // oval asymmetry
    wobbleAmp:  0.6 + Math.random() * 1.0,
    wobbleFreq: 0.6 + Math.random() * 1.2,
    wobbleOff:  Math.random() * Math.PI * 2,
    spinAngle:  Math.random() * Math.PI * 2,
    spinRate:   (Math.random() - 0.5) * 0.8,        // slow screen-space spin
  });
}

function updatePlume(dt) {
  _plumeGroup.visible = true;
  _plumeFadeT = Math.min(1, _plumeFadeT + dt * 0.5);
  _plumeQuat.copy(camera.quaternion);

  const tSinceErupt = state.matchTime - state.eruptionStartTime;
  // Violent phase lasts 9s, then smoothly eases to normal over 4s
  const violentFrac = 1 - Math.min(1, Math.max(0, (tSinceErupt - 9) / 4));
  const speedMult = 1.0 + violentFrac * 1.0;   // 2.0 → 1.0 smooth

  for (const p of _plumeData) {
    p.y += p.speed * speedMult * dt;
    if (p.y > PLUME_MAX_Y) p.y -= PLUME_MAX_Y;   // seamless wrap

    const f   = p.y / PLUME_MAX_Y;               // 0 = mouth, 1 = top
    const rad = 1.5 + Math.pow(f, 1.5) * 62 * p.radMult;

    // Pure radial spread — no spiral, just outward in fixed angle + small wobble
    p.wobbleOff += p.wobbleFreq * dt;
    const wx = Math.sin(p.wobbleOff) * p.wobbleAmp * 1.8;
    const wz = Math.cos(p.wobbleOff * 0.7 + 1.3) * p.wobbleAmp * 1.8;
    p.mesh.position.set(Math.cos(p.angle) * rad + wx, p.y, Math.sin(p.angle) * rad + wz);

    // Camera-facing + per-sprite screen-space spin for organic variety
    p.spinAngle += p.spinRate * dt;
    _spinQ.setFromAxisAngle(_spinAxis, p.spinAngle);
    p.mesh.quaternion.multiplyQuaternions(_plumeQuat, _spinQ);

    // Oval scale (x/y ratio varies per sprite)
    const s = (p.baseSize + f * 28) * (1.0 + violentFrac * 0.35);
    p.mesh.scale.set(s, s * p.scaleRatio, 1);

    // Fade in from mouth, full opacity mid-column, fade out at very top
    const fadeIn  = Math.min(1, p.y / 8) * _plumeFadeT;
    const fadeOut = 1 - Math.max(0, (f - 0.82) / 0.18);
    p.mat.opacity = 0.80 * fadeIn * fadeOut;
  }
}

// Stubs expected by eruption-start / legacy code
const ERUPT_COUNT = 1;
const eruptPhase = new Float32Array(1);
const eruptSpeed = new Float32Array(1);
const eruptPos   = new Float32Array(3);
const ERUPT_MAX_H = 165;


scene.add(ashMesh);

const ashActive    = new Array(ASH_POOL_SIZE).fill(false);
const ashPos       = Array.from({ length: ASH_POOL_SIZE }, () => new THREE.Vector3());
const ashVel       = Array.from({ length: ASH_POOL_SIZE }, () => new THREE.Vector3());
const ashSize      = new Float32Array(ASH_POOL_SIZE);
const ashGrowRate  = new Float32Array(ASH_POOL_SIZE);
const ashLife      = new Float32Array(ASH_POOL_SIZE);
const ashMaxLife   = new Float32Array(ASH_POOL_SIZE);
const ashOpacity   = new Float32Array(ASH_POOL_SIZE);
const ashColors    = [0x606060, 0x707070, 0x787878, 0x686860, 0x686868];
const ashColorObjs = ashColors.map(c => new THREE.Color(c));

ashMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ASH_POOL_SIZE * 3), 3);

const _ashDummy = new THREE.Object3D();

function spawnAshCloud(size, upVel, life) {
  for (let i = 0; i < ASH_POOL_SIZE; i++) {
    if (ashActive[i]) continue;
    ashActive[i]   = true;
    ashSize[i]     = size * 1.2;
    ashGrowRate[i] = 0.3 + Math.random() * 0.5;
    ashLife[i]     = life;
    ashMaxLife[i]  = life + 5;
    const heightFrac = Math.random();
    const spawnAngle = Math.random() * Math.PI * 2;
    const spawnRadius = (4 + heightFrac * 22) * Math.random();
    ashPos[i].set(
      Math.cos(spawnAngle) * spawnRadius,
      CONFIG.volcanoHeight + 12 + heightFrac * 68,
      Math.sin(spawnAngle) * spawnRadius
    );
    ashVel[i].set(
      (Math.random() - 0.5) * 4,
      upVel * (1 - heightFrac * 0.7),
      (Math.random() - 0.5) * 4
    );
    const col = ashColorObjs[Math.floor(Math.random() * ashColorObjs.length)];
    ashMesh.instanceColor.setXYZ(i, col.r, col.g, col.b);
    return;
  }
}

function updateAshClouds(dt) {
  for (let i = 0; i < ASH_POOL_SIZE; i++) {
    if (!ashActive[i]) {
      _ashDummy.position.set(0, -9999, 0);
      _ashDummy.scale.set(0, 0, 0);
      _ashDummy.updateMatrix();
      ashMesh.setMatrixAt(i, _ashDummy.matrix);
      continue;
    }

    ashVel[i].y *= Math.pow(0.96, dt);
    ashVel[i].x *= Math.pow(0.65, dt);
    ashVel[i].z *= Math.pow(0.65, dt);
    ashPos[i].addScaledVector(ashVel[i], dt);
    ashSize[i] += ashGrowRate[i] * dt;
    ashLife[i] -= dt;

    const opacity = Math.max(0, (ashLife[i] / ashMaxLife[i]) * 0.6);
    ashOpacity[i] = opacity;

    if (ashLife[i] <= 0) {
      ashActive[i] = false;
      _ashDummy.position.set(0, -9999, 0);
      _ashDummy.scale.set(0, 0, 0);
      _ashDummy.updateMatrix();
      ashMesh.setMatrixAt(i, _ashDummy.matrix);
      continue;
    }

    const s = ashSize[i];
    _ashDummy.position.copy(ashPos[i]);
    _ashDummy.scale.set(s, s * 0.6, s);
    _ashDummy.updateMatrix();
    ashMesh.setMatrixAt(i, _ashDummy.matrix);
  }

  ashMesh.instanceMatrix.needsUpdate = true;
  ashMesh.instanceColor.needsUpdate = true;
  ashMat.opacity = 0.18;
}

// ═══════════════════════════════════════════════════════════
// PHYSICS STEP — runs at exactly FIXED_DT (1/64 s) per tick.
//
// Rules for this function:
//   • Only uses fixedDt — never reads clock or Date.now()
//   • Reads state.yaw / state.pitch as the canonical look angles
//   • Reads input booleans (state.moveForward etc.) set by event handlers
//   • Writes camera.position and camera.quaternion
//   • Must produce identical output for identical (state, inputs) — always
// ═══════════════════════════════════════════════════════════
function physicsStep(fixedDt) {
  if (state.playerDead) return;

  // Reconstruct camera orientation from canonical yaw/pitch.
  // YXZ order: yaw (Y) applied first, then pitch (X). No roll.
  euler.set(state.pitch, state.yaw, 0, 'YXZ');
  camera.quaternion.setFromEuler(euler);

  // Build world-space move vector from camera facing + input booleans.
  // Strafe (A/D) is scaled by strafeSpeedMult so lateral movement is slightly slower
  // than forward movement, matching CS/Krunker feel. Diagonal speed is capped at 1.
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  rgt.crossVectors(fwd, new THREE.Vector3(0, -1, 0)).normalize();
  const fwdInput  = (state.moveForward ? 1 : 0) - (state.moveBack  ? 1 : 0);
  const sideInput = (state.moveLeft    ? 1 : 0) - (state.moveRight ? 1 : 0);
  moveVec.set(0, 0, 0);
  moveVec.addScaledVector(fwd, fwdInput);
  moveVec.addScaledVector(rgt, sideInput * CONFIG.strafeSpeedMult);
  const mLen = moveVec.length();
  if (mLen > 1) moveVec.divideScalar(mLen);

  // Smoothed move vector — fixedDt is constant so smoothFactor is constant.
  // This means the lerp rate is perfectly frame-rate independent.
  const smoothFactor = 1 - Math.pow(CONFIG.moveSmoothing, fixedDt * 60);
  smoothedMove.lerp(moveVec, smoothFactor);

  // Advance deterministic physics clock
  state.physicsTime += fixedDt;

  // Speed modifiers
  const sprintActive = false;

  // Compute water level from matchTime — same time domain as waterRiseStart
  let physicsWaterLevel = -0.3;
  if (state.waterRising) {
    const timeSinceRise = state.matchTime - state.waterRiseStart;
    if (timeSinceRise > 0) {
      let riseProgress;
      if (timeSinceRise < 10) {
        riseProgress = (timeSinceRise / 10) * 0.02;
      } else {
        const normalProgress = (timeSinceRise - 10) / (state.matchDuration - state.waterRiseStart - 10);
        riseProgress = 0.02 + Math.pow(Math.max(0, Math.min(1, normalProgress)), 0.70) * 0.98;
      }
      physicsWaterLevel = -0.3 + riseProgress * (CONFIG.volcanoHeight * 0.85 + 0.3);
    }
  }
  const _playerFeetY = CONFIG.newPhysics ? phys.pos.y : (camera.position.y - state.smoothCameraHeight);
  const isSwimming = !!state.isSwimming;
  // _cW must be < 0.96 (inner wall radius) so standing on the wall top doesn't count
  const _cp = camera.position, _cR = 85, _cW = 0.80;
  const _feetY = CONFIG.newPhysics ? phys.pos.y : (_cp.y - state.smoothCameraHeight);
  const inCanalXZ = (Math.abs(_cp.z + _cR) < _cW && Math.abs(_cp.x) < _cR + _cW) ||
                    (Math.abs(_cp.z - _cR) < _cW && Math.abs(_cp.x) < _cR + _cW) ||
                    (Math.abs(_cp.x - _cR) < _cW && Math.abs(_cp.z) < _cR + _cW) ||
                    (Math.abs(_cp.x + _cR) < _cW && Math.abs(_cp.z) < _cR + _cW);
  // _feetY < 0.60 excludes players standing on top of the canal walls (wall top = 0.77)
  const inCanal = inCanalXZ && _feetY < 0.60;
  state.inCanal = inCanal;
  let speed = state.ads ? CONFIG.moveSpeed * CONFIG.adsSpeedMult : CONFIG.moveSpeed;
  if (isSwimming)      speed *= 0.55;
  if (inCanal)         speed *= 1.5;
  if (state.crouching && !state.sliding) speed *= CONFIG.crouchSpeedMult;

  if (CONFIG.newPhysics) {
    // ═══════════════════════════════════════════════════
    // NEW PHYSICS — capsule sweep-and-slide (08b_physics.js)
    // ═══════════════════════════════════════════════════
    physicsUpdate(fixedDt, moveVec, speed);  // raw input — accel model does the smoothing

  } else {
    // ═══════════════════════════════════════════════════
    // LEGACY PHYSICS — circle-vs-AABB (08_weapons.js)
    // ═══════════════════════════════════════════════════
    const targetHeight = state.crouching ? CONFIG.crouchHeight : CONFIG.playerHeight;
    const lerpRate = state.crouching ? 14 : 7;
    state.smoothCameraHeight += (targetHeight - state.smoothCameraHeight) * Math.min(1, fixedDt * lerpRate);

    if (smoothedMove.lengthSq() > 0.001) {
      const frame = smoothedMove.clone().multiplyScalar(speed * fixedDt);

      const testPosX = camera.position.clone();
      testPosX.x += frame.x;
      const collX = checkCollisionAndStep(testPosX);
      if (!collX.blocked) {
        camera.position.x = testPosX.x;
        if (collX.stepUpY > camera.position.y) {
          camera.position.y = collX.stepUpY;
          state.velocityY = 0; state.isGrounded = true;
        }
      }

      const testPosZ = camera.position.clone();
      testPosZ.z += frame.z;
      const collZ = checkCollisionAndStep(testPosZ);
      if (!collZ.blocked) {
        camera.position.z = testPosZ.z;
        if (collZ.stepUpY > camera.position.y) {
          camera.position.y = collZ.stepUpY;
          state.velocityY = 0; state.isGrounded = true;
        }
      }
    }

    // Gravity
    if (!state.isGrounded || state.velocityY > 0) {
      state.velocityY -= CONFIG.gravity * fixedDt;
      camera.position.y += state.velocityY * fixedDt;
    }

    // Floor height — terrain + top of any collider the player is standing on
    let floorH = getTerrainHeight(camera.position.x, camera.position.z);
    const r = CONFIG.playerRadius;
    for (const entry of collidableCache) {
      const objBB = entry.bb;
      if (camera.position.x > objBB.min.x - r && camera.position.x < objBB.max.x + r &&
          camera.position.z > objBB.min.z - r && camera.position.z < objBB.max.z + r) {
        const objTop = objBB.max.y;
        const feetCrouch = camera.position.y - CONFIG.crouchHeight;
        const feetStand  = camera.position.y - CONFIG.playerHeight;
        const nearTop = (feetCrouch >= objTop - 0.6 && feetCrouch <= objTop + 1.2) ||
                        (feetStand  >= objTop - 0.6 && feetStand  <= objTop + 1.2);
        if (nearTop) floorH = Math.max(floorH, objTop);
      }
    }

    const standY = floorH + state.smoothCameraHeight;
    const hardStandY = floorH + targetHeight;
    if (camera.position.y <= standY) {
      camera.position.y = standY; state.velocityY = 0; state.isGrounded = true;
    } else if (camera.position.y > hardStandY + 0.15) {
      state.isGrounded = false;
    }

    // Float on water
    const floatLevel = state.waterLevel + 1.2;
    if (state.waterRising && camera.position.y < floatLevel && state.waterLevel > floorH + 0.8) {
      camera.position.y = floatLevel; state.velocityY = 0; state.isGrounded = true;
    }

    // Smooth crouch camera transition
    if (state.isGrounded) {
      camera.position.y += (standY - camera.position.y) * fixedDt * 20;
    }

    // World boundary clamp
    const bound = half - 1;
    camera.position.x = Math.max(-bound, Math.min(bound, camera.position.x));
    camera.position.z = Math.max(-bound, Math.min(bound, camera.position.z));
  } // end legacy physics

  // Footstep sounds — driven by fixed timestep so cadence is frame-rate independent
  if (smoothedMove.lengthSq() > 0.01 && state.isGrounded && !isSwimming) {
    let stepSpeed = state.crouching ? 2.5 : 4.5;
    if (state.ads) stepSpeed *= 0.6;
    footstepTimer += fixedDt * stepSpeed;
    if (footstepTimer >= 1) { footstepTimer = 0; SFX.footstep(); }
  }
}

// ═══════════════════════════════════════════════════════════
// RENDER / GAME LOOP
// Runs every animation frame. Physics is ticked separately via
// the fixed-timestep accumulator above. Everything here uses
// renderDt — visual smoothing, UI, bots, particles, rendering.
// ═══════════════════════════════════════════════════════════
// Scratch vectors for remote-tracer barrel math — never allocated in the loop
const _rtA = new THREE.Vector3(), _rtB = new THREE.Vector3();

function update() {
  requestAnimationFrame(update);
  const renderDt = Math.min(clock.getDelta(), 0.05);

  _adaptResolution(renderDt); // scale render resolution to hold 60fps under load

  // Regenerate the shadow map at ~30Hz instead of every frame (autoUpdate is off).
  // Set before any render() this frame so the first one picks it up; three resets
  // needsUpdate to false after it renders the shadow pass.
  if ((_shadowFrame++ & 1) === 0) renderer.shadowMap.needsUpdate = true;

  // Slide the sun (shadow frustum) to stay centered on the player, keeping its
  // travel direction constant so shading doesn't change. This is what lets the
  // shadow pass draw only nearby casters instead of the entire island.
  // The follow point is snapped to a texel-sized world grid so the frustum jumps
  // in whole-texel steps as you move — otherwise the shadow edges shimmer.
  if (window._sunDir) {
    const _texel = 140 / 1024; // ortho width / shadow map size ≈ world units per texel
    const _px = Math.round(camera.position.x / _texel) * _texel;
    const _pz = Math.round(camera.position.z / _texel) * _texel;
    sun.target.position.set(_px, 0, _pz);
    sun.position.set(
      _px - _sunDir.x * _sunDist,
      -_sunDir.y * _sunDist,
      _pz - _sunDir.z * _sunDist
    );
  }

  refreshDynamicColliders();

  // ── Fixed-timestep physics accumulator ──
  // Catches up all missed 64Hz ticks since last render frame.
  // Player position is only ever advanced in steps of exactly FIXED_DT.
  physicsAccumulator += renderDt;
  while (physicsAccumulator >= FIXED_DT) {
    physicsStep(FIXED_DT);
    physicsAccumulator -= FIXED_DT;
  }

  // Hold-to-fire: auto weapons re-trigger from the frame loop; shoot() itself
  // gates cadence via state.nextFireAt, so frame rate never changes fire rate.
  if (state.firing) {
    if (!state.locked) state.firing = false;
    else if ((CONFIG.weapons[state.currentWeapon] || {}).auto) shoot();
  }

  // Canal boost HUD
  if (streamBoostEl) streamBoostEl.style.display = state.inCanal ? "block" : "none";

  if (!state.locked && !state.playerDead) {
    updateDroneCamera(renderDt);
    if (window.skyDome) window.skyDome.position.copy(droneCamera.position);
    droneRenderer.render(scene, droneCamera);
    renderer.clear();
    if (window.skyDome) window.skyDome.position.copy(camera.position);
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(weaponScene, weaponCamera); return;
  }

  // ── Game phase management ──
  if (state.phase === 'lobby') {
    if (!state.joinSent) sendJoin();
    if (state.myId && !state.inLobby && state.phase !== 'countdown') {
      // phase is set server-side via startMatch, nothing to do here
    }
  }

  if (state.phase === 'countdown') {
    // Hold the timer until all character rigs are loaded. While waiting we drain the
    // clone work aggressively (frame rate doesn't matter on a "…" loading hold) and
    // show "…"; the 10s countdown only starts once everyone's in — so the load-in
    // cost happens here instead of dropping frames mid-countdown / early match.
    if (!state.matchStartAt && typeof charLoadComplete === 'function') {
      if (charLoadComplete()) {
        // Duel MVP: no countdown ceremony — drop straight into play once the rigs
        // are loaded. matchStartAt in the past ⇒ countdownTime ≤ 0 on the next
        // frame, so no number ever renders and the existing <=0 transition (music
        // stop, phase='playing') runs immediately. BR keeps its 10s countdown.
        state.matchStartAt = Date.now() + (CONFIG.mode === 'duel' ? -2000 : 10000);
      } else {
        // Loading: drain the clone work fast, but keep the screen blank — the
        // countdown number only appears once everyone's in.
        for (let i = 0; i < 12; i++) _drainCharWork();
        const cdElL = document.getElementById('countdown-num');
        if (cdElL) cdElL.classList.remove('show');
      }
    }
    state.countdownTime = state.matchStartAt
      ? 1 - (Date.now() - state.matchStartAt) / 1000
      : state.countdownTime;
    const num = Math.ceil(state.countdownTime);
    const cdEl = document.getElementById('countdown-num');
    if (state.matchStartAt && num > 0 && num <= 10) {
      cdEl.textContent = num;
      cdEl.classList.add('show');
    }
    const music = document.getElementById('menu-music');
    if (music && !music.paused && state.countdownTime <= 5) {
      music.volume = Math.max(0, (state.countdownTime / 5) * 0.75);
      if (state.countdownTime <= 0) { music.pause(); music.currentTime = 0; }
    }
    if (state.countdownTime <= 0) {
      state.phase = 'playing';
      window._killCamBot = null;
      cdEl.classList.remove('show');
      if (CONFIG.mode === 'duel') {
        // Duel loadout guaranteed at match go-live — covers every entry path
        // (bots / real-players), so the player always spawns able to shoot.
        state.armor = 100;
        state.ammo = { m4: CONFIG.weapons.m4.magSize, pistol: CONFIG.weapons.pistol.magSize };
        state.reserveAmmo = { m4: 90, pistol: 45 };
        if (typeof updateHUD === 'function') updateHUD();
      }
      // Prison gate swing is island-only (gateDoorL/R live in the island world
      // file, which the city build removes). Duel has no gate.
      if (CONFIG.world === 'island') {
        state.gateOpening = true;
        SFX.gate_creak();
        const idx1 = collidables.indexOf(gateDoorL);
        if (idx1 >= 0) collidables.splice(idx1, 1);
        const idx2 = collidables.indexOf(gateDoorR);
        if (idx2 >= 0) collidables.splice(idx2, 1);
      }
    }
  }

  // Record player position for kill-cam replay
  if (state.locked && !state.playerDead) {
    const _pSnapNow = Date.now();
    const _lastPS = state.playerSnapshots[state.playerSnapshots.length - 1];
    if (!_lastPS || _pSnapNow - _lastPS.t >= 50) {
      state.playerSnapshots.push({ t: _pSnapNow, x: camera.position.x, y: camera.position.y, z: camera.position.z });
      const _pCutoff = _pSnapNow - 30000;
      while (state.playerSnapshots.length > 2 && state.playerSnapshots[0].t < _pCutoff) state.playerSnapshots.shift();
    }
  }

  // Check player death
  if (state.phase === 'playing' && state.hp <= 0 && !state.playerDead) {
    if (CONFIG.mode === 'duel') {
      // Duel: no elimination/kill-cam — go down, then the server respawns us at
      // our home end. Keep pointer lock so play resumes seamlessly.
      onDuelDeath();
    } else {
      state.playerDead = true;
      state.phase = 'gameover';
      state.killCamVictimPos = camera.position.clone();
      if (document.pointerLockElement) document.exitPointerLock();
      startKillCam();
    }
  }

  // Check victory — you win when no bots AND no remote players are left standing.
  // BR only: in duel, winning is "first to 2 kills" (handled separately), so the
  // last-alive check must NOT fire (with 0 bots it would win instantly).
  if (CONFIG.mode === 'br' && state.phase === 'playing' && !state.playerDead) {
    let anyAlive = false;
    for (const b of bots) { if (b.alive) { anyAlive = true; break; } }
    if (!anyAlive) {
      for (const id in state.remotePlayers) { if (!state.remotePlayers[id].dead) { anyAlive = true; break; } }
    }
    if (!anyAlive) {
      state.phase = 'victory';
      const winScreen = document.getElementById('victory-screen');
      document.getElementById('win-kills').textContent = state.kills;
      const m = Math.floor(state.matchTime / 60);
      const s = Math.floor(state.matchTime % 60);
      document.getElementById('win-time').textContent = m + ':' + String(s).padStart(2, '0');
      setTimeout(() => {
        winScreen.classList.add('show');
        const music = document.getElementById('menu-music');
        if (music) { music.currentTime = 47; music.volume = 0.85; music.play(); }
      }, 500);
    }
  }

  // Kill-cam playback — two modes:
  //   'follow' (default): 3rd-person behind killer showing their body
  //   'pov':              1st-person from killer's eyes aimed at victim death spot
  if (state.killCamActive) {
    state.killCamPlayTime += renderDt;

    // Ensure we have a bot reference — fallback to nearest alive bot if unknown killer
    if (!window._killCamBot) {
      if (state.killCamBotIndex >= 0 && bots[state.killCamBotIndex]) {
        window._killCamBot = bots[state.killCamBotIndex];
      } else {
        const vd = state.killCamVictimPos || camera.position;
        let nearest = null, nearestDist = Infinity;
        for (const b of bots) {
          if (!b.alive) continue;
          const d = (b.pos.x - vd.x) ** 2 + (b.pos.z - vd.z) ** 2;
          if (d < nearestDist) { nearestDist = d; nearest = b; }
        }
        if (nearest) window._killCamBot = nearest;
      }
    }

    const kbot   = window._killCamBot;
    const kplayer = !kbot && state.killCamShooterId ? state.remotePlayers[state.killCamShooterId] : null;
    const vp = state.killCamVictimPos || camera.position;

    if (state.killCamMode === 'pov') {
      // Snapshot replay: killer POV interpolated, player mesh shown at recorded position
      const buf = state.killCamBuffer;
      if (buf && buf.length >= 2) {
        const t = Math.min(state.killCamPlayTime, state.killCamDuration);
        // Interpolate killer position
        let s0 = buf[0], s1 = buf[buf.length - 1];
        for (let i = 0; i < buf.length - 1; i++) {
          if (buf[i].relT <= t && buf[i + 1].relT > t) { s0 = buf[i]; s1 = buf[i + 1]; break; }
        }
        const alpha = s1.relT === s0.relT ? 1 : Math.max(0, Math.min(1, (t - s0.relT) / (s1.relT - s0.relT)));
        const kx = s0.x + (s1.x - s0.x) * alpha;
        const ky = s0.y + (s1.y - s0.y) * alpha;
        const kz = s0.z + (s1.z - s0.z) * alpha;
        camera.position.set(kx, ky + 1.65, kz);

        // Interpolate player (victim) position first — used for both mesh and geometric aim
        const pbuf = state.killCamPlayerBuffer;
        let px = vp.x, py = vp.y, pz = vp.z;
        let hasPbuf = false;
        if (pbuf && pbuf.length >= 2) {
          let p0b = pbuf[0], p1b = pbuf[pbuf.length - 1];
          for (let i = 0; i < pbuf.length - 1; i++) {
            if (pbuf[i].relT <= t && pbuf[i + 1].relT > t) { p0b = pbuf[i]; p1b = pbuf[i + 1]; break; }
          }
          const pa = p1b.relT === p0b.relT ? 1 : Math.max(0, Math.min(1, (t - p0b.relT) / (p1b.relT - p0b.relT)));
          px = p0b.x + (p1b.x - p0b.x) * pa;
          py = p0b.y + (p1b.y - p0b.y) * pa;
          pz = p0b.z + (p1b.z - p0b.z) * pa;
          hasPbuf = true;
        }
        // Show player mesh at interpolated position, facing the killer
        if (window._playerMesh) {
          window._playerMesh.visible = true;
          window._playerMesh.position.set(px, py - CONFIG.playerHeight, pz);
          window._playerMesh.rotation.y = Math.atan2(kx - px, kz - pz);
        }
        // Aim: geometric per-frame from interpolated positions (most accurate) with snapshot fallback
        if (hasPbuf) {
          const _gdx = px - kx, _gdz = pz - kz;
          const _gdy = (py - 0.5) - (ky + 1.65);
          const _ghoriz = Math.sqrt(_gdx * _gdx + _gdz * _gdz) || 0.001;
          state.yaw   = Math.atan2(-_gdx, -_gdz);
          state.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01,
            -Math.atan2(_gdy, _ghoriz)));
        } else if (s0.aimYaw !== undefined && s1.aimYaw !== undefined) {
          const yawDelta = ((s1.aimYaw - s0.aimYaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
          state.yaw   = s0.aimYaw + yawDelta * alpha;
          state.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01,
            s0.aimPitch + (s1.aimPitch - s0.aimPitch) * alpha));
        }

        // Trigger muzzle flash + sound + recoil at recorded shot moments
        const prevT = t - renderDt;
        for (const st of state.killCamShotTimes) {
          if (st > prevT && st <= t) {
            showMuzzleFlash(); // 3D barrel flash only (old CSS #muzzle-flash starburst removed)
            // Hitmarker — red tint on kill shot (last in the list), white otherwise
            const _isKillShot = st === state.killCamShotTimes[state.killCamShotTimes.length - 1];
            hitmarker.style.filter = _isKillShot ? 'hue-rotate(200deg) brightness(2)' : 'none';
            hitmarker.classList.add('show');
            clearTimeout(hitmarkerTimeout);
            hitmarkerTimeout = setTimeout(() => hitmarker.classList.remove('show'), 120);
            if (state.currentWeapon === 'm4') SFX.gunshot_m4(); else SFX.gunshot_pistol();
            weaponGroup.position.z += 0.06;
            weaponGroup.rotation.x -= 0.08;
            break;
          }
        }
      } else {
        if (window._playerMesh) window._playerMesh.visible = false;
        // No buffer — orbit the death position
        const angle = state.killCamPlayTime * 0.6;
        camera.position.set(vp.x + Math.cos(angle) * 8, vp.y + 4, vp.z + Math.sin(angle) * 8);
        state.yaw = angle + Math.PI; state.pitch = -0.35;
      }
    } else if (kbot && kbot.pos) {
      // 3rd-person follow: camera 5 units behind bot using bot's facing yaw
      const facingX = Math.sin(kbot.yaw), facingZ = Math.cos(kbot.yaw);
      const camX = kbot.pos.x - facingX * 7;
      const camY = kbot.pos.y + 2.5;
      const camZ = kbot.pos.z - facingZ * 7;
      camera.position.set(camX, camY, camZ);
      const tdx = kbot.pos.x - camX, tdy = (kbot.pos.y + 1) - camY, tdz = kbot.pos.z - camZ;
      state.yaw   = Math.atan2(-tdx, -tdz);
      state.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01,
        -Math.atan2(tdy, Math.sqrt(tdx * tdx + tdz * tdz))));
    } else if (kplayer && kplayer.mesh) {
      // Remote player 3rd-person follow using mesh rotation
      const mp = kplayer.mesh;
      const facingX = Math.sin(mp.rotation.y), facingZ = Math.cos(mp.rotation.y);
      const camX = mp.position.x - facingX * 7;
      const camY = mp.position.y + 2.5;
      const camZ = mp.position.z - facingZ * 7;
      camera.position.set(camX, camY, camZ);
      const tdx = mp.position.x - camX, tdy = (mp.position.y + 1) - camY, tdz = mp.position.z - camZ;
      state.yaw   = Math.atan2(-tdx, -tdz);
      state.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01,
        -Math.atan2(tdy, Math.sqrt(tdx * tdx + tdz * tdz))));
    } else {
      // No killer found — orbit death position
      const angle = state.killCamPlayTime * 0.6;
      camera.position.set(vp.x + Math.cos(angle) * 8, vp.y + 4, vp.z + Math.sin(angle) * 8);
      state.yaw = angle + Math.PI; state.pitch = -0.35;
    }

    // Hide player mesh in follow/orbit modes (only visible in pov)
    if (state.killCamMode !== 'pov' && window._playerMesh) window._playerMesh.visible = false;

    if (state.killCamPlayTime >= state.killCamDuration) {
      state.killCamActive = false;
      if (window._playerMesh) window._playerMesh.visible = false;
      const _cEl2 = document.getElementById('crosshair');
      if (_cEl2) _cEl2.style.display = 'none';
      document.getElementById('killcam-overlay').classList.remove('show');
      showPostDeathMenu();
    }
    updateBots(renderDt);

  // Spectate mode
  } else if (state.playerDead && state.spectateMode) {
    const aliveBots = bots.filter(b => b.alive);
    const aliveRemote = Object.values(state.remotePlayers).filter(rp => !rp.dead);
    const allTargets = [
      ...aliveBots.map(b => ({ type: 'bot', obj: b })),
      ...aliveRemote.map(rp => ({ type: 'player', obj: rp })),
    ];
    if (allTargets.length > 0) {
      const tgt = allTargets[state.spectateIndex % allTargets.length];
      let specPos, facingYaw;
      if (tgt.type === 'bot') {
        specPos = tgt.obj.pos;
        // bot mesh +Z = forward; camera -Z = forward → add π to convert
        facingYaw = (tgt.obj.yaw || 0) + Math.PI;
      } else {
        specPos = tgt.obj.mesh.position;
        const snaps = tgt.obj.snapshots;
        facingYaw = snaps.length > 0 ? snaps[snaps.length - 1].yaw : 0;
      }

      if (state.spectateMode === '1st') {
        // Push eye forward past the bag face so we're not inside the model.
        // Camera forward = (-sin(facingYaw), 0, -cos(facingYaw)); target is behind PI offset,
        // so bot forward = -camera forward = (sin(facingYaw-PI), 0, cos(facingYaw-PI)).
        const _sfx = -Math.sin(facingYaw) * 0.45;
        const _sfz = -Math.cos(facingYaw) * 0.45;
        camera.position.lerp(new THREE.Vector3(specPos.x + _sfx, specPos.y + 1.78, specPos.z + _sfz), renderDt * 12);
        let dy = facingYaw - state.spectateYaw;
        while (dy >  Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        state.spectateYaw += dy * Math.min(1, renderDt * 12);
        state.yaw = state.spectateYaw;
        state.pitch = 0;
      } else {
        // 3rd person: camera behind + above target.
        // "behind" = opposite of facing direction. Camera faces (-sin, 0, -cos)(facingYaw),
        // so behind-offset = +(sin, 0, cos)(facingYaw).
        const behind = new THREE.Vector3(
          specPos.x + Math.sin(facingYaw) * 7,
          specPos.y + 5,
          specPos.z + Math.cos(facingYaw) * 7
        );
        camera.position.lerp(behind, renderDt * 4);

        // Compute state.yaw / state.pitch so the render step points camera at target.
        // camera.lookAt() is overridden by euler.set(pitch, yaw) at render time.
        const tx = specPos.x, ty = specPos.y + 1.5, tz = specPos.z;
        const cdx = camera.position.x - tx;
        const cdy = camera.position.y - ty;
        const cdz = camera.position.z - tz;
        const cxzLen = Math.sqrt(cdx * cdx + cdz * cdz);
        state.yaw   = Math.atan2(cdx, cdz);
        state.pitch = Math.atan2(-cdy, cxzLen);
        state.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, state.pitch));
      }

      const nameEl = document.getElementById('spec-name');
      if (nameEl) nameEl.textContent = tgt.type === 'bot' ? tgt.obj.name : ('Player ' + (tgt.obj.mesh && tgt.obj.mesh.userData.id || '?'));
    }
    updateBots(renderDt);
  }

  if (streamBoostEl) streamBoostEl.style.display = state.inCanal ? "block" : "none";

  // Gate swing animation
  if (state.gateOpening && gateOpenProgress < 1) {
    gateOpenProgress += renderDt * 0.5;
    if (gateOpenProgress > 1) {
      gateOpenProgress = 1;
    }
    const angle = gateOpenProgress * Math.PI * 0.45;
    gatePivotL.rotation.y = angle;
    gatePivotR.rotation.y = -angle;
  }

  if (!state.playerDead && !state.killCamActive) updateBots(renderDt);

  // Snapshot interpolation — render each remote player slightly in the past on the
  // server's clock, interpolating between two real snapshots. Delay = one mean
  // snapshot gap + a jitter cushion: clean connections sit at the 45ms floor
  // (was hard-pinned at 60), jittery ones rise smoothly toward 150. Brief gaps
  // are covered by extrapolation.
  const INTERP_DELAY = Math.min(150, Math.max(45,
    (state._snapGapMean || 17) + (state._snapJitter || 4) * 4 + 12));
  const renderTime = Date.now() + (state.clockOffset || 0) - INTERP_DELAY;
  state.renderServerTime = renderTime; // shooter's view time — sent with shots for lag comp

  for (const id in state.remotePlayers) {
    const rp = state.remotePlayers[id];
    const snaps = rp.snapshots;
    if (!snaps || snaps.length === 0) continue;

    // Find the two snapshots that bracket renderTime
    let s0 = snaps[0], s1 = snaps[snaps.length - 1];
    for (let si = 0; si < snaps.length - 1; si++) {
      if (snaps[si].t <= renderTime && snaps[si + 1].t >= renderTime) {
        s0 = snaps[si]; s1 = snaps[si + 1]; break;
      }
    }

    const alpha = (s1.t === s0.t) ? 1 : Math.max(0, Math.min(1, (renderTime - s0.t) / (s1.t - s0.t)));

    if (renderTime > s1.t && snaps.length >= 2 && !rp.dead) {
      // Snapshots stalled (TCP hiccup) — dead-reckon forward up to 200ms so the
      // player keeps moving instead of freezing, then hold.
      const sa = snaps[snaps.length - 2], sb = s1;
      const span = sb.t - sa.t;
      const ahead = Math.min(renderTime - sb.t, 200);
      const k = span > 0 ? ahead / span : 0;
      rp.mesh.position.x = sb.x + (sb.x - sa.x) * k;
      rp.mesh.position.y = sb.y + (sb.y - sa.y) * k;
      rp.mesh.position.z = sb.z + (sb.z - sa.z) * k;
    } else {
      rp.mesh.position.x = s0.x + (s1.x - s0.x) * alpha;
      rp.mesh.position.y = s0.y + (s1.y - s0.y) * alpha;
      rp.mesh.position.z = s0.z + (s1.z - s0.z) * alpha;
    }

    // Shortest-path yaw interpolation between snapshots
    if (s0.yaw !== undefined && s1.yaw !== undefined) {
      let dySnap = s1.yaw - s0.yaw;
      while (dySnap >  Math.PI) dySnap -= Math.PI * 2;
      while (dySnap < -Math.PI) dySnap += Math.PI * 2;
      const targetYaw = s0.yaw + dySnap * alpha;
      let dy = targetYaw - rp.mesh.rotation.y;
      while (dy >  Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      rp.mesh.rotation.y += dy * Math.min(1, renderDt * 20);
    }

    // Crouch — the transmitted Y is the opponent's eye height, which already
    // drops when they crouch, so the group (and its hitboxes) needs NO extra
    // lowering: the head hitbox rides the eye and the crouch anim lowers the
    // body. We only track a smoothed eye height so the puppet's feet, computed
    // below as eye − eyeHeight, stay planted on the ground instead of sinking.
    // Use the crouch state AT RENDER TIME (from the bracketing snapshots), not
    // the latest packet — the rendered eye Y is ~100ms behind (interp delay), so
    // the latest flag would lead the body and pop the feet. Mirror the sender's
    // asymmetric smoothing (08b_physics: rate 14 dropping into crouch, 7 rising)
    // so eyeH tracks the transmitted eye and the feet stay welded to the floor.
    const crouchNow = (alpha < 0.5 ? s0.crouch : s1.crouch) || false;
    const eyeTarget = crouchNow ? CONFIG.crouchHeight : CONFIG.playerHeight;
    if (rp.eyeH === undefined) rp.eyeH = eyeTarget;
    rp.eyeH += (eyeTarget - rp.eyeH) * Math.min(1, renderDt * (crouchNow ? 14 : 7));

    // Animated character puppet (same rig/anims/gun fit as bots), driven by the
    // interpolated network state. The block mesh stays as hitbox + load fallback.
    const rpWeapon = rp.pistol ? 'pistol' : 'rifle';
    if (rp.puppet && rp.puppet.weapon !== rpWeapon && !rp.dead) {
      // Weapon switched — rebuild the puppet with the matching anim set + gun mesh
      removeCharacterPuppet(rp.puppet);
      rp.puppet = null;
    }
    if (!rp.puppet && typeof createCharacterPuppet === 'function') {
      rp.puppet = createCharacterPuppet(rpWeapon);
      if (rp.puppet && rp.mesh.userData.blockVisual) rp.mesh.userData.blockVisual.visible = false;
    }
    if (rp.puppet) {
      const pu = rp.puppet;
      const mp = rp.mesh.position;
      // Speed estimate from interpolated motion (units/s, smoothed) → anim choice
      if (rp._lastPX !== undefined && renderDt > 0) {
        const sp = Math.hypot(mp.x - rp._lastPX, mp.z - rp._lastPZ) / renderDt;
        rp._speed = (rp._speed || 0) * 0.8 + sp * 0.2;
      }
      rp._lastPX = mp.x; rp._lastPZ = mp.z;
      // Group origin is the opponent's eye; feet = eye − (smoothed) eye height,
      // so they stay grounded whether standing or crouched (crouch lowers eye),
      // and the crouch animation dips the torso/head from there.
      pu.pos.set(mp.x, mp.y - rp.eyeH, mp.z);
      if (!rp.dead) pu.deadY = pu.pos.y;
      pu.alive = !rp.dead;
      // Hysteresis on the walk/idle switch so position jitter can't flicker it
      const sp = rp._speed || 0;
      rp._moving = rp._moving ? sp > 0.4 : sp > 0.8;
      const moving = rp._moving;
      // Camera yaw 0 faces -Z; the rig's yaw 0 faces +Z — flip 180°.
      // While idle, keep the feet planted through small look-arounds and only
      // turn the body once the view strays >40° — otherwise the rig pivots with
      // every mouse twitch and the feet "ice-skate" across the ground.
      const rawYaw = rp.mesh.rotation.y + Math.PI;
      if (pu._plantYaw === undefined) pu._plantYaw = rawYaw;
      const yd = Math.atan2(Math.sin(rawYaw - pu._plantYaw), Math.cos(rawYaw - pu._plantYaw));
      if (moving || Math.abs(yd) > 0.7) pu._plantYaw = rawYaw;
      pu.yaw = pu._plantYaw; // updateCharacterVisual smooths the actual turn
      // Shooting shows the firing stance, but never overrides crouch — the
      // crouch hitbox is lower, and a standing visual over it would desync
      // what you see from what you can hit.
      const anim = !pu.alive ? 'death'
        : crouchNow ? (moving ? 'crouchWalk' : 'crouchIdle')
        : rp.reloading ? 'reload'
        : rp.shooting ? 'fire'
        : moving ? 'walk' : 'rifleIdle';
      _setBotAnim(pu, anim);
      // Muzzle flash — attached to the puppet's gun mesh so it tracks the
      // animated barrel. Created lazily once the gun exists; the light is kept
      // permanently (intensity toggled) to avoid three.js shader recompiles.
      if (pu.gunMesh && !pu._mf) {
        pu._mf = new THREE.Sprite(new THREE.SpriteMaterial({ map: _getMuzzleTex(),
          color: 0xffddaa, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        pu._mf.position.set(0, 0, -0.69);   // just past the barrel tip (gun-local -z)
        pu._mf.visible = false;
        pu.gunMesh.add(pu._mf);
        pu._mfl = new THREE.PointLight(0xffaa33, 0, 8);
        pu._mfl.position.set(0, 0, -0.69);
        pu.gunMesh.add(pu._mfl);
      }
      if (pu._mf) {
        const on = !!rp.shooting && pu.alive && Math.random() < 0.8;
        pu._mf.visible = on;
        if (on) {
          // gunMesh is scaled by charScale each frame; divide it out for a
          // consistent world size, and spin the sprite for a per-frame flicker.
          const s = (0.34 + Math.random() * 0.22) / (pu.gunMesh.scale.x || 1);
          pu._mf.scale.set(s, s, 1);
          pu._mf.material.rotation = Math.random() * Math.PI;
          // Tracer along the gun's aim, from the same barrel tip as the flash.
          // Yaw-accurate; pitch isn't in the snapshot (flat-arena approximation).
          // Rate-limited to the M4 cadence so the flicker doesn't multi-spawn.
          const nowT = performance.now();
          if (!rp._lastTracerAt || nowT - rp._lastTracerAt > 120) {
            rp._lastTracerAt = nowT;
            _rtA.set(0, 0, -0.69).applyMatrix4(pu.gunMesh.matrixWorld);
            _rtB.set(0, 0, -1.69).applyMatrix4(pu.gunMesh.matrixWorld).sub(_rtA).normalize();
            spawnTracerRay(_rtA, _rtB, 90);
          }
        }
        pu._mfl.intensity = on ? 3.2 : 0;
      }
      updateCharacterVisual(pu, renderDt);
    }
  }

  // Debug overlay - remote player distances


  // ── Match timer & water rise ──
  state.matchTime += renderDt;
  const remaining = Math.max(0, state.matchDuration - state.matchTime);
  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);
  document.getElementById('match-timer').textContent =
    String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');

  let aliveCount = state.playerDead ? 0 : 1;
  for (const b of bots) if (b.alive) aliveCount++;
  for (const id in state.remotePlayers) if (!state.remotePlayers[id].dead) aliveCount++;
  document.getElementById('alive-val').textContent = aliveCount;

  // Volcano eruption — BR storm only (references island `water`/plume objects)
  const eruptionTime = state.waterRiseStart - 15;
  if (CONFIG.mode === 'br' && state.matchTime >= eruptionTime && !state.erupted) {
    state.erupted = true;
    state.eruptionStartTime = state.matchTime;
    // Reset plume — evenly stagger so no wave gap on startup
    _plumeFadeT = 0;
    for (let i = 0; i < _plumeData.length; i++) {
      _plumeData[i].y = (i / _plumeData.length) * PLUME_MAX_Y;
      _plumeData[i].mat.opacity = 0;
    }
    waterWarning.textContent = '⚠ VOLCANO ERUPTING — WATER RISING IN 15 SECONDS ⚠';
    waterWarning.style.fontSize = '28px';
    waterWarning.classList.add('show');
    setTimeout(() => waterWarning.classList.remove('show'), 5000);
    // ash cloud spawning disabled — eruptPoints handles the column visuals
    {
      const ctx = ensureAudio();
      const t0 = ctx.currentTime;
      const fullDur = 15;
      const taperStart = 10;

      const boomBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.8), ctx.sampleRate);
      const bbd = boomBuf.getChannelData(0);
      for (let i = 0; i < bbd.length; i++) {
        const env = i < 200 ? i / 200 : Math.pow(1 - i / bbd.length, 1.1);
        bbd[i] = (Math.random() * 2 - 1) * env;
      }
      const boomSrc = ctx.createBufferSource(); boomSrc.buffer = boomBuf;
      const boomLp = ctx.createBiquadFilter(); boomLp.type = 'lowpass'; boomLp.frequency.value = 90;
      const boomGain = ctx.createGain(); boomGain.gain.value = 1.61;
      boomSrc.connect(boomLp).connect(boomGain).connect(getMaster());
      boomSrc.start(t0);

      for (let layer = 0; layer < 3; layer++) {
        const offset = layer * 0.21;
        const dur = fullDur - offset;
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) {
          const t = i / d.length;
          const fadeIn = Math.min(1, t / 0.05);
          const fadeOut = t > taperStart / dur ? Math.pow(1 - (t - taperStart/dur) / (1 - taperStart/dur), 0.5) : 1;
          d[i] = (Math.random() * 2 - 1) * fadeIn * fadeOut;
        }
        const src = ctx.createBufferSource(); src.buffer = buf;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 75 + layer * 20;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 15;
        const g = ctx.createGain(); g.gain.value = [0.598, 0.403, 0.276][layer];
        src.connect(hp).connect(lp).connect(g).connect(getMaster());
        src.start(t0 + offset);
      }

      const subBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * fullDur), ctx.sampleRate);
      const sbd = subBuf.getChannelData(0);
      for (let i = 0; i < sbd.length; i++) {
        const t = i / sbd.length;
        const fadeIn = Math.min(1, t / 0.08);
        const fadeOut = t > taperStart / fullDur ? Math.pow(1 - (t - taperStart/fullDur) / (1 - taperStart/fullDur), 0.4) : 1;
        sbd[i] = (Math.random() * 2 - 1) * fadeIn * fadeOut;
      }
      const subSrc = ctx.createBufferSource(); subSrc.buffer = subBuf;
      const subLp1 = ctx.createBiquadFilter(); subLp1.type = 'lowpass'; subLp1.frequency.value = 45;
      const subLp2 = ctx.createBiquadFilter(); subLp2.type = 'lowpass'; subLp2.frequency.value = 45;
      const subG = ctx.createGain(); subG.gain.value = 0.92;
      subSrc.connect(subLp1).connect(subLp2).connect(subG).connect(getMaster());
      subSrc.start(t0);

      [950, 2600, 4350, 6100, 7800, 9500].forEach(ms => {
        setTimeout(() => {
          playNoise(0.322, 0.38, 70, 'lowpass');
          playNoise(0.207, 0.22, 110, 'lowpass');
        }, ms);
      });
    }
    const hazeGeo = new THREE.PlaneGeometry(CONFIG.islandSize * 1.5, CONFIG.islandSize * 1.5);
    const hazeMat = new THREE.MeshBasicMaterial({ color: 0x777777, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    const haze = new THREE.Mesh(hazeGeo, hazeMat);
    haze.rotation.x = -Math.PI / 2; haze.position.y = 45;
    scene.add(haze);
    state.hazePlane = haze;
  }

  if (state.erupted) updatePlume(renderDt);

  updateAshClouds(renderDt);

  if (state.hazePlane) {
    const timeSinceEruption = Math.max(0, state.matchTime - eruptionTime);
    const targetOpacity = Math.min(0.35, timeSinceEruption * 0.003);
    state.hazePlane.material.opacity += (targetOpacity - state.hazePlane.material.opacity) * renderDt * 0.5;
    const dimFactor = Math.max(0.35, 1 - timeSinceEruption * 0.004);
    sun.intensity = 1.6 * dimFactor;
    sunMesh.material.color.setHex(dimFactor > 0.6 ? 0xFFEE00 : 0xCC8800);
  }

  if (state.erupted && state.matchTime < eruptionTime + 3 && !state.playerDead) {
    const shakeIntensity = 0.234 * (1 - (state.matchTime - eruptionTime) / 3);
    state.shakeOffset.set(
      (Math.random() - 0.5) * shakeIntensity,
      (Math.random() - 0.5) * shakeIntensity * 0.5,
      (Math.random() - 0.5) * shakeIntensity * 0.25
    );
  } else {
    state.shakeOffset.set(0, 0, 0);
  }

  if (CONFIG.mode === 'br' && state.matchTime >= state.waterRiseStart) {
    if (!state.waterRising) {
      state.waterRising = true;
      water.visible = true;
    }

    const timeSinceRise = state.matchTime - state.waterRiseStart;
    let riseProgress;
    if (timeSinceRise < 20) {
      // Slow grace period — crawls up for 20s to give distant players time to reach volcano
      riseProgress = (timeSinceRise / 20) * 0.015;
    } else {
      // After 20s — accelerated rise, shrinks playable volcano area quickly
      const normalProgress = (timeSinceRise - 20) / (state.matchDuration - state.waterRiseStart - 20);
      riseProgress = 0.015 + Math.pow(normalProgress, 0.55) * 0.985;
    }
    state.waterLevel = -0.3 + riseProgress * (CONFIG.volcanoHeight * 0.85 + 0.3);
    water.position.y = state.waterLevel;

    // Wave displacement re-uploads the whole position buffer — only the back half
    // of every match touches this, so do it at ~30Hz. The rise (position.y) above
    // still updates every frame, so the surface height stays smooth.
    if ((_waterWaveFrame++ & 1) === 0) {
      const waterPosAttr = water.geometry.attributes.position;
      for (let i = 0; i < waterPosAttr.count; i++) {
        const wx = waterPosAttr.getX(i);
        const wy = waterPosAttr.getY(i);
        const wave = Math.sin(wx * 0.3 + clock.elapsedTime * 1.5) * Math.cos(wy * 0.3 + clock.elapsedTime) * 0.15;
        waterPosAttr.setZ(i, wave);
      }
      waterPosAttr.needsUpdate = true;
    }

    // Damage is terrain-based — jumping on water doesn't let you escape damage
    const groundUnderPlayer = getTerrainHeight(camera.position.x, camera.position.z);
    if (state.waterLevel > groundUnderPlayer + 0.4) {
      state.waterDmgTimer += renderDt;
      if (state.waterDmgTimer >= 1) {
        state.waterDmgTimer -= 1;
        if (state.armor > 0) {
          state.armor = Math.max(0, state.armor - 5);
        } else {
          state.hp = Math.max(0, state.hp - 5);
        }
        updateHUD();
        SFX.water_damage();
        const dv = document.getElementById('damage-vignette');
        dv.classList.add('show');
        setTimeout(() => dv.classList.remove('show'), 350);
      }
    } else {
      state.waterDmgTimer = 0;
    }

    for (const bot of bots) {
      if (!bot.alive) continue;
      if (state.waterLevel > bot.pos.y + 0.4) {
        bot.hp -= renderDt * 5;
        if (bot.hp <= 0) {
          bot.alive = false;
          bot.deadY = state.waterLevel;
        }
      }
    }
  }

  // Ambient jungle sounds
  ambientTimer -= renderDt;
  if (ambientTimer <= 0 && state.phase === 'playing') {
    const roll = Math.random();
    if (roll < 0.4) SFX.bird();
    else if (roll < 0.7) SFX.insect();
    else SFX.wind();
    ambientTimer = 4 + Math.random() * 8;
  }

  // Loot proximity
  state.nearbyLoot = null;
  let closestDist = 2.5;
  _lootLookDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
  // Refill the scan list in place (no per-frame array allocation).
  _lootScan.length = 0;
  for (const l of lootItems) _lootScan.push(l);
  for (const c of depotCrates) _lootScan.push(c);
  for (const loot of _lootScan) {
    loot.getWorldPosition(_lootWP);
    const dx = _lootWP.x - camera.position.x;
    const dz = _lootWP.z - camera.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > closestDist) continue;
    if (loot.userData.depot) {
      const { shedX, shedZ } = loot.userData;
      const sdx = camera.position.x - shedX, sdz = camera.position.z - shedZ;
      if (Math.sqrt(sdx * sdx + sdz * sdz) > 12) continue;
    }
    _lootToVec.set(dx, 0, dz).normalize();
    const dot = _lootLookDir.x * _lootToVec.x + _lootLookDir.z * _lootToVec.z;
    if (dot > 0.7 && dist < closestDist) { closestDist = dist; state.nearbyLoot = loot; }
  }
  pickupPrompt.textContent = state.nearbyLoot ? `[F] ${state.nearbyLoot.userData.label}` : '';
  state.nearbyLoot ? pickupPrompt.classList.add('show') : pickupPrompt.classList.remove('show');

  // Loot bob + float with water
  for (const loot of lootItems) {
    const groundY = loot.userData.baseY;
    const floatY = state.waterLevel + 0.1;
    const effectiveY = Math.max(groundY, floatY);
    loot.position.y = effectiveY + Math.sin(clock.elapsedTime * 2 + loot.position.x) * 0.08;
    loot.rotation.y += renderDt * 1.5;
  }

  // Smoke — island volcano only (smokeInst lives in the island world file,
  // which the city build swaps out). ashMesh/_plumeGroup are defined here in
  // 12_main, so we still force them hidden in the city.
  if (CONFIG.world === 'island') {
    smokeInst.visible = !state.erupted;
    ashMesh.visible = !state.erupted;
    if (!state.erupted) _plumeGroup.visible = false;
    for (const s of smokeParticles) {
      const riseT = ((clock.elapsedTime * s.speed * 5 + s.phase * 15) % 65);
      const spread = 1 + riseT * 0.07;
      _smokeDummy.position.set(
        s.ox * spread + Math.sin(clock.elapsedTime * 0.3 + s.phase) * 1.5,
        CONFIG.volcanoHeight + 2 + riseT,
        s.oz * spread + Math.cos(clock.elapsedTime * 0.2 + s.phase) * 1.5
      );
      _smokeDummy.scale.setScalar(s.size * (1 + riseT * 0.035));
      _smokeDummy.updateMatrix();
      smokeInst.setMatrixAt(s.index, _smokeDummy.matrix);
    }
    smokeInst.instanceMatrix.needsUpdate = true;
  } else {
    ashMesh.visible = false;
    _plumeGroup.visible = false;
  }

  // Water vignette
  if (state.waterRising) {
    const maxWater = CONFIG.volcanoHeight * 0.85;
    const progress = Math.min(1, Math.max(0, state.waterLevel / maxWater));
    waterVignette.style.opacity = (progress * 0.9).toFixed(2);
  } else {
    waterVignette.style.opacity = 0;
  }

  // Bubble animation — single instanced mesh
  if (window._bubbleInst) {
    const bi = window._bubbleInst, bd = window._bubbleData, bdm = window._bubbleDummy2;
    bi.visible = !state.waterRising;
    if (!state.waterRising) {
      const opac = 0.2 + Math.sin(clock.elapsedTime * 1.5) * 0.12;
      bi.material.opacity = opac;
      for (let i = 0; i < bd.length; i++) {
        const b = bd[i]; if (!b) continue;
        b.y += b.speed * renderDt;
        if (b.y > 3) b.y = -2 - Math.random() * 2;
        bdm.position.set(b.bx, b.y, b.bz);
        bdm.scale.setScalar(b.size);
        bdm.updateMatrix();
        bi.setMatrixAt(i, bdm.matrix);
      }
      bi.instanceMatrix.needsUpdate = true;
    }
  }

  // ── Stream water shimmer ──
  if (window.streamWater) {
    const st = clock.elapsedTime;
    const shimmer = Math.sin(st * 1.3) * 0.04 + Math.sin(st * 3.1) * 0.02 + Math.sin(st * 0.7) * 0.015;
    window.streamWater.material.color.setRGB(
      0.08 + shimmer * 0.35,
      0.50 + shimmer * 0.85,
      0.82 + shimmer * 0.45
    );
    window.streamWater.material.opacity = 0.74 + Math.sin(st * 0.9) * 0.10;
  }

  // ── Head bob ──
  const isMoving = smoothedMove.lengthSq() > 0.01;
  if (state.isGrounded && isMoving && !state.ads) {
    headBobPhase += renderDt * 8;
  } else {
    headBobPhase += renderDt * 1.5;
  }
  const headBobY = (state.isGrounded && isMoving && !state.ads)
    ? Math.sin(headBobPhase) * 0.015
    : 0;

  // ── Jump / landing pitch kick (spring) ──
  const justLeftGround = !state.isGrounded && wasGrounded;
  const justLanded     = state.isGrounded  && !wasGrounded;
  wasGrounded = state.isGrounded;
  landingCooldown = Math.max(0, landingCooldown - renderDt);
  if (justLeftGround && landingCooldown === 0) {
    landingBobVel  = -0.5;    // slight upward pitch tug on takeoff
    weaponJumpVel  = -0.05;   // weapon lags behind — dips down on takeoff
    landingCooldown = 0.4;
  }
  if (justLanded && landingCooldown === 0) {
    landingBobVel  = 0.361;   // forward pitch kick on landing
    weaponJumpVel  = -0.07;   // weapon bounces down on landing
    landingCooldown = 0.4;
  }
  landingBobY += landingBobVel * renderDt;
  landingBobVel += (-landingBobY * 200 - landingBobVel * 18) * renderDt;
  weaponJumpY += weaponJumpVel * renderDt;
  weaponJumpVel += (-weaponJumpY * 80 - weaponJumpVel * 12) * renderDt;

  // Weapon bob + reload animation
  weaponBobPhase += renderDt * (isMoving ? 10 : 1.5);
  const restPos = state.currentWeapon === 'm4'
    ? _restPos.set(0.25, -0.22, -0.38)
    : _restPos.set(0.2, -0.2, -0.3);
  const targetPos = _wepTargetPos;

  if (state.reloadPhase === 'down' || state.switchPhase === 'down') {
    targetPos.copy(restPos);
    targetPos.y = -0.7;
    targetPos.x += 0.05;
    weaponGroup.rotation.x = -0.3;
  } else if (state.reloadPhase === 'up' || state.switchPhase === 'up') {
    targetPos.copy(restPos);
  } else if (state.ads) {
    const adsX = state.currentWeapon === 'm4' ? 0 : -0.15;
    targetPos.set(adsX, -0.04, restPos.z + 0.06);
  } else {
    targetPos.copy(restPos);
    if (isMoving) {
      targetPos.x += Math.sin(weaponBobPhase) * 0.008;
      targetPos.y += Math.abs(Math.cos(weaponBobPhase)) * 0.008 - 0.004;
    } else {
      targetPos.x += Math.sin(weaponBobPhase * 0.5) * 0.002;
      targetPos.y += Math.sin(weaponBobPhase * 0.3) * 0.002;
    }
  }
  targetPos.y += weaponJumpY;
  const lerpSpeed = state.reloadPhase ? 6 : 12;
  weaponGroup.position.lerp(targetPos, renderDt * lerpSpeed);
  if (!state.reloadPhase) {
    weaponGroup.rotation.x += (0 - weaponGroup.rotation.x) * renderDt * 10;
  } else {
    weaponGroup.rotation.x += (-0.3 - weaponGroup.rotation.x) * renderDt * 6;
  }
  weaponGroup.rotation.y += (0 - weaponGroup.rotation.y) * renderDt * 10;
  // Strafe sway — weapon tilts into the direction of lateral movement
  const strafeAmt = state.moveLeft ? 1 : state.moveRight ? -1 : 0;
  const targetSwayZ = state.ads ? 0 : strafeAmt * 0.069;
  weaponGroup.rotation.z += (targetSwayZ - weaponGroup.rotation.z) * renderDt * 7;
  updateMuzzleFlash(renderDt);

  // FOV
  camera.fov += ((state.ads ? CONFIG.adsFov : CONFIG.normalFov) - camera.fov) * renderDt * 10;
  camera.updateProjectionMatrix();
  // Sync weapon camera to main camera
  weaponCamera.position.copy(camera.position);
  weaponCamera.quaternion.copy(camera.quaternion);
  weaponCamera.fov = camera.fov;
  weaponCamera.updateProjectionMatrix();

  updateTracers(renderDt); // bullet tracer streaks (pooled InstancedMesh, 08_weapons)

  // Impact particles (pooled — deactivate on expiry; never remove/dispose)
  for (let i = 0; i < impactParticles.length; i++) {
    const p = impactParticles[i];
    if (!p.visible) continue;
    p.userData.vel.y -= 9.8 * renderDt;
    p.position.addScaledVector(p.userData.vel, renderDt);
    p.userData.life -= renderDt;
    if (p.userData.life <= 0) p.visible = false;
  }

  // Performance stats — uses the post-main-render snapshot (_mainTris/_mainCalls):
  // renderer.info resets per render() call, so reading it here would show the
  // weapon overlay's numbers (~1k tris), not the actual scene workload.
  perfFrames++;
  if (clock.elapsedTime - perfLastTime >= 1) {
    const fps = perfFrames;
    perfFrames = 0;
    perfLastTime = clock.elapsedTime;
    document.getElementById('perf-stats').textContent =
      `FPS: ${fps} | Tris: ${(_mainTris/1000).toFixed(1)}k | Calls: ${_mainCalls} | Res: ${window._curPR.toFixed(2)}x`;
  }

  // Apply head bob (position) + landing pitch kick (rotation) for this frame only
  camera.position.add(state.shakeOffset);
  camera.position.y += headBobY;
  euler.set(state.pitch + landingBobY, state.yaw, 0, 'YXZ');
  camera.quaternion.setFromEuler(euler);
  if (window.skyDome) window.skyDome.position.copy(camera.position);
  renderer.clear();
  renderer.render(scene, camera);
  _mainTris = renderer.info.render.triangles;
  _mainCalls = renderer.info.render.calls;
  if (!state.killCamActive && !state.playerDead || (state.killCamActive && state.killCamMode === 'pov')) {
    renderer.clearDepth();
    renderer.render(weaponScene, weaponCamera);
  }
  camera.position.y -= headBobY;
  camera.position.sub(state.shakeOffset);
  // Restore physics quaternion
  euler.set(state.pitch, state.yaw, 0, 'YXZ');
  camera.quaternion.setFromEuler(euler);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  droneCamera.aspect = window.innerWidth / window.innerHeight;
  droneCamera.updateProjectionMatrix();
  weaponCamera.aspect = window.innerWidth / window.innerHeight;
  weaponCamera.updateProjectionMatrix();
  droneRenderer.setSize(window.innerWidth, window.innerHeight);
  overlayCanvas.width = window.innerWidth;
  overlayCanvas.height = window.innerHeight;
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) overlayCanvas.style.display = 'none';
});

updateHUD();
buildCollisionCache();
if (CONFIG.newPhysics) physInit();  // Seed capsule from camera position
window._state = state;
// Server connection only started when player picks Real Players mode
window.startBotMatch = function() {
  state.gameMode = "bot";
  const ov = document.getElementById("overlay");
  if (ov) ov.classList.add("hidden");
  if (typeof spawnBots === 'function') spawnBots();
  state.phase = "countdown";
  state.matchStartAt = null; // countdown timer waits until all rigs are loaded (see update loop)
  renderer.domElement.requestPointerLock();
};
window.showPvPOptions = function() {
  const el = document.getElementById("pvp-options");
  if (!el) return;
  el.style.display = (el.style.display === "flex") ? "none" : "flex";
};
window.startPvPMatch = function() {
  state.gameMode = "pvp";
  const ov = document.getElementById("overlay");
  if (ov) ov.classList.add("hidden");
  const lobbyEl = document.getElementById("lobbyScreen");
  if (lobbyEl) lobbyEl.classList.add("visible");
  const modeEl = document.getElementById("lobbyModeLabel");
  if (modeEl) modeEl.textContent = "WAITING FOR PLAYERS...";
  const statusEl = document.getElementById("lobbyStatus");
  if (statusEl) statusEl.textContent = "Connecting...";
  renderer.domElement.requestPointerLock();
  state.phase = "lobby";
  state.inLobby = true;
  camera.position.set(
    CONFIG.spawnPos.x + (Math.random() - 0.5) * 1.5,
    CONFIG.playerHeight,
    CONFIG.spawnPos.z + (Math.random() - 0.5) * 1.5
  );
  // Reseed the capsule from the spawn camera — physics drives the camera, so
  // without this the capsule keeps its old position and the spawn is ignored.
  if (CONFIG.newPhysics) physInit();
  state.ammo.m4 = 30; state.ammo.pistol = 15;
  state.reserveAmmo.m4 = 90; state.reserveAmmo.pistol = 45;
  if (CONFIG.mode === 'duel') state.armor = 100; // duel: spawn with full armor
  try { connectToServer(); } catch(e) { console.error("connectToServer failed:", e); }
};
// ── Player character mesh — visible only during kill-cam POV replay ──
{
  const _pmGroup = new THREE.Group();
  const _shirtM  = new THREE.MeshPhongMaterial({ color: 0xE06820, shininess: 5 }); // orange jumpsuit
  const _pantsM  = new THREE.MeshPhongMaterial({ color: 0xE06820, shininess: 5 }); // same orange
  const _skinM   = new THREE.MeshPhongMaterial({ color: 0xD4A87A, shininess: 12 });
  const _bootM   = new THREE.MeshPhongMaterial({ color: 0x18120a, shininess: 24 });
  const _beltM   = new THREE.MeshPhongMaterial({ color: 0x28180a, shininess: 12 });
  const _bagM    = new THREE.MeshPhongMaterial({ color: 0xC89040, map: _makeBagTex(), shininess: 4 });
  const _bagEyeM = new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 5 });
  const _gunM    = new THREE.MeshPhongMaterial({ color: 0x2a2a2a, shininess: 60, specular: new THREE.Color(0x444444) });
  const _stkM    = new THREE.MeshPhongMaterial({ color: 0x3d2812, shininess: 8 });
  const _textM   = new THREE.MeshPhongMaterial({ map: _makeICETex(), shininess: 2 });

  function _pmAdd(geo, mat, x, y, z, rx) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    _pmGroup.add(m); return m;
  }
  const B  = (w,h,d)     => new THREE.BoxGeometry(w, h, d);
  const S  = (r,sw,sh)   => new THREE.SphereGeometry(r, sw||16, sh||12);
  const Cy = (rt,rb,h,s) => new THREE.CylinderGeometry(rt, rb, h, s||8);

  // Torso — orange jumpsuit, no chest rig
  _pmAdd(Cy(0.30,0.24,0.62),    _shirtM,  0,      1.27,  0);
  _pmAdd(B(0.52,0.09,0.27),     _beltM,   0,      0.95,  0);
  _pmAdd(B(0.29,0.11,0.002),    _textM,   0,      1.42,  0.29);  // I.C.E. front
  _pmAdd(B(0.29,0.11,0.002),    _textM,   0,      1.42, -0.29);  // I.C.E. back
  // Paper bag head
  _pmAdd(B(0.42,0.48,0.37),     _bagM,    0,      1.76,  0);
  _pmAdd(B(0.10,0.056,0.01),   _bagEyeM,-0.09,   1.82,  0.186);      // L eye hole
  _pmAdd(B(0.10,0.056,0.01),   _bagEyeM, 0.09,   1.82,  0.186);      // R eye hole
  // Shoulders
  _pmAdd(Cy(0.10,0.13,0.12),    _shirtM, -0.30,   1.55,  0);
  _pmAdd(Cy(0.10,0.13,0.12),    _shirtM,  0.30,   1.55,  0);
  // Arms — two-handed rifle carry pose: right grips trigger, left reaches handguard
  // lRotX > 0 tilts the hand forward; forearm x moves inward at elbow for visual bend
  _pmAdd(B(0.17,0.34,0.17),     _shirtM,  0.41,   1.41,  0.04, 0.36);  // R upper arm
  _pmAdd(B(0.14,0.28,0.14),     _shirtM,  0.38,   1.20,  0.13, 0.66);  // R forearm
  _pmAdd(B(0.14,0.12,0.18),     _skinM,   0.24,   1.05,  0.18);        // R hand
  _pmAdd(B(0.17,0.34,0.17),     _shirtM, -0.41,   1.41,  0.04, 0.60);  // L upper arm
  _pmAdd(B(0.14,0.28,0.14),     _shirtM, -0.30,   1.23,  0.22, 0.98);  // L forearm
  _pmAdd(B(0.14,0.12,0.18),     _skinM,   0.04,   1.07,  0.34);        // L hand
  // Legs
  _pmAdd(B(0.22,0.38,0.22),     _pantsM, -0.155,  0.73,  0);
  _pmAdd(B(0.22,0.38,0.22),     _pantsM,  0.155,  0.73,  0);
  _pmAdd(B(0.17,0.34,0.19),     _pantsM, -0.155,  0.37,  0);
  _pmAdd(B(0.17,0.34,0.19),     _pantsM,  0.155,  0.37,  0);
  _pmAdd(B(0.20,0.18,0.30),     _bootM,  -0.155,  0.09,  0.04);
  _pmAdd(B(0.20,0.18,0.30),     _bootM,   0.155,  0.09,  0.04);
  // Gun — barrel Rx(PI/2) maps +Y → +Z (points toward target)
  const _woodM = new THREE.MeshPhongMaterial({ color: 0x7a4a1a, shininess: 15 });
  _pmAdd(Cy(0.028,0.028,0.44,8),_gunM,    0.06,   1.10,  0.40, Math.PI/2);  // barrel
  _pmAdd(B(0.08,0.10,0.22),     _gunM,    0.10,   1.11,  0.14);             // receiver
  _pmAdd(B(0.065,0.038,0.18),   _woodM,   0.07,   1.09,  0.33);             // handguard
  _pmAdd(B(0.055,0.14,0.062),   _gunM,    0.10,   0.98,  0.16);             // magazine (angled in 3d)
  _pmAdd(B(0.042,0.088,0.046),  _woodM,   0.12,   1.01,  0.08);             // pistol grip
  _pmAdd(B(0.06,0.08,0.16),     _stkM,    0.18,   1.12, -0.04);             // stock

  _pmGroup.visible = false;
  scene.add(_pmGroup);
  window._playerMesh = _pmGroup;
}

update();

document.getElementById('win-restart').addEventListener('click', () => location.reload());

// ── Kill-cam: 3-second live follow, plus build snapshot buffer for the replay button ──
function startKillCam() {
  state.killCamPlayTime = 0;
  state.killCamActive = true;
  state.killCamMode = 'follow';
  state.killCamDuration = 3.0;
  state.killCamBuffer = [];
  state.killCamReplayDuration = 5.0;

  // Build replay buffer from killer's last 5s of snapshots (used by watchKillCam)
  const now = Date.now();
  const cutoff = now - 5000;
  const vp = state.killCamVictimPos || camera.position;

  // Resolve killer bot — also check nearest alive bot as last resort
  let _kcBot = window._killCamBot || (state.killCamBotIndex >= 0 ? bots[state.killCamBotIndex] : null);
  if (!_kcBot && !state.killCamShooterId) {
    let nearest = null, nearestDist = Infinity;
    for (const b of bots) {
      if (!b.alive) continue;
      const d = (b.pos.x - vp.x) ** 2 + (b.pos.z - vp.z) ** 2;
      if (d < nearestDist) { nearestDist = d; nearest = b; }
    }
    if (nearest) { _kcBot = nearest; window._killCamBot = nearest; }
  }
  if (_kcBot) {
    // Use last 5s of snapshots — fall back to all available if fewer than 5s recorded
    const allSnaps = _kcBot.snapshots;
    const rawSnaps = allSnaps.length > 0
      ? allSnaps.filter(s => s.t >= cutoff).length > 1
        ? allSnaps.filter(s => s.t >= cutoff)
        : allSnaps
      : [];
    if (rawSnaps.length > 1) {
      const baseT = rawSnaps[0].t;
      const endT  = rawSnaps[rawSnaps.length - 1].t;
      state.killCamBuffer = rawSnaps.map(s => ({
        relT: (s.t - baseT) / 1000,
        x: s.x, y: s.y, z: s.z, yaw: s.yaw,
      }));
      // Ensure kill shot falls within the replay window — extend if needed
      const killShotRelT = state.killShotAbsTime != null
        ? (state.killShotAbsTime - baseT) / 1000
        : null;
      const naturalDur = Math.min((endT - baseT) / 1000, 5.0);
      state.killCamReplayDuration = killShotRelT != null
        ? Math.min(Math.max(naturalDur, killShotRelT + 0.4), 6.0)
        : naturalDur;
      // Build aligned player buffer over the same time window
      const winEndT = baseT + state.killCamReplayDuration * 1000;
      const playerRaw = state.playerSnapshots.filter(s => s.t >= baseT && s.t <= winEndT + 200);
      if (playerRaw.length > 1) {
        state.killCamPlayerBuffer = playerRaw.map(s => ({
          relT: (s.t - baseT) / 1000,
          x: s.x, y: s.y, z: s.z,
        }));
      } else {
        state.killCamPlayerBuffer = [];
      }
      // Convert killer's shot timestamps to relT offsets within this window
      state.killCamShotTimes = (_kcBot.shotTimes || [])
        .filter(t => t >= baseT && t <= winEndT + 100)
        .map(t => (t - baseT) / 1000);
    }
  } else if (state.killCamShooterId && state.remotePlayers[state.killCamShooterId]) {
    const snaps = state.remotePlayers[state.killCamShooterId].snapshots.filter(s => s.t >= cutoff);
    if (snaps.length > 1) {
      const baseT = snaps[0].t;
      state.killCamBuffer = snaps.map(s => ({
        relT: (s.t - baseT) / 1000,
        x: s.x, y: s.y, z: s.z, yaw: s.yaw,
      }));
      state.killCamReplayDuration = (snaps[snaps.length - 1].t - baseT) / 1000;
    }
  }

  document.getElementById('killcam-overlay').classList.add('show');
  document.getElementById('killcam-disclaimer').style.display = 'none';
  const crosshairEl = document.getElementById('crosshair');
  if (crosshairEl) crosshairEl.style.display = 'none';
}

// ── Watch Kill Cam: replay the last 5s from the killer's 1st-person POV ──
window.watchKillCam = function() {
  document.getElementById('game-over-screen').classList.remove('show');
  state.killCamPlayTime = 0;
  state.killCamActive = true;
  state.killCamMode = 'pov';
  state.killCamDuration = state.killCamReplayDuration || 5.0;
  document.getElementById('killcam-overlay').classList.add('show');
  document.getElementById('killcam-disclaimer').style.display = '';
  const _cEl = document.getElementById('crosshair');
  if (_cEl) _cEl.style.display = '';
};

// ── Show post-death stat card + spectate choice menu ──
function showPostDeathMenu() {
  const goScreen = document.getElementById('game-over-screen');
  document.getElementById('go-kills').textContent = state.kills;
  const m = Math.floor(state.matchTime / 60);
  const s = Math.floor(state.matchTime % 60);
  document.getElementById('go-time').textContent = m + ':' + String(s).padStart(2, '0');
  const acc = state.shotsFired > 0 ? Math.round(state.shotsHit / state.shotsFired * 100) : 0;
  document.getElementById('go-shots').textContent = state.shotsFired;
  document.getElementById('go-accuracy').textContent = acc + '%';
  setTimeout(() => goScreen.classList.add('show'), 300);
}

window.startSpectate = function() {
  state.spectateMode = '3rd';
  // Try to land on the killer first
  const aliveBots = bots.filter(b => b.alive);
  const aliveRemote = Object.values(state.remotePlayers).filter(rp => !rp.dead);
  const allT = [
    ...aliveBots.map(b => ({ type: 'bot', obj: b })),
    ...aliveRemote.map(rp => ({ type: 'player', obj: rp })),
  ];
  let startIdx = 0;
  if (state.killCamBotIndex >= 0) {
    const bi = aliveBots.indexOf(bots[state.killCamBotIndex]);
    if (bi >= 0) startIdx = bi;
  } else if (state.killCamShooterId) {
    const pi = aliveRemote.findIndex(rp => rp.id === state.killCamShooterId || Object.keys(state.remotePlayers).find(k => k === state.killCamShooterId && state.remotePlayers[k] === rp));
    if (pi >= 0) startIdx = aliveBots.length + pi;
  }
  state.spectateIndex = startIdx;
  document.getElementById('game-over-screen').classList.remove('show');
  document.getElementById('spectate-hud').classList.add('show');
  const vBtn = document.getElementById('spec-view-btn');
  if (vBtn) vBtn.textContent = '1ST PERSON';
};

window.specCycle = function(dir) {
  const aliveBots = bots.filter(b => b.alive);
  const aliveRemote = Object.values(state.remotePlayers).filter(rp => !rp.dead);
  const total = aliveBots.length + aliveRemote.length;
  if (total === 0) return;
  state.spectateIndex = ((state.spectateIndex + dir) % total + total) % total;
};

window.specToggleView = function() {
  state.spectateMode = state.spectateMode === '3rd' ? '1st' : '3rd';
  const vBtn = document.getElementById('spec-view-btn');
  if (vBtn) vBtn.textContent = state.spectateMode === '3rd' ? '1ST PERSON' : '3RD PERSON';
};

// ─────────────────────────────────────────────────────────────────────────────
// MULTIPLAYER — WebSocket client
// ─────────────────────────────────────────────────────────────────────────────

var WS_URL = 'wss://deported.onrender.com';

// ── Merge an array of part descriptors into a single BufferGeometry with vertex colors.
// Each part: { geo, color (hex int), pos [x,y,z], rot [x,y,z] (optional) }
// Vertex colors make this forward-compatible with texture-atlas skins — just overlay a UV map later.
const _mergeDummy = new THREE.Object3D();
function _buildMergedGeo(partDefs) {
  let totalVerts = 0;
  const processed = [];
  for (const p of partDefs) {
    const g = p.geo.clone().toNonIndexed();
    _mergeDummy.position.set(p.pos[0], p.pos[1], p.pos[2]);
    _mergeDummy.rotation.set(p.rot ? p.rot[0] : 0, p.rot ? p.rot[1] : 0, p.rot ? p.rot[2] : 0);
    _mergeDummy.scale.set(1, 1, 1);
    _mergeDummy.updateMatrix();
    g.applyMatrix4(_mergeDummy.matrix); // bakes position+rotation into vertex positions & normals
    totalVerts += g.attributes.position.count;
    processed.push({ g, c: new THREE.Color(p.color) });
  }
  const posArr = new Float32Array(totalVerts * 3);
  const norArr = new Float32Array(totalVerts * 3);
  const colArr = new Float32Array(totalVerts * 3);
  let off = 0;
  for (const { g, c } of processed) {
    const n = g.attributes.position.count;
    posArr.set(g.attributes.position.array, off * 3);
    norArr.set(g.attributes.normal.array,   off * 3);
    for (let i = 0; i < n; i++) {
      colArr[(off + i) * 3]     = c.r;
      colArr[(off + i) * 3 + 1] = c.g;
      colArr[(off + i) * 3 + 2] = c.b;
    }
    off += n;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(norArr, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colArr, 3));
  return geo;
}

// Shared single material for all remote players — vertex colors carry per-player/part tinting.
const _remotePlayerMat = new THREE.MeshLambertMaterial({ vertexColors: true });
// colorWrite AND depthWrite off — depth writes from an invisible mesh punch a
// see-through hole in whatever renders behind it (the "floating head" glitch)
const _remoteHitboxMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

// Humanoid remote player — 2 draw calls per player (1 merged visual + 1 invisible hitbox).
// Group origin = camera eye height; all geometry offsets downward so feet meet world ground.
function createRemotePlayerMesh(id) {
  const group = new THREE.Group();
  const hue = (parseInt(id.slice(-4), 16) || 0) % 360;

  const bodyHex   = new THREE.Color('hsl(' + hue + ',60%,40%)').getHex();
  const helmetHex = new THREE.Color('hsl(' + hue + ',40%,25%)').getHex();

  const mergedGeo = _buildMergedGeo([
    // Head
    { geo: new THREE.SphereGeometry(0.17, 8, 6),              color: 0xf0c080, pos: [0,     -0.10,  0]              },
    // Helmet dome
    { geo: new THREE.CylinderGeometry(0.20, 0.21, 0.15, 8),   color: helmetHex, pos: [0,     0.03,   0]             },
    // Visor
    { geo: new THREE.BoxGeometry(0.30, 0.05, 0.09),            color: 0x111111, pos: [0,     -0.05, -0.21]           },
    // Neck
    { geo: new THREE.CylinderGeometry(0.07, 0.08, 0.12, 6),   color: 0xf0c080, pos: [0,     -0.33,  0]              },
    // Torso
    { geo: new THREE.BoxGeometry(0.42, 0.52, 0.22),            color: bodyHex,  pos: [0,     -0.65,  0]              },
    // Left arm
    { geo: new THREE.CylinderGeometry(0.065, 0.055, 0.48, 6), color: bodyHex,  pos: [-0.28, -0.68,  0], rot: [0, 0,  0.15] },
    // Right arm
    { geo: new THREE.CylinderGeometry(0.065, 0.055, 0.48, 6), color: bodyHex,  pos: [0.28,  -0.68,  0], rot: [0, 0, -0.15] },
    // Gun body
    { geo: new THREE.BoxGeometry(0.06, 0.08, 0.52),            color: 0x222222, pos: [0.36,  -0.72, -0.17]           },
    // Gun stock
    { geo: new THREE.BoxGeometry(0.05, 0.13, 0.17),            color: 0x3a2a1a, pos: [0.36,  -0.76,  0.15]           },
    // Balaclava front
    { geo: new THREE.BoxGeometry(0.26, 0.15, 0.05),            color: 0x1a1a1a, pos: [0,     -0.20, -0.14]           },
    // Balaclava side L
    { geo: new THREE.BoxGeometry(0.05, 0.15, 0.10),            color: 0x1a1a1a, pos: [-0.13, -0.20, -0.08]           },
    // Balaclava side R
    { geo: new THREE.BoxGeometry(0.05, 0.15, 0.10),            color: 0x1a1a1a, pos: [0.13,  -0.20, -0.08]           },
    // Left leg
    { geo: new THREE.CylinderGeometry(0.09, 0.08, 0.65, 6),   color: 0x1a2a44, pos: [-0.11, -1.15,  0]              },
    // Right leg
    { geo: new THREE.CylinderGeometry(0.09, 0.08, 0.65, 6),   color: 0x1a2a44, pos: [0.11,  -1.15,  0]              },
    // Left boot
    { geo: new THREE.BoxGeometry(0.13, 0.12, 0.20),            color: 0x111111, pos: [-0.11, -1.57,  0.03]           },
    // Right boot
    { geo: new THREE.BoxGeometry(0.13, 0.12, 0.20),            color: 0x111111, pos: [0.11,  -1.57,  0.03]           },
  ]);

  // Block-style fallback visual — hidden once the animated puppet attaches
  // (character GLBs may still be loading); the group/hitbox stay for raycasting.
  const blockVisual = new THREE.Mesh(mergedGeo, _remotePlayerMat);
  group.add(blockVisual);
  group.userData.blockVisual = blockVisual;

  // Invisible hitbox — separate so it stays at the fixed head position for raycasting.
  // Group origin = eye height (feet + 1.7); the rig's head bone sits 1.78 above the
  // feet, so the head sphere goes at +0.08 — not -0.10 (that was upper-chest).
  const hitbox = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4), _remoteHitboxMat);
  hitbox.position.y = 0.08;
  hitbox.userData.isHead = true;
  group.add(hitbox);

  // Body hitbox cylinder — the hidden block visual's pose (arms at sides) doesn't
  // match the animated puppet (arms forward on the rifle), so limb shots whiffed.
  // Same generous dimensions as the bots' body cylinder, centered feet→shoulders.
  const bodyHit = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.55, 8), _remoteHitboxMat);
  bodyHit.position.y = -0.925; // group origin = eye height (feet + 1.7)
  group.add(bodyHit);

  group.userData.id = id;
  scene.add(group);
  return group;
}

// Shared starburst texture for muzzle flashes (built once): a white-hot core
// over a few radial spikes, so it reads as a flash rather than a soft ball.
let _muzzleTexCache = null;
function _getMuzzleTex() {
  if (_muzzleTexCache) return _muzzleTexCache;
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d'); const cx = S / 2, cy = S / 2;
  ctx.globalCompositeOperation = 'lighter';
  // Radial spikes (alternating long/short) under the core glow
  ctx.strokeStyle = 'rgba(255,210,120,0.85)';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const len = (i % 2 ? 0.28 : 0.46) * S;
    ctx.lineWidth = i % 2 ? 2 : 4;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); ctx.stroke();
  }
  // Hot core glow on top
  const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, S * 0.34);
  g.addColorStop(0,    'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,245,200,0.95)');
  g.addColorStop(0.45, 'rgba(255,180,60,0.7)');
  g.addColorStop(1,    'rgba(255,120,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, S * 0.34, 0, Math.PI * 2); ctx.fill();
  _muzzleTexCache = new THREE.CanvasTexture(c);
  return _muzzleTexCache;
}
function removeRemotePlayer(id) {
  const rp = state.remotePlayers[id];
  if (!rp) return;
  scene.remove(rp.mesh);
  if (rp.puppet && typeof removeCharacterPuppet === 'function') removeCharacterPuppet(rp.puppet);
  delete state.remotePlayers[id];
  console.log('Player left:', id);
}

function updateRemotePlayers(playerList, serverT) {
  const seen = new Set();
  // Stamp snapshots with the server's clock (smooth) — not arrival time (jittery)
  const now = serverT !== undefined ? serverT : Date.now();

  for (const p of playerList) {
    if (p.id === state.myId) continue;
    seen.add(p.id);

    if (!state.remotePlayers[p.id]) {
      const newMesh = createRemotePlayerMesh(p.id);
      newMesh.position.set(p.x, p.y, p.z);
      state.remotePlayers[p.id] = { mesh: newMesh, hp: p.hp, dead: p.dead, snapshots: [], crouchY: 0 };
    }

    const rp = state.remotePlayers[p.id];
    rp.hp = p.hp;
    rp.dead = p.dead;
    rp.crouching = p.crouch || false;
    rp.pistol = p.pistol || false;
    rp.shooting = p.shooting || false;
    rp.reloading = p.reloading || false;
    rp.mesh.visible = !p.dead;

    rp.snapshots.push({ t: now, x: p.x, y: p.y, z: p.z, yaw: p.yaw, crouch: p.crouch });
    // Keep 4s of history for kill-cam; interpolation only needs 2 at a time
    const cutoff = now - 4000;
    while (rp.snapshots.length > 2 && rp.snapshots[0].t < cutoff) rp.snapshots.shift();
  }

  for (const id of Object.keys(state.remotePlayers)) {
    if (!seen.has(id)) removeRemotePlayer(id);
  }
}


// ── LOBBY SCREEN HELPERS ────────────────────────────────────
function showLobbyScreen(code) {
  const el = document.getElementById('lobbyScreen');
  const codeEl = document.getElementById('lobbyCode');
  if (el) el.classList.add('visible');
  if (codeEl) codeEl.textContent = code || '----';
  const showCode = !!state.joinedWithCode;
  const codeLabelEl = document.querySelector('.lobby-code-label');
  const codeHintEl  = document.querySelector('.lobby-code-hint');
  const d = showCode ? '' : 'none';
  if (codeEl)       codeEl.style.display       = d;
  if (codeLabelEl)  codeLabelEl.style.display   = d;
  if (codeHintEl)   codeHintEl.style.display    = d;
}

function hideLobbyScreen() {
  const el = document.getElementById('lobbyScreen');
  if (el) el.classList.remove('visible');
}

function updateLobbyUI(msg) {
  const listEl   = document.getElementById('lobbyPlayerList');
  const statusEl = document.getElementById('lobbyStatus');
  const btn      = document.getElementById('lobbyReadyBtn');
  const TOTAL_SLOTS = 21;
  const players = msg.players || [];
  state.lobbyPlayerCount = players.length;

  if (listEl) {
    let html = '';
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      if (i < players.length) {
        const p = players[i];
        const isMe = (p.id === state.myId);
        const rc = p.ready ? 'is-ready' : '';
        html += '<div class="lobby-slot">' +
          '<div class="slot-dot ' + rc + '"></div>' +
          '<div class="slot-name ' + (isMe ? 'is-me' : 'is-player') + '">' +
            (p.name || p.id) + (isMe ? ' (you)' : '') +
          '</div>' +
          '<div class="slot-status ' + rc + '">' + (p.ready ? 'READY' : 'waiting') + '</div>' +
        '</div>';
      } else {
        html += '<div class="lobby-slot lobby-slot-empty">' +
          '<div class="slot-dot slot-dot-empty"></div>' +
          '<div class="slot-name slot-name-empty">— open —</div>' +
          '<div class="slot-status"></div>' +
        '</div>';
      }
    }
    listEl.innerHTML = html;
  }

  if (statusEl) {
    const readyCount = players.filter(p => p.ready).length;
    const total = players.length;
    const need  = Math.ceil(total * 0.51);
    statusEl.textContent = readyCount + ' / ' + total + ' ready — need ' + need + ' to start';
  }

  if (btn) {
    const me = players.find(p => p.id === state.myId);
    if (me && me.ready) {
      btn.textContent = 'UNREADY';
      btn.classList.add('is-ready');
    } else {
      btn.textContent = 'READY UP';
      btn.classList.remove('is-ready');
    }
  }
}

window.toggleReady = function() {
  console.log('[ready] ws:', state.ws && state.ws.readyState, '| myId:', state.myId, '| joinSent:', state.joinSent);
  if (!state.myId) { console.warn('[ready] not joined yet'); return; }
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'ready' }));
    console.log('[ready] sent');
    // Ready-up is a user gesture — grab pointer lock now so the player is already
    // locked and live when the countdown hits zero (no "click to play" screen).
    try { renderer.domElement.requestPointerLock(); } catch (e) {}
  }
};

function sendJoin() {
  if (state.joinSent) return;
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  const roomInput = document.getElementById('room-input');
  const requestedRoom = roomInput ? roomInput.value.trim().toUpperCase() : '';
  state.ws.send(JSON.stringify({
    type: 'join',
    name: 'Player' + Math.floor(Math.random() * 1000),
    roomCode: requestedRoom || undefined,
    gameMode: state.gameMode || 'bot',
  }));
  state.joinSent = true;
  state.joinedWithCode = !!requestedRoom;
  console.log('Join sent — room:', requestedRoom || '(auto)');
}

function adjustBotsForPlayerCount(playerCount) {
  const toRemove = Math.min(Math.max(0, playerCount - 1), bots.length);
  let removed = 0;
  for (let i = 0; i < bots.length && removed < toRemove; i++) {
    const bot = bots[i];
    if (!bot.alive) continue;
    bot.alive = false;
    bot.hp = 0;
    bot.deadY = -10000; // park underground — matrix update handles hiding
    removed++;
  }
  if (removed > 0) console.log('[room] Removed ' + removed + ' bots — ' + bots.filter(b=>b.alive).length + ' bots + ' + playerCount + ' players = 21 total');
}

function showRoomCode(code) {
  if (!code) return;
  const el = document.getElementById('room-code-badge');
  if (!el) return;
  el.textContent = 'Room: ' + code;
  el.style.display = 'block';
}

// ── Unpack binary world snapshot from server ──
// Format: [0x01][count][uint32 serverTimeMs] then per player:
//   6-byte id | flags | hp | armor | uint16 yaw | int16 x,y,z (×100)
const _UNPACK_SCALE = 1 / 100;
function unpackWorld(ab) {
  const dv = new DataView(ab);
  const count = dv.getUint8(1);
  const players = [];
  let off = 6;
  for (let i = 0; i < count; i++) {
    let id = '';
    for (let b = 0; b < 6; b++) { const c = dv.getUint8(off + b); if (c) id += String.fromCharCode(c); }
    off += 6;
    const flags = dv.getUint8(off++);
    const hp    = dv.getUint8(off++);
    const armor = dv.getUint8(off++);
    const yaw   = dv.getUint16(off, true) / 65535 * Math.PI * 2; off += 2;
    const x     = dv.getInt16(off, true) * _UNPACK_SCALE; off += 2;
    const y     = dv.getInt16(off, true) * _UNPACK_SCALE; off += 2;
    const z     = dv.getInt16(off, true) * _UNPACK_SCALE; off += 2;
    players.push({ id, hp, armor, yaw, x, y, z, dead: !!(flags & 1), crouch: !!(flags & 2), pistol: !!(flags & 4), shooting: !!(flags & 8), reloading: !!(flags & 16) });
  }
  return players;
}

function connectToServer() {
  // Local dev (page served from localhost) talks to the local server on 8081
  // Local dev: localhost AND private LAN IPs (a second test machine loading
  // the page via 192.168.x.x must hit the same local server, not production).
  const _isLocal = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(location.hostname);
  const wsUrl = _isLocal
    ? 'ws://' + location.hostname + ':8081'
    : 'wss://deported.onrender.com';
  console.log('Connecting to ' + wsUrl);
  state.ws = new WebSocket(wsUrl);
  state.ws.binaryType = 'arraybuffer';

  state.ws.onopen = () => {
    console.log('WS connected — waiting for player to click play');
    state.wsReady = true;
    state.wsRetries = 0;
    const statusEl = document.getElementById('lobbyStatus');
    if (statusEl && state.inLobby) statusEl.textContent = 'Connected — joining lobby...';
    // In pvp mode, send join immediately on connect
    if (state.gameMode === 'pvp') sendJoin();
  };

  state.ws.onmessage = (event) => {
    // Binary world snapshot
    if (event.data instanceof ArrayBuffer) {
      const dv = new DataView(event.data);
      if (dv.getUint8(0) === 0x01) {
        const arrival = Date.now();
        state.lastWorldAt = arrival;
        const serverT = dv.getUint32(2, true);

        // Clock sync: (serverT - arrival) = clock offset minus one-way delay.
        // The window max ≈ offset at minimum delay; smooth it so the remote
        // timeline doesn't jump when the network hiccups.
        if (!state._clockSamples) state._clockSamples = [];
        state._clockSamples.push({ a: arrival, o: serverT - arrival });
        while (state._clockSamples.length > 2 && state._clockSamples[0].a < arrival - 5000) state._clockSamples.shift();
        let maxOff = -Infinity;
        for (const s of state._clockSamples) if (s.o > maxOff) maxOff = s.o;
        state.clockOffset = (state.clockOffset === undefined)
          ? maxOff : state.clockOffset + (maxOff - state.clockOffset) * 0.1;

        // Adaptive interpolation delay — track the mean snapshot gap and the
        // true jitter (mean |deviation| from that gap) as separate EMAs. The
        // old code fed the mean gap itself in as "jitter" (~16.7ms at 60Hz),
        // which pinned INTERP_DELAY at its floor and never responded to actual
        // network conditions.
        if (state._lastSnapArrival) {
          const gap = arrival - state._lastSnapArrival;
          state._snapGapMean = (state._snapGapMean || 17) * 0.95 + gap * 0.05;
          const dev = Math.abs(gap - state._snapGapMean);
          state._snapJitter = (state._snapJitter === undefined ? 4 : state._snapJitter) * 0.95 + dev * 0.05;
        }
        state._lastSnapArrival = arrival;

        updateRemotePlayers(unpackWorld(event.data), serverT);
      }
      return;
    }

    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    switch (msg.type) {

      case 'welcome':
        state.myId = msg.id;
        state.roomCode = msg.roomCode;
        state.roomPlayerCount = msg.playerCount || 1;
        console.log('My ID:', state.myId, '| Room:', state.roomCode, '| Players:', state.roomPlayerCount);
        if (msg.seed !== undefined) { _seed = msg.seed; console.log('World seed:', _seed); }
        adjustBotsForPlayerCount(state.roomPlayerCount);
        showRoomCode(state.roomCode);
        break;

      case 'joined':
        state.myId = msg.id;
        state.roomCode = msg.roomCode;
        state.fillEndsAt = msg.fillEndsAt || null;
        // Duel: remember the end (A/B) the server assigned us — the match-start
        // and respawn teleports seed the camera here so we don't desync.
        if (msg.spawn) {
          state.mySpawn = msg.spawn;
          // Warm up at our own end — without this both clients idle at spawn A
          // and players stack in one tunnel until match start.
          camera.position.set(
            msg.spawn.x + (Math.random() - 0.5) * 1.5,
            CONFIG.playerHeight,
            msg.spawn.z + (Math.random() - 0.5) * 1.5
          );
          // facing is the +z/−z look direction into the arena (CONFIG.arena.spawns).
          // Camera forward after yaw θ is (−sinθ,0,−cosθ): look +z ⇒ yaw=π, look −z ⇒ yaw=0.
          if (typeof msg.spawn.facing === 'number') { state.yaw = (msg.spawn.facing > 0) ? Math.PI : 0; state.pitch = 0; }
          if (CONFIG.newPhysics) physInit();
        }
        if (msg.winKills)  state.duelWinKills  = msg.winKills;
        if (msg.respawnMs) state.duelRespawnMs = msg.respawnMs;
        showRoomCode(msg.roomCode);
        if (msg.phase === 'waiting') {
          state.inLobby = true;
          showLobbyScreen(msg.roomCode);
          const chatW = document.getElementById('chat-container');
          if (chatW) chatW.style.setProperty('display', 'flex', 'important');
          // Start fill countdown display
          if (state.fillEndsAt) {
            clearInterval(state._fillInterval);
            state.lobbyPlayerCount = state.lobbyPlayerCount || 1;
            state._fillInterval = setInterval(function() {
              const statusEl = document.getElementById('lobbyStatus');
              if (!statusEl || !state.inLobby) return;
              if ((state.lobbyPlayerCount || 1) < 2) {
                statusEl.textContent = 'Waiting for players to join...';
                return;
              }
              const rem = Math.max(0, Math.ceil((state.fillEndsAt - Date.now()) / 1000));
              const m = Math.floor(rem / 60), s = rem % 60;
              statusEl.textContent = 'Match starts in ' + m + ':' + String(s).padStart(2,'0') + (rem === 0 ? ' — Starting!' : '');
              if (rem === 0) clearInterval(state._fillInterval);
            }, 500);
          }
        } else {
          state.inLobby = false;
          const chat = document.getElementById('chat-container');
          if (chat) chat.style.setProperty('display', 'flex', 'important');
        }
        break;
      case 'lobbyState':
        updateLobbyUI(msg);
        break;
      case 'startMatch':
        state.matchStartAt = msg.startAt || (Date.now() + 2500);
        state.phase = 'countdown';
        state.countdownTime = 4;
        (function() {
          var flash = document.createElement('div');
          flash.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;z-index:9999;pointer-events:none;';
          var txt = document.createElement('div');
          txt.style.cssText = 'color:#ffd700;font-size:64px;font-weight:900;letter-spacing:8px;text-shadow:0 0 40px #ffd700,0 0 80px #ffd700;font-family:monospace;';
          txt.textContent = 'GAME STARTING';
          flash.appendChild(txt);
          document.body.appendChild(flash);
          setTimeout(function() { if (flash.parentNode) flash.parentNode.removeChild(flash); }, 2500);
        })();
        state.inLobby = false;
        hideLobbyScreen();
        // Duel is strictly human 1v1 — no bots. (BR fills to 21 with bots so its
        // last-alive victory check doesn't fire instantly at 0 opponents.)
        if (CONFIG.mode !== 'duel') {
          if (typeof spawnBots === 'function' && bots.length === 0) spawnBots();
          adjustBotsForPlayerCount(state.lobbyPlayerCount || state.roomPlayerCount || 1);
        }
        // Reset player to clean match start — no warmup gear carries over
        state.hp = 100;
        if (CONFIG.mode === 'duel') {
          // Duel: fixed loadout — full mags, generous reserve, full armor.
          state.armor = 100;
          state.ammo = { m4: CONFIG.weapons.m4.magSize, pistol: CONFIG.weapons.pistol.magSize };
          state.reserveAmmo = { m4: 90, pistol: 45 };
        } else {
          state.armor = 0;
          state.ammo = { m4: 0, pistol: 0 };
          state.reserveAmmo = { m4: 0, pistol: 0 };
        }
        if (typeof updateHUD === 'function') updateHUD();
        // Fresh duel scoreboard at the top of every match.
        if (CONFIG.mode === 'duel') {
          state.duelScore = {};
          state.playerDead = false;
          hideRespawnOverlay();
          updateDuelHUD();
        }
        state.velocityY = 0;
        // Duel: spawn at the server-assigned end (A/B). Small jitter only — the
        // tunnels are 6u wide, so a wide spread would clip the walls.
        const _startSpawn = (CONFIG.mode === 'duel' && state.mySpawn) ? state.mySpawn : CONFIG.spawnPos;
        const _startJit = (CONFIG.mode === 'duel') ? 2 : 10;
        camera.position.set(
          _startSpawn.x + (Math.random() - 0.5) * _startJit,
          CONFIG.playerHeight,
          _startSpawn.z + (Math.random() - 0.5) * _startJit
        );
        // Reseed the capsule to the match-start spawn (physics drives the camera).
        if (CONFIG.newPhysics) physInit();
        { const chatEl = document.getElementById('chat-container');
          if (chatEl) chatEl.style.setProperty('display', 'flex', 'important'); }
        // Players are normally already pointer-locked (ready-up grabs the lock).
        // Only if the lock is missing: we can't request it from a WS handler (not a
        // user gesture), so flag it and show the click-to-play fallback prompt.
        if (!document.pointerLockElement) {
          state.pendingLock = true;
          const pl = document.getElementById('click-to-play');
          if (pl) pl.style.setProperty('display', 'flex', 'important');
        }
        break;
      case 'chat':
        addChatMessage(msg.id || 'unknown', msg.text || '');
        break;
      case 'events':
        for (const evt of msg.events) {
          if (evt.type === 'hit') applyHitEvent(evt);
          else if (evt.type === 'kill') applyKillEvent(evt);
          else if (evt.type === 'respawn') applyRespawnEvent(evt);
        }
        break;

      case 'duelOver':
        showDuelOver(msg);
        break;

      case 'existingPlayers':
        updateRemotePlayers(msg.players);
        break;

      case 'roomUpdate':
        state.roomPlayerCount = msg.playerCount || state.roomPlayerCount;
        adjustBotsForPlayerCount(state.roomPlayerCount);
        showRoomCode(msg.roomCode || state.roomCode);
        break;

      case 'playerLeft':
        removeRemotePlayer(msg.id);
        break;

      case 'error':
        console.warn('Server error:', msg.reason);
        break;
    }
  };

  state.ws.onclose = () => {
    console.log('WS disconnected — reconnecting in 3s');
    state.myId = null;
    state.wsRetries = (state.wsRetries || 0) + 1;
    const statusEl = document.getElementById('lobbyStatus');
    if (statusEl && state.inLobby) {
      statusEl.textContent = (state.wsRetries >= 2)
        ? 'Waking up the server — this can take ~40s on first visit...'
        : 'Connection lost — retrying...';
    }
    setTimeout(connectToServer, 3000);
  };

  state.ws.onerror = (err) => {
    console.error('WS error', err);
  };
}

// ── DUEL: scoreboard, respawn flow, win screen ─────────────────────────────
// All UI here is injected at runtime (self-contained overlays appended to
// <body>) so it needs no markup in index.html. Guarded by CONFIG.mode==='duel'.

// Lazily create (once) an absolutely-positioned overlay element by id.
function _duelEl(id, css) {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('div'); el.id = id; el.style.cssText = css; document.body.appendChild(el); }
  return el;
}

function updateDuelHUD() {
  if (CONFIG.mode !== 'duel') return;
  const el = _duelEl('duelScore',
    'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:500;' +
    'font-family:monospace;font-weight:900;font-size:26px;letter-spacing:2px;' +
    'text-shadow:0 2px 6px #000;pointer-events:none;white-space:nowrap;');
  const score = state.duelScore || {};
  const my = score[state.myId] || 0;
  let opp = 0;
  for (const id in score) if (id !== state.myId) opp = Math.max(opp, score[id]);
  el.innerHTML =
    '<span style="color:#7CFC00">' + my + '</span>' +
    '<span style="opacity:.5;font-size:15px;margin:0 12px;vertical-align:middle">FIRST TO ' + (state.duelWinKills || 2) + '</span>' +
    '<span style="color:#ff5a5a">' + opp + '</span>';
  el.style.display = 'block';
}

function showRoundOverlay(seconds, won) {
  const el = _duelEl('respawnOverlay',
    'position:fixed;top:0;left:0;width:100%;height:100%;z-index:800;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'font-family:monospace;pointer-events:none;');
  el.style.background = won ? 'rgba(0,40,0,0.35)' : 'rgba(70,0,0,0.45)';
  el.innerHTML =
    '<div style="color:' + (won ? '#7CFC00' : '#ff5a5a') + ';font-size:52px;font-weight:900;' +
      'letter-spacing:6px;text-shadow:0 0 30px ' + (won ? '#063' : '#900') + '">' +
      (won ? 'ROUND WON' : 'ROUND LOST') + '</div>' +
    '<div id="respawnCount" style="color:#fff;font-size:22px;margin-top:16px">Next round in ' + seconds + '…</div>';
  el.style.display = 'flex';
  clearInterval(state._respawnInterval);
  let remain = seconds;
  state._respawnInterval = setInterval(function() {
    remain -= 1;
    const c = document.getElementById('respawnCount');
    if (c) c.textContent = remain > 0 ? ('Next round in ' + remain + '…') : 'FIGHT!';
    if (remain <= 0) clearInterval(state._respawnInterval);
  }, 1000);
}
function showRespawnOverlay(seconds) { showRoundOverlay(seconds, false); }

function hideRespawnOverlay() {
  clearInterval(state._respawnInterval);
  const el = document.getElementById('respawnOverlay');
  if (el) el.style.display = 'none';
}

// Local player went down — the server will send a 'respawn' event shortly.
function onDuelDeath() {
  state.playerDead = true;
  state.phase = 'dead';
  state.velocityY = 0;
  showRespawnOverlay(Math.ceil((state.duelRespawnMs || 3000) / 1000));
}

// Server respawned us — reset loadout and teleport to our home end (x/z come
// from the server so both sides agree on the position).
function onDuelRespawn(x, z) {
  state.playerDead = false;
  state.phase = 'playing';
  state.hp = 100;
  state.armor = 100;
  state.ammo = { m4: CONFIG.weapons.m4.magSize, pistol: CONFIG.weapons.pistol.magSize };
  state.reserveAmmo = { m4: 90, pistol: 45 };
  state.velocityY = 0;
  const sx = (typeof x === 'number') ? x : (state.mySpawn ? state.mySpawn.x : CONFIG.spawnPos.x);
  const sz = (typeof z === 'number') ? z : (state.mySpawn ? state.mySpawn.z : CONFIG.spawnPos.z);
  camera.position.set(sx, CONFIG.playerHeight, sz);
  if (CONFIG.newPhysics) physInit();
  hideRespawnOverlay();
  if (typeof updateHUD === 'function') updateHUD();
  updateDuelHUD();
}

function addKillFeed(text, good) {
  const el = _duelEl('killFeed',
    'position:fixed;top:52px;left:50%;transform:translateX(-50%);z-index:500;' +
    'font-family:monospace;font-size:18px;font-weight:700;text-shadow:0 2px 5px #000;' +
    'pointer-events:none;text-align:center;transition:opacity .4s;');
  el.style.color = good ? '#7CFC00' : '#ff7a7a';
  el.textContent = text;
  el.style.opacity = '1';
  clearTimeout(state._killFeedTO);
  state._killFeedTO = setTimeout(function() { el.style.opacity = '0'; }, 2200);
}

// A 'kill' event: update the scoreboard and show a brief feed line.
function applyKillEvent(evt) {
  if (CONFIG.mode !== 'duel') return;
  state.duelScore = state.duelScore || {};
  if (evt.shooterKills !== undefined) state.duelScore[evt.shooter] = evt.shooterKills;
  if (evt.victim !== undefined && evt.victimKills !== undefined) state.duelScore[evt.victim] = evt.victimKills;
  updateDuelHUD();
  if (evt.shooter === state.myId) {
    addKillFeed('✓ Round won', true);
    // Round reset teleports BOTH players — show the winner the same countdown
    // (skip if this kill just won the whole duel; showDuelOver handles that).
    if ((state.duelScore[evt.shooter] || 0) < (state.duelWinKills || 2)) {
      showRoundOverlay(Math.ceil((state.duelRespawnMs || 3000) / 1000), true);
    }
  }
  else if (evt.victim === state.myId) addKillFeed('✗ Round lost', false);
}

// A 'respawn' event: for us, reset+teleport; the opponent's visibility is driven
// by the per-tick snapshot dead flag, so just clear our cached death state.
function applyRespawnEvent(evt) {
  if (evt.id === state.myId) { onDuelRespawn(evt.x, evt.z); return; }
  const rp = (state.remotePlayers || {})[evt.id];
  if (rp) { rp.dead = false; rp.hp = evt.hp || 100; if (rp.mesh) rp.mesh.visible = true; }
}

function showDuelOver(msg) {
  const won = msg.winner === state.myId;
  hideRespawnOverlay();
  state.phase = 'gameover';
  if (document.pointerLockElement) document.exitPointerLock();
  const el = _duelEl('duelOver',
    'position:fixed;top:0;left:0;width:100%;height:100%;z-index:1000;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,0.88);font-family:monospace;');
  const my = (msg.scores && msg.scores[state.myId]) || 0;
  let opp = 0;
  for (const id in (msg.scores || {})) if (id !== state.myId) opp = Math.max(opp, msg.scores[id]);
  el.innerHTML =
    '<div style="color:' + (won ? '#ffd700' : '#ff5a5a') + ';font-size:72px;font-weight:900;' +
      'letter-spacing:8px;text-shadow:0 0 40px ' + (won ? '#ffd700' : '#900') + '">' +
      (won ? 'VICTORY' : 'DEFEAT') + '</div>' +
    '<div style="color:#fff;font-size:30px;margin-top:8px">' + my + ' — ' + opp + '</div>' +
    '<button id="duelAgainBtn" style="margin-top:34px;padding:14px 40px;font-family:monospace;' +
      'font-size:20px;font-weight:800;letter-spacing:2px;cursor:pointer;background:#ffd700;' +
      'color:#111;border:none;border-radius:6px">PLAY AGAIN</button>';
  el.style.display = 'flex';
  const btn = document.getElementById('duelAgainBtn');
  if (btn) btn.onclick = function() { location.href = location.pathname + '?requeue=1'; };
}

// ── Send binary input packet to server ──
// Format: [0x02][seq uint16][x,y,z,yaw,pitch float32][keys uint8] = 24 bytes
const _inputBuf = new ArrayBuffer(24);
const _inputDV  = new DataView(_inputBuf);
_inputDV.setUint8(0, 0x02);

function sendInputToServer() {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.myId) return;
  state.inputSeq = (state.inputSeq + 1) & 0xffff;
  _inputDV.setUint16(1,  state.inputSeq,       true);
  _inputDV.setFloat32(3, camera.position.x,    true);
  _inputDV.setFloat32(7, camera.position.y,    true);
  _inputDV.setFloat32(11, camera.position.z,   true);
  _inputDV.setFloat32(15, state.yaw   || 0,    true);
  _inputDV.setFloat32(19, state.pitch || 0,    true);
  const keys =
    (state.moveForward ? 1  : 0) |
    (state.moveBack    ? 2  : 0) |
    (state.moveLeft    ? 4  : 0) |
    (state.moveRight   ? 8  : 0) |
    (state.crouching   ? 16 : 0) |
    (state.currentWeapon === 'pistol' ? 32 : 0) |
    (performance.now() < (state.shootingUntil || 0) ? 64 : 0) |
    (state.reloading ? 128 : 0);
  _inputDV.setUint8(23, keys);
  state.ws.send(_inputBuf);
}

// 60Hz to match the server tick — at 20Hz two of every three snapshots just
// repeated stale positions. ~1.5KB/s up. Doubles as keepalive when backgrounded.
setInterval(sendInputToServer, 16);

// Stale connection watchdog — Render's proxy can silently drop WS connections
// without firing onclose. If no world snapshot arrives in 5s, force reconnect.
setInterval(() => {
  if (!state.myId) return;
  const age = Date.now() - (state.lastWorldAt || Date.now());
  if (age > 5000) {
    console.warn('[watchdog] No world snapshot for ' + (age/1000).toFixed(1) + 's — reconnecting');
    if (state.ws) state.ws.close();
    state.lastWorldAt = Date.now();
  }
}, 2000);

window.addEventListener('DOMContentLoaded', function() { setupChat(); });


// -- Auto-requeue: PLAY AGAIN reloads with ?requeue=1 so the player lands
// straight back in the PvP lobby instead of the main menu. Pointer lock may
// be rejected (no user gesture after a reload) -- clicking the canvas re-locks
// via the existing handler in 10_input.js.
if (new URLSearchParams(location.search).has('requeue')) {
  // Consume the flag immediately — strip it from the address bar so a manual
  // refresh returns to the main menu instead of re-triggering the auto-join.
  history.replaceState(null, '', location.pathname);
  window.addEventListener('load', function() {
    setTimeout(function() {
      try { window.startPvPMatch(); } catch (e) { console.error('requeue failed:', e); }
    }, 300);
  });
}
