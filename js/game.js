// Seeded RNG
var _seed = 123456;
function seededRand() {
  _seed ^= _seed << 13; _seed ^= _seed >> 17; _seed ^= _seed << 5;
  return ((_seed >>> 0) / 4294967296);
}

import * as THREE from 'three';

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

  moveSpeed: 11.97,         // 5% slower
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

  weapons: {
    m4: {
      name: 'M4', magSize: 30, fireRate: 100,
      bodyDmg: 15, headDmg: 150,
      recoilHip: 0.025, recoilAds: 0.012,
      reloadTime: 2200, spread: 0.015, adsSpread: 0.0,
      range: 500,
    },
    pistol: {
      name: '1911', magSize: 15, fireRate: 180,
      bodyDmg: 15, headDmg: 150,
      recoilHip: 0.035, recoilAds: 0.018,
      reloadTime: 1500, spread: 0.025, adsSpread: 0.0,
      range: 400,
    }
  }
};

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
  currentWeapon: 'm4',
  ammo: { m4: 0, pistol: 0 },
  reserveAmmo: { m4: 0, pistol: 0 },
  hp: 100, armor: 0,
  canFire: true, reloading: false, reloadPhase: null, switching: false, switchPhase: null,
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
  erupted: false,
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

// ── Clouds — wispy horizontal streaks ──
{
  // 512×96 canvas: elongated streak with feathery edges
  const cc = document.createElement('canvas');
  cc.width = 512; cc.height = 96;
  const cx = cc.getContext('2d');

  // Spread overlapping soft blobs horizontally to form one long wispy streak
  [
    [256, 48, 210, 52, 0.90],
    [130, 46, 140, 36, 0.72],
    [385, 50, 130, 34, 0.68],
    [ 60, 50,  80, 28, 0.45],
    [450, 46,  70, 26, 0.42],
    [200, 44,  90, 30, 0.55],
    [320, 52,  85, 28, 0.50],
  ].forEach(([bx, by, rx, ry, a]) => {
    // Simulate elliptical gradient by scaling context
    cx.save();
    cx.translate(bx, by);
    cx.scale(1, ry / rx);
    const g = cx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0,    `rgba(255,255,255,${a})`);
    g.addColorStop(0.38, `rgba(248,252,255,${(a * 0.55).toFixed(2)})`);
    g.addColorStop(0.70, `rgba(240,248,255,${(a * 0.18).toFixed(2)})`);
    g.addColorStop(1,    'rgba(255,255,255,0)');
    cx.fillStyle = g;
    cx.fillRect(-rx, -rx * (rx / ry), rx * 2, rx * 2 * (rx / ry));
    cx.restore();
  });

  // Bright horizontal centre line to add the crisp streak look
  const sl = cx.createLinearGradient(0, 0, 0, 96);
  sl.addColorStop(0,    'rgba(255,255,255,0)');
  sl.addColorStop(0.38, 'rgba(255,255,255,0.28)');
  sl.addColorStop(0.50, 'rgba(255,255,255,0.48)');
  sl.addColorStop(0.62, 'rgba(255,255,255,0.28)');
  sl.addColorStop(1,    'rgba(255,255,255,0)');
  cx.fillStyle = sl;
  cx.fillRect(55, 0, 400, 96);

  const cloudTex = new THREE.CanvasTexture(cc);
  const cloudMat = new THREE.MeshBasicMaterial({
    map: cloudTex, transparent: true, opacity: 0.88,
    depthWrite: false, side: THREE.DoubleSide, fog: false
  });

  // Wispy streak clouds — spread wider
  const STREAK_COUNT = 10;
  const strkInst = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1), cloudMat, STREAK_COUNT
  );
  strkInst.renderOrder = 1;
  const _cd = new THREE.Object3D();
  for (let i = 0; i < STREAK_COUNT; i++) {
    const angle  = seededRand() * Math.PI * 2;
    const radius = seededRand() * 200;         // stay over / near the island
    const cx2    = Math.cos(angle) * radius;
    const cz2    = Math.sin(angle) * radius;
    const cy2    = 220 + seededRand() * 80;    // high enough that long contrails never appear to dive into terrain
    const cw     = 200 + seededRand() * 300;    // long contrail-style streaks
    const ch     = 14  + seededRand() * 22;
    const yRot   = seededRand() * Math.PI;
    _cd.position.set(cx2, cy2, cz2);
    _cd.scale.set(cw, ch, 1);
    _cd.rotation.set(-Math.PI / 2, 0, yRot); // perfectly flat; Z-spin = compass direction in world XZ
    _cd.updateMatrix();
    strkInst.setMatrixAt(i, _cd.matrix);
  }
  strkInst.instanceMatrix.needsUpdate = true;
  scene.add(strkInst);

  // ── Round/puffy cumulus clouds — separate texture and mesh ──
  const rc = document.createElement('canvas');
  rc.width = rc.height = 256;
  const rx = rc.getContext('2d');
  [ [128,128,105], [80,110,72], [170,120,68], [95,148,60], [155,95,58], [128,80,50] ]
    .forEach(([bx, by, br]) => {
      const g = rx.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0,    'rgba(255,255,255,0.92)');
      g.addColorStop(0.40, 'rgba(245,250,255,0.58)');
      g.addColorStop(0.72, 'rgba(235,245,255,0.22)');
      g.addColorStop(1,    'rgba(255,255,255,0)');
      rx.fillStyle = g; rx.fillRect(0, 0, 256, 256);
    });
  const puffTex = new THREE.CanvasTexture(rc);
  const puffMat = new THREE.MeshBasicMaterial({
    map: puffTex, transparent: true, opacity: 0.80,
    depthWrite: false, side: THREE.DoubleSide, fog: false
  });

  const PUFF_COUNT = 10;
  const puffInst = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1), puffMat, PUFF_COUNT * 2
  );
  puffInst.renderOrder = 1;
  let pi = 0;
  for (let i = 0; i < PUFF_COUNT; i++) {
    const angle  = (i / PUFF_COUNT) * Math.PI * 2 + seededRand() * 0.5; // evenly spaced angles
    const radius = 40 + seededRand() * 580;
    const cx2    = Math.cos(angle) * radius;
    const cz2    = Math.sin(angle) * radius;
    const cy2    = 95 + seededRand() * 100;
    const cw     = (55 + seededRand() * 80) * 1.2;   // 20% larger
    const ch     = (40 + seededRand() * 55) * 1.2;
    const yRot   = seededRand() * Math.PI;
    for (const ao of [0, 1]) {
      _cd.position.set(cx2, cy2, cz2);
      _cd.scale.set(cw, ch, 1);
      _cd.rotation.set(0, yRot + ao * Math.PI * 0.5, 0);
      _cd.updateMatrix();
      puffInst.setMatrixAt(pi++, _cd.matrix);
    }
  }
  puffInst.instanceMatrix.needsUpdate = true;
  scene.add(puffInst);
}

// Sun
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(32, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xFFEE88, fog: false })
);
sunMesh.position.set(210, 367, -157);
sunMesh.renderOrder = 0;
scene.add(sunMesh);

const camera = new THREE.PerspectiveCamera(CONFIG.normalFov, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(CONFIG.prisonPos.x, CONFIG.playerHeight, CONFIG.prisonPos.z);
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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x1a4d8a, 1);
renderer.shadowMap.enabled = true;
renderer.autoClear = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.style.position = 'fixed';
renderer.domElement.style.inset = '0';
renderer.domElement.style.zIndex = '0';
document.body.appendChild(renderer.domElement);

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const collidables = [];
const targets = [];
const lootItems = [];
const bots = [];

// ═══════════════════════════════════════════════════════════
// LIGHTING
// ═══════════════════════════════════════════════════════════
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const sun = new THREE.DirectionalLight(0xfffbe8, 2.2);
sun.position.set(210, 367, -157);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 600;
sun.shadow.camera.left = -170; sun.shadow.camera.right = 170;
sun.shadow.camera.top = 170; sun.shadow.camera.bottom = -170;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x4488ff, 0x2d7a0a, 0.7));

// ═══════════════════════════════════════════════════════════
// TERRAIN
// ═══════════════════════════════════════════════════════════
const half = CONFIG.islandSize / 2;


// Used by jungle placement to keep trees out of the canal zone
const _CANAL_R = 85, _CANAL_W = 1.25;
function isInStream(x, z) {
  const w = _CANAL_W + 6; // extra buffer keeps trees/bushes clear of canal edges
  if (Math.abs(z + _CANAL_R) < w && Math.abs(x) <= _CANAL_R + w) return true; // North
  if (Math.abs(x - _CANAL_R) < w && Math.abs(z) <= _CANAL_R + w) return true; // East
  if (Math.abs(z - _CANAL_R) < w && Math.abs(x) <= _CANAL_R + w) return true; // South
  if (Math.abs(x + _CANAL_R) < w && Math.abs(z) <= _CANAL_R + w) return true; // West
  return false;
}
// Tight version — only excludes the actual water channel (for grass placement)
function isInCanalWater(x, z) {
  const w = _CANAL_W + 0.2;
  if (Math.abs(z + _CANAL_R) < w && Math.abs(x) <= _CANAL_R + w) return true;
  if (Math.abs(x - _CANAL_R) < w && Math.abs(z) <= _CANAL_R + w) return true;
  if (Math.abs(z - _CANAL_R) < w && Math.abs(x) <= _CANAL_R + w) return true;
  if (Math.abs(x + _CANAL_R) < w && Math.abs(z) <= _CANAL_R + w) return true;
  return false;
}

function getVolcanoHeight(x, z) {
  const dist = Math.sqrt(x * x + z * z);
  if (dist > CONFIG.volcanoRadius) return 0;
  const t = 1 - dist / CONFIG.volcanoRadius;
  const smooth = t * t * t * (t * (t * 6 - 15) + 10);
  let h = smooth * CONFIG.volcanoHeight;
  if (dist < CONFIG.volcanoRadius * 0.18) {
    const flatT = dist / (CONFIG.volcanoRadius * 0.18);
    h = CONFIG.volcanoHeight - (1 - flatT * flatT) * 1.2;
  }
  return Math.max(0, h);
}

function getTerrainHeight(x, z) {
  if (Math.abs(x) > half || Math.abs(z) > half) return -5;
  const vh = getVolcanoHeight(x, z);

  const raw = Math.sin(x * 0.15) * Math.cos(z * 0.15) * 0.3;

  // Flatten terrain within 10 units of each canal side so the canal walls
  // never float above or sink into a terrain ridge/valley.
  const R = _CANAL_R, buf = 10;
  const dS = (Math.abs(x) <= R + buf) ? Math.abs(z + R) : 999;
  const dN = (Math.abs(x) <= R + buf) ? Math.abs(z - R) : 999;
  const dE = (Math.abs(z) <= R + buf) ? Math.abs(x - R) : 999;
  const dW = (Math.abs(z) <= R + buf) ? Math.abs(x + R) : 999;
  const dist = Math.min(dS, dN, dE, dW);
  const flatRaw = dist >= buf ? raw : raw * (dist / buf) * (dist / buf) * (3 - 2 * (dist / buf));

  // Smoothly blend flat terrain into volcano over a 0→1.5 unit transition zone.
  // The old hard threshold (vh > 0.5 → return vh) caused a visible floor jump.
  if (vh <= 0)   return flatRaw;
  if (vh >= 1.5) return vh;
  const bt = vh / 1.5;
  const st = bt * bt * (3 - 2 * bt);   // smoothstep
  return flatRaw + (vh - flatRaw) * st;
}

// ═══════════════════════════════════════════════════════════
// BUILD GROUND MESH
// ═══════════════════════════════════════════════════════════
const groundSeg = 180;
const groundGeo = new THREE.PlaneGeometry(CONFIG.islandSize, CONFIG.islandSize, groundSeg, groundSeg);
const gPosAttr = groundGeo.attributes.position;

for (let i = 0; i < gPosAttr.count; i++) {
  const x = gPosAttr.getX(i);
  const y = gPosAttr.getY(i);
  gPosAttr.setZ(i, getTerrainHeight(x, y));
}
groundGeo.computeVertexNormals();

const groundColors = new Float32Array(gPosAttr.count * 3);
for (let i = 0; i < gPosAttr.count; i++) {
  const x = gPosAttr.getX(i);
  const y = gPosAttr.getY(i);
  const h = getTerrainHeight(x, y);
  let r, g, b;
  // Use distance from center to determine volcano zone (not height) — prevents green bleed at base
  const vDist = Math.sqrt(x * x + y * y);
  const onVolcano = vDist < CONFIG.volcanoRadius * 0.98 && getVolcanoHeight(x, y) > 0.2;
  if (onVolcano) {
    const t = Math.min(h / CONFIG.volcanoHeight, 1);
    // Diagonal flow streaks — angled noise simulates lava channels running down the slope
    const flow1 = Math.sin(x * 1.8 + y * 2.6 + h * 0.4) * 0.090 + Math.sin(x * 4.1 - y * 3.3) * 0.050;
    const flow2 = Math.cos(x * 2.9 - y * 1.7 + h * 0.3) * 0.075 + Math.cos(y * 5.8 + x * 1.2) * 0.040;
    // Mid-frequency surface roughness
    const rough = Math.sin(x * 9.4 + y * 7.1) * 0.022 + Math.cos(x * 14.2 - y * 11.8) * 0.014;
    // Subtle height strata (geological layering)
    const strata = Math.sin(h * 2.2) * 0.045 + Math.sin(h * 5.5) * 0.018;
    // Combined surface noise
    const surf = flow1 + flow2 + rough + strata;
    // Zone blends — sharper transitions for visible banding
    const rustBlend = Math.max(0, Math.min(1, (t - 0.20) / 0.25));
    const ashBlend  = Math.max(0, Math.min(1, (t - 0.58) / 0.22));
    const rimBlend  = Math.max(0, (t - 0.84) / 0.16);
    // Colors: very dark basalt base → rich rust/iron-oxide → cool gray ash → dark crater rim
    const basaltR = 0.10 + surf * 0.5;
    const basaltG = 0.07 + surf * 0.3;
    const basaltB = 0.06 + surf * 0.2;
    const rustR   = 0.15 + surf * 0.715;
    const rustG   = 0.085 + surf * 0.36;
    const rustB   = 0.026 + surf * 0.098;
    // Upper zone: dark volcanic red — deep crimson rock near the summit (35% darker)
    const ashR    = 0.34 + rough * 0.325 + strata * 0.52;
    const ashG    = 0.065 + rough * 0.13 + strata * 0.195;
    const ashB    = 0.039 + rough * 0.065 + strata * 0.13;
    // Crater rim: very dark red-black (35% darker)
    const rimR    = 0.18 + rough * 0.39;
    const rimG    = 0.039 + rough * 0.13;
    const rimB    = 0.026 + rough * 0.065;
    r = basaltR + (rustR - basaltR) * rustBlend + (ashR - rustR) * ashBlend + (rimR - ashR) * rimBlend;
    g = basaltG + (rustG - basaltG) * rustBlend + (ashG - rustG) * ashBlend + (rimG - ashG) * rimBlend;
    b = basaltB + (rustB - basaltB) * rustBlend + (ashB - rustB) * ashBlend + (rimB - ashB) * rimBlend;
    r = Math.max(0, Math.min(1, r));
    g = Math.max(0, Math.min(1, g));
    b = Math.max(0, Math.min(1, b));
  } else {
    // Multi-octave noise for rich micro-variation
    const n1 = Math.sin(x * 0.48 + 0.3) * Math.cos(y * 0.71 + 0.1) * 0.11;
    const n2 = Math.sin(x * 2.31 + y * 1.72) * 0.055;
    const n3 = Math.sin(x * 0.11 - 0.2) * Math.cos(y * 0.094 + 0.5) * 0.08;
    const n4 = Math.sin(x * 5.7 + y * 4.3) * 0.028;
    const n5 = Math.cos(x * 9.1 - y * 7.8) * 0.016;
    const n6 = Math.sin(x * 18.3 + y * 22.7) * 0.008; // fine detail
    const grass = n1 + n2 + n3 + n4 + n5 + n6;
    const warmth = Math.sin(x * 0.07 + y * 0.05) * 0.03;
    // Moisture map — damp dark green near canal, dry olive elsewhere
    const dS = Math.abs(y + _CANAL_R), dN = Math.abs(y - _CANAL_R);
    const dE = Math.abs(x - _CANAL_R), dW = Math.abs(x + _CANAL_R);
    const nearCanal = Math.max(0, 1 - Math.min(dS, dN, dE, dW) / 22);
    const moisture = nearCanal * 0.06;
    // Subtle dirt-path variation along diagonals
    const dirtPatch = Math.max(0, Math.sin(x * 0.22 + y * 0.19) * Math.cos(x * 0.15 - y * 0.28) - 0.55) * 0.18;
    const baseG = 0.28 + grass + moisture;
    r = Math.max(0, (0.07 + grass * 0.7 + warmth + seededRand() * 0.022 + dirtPatch * 1.1) * 0.60);
    g = Math.max(0, (baseG   + seededRand() * 0.038 - dirtPatch * 0.3) * 0.62);
    b = Math.max(0, (0.04 + grass * 0.35 - warmth * 0.6 + moisture * 0.4) * 0.60);
  }
  groundColors[i * 3] = r;
  groundColors[i * 3 + 1] = g;
  groundColors[i * 3 + 2] = b;
}
groundGeo.setAttribute('color', new THREE.BufferAttribute(groundColors, 3));

const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ── Raised canal — square corners, axis-aligned sides ──
{
  const CANAL_R    = 85;
  const canalH     = 0.847; // +10%
  const canalOuter = 1.25;
  const wallThick  = 0.29;
  const canalInner = canalOuter - wallThick;
  const _s = 2.5;

  const _waterMat = new THREE.MeshLambertMaterial({
    color: 0x1a8ed8, transparent: true, opacity: 0.84, side: THREE.DoubleSide,
  });

  // Brick texture for canal walls
  const _brickCanvas = document.createElement('canvas'); _brickCanvas.width = 256; _brickCanvas.height = 128;
  const _bctx = _brickCanvas.getContext('2d');
  _bctx.fillStyle = '#291a11'; _bctx.fillRect(0, 0, 256, 128);
  const bW = 64, bH = 28;
  for (let row = 0; row < 6; row++) {
    const offsetX = (row % 2) * bW * 0.5;
    for (let col = -1; col < 5; col++) {
      const bx = col * bW + offsetX, by = row * bH;
      const shade = 0.88 + Math.random() * 0.24;
      _bctx.fillStyle = `rgba(${Math.floor(50*shade)},${Math.floor(28*shade)},${Math.floor(16*shade)},1)`;
      _bctx.fillRect(bx + 2, by + 2, bW - 4, bH - 4);
      for (let gi = 0; gi < 5; gi++) {
        _bctx.fillStyle = `rgba(0,0,0,${0.04 + Math.random()*0.06})`;
        _bctx.fillRect(bx + 2 + Math.random()*(bW-8), by + 2 + Math.random()*(bH-6), bW*0.3, 1);
      }
    }
  }
  _bctx.fillStyle = 'rgba(18,11,8,0.92)';
  for (let row = 0; row <= 6; row++) { _bctx.fillRect(0, row * bH, 256, 2); }
  for (let row = 0; row < 6; row++) {
    const offsetX = (row % 2) * bW * 0.5;
    for (let col = -1; col < 5; col++) { _bctx.fillRect(col*bW+offsetX, row*bH, 2, bH); }
  }
  const _brickTex = new THREE.CanvasTexture(_brickCanvas);
  _brickTex.wrapS = _brickTex.wrapT = THREE.RepeatWrapping;

  const _wallMat = new THREE.MeshLambertMaterial({ map: _brickTex, side: THREE.DoubleSide });

  // addQuad with UV: uvArr receives UVs computed from quad horizontal/vertical spans
  const addQuad = (arr, uvArr, idx, x0,y0,z0, x1,y1,z1, x2,y2,z2, x3,y3,z3) => {
    const b = arr.length / 3;
    arr.push(x0,y0,z0, x1,y1,z1, x2,y2,z2, x3,y3,z3);
    if (uvArr) {
      const sc = 0.55;
      const dx=x1-x0,dz=z1-z0; const hL=Math.sqrt(dx*dx+dz*dz)*sc;
      const dx2=x2-x0,dy2=y2-y0,dz2=z2-z0; const vL=Math.sqrt(dx2*dx2+dy2*dy2+dz2*dz2)*sc;
      uvArr.push(0,0, hL,0, 0,vL, hL,vL);
    }
    idx.push(b, b+1, b+2, b+1, b+3, b+2);
  };

  function mkPts(x0,z0,x1,z1) {
    const dx=x1-x0, dz=z1-z0, dist=Math.sqrt(dx*dx+dz*dz);
    const n = Math.max(2, Math.ceil(dist/_s)+1);
    return Array.from({length:n},(_,i)=>({x:x0+dx*i/(n-1), z:z0+dz*i/(n-1)}));
  }

  function segNorm(seg) {
    const dx=seg[seg.length-1].x-seg[0].x, dz=seg[seg.length-1].z-seg[0].z;
    const l=Math.sqrt(dx*dx+dz*dz)||1;
    return {nx:-dz/l, nz:dx/l};
  }

  // Miter between two normals — bisects the joint and scales to keep wall width consistent
  function miter(n1, n2) {
    const mx=n1.nx+n2.nx, mz=n1.nz+n2.nz;
    const ml=Math.sqrt(mx*mx+mz*mz);
    if (ml<0.001) return n1;
    const dot=(mx/ml)*n1.nx+(mz/ml)*n1.nz;
    const s=Math.min(1/Math.max(dot,0.25),4);
    return {nx:(mx/ml)*s, nz:(mz/ml)*s};
  }

  const C=CANAL_R;
  const segments = [
    mkPts(-C,-C,  C,-C),
    mkPts( C,-C,  C, C),
    mkPts( C, C, -C, C),
    mkPts(-C, C, -C,-C),
  ];

  const NS = segments.length;
  const norms = segments.map(segNorm);
  // At each junction, use a miter that correctly bridges the two adjacent segments
  const startM = segments.map((_,i) => miter(norms[(i-1+NS)%NS], norms[i]));
  const endM   = segments.map((_,i) => miter(norms[i], norms[(i+1)%NS]));

  const allWaterV=[], allWaterI=[];

  for (let si=0; si<NS; si++) {
    const seg=segments[si], sn=norms[si];
    const wv=[], wuv=[], wi=[];

    for (let i=0; i<seg.length-1; i++) {
      const p=seg[i], q=seg[i+1];
      // Junction endpoints use miter; interior points use straight segment normal
      const mp = (i===0)            ? startM[si] : sn;
      const mq = (i===seg.length-2) ? endM[si]   : sn;
      const yB=-1.0, yT=canalH, fY=0.08;

      // Island-side wall (inner face of canal)
      addQuad(wv,wuv,wi, p.x+mp.nx*canalOuter,yB,p.z+mp.nz*canalOuter, q.x+mq.nx*canalOuter,yB,q.z+mq.nz*canalOuter,
                     p.x+mp.nx*canalOuter,yT,p.z+mp.nz*canalOuter, q.x+mq.nx*canalOuter,yT,q.z+mq.nz*canalOuter);
      addQuad(wv,wuv,wi, p.x+mp.nx*canalInner,yB,p.z+mp.nz*canalInner, q.x+mq.nx*canalInner,yB,q.z+mq.nz*canalInner,
                     p.x+mp.nx*canalInner,yT,p.z+mp.nz*canalInner, q.x+mq.nx*canalInner,yT,q.z+mq.nz*canalInner);
      addQuad(wv,wuv,wi, p.x+mp.nx*canalInner,yT,p.z+mp.nz*canalInner, q.x+mq.nx*canalInner,yT,q.z+mq.nz*canalInner,
                     p.x+mp.nx*canalOuter,yT,p.z+mp.nz*canalOuter, q.x+mq.nx*canalOuter,yT,q.z+mq.nz*canalOuter);

      // Exterior wall
      addQuad(wv,wuv,wi, p.x-mp.nx*canalOuter,yB,p.z-mp.nz*canalOuter, q.x-mq.nx*canalOuter,yB,q.z-mq.nz*canalOuter,
                     p.x-mp.nx*canalOuter,yT,p.z-mp.nz*canalOuter, q.x-mq.nx*canalOuter,yT,q.z-mq.nz*canalOuter);
      addQuad(wv,wuv,wi, p.x-mp.nx*canalInner,yB,p.z-mp.nz*canalInner, q.x-mq.nx*canalInner,yB,q.z-mq.nz*canalInner,
                     p.x-mp.nx*canalInner,yT,p.z-mp.nz*canalInner, q.x-mq.nx*canalInner,yT,q.z-mq.nz*canalInner);
      addQuad(wv,wuv,wi, p.x-mp.nx*canalInner,yT,p.z-mp.nz*canalInner, q.x-mq.nx*canalInner,yT,q.z-mq.nz*canalInner,
                     p.x-mp.nx*canalOuter,yT,p.z-mp.nz*canalOuter, q.x-mq.nx*canalOuter,yT,q.z-mq.nz*canalOuter);

      // Concrete floor
      addQuad(wv,wuv,wi, p.x-mp.nx*canalInner,fY,p.z-mp.nz*canalInner, q.x-mq.nx*canalInner,fY,q.z-mq.nz*canalInner,
                     p.x+mp.nx*canalInner,fY,p.z+mp.nz*canalInner, q.x+mq.nx*canalInner,fY,q.z+mq.nz*canalInner);

      // Water
      const ww=canalInner-0.05, yw=canalH*0.75;
      addQuad(allWaterV,null,allWaterI, p.x-mp.nx*ww,yw,p.z-mp.nz*ww, q.x-mq.nx*ww,yw,q.z-mq.nz*ww,
                                   p.x+mp.nx*ww,yw,p.z+mp.nz*ww, q.x+mq.nx*ww,yw,q.z+mq.nz*ww);
    }

    const g=new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wv),3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(wuv),2));
    g.setIndex(wi);
    g.computeVertexNormals();
    // Visual only — collision handled by axis-aligned strips below
    scene.add(new THREE.Mesh(g,_wallMat));
  }

  // Collision — two thin walls per side (inner + outer) with an open gap between.
  // Players walk up to the inner wall (must jump over, top at 0.77 > STEP_HEIGHT 0.45).
  // Once airborne and past the inner wall, they land in the gap where getTerrainHeight
  // returns -0.8, sinking to the canal floor. Outer wall prevents escaping off-island.
  const cHgt = 1.0 + canalH;            // original wall height
  const cY   = cHgt / 2 - 1.0;         // box top at canalH (0.77) above ground
  const cInn = C - canalOuter;          // 83.75 — inner face radius
  const cOut = C + canalOuter;          // 86.25 — outer face radius
  const wC   = 0.5;                     // collision wall thickness (wider than visual for safety)
  const iLen = cInn * 2;               // inner walls stop at adjacent canal zone — no corner overlap
  const oLen = cOut * 2 + wC;          // outer walls span full perimeter including corners
  [
    // South inner / outer
    [0,          -(cInn + wC/2), iLen,  wC  ],
    [0,          -(cOut - wC/2), oLen,  wC  ],
    // East inner / outer
    [cInn + wC/2,  0,            wC,   iLen ],
    [cOut - wC/2,  0,            wC,   oLen ],
    // North inner / outer
    [0,           cInn + wC/2,   iLen,  wC  ],
    [0,           cOut - wC/2,   oLen,  wC  ],
    // West inner / outer
    [-(cInn + wC/2), 0,          wC,   iLen ],
    [-(cOut - wC/2), 0,          wC,   oLen ],
  ].forEach(([x, z, w, d]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, cHgt, d), new THREE.MeshBasicMaterial());
    m.position.set(x, cY, z);
    m.visible = false;
    scene.add(m);
    collidables.push(m);
  });

  const waterGeo=new THREE.BufferGeometry();
  waterGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(allWaterV),3));
  waterGeo.setIndex(allWaterI);
  waterGeo.computeVertexNormals();
  window.streamWater=new THREE.Mesh(waterGeo,_waterMat);
  scene.add(window.streamWater);
}

// Crater marking
const crater = new THREE.Mesh(
  new THREE.CircleGeometry(8, 20),
  new THREE.MeshLambertMaterial({ color: 0x3a2a1a })
);
crater.rotation.x = -Math.PI / 2;
crater.position.set(0, CONFIG.volcanoHeight - 0.8, 0);
scene.add(crater);

// ── Instanced Smoke — 1 draw call for all volcano smoke puffs ──
const SMOKE_COUNT = 18;
const smokeGeo = new THREE.SphereGeometry(1, 7, 6); // unit sphere, scaled per instance
const smokeMat = new THREE.MeshBasicMaterial({ color: 0x6b4a28, transparent: true, opacity: 0.30 });
const smokeInst = new THREE.InstancedMesh(smokeGeo, smokeMat, SMOKE_COUNT);
smokeInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(smokeInst);

// Store per-instance smoke data (replaces smokeParticles array of meshes)
const smokeParticles = [];
const _smokeDummy = new THREE.Object3D();
for (let i = 0; i < SMOKE_COUNT; i++) {
  const size = 1.0 + seededRand() * 2.5;
  const baseY = CONFIG.volcanoHeight + 1 + seededRand() * 16;
  smokeParticles.push({
    baseY,
    phase: seededRand() * 6.28,
    speed: 0.4 + seededRand() * 0.8,
    size,
    ox: (seededRand() - 0.5) * 6,
    oz: (seededRand() - 0.5) * 6,
    index: i
  });
  // Set initial matrix so nothing is at origin on frame 0
  _smokeDummy.position.set((seededRand() - 0.5) * 6, baseY, (seededRand() - 0.5) * 6);
  _smokeDummy.scale.setScalar(size);
  _smokeDummy.updateMatrix();
  smokeInst.setMatrixAt(i, _smokeDummy.matrix);
}
smokeInst.instanceMatrix.needsUpdate = true;

// ═══════════════════════════════════════════════════════════
// WATER PLANE — Hidden until water starts rising
// ═══════════════════════════════════════════════════════════
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(CONFIG.islandSize + 60, CONFIG.islandSize + 60, 30, 30),
  new THREE.MeshLambertMaterial({ color: 0x0c4878, transparent: true, opacity: 0.6 })
);
water.rotation.x = -Math.PI / 2;
water.position.y = -5;
water.visible = false;
scene.add(water);

// ── Rising bubble particles along perimeter — single instanced mesh ──
const BUBBLE_COUNT = 40;
const bubbleMat  = new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.35 });
const bubbleInst = new THREE.InstancedMesh(
  new THREE.SphereGeometry(1, 5, 4),   // unit sphere — scaled per instance
  bubbleMat,
  BUBBLE_COUNT
);
bubbleInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
const _bubbleData = [];   // { bx, bz, baseY, speed, phase, size }
const _bubbleDummy = new THREE.Object3D();
let _bubbleCount = 0;
for (let i = 0; i < BUBBLE_COUNT; i++) {
  const angle = seededRand() * Math.PI * 2;
  const dist  = half - 4 - seededRand() * 12;
  const bx    = Math.cos(angle) * dist;
  const bz    = Math.sin(angle) * dist;
  if (Math.abs(bx - CONFIG.prisonPos.x) < CONFIG.prisonSize / 2 + 5 &&
      Math.abs(bz - CONFIG.prisonPos.z) < CONFIG.prisonSize / 2 + 5) {
    // Park off-screen so the slot doesn't flicker
    _bubbleDummy.position.set(0, -9999, 0); _bubbleDummy.scale.setScalar(0.01);
    _bubbleDummy.updateMatrix(); bubbleInst.setMatrixAt(i, _bubbleDummy.matrix);
    _bubbleData.push(null);
    continue;
  }
  const size  = 0.4 + seededRand() * 0.7;
  const baseY = -1 + seededRand() * 2;
  const speed = 0.4 + seededRand() * 0.8;
  const phase = seededRand() * 6.28;
  _bubbleData.push({ bx, bz, baseY, speed, phase, size, y: baseY });
  _bubbleDummy.position.set(bx, baseY, bz);
  _bubbleDummy.scale.setScalar(size);
  _bubbleDummy.updateMatrix();
  bubbleInst.setMatrixAt(i, _bubbleDummy.matrix);
  _bubbleCount++;
}
bubbleInst.instanceMatrix.needsUpdate = true;
// Expose for update loop
window._bubbleInst = bubbleInst;
window._bubbleData = _bubbleData;
window._bubbleDummy2 = _bubbleDummy;
scene.add(bubbleInst);

// ═══════════════════════════════════════════════════════════
// CLIFF WALLS — Single color, smooth height variation
// ═══════════════════════════════════════════════════════════
function createCliffSection(x, z, w, d, h) {
  const cliffH = h || CONFIG.cliffHeight;
  const extendedH = cliffH + 3;
  const segsW = Math.max(1, Math.round(w / 8));
  const segsH = 4;
  const segsD = Math.max(1, Math.round(d / 8));
  const geo = new THREE.BoxGeometry(w, extendedH, d, segsW, segsH, segsD);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i) + x;
    const vy = pos.getY(i) + (extendedH / 2 - 3);
    const t = (vy + 5) / (extendedH + 5);
    const band = Math.sin(vy * 1.8) * 0.06 + Math.sin(vy * 4.3) * 0.03;
    const nx = Math.sin(vx * 0.41 + z * 0.17) * 0.05 + Math.cos(vx * 1.2) * 0.03;
    const base = 0.36 + t * 0.12 + band + nx;
    colors[i*3]   = Math.min(1, base + 0.08);
    colors[i*3+1] = Math.min(1, base * 0.88);
    colors[i*3+2] = Math.min(1, base * 0.72);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, extendedH / 2 - 3, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  collidables.push(mesh);
  return mesh;
}

const ct = CONFIG.cliffThickness;
const segCount = 20;
const segLen = (CONFIG.islandSize + ct * 2) / segCount;
const wallLen = CONFIG.islandSize + ct * 2;
const avgH = CONFIG.cliffHeight + 4;

[
  { px: 0, pz: -half - ct/2, w: wallLen, d: ct },
  { px: 0, pz:  half + ct/2, w: wallLen, d: ct },
  { px:  half + ct/2, pz: 0, w: ct, d: wallLen },
  { px: -half - ct/2, pz: 0, w: ct, d: wallLen },
].forEach(({ px, pz, w, d }) => {
  const geo = new THREE.BoxGeometry(w, avgH, d, Math.max(1,Math.round(w/8)), 4, Math.max(1,Math.round(d/8)));
  const pos2 = geo.attributes.position;
  const cols2 = new Float32Array(pos2.count * 3);
  for (let i = 0; i < pos2.count; i++) {
    const vy = pos2.getY(i) + (avgH / 2 - 3);
    const vx = pos2.getX(i) + px;
    const depthT = Math.max(0, Math.min(1, (vy + 2) / avgH));
    const waveB  = Math.sin(vy * 2.1 + vx * 0.08) * 0.035 + Math.sin(vy * 5.3) * 0.015;
    const foamT  = Math.max(0, (depthT - 0.80) / 0.20);
    const oceanR = 0.01 + depthT * 0.09 + waveB * 0.5 + foamT * 0.72;
    const oceanG = 0.07 + depthT * 0.33 + waveB * 1.2 + foamT * 0.85;
    const oceanB = 0.20 + depthT * 0.46 + waveB       + foamT * 0.76;
    cols2[i*3]   = Math.min(1, oceanR);
    cols2[i*3+1] = Math.min(1, oceanG);
    cols2[i*3+2] = Math.min(1, oceanB);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols2, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
  mesh.position.set(px, avgH / 2 - 3, pz);
  scene.add(mesh);
  collidables.push(mesh);
});

// ── Ocean foam caps — cresting white wave tops on each perimeter wall ──
window._oceanFoam = [];
const foamMat = new THREE.MeshBasicMaterial({ color: 0xe8f8ff, transparent: true, opacity: 0.82 });
const foamY   = avgH - 3 + 0.38;
[
  { px: 0,            pz: -half - ct/2, w: wallLen + ct, d: ct + 0.5 },
  { px: 0,            pz:  half + ct/2, w: wallLen + ct, d: ct + 0.5 },
  { px:  half + ct/2, pz: 0,            w: ct + 0.5,     d: wallLen + ct },
  { px: -half - ct/2, pz: 0,            w: ct + 0.5,     d: wallLen + ct },
].forEach(({ px, pz, w, d }, i) => {
  const foam = new THREE.Mesh(new THREE.BoxGeometry(w, 0.55, d), foamMat);
  foam.position.set(px, foamY, pz);
  foam.userData.baseY = foamY;
  scene.add(foam);
  window._oceanFoam.push(foam);
});
// ═══════════════════════════════════════════════════════════
// PRISON COMPOUND — Taller walls
// ═══════════════════════════════════════════════════════════
const prison = { x: CONFIG.prisonPos.x, z: CONFIG.prisonPos.z, size: CONFIG.prisonSize };
const pw = prison.size;
const pwh = CONFIG.prisonWallHeight;
const pwt = 0.6;

// ── Prison stone texture — dark grey masonry blocks ──
{
  const _sc = document.createElement('canvas');
  _sc.width = _sc.height = 512;
  const _sx = _sc.getContext('2d');
  _sx.fillStyle = '#1c1b19';
  _sx.fillRect(0, 0, 512, 512);
  const _rowH = 27, _gap = 4;
  const _rows = Math.ceil(512 / (_rowH + _gap)) + 2;
  const _rng = (() => { let s = 42; return () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; }; })();
  for (let row = 0; row < _rows; row++) {
    const y = row * (_rowH + _gap);
    const shift = (row % 2) === 0 ? 0 : 55;
    let x = -shift;
    while (x < 560) {
      const bw = 52 + Math.floor(_rng() * 42);
      const s  = 60 + Math.floor((_rng() - 0.5) * 20);
      _sx.fillStyle = `rgb(${s},${s - 1},${s - 3})`;
      _sx.fillRect(x + 2, y + 2, bw - 3, _rowH - 2);
      _sx.fillStyle = 'rgba(255,255,255,0.05)';
      _sx.fillRect(x + 2, y + 2, bw - 3, 3);
      _sx.fillStyle = 'rgba(0,0,0,0.22)';
      _sx.fillRect(x + 2, y + _rowH - 5, bw - 3, 5);
      x += bw;
    }
  }
  window._prisonStoneTex = new THREE.CanvasTexture(_sc);
  window._prisonStoneTex.wrapS = window._prisonStoneTex.wrapT = THREE.RepeatWrapping;
  window._prisonStoneTex.repeat.set(3, 2);
}

// ── Prison materials — stone masonry ──
const prisonWallMat  = new THREE.MeshLambertMaterial({ color: 0xbbbbbb, map: window._prisonStoneTex });
const prisonWallDark = new THREE.MeshLambertMaterial({ color: 0x4e4e48 });
const prisonAccent   = new THREE.MeshLambertMaterial({ color: 0x52524a, map: window._prisonStoneTex });
const prisonMetal    = new THREE.MeshLambertMaterial({ color: 0x38383a });
const prisonRust     = new THREE.MeshLambertMaterial({ color: 0x6b4030 });
const prisonCap      = new THREE.MeshLambertMaterial({ color: 0x555550 });

// Invisible collider material — meshes using this are NOT added to the scene.
// updateMatrixWorld(true) is called after positioning so Box3.setFromObject()
// gets a correct world transform without issuing any draw calls.
const colliderMat = new THREE.MeshBasicMaterial({
  transparent: true, opacity: 0,
  depthWrite: false, colorWrite: false
});

function createPrisonWall(x, z, w, h, d) {
  // Main wall body — visual only
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), prisonWallMat);
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  targets.push(mesh);

  // Wall cap
  const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, 0.22, d + 0.05), prisonCap);
  cap.position.set(x, h + 0.11, z);
  cap.castShadow = true;
  scene.add(cap);

  // Horizontal concrete band at mid-height — protrudes 0.18 to avoid z-fighting
  const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.36, 0.18, d + 0.36), prisonWallDark);
  band.position.set(x, h * 0.45, z);
  scene.add(band);

  // Lower base strip
  const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.36, 0.35, d + 0.36), prisonAccent);
  base.position.set(x, 0.175, z);
  base.receiveShadow = true;
  scene.add(base);

  // Invisible collider — padded +0.5 on the thin axis to prevent clipping
  const cw = w < d ? w + 0.5 : w;
  const cd = d < w ? d + 0.5 : d;
  const collider = new THREE.Mesh(new THREE.BoxGeometry(cw, h, cd), colliderMat);
  collider.position.set(x, h / 2, z);
  collider.updateMatrixWorld(true);
  collidables.push(collider);

  return mesh;
}

// North wall (z-)
createPrisonWall(prison.x, prison.z - pw / 2, pw, pwh, pwt);
// South wall (z+)
createPrisonWall(prison.x, prison.z + pw / 2, pw, pwh, pwt);
// East wall (x+) — split with gate gap
const gateWidth = 6;
const eastWallLen = (pw - gateWidth) / 2;
createPrisonWall(prison.x + pw / 2, prison.z - pw / 2 + eastWallLen / 2, pwt, pwh, eastWallLen);
createPrisonWall(prison.x + pw / 2, prison.z + pw / 2 - eastWallLen / 2, pwt, pwh, eastWallLen);
// West wall
createPrisonWall(prison.x - pw / 2, prison.z, pwt, pwh, pw);

// Prison floor — stone-textured courtyard
{
  const floorTex = window._prisonStoneTex.clone();
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(pw / 1.8, pw / 1.8);
  floorTex.needsUpdate = true;
  const floorMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa, map: floorTex });
  // Slab extends deep underground so top is always at y=0.5 regardless of terrain variation
  const floor = new THREE.Mesh(new THREE.BoxGeometry(pw - pwt, 6, pw - pwt), floorMat);
  floor.position.set(prison.x, -2.5, prison.z);
  floor.receiveShadow = true;
  scene.add(floor);
  floor.updateMatrixWorld(true);
  collidables.push(floor);
}

// Ground height helper — wraps getTerrainHeight but raises to slab surface inside prison
const _prisonSlabTop = 0.5;
const _prisonInnerMinX = prison.x - pw / 2 + pwt;
const _prisonInnerMaxX = prison.x + pw / 2 - pwt;
const _prisonInnerMinZ = prison.z - pw / 2 + pwt;
const _prisonInnerMaxZ = prison.z + pw / 2 - pwt;
function getGroundHeight(x, z) {
  const th = getTerrainHeight(x, z);
  if (x > _prisonInnerMinX && x < _prisonInnerMaxX &&
      z > _prisonInnerMinZ && z < _prisonInnerMaxZ) {
    return Math.max(th, _prisonSlabTop);
  }
  return th;
}

// Vertical pilasters
{
  const pilasterMat = new THREE.MeshLambertMaterial({ color: 0xbbbbbb, map: window._prisonStoneTex });
  const wallDefs = [
    { axis: 'x', fixed: prison.z - pw/2, from: prison.x - pw/2, to: prison.x + pw/2, faceZ: true },
    { axis: 'x', fixed: prison.z + pw/2, from: prison.x - pw/2, to: prison.x + pw/2, faceZ: true },
    { axis: 'z', fixed: prison.x - pw/2, from: prison.z - pw/2, to: prison.z + pw/2, faceZ: false },
  ];
  wallDefs.forEach(({ axis, fixed, from, to, faceZ }) => {
    const count = 5;
    for (let i = 1; i < count; i++) {
      const t = i / count;
      const pos = from + (to - from) * t;
      const px = faceZ ? pos : fixed;
      const pz = faceZ ? fixed : pos;
      const pil = new THREE.Mesh(new THREE.BoxGeometry(faceZ ? 0.28 : pwt + 0.28, pwh, faceZ ? pwt + 0.28 : 0.28), pilasterMat);
      pil.position.set(px, pwh / 2, pz);
      pil.castShadow = true;
      scene.add(pil);
    }
  });
}

// Gate posts
for (const side of [-1, 1]) {
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, pwh + 2.2, 0.8), prisonAccent);
  post.position.set(prison.x + pw / 2, (pwh + 2.2) / 2, prison.z + side * (gateWidth / 2));
  post.castShadow = true;
  scene.add(post);
  const postCap = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 1.1), prisonMetal);
  postCap.position.set(prison.x + pw / 2, pwh + 2.2 + 0.12, prison.z + side * (gateWidth / 2));
  scene.add(postCap);
  const lightBox = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.4), new THREE.MeshLambertMaterial({ color: 0x888860, emissive: 0x444420, emissiveIntensity: 0.6 }));
  lightBox.position.set(prison.x + pw / 2 - 0.3, pwh + 1.6, prison.z + side * (gateWidth / 2));
  scene.add(lightBox);
}

// Gate sign
const signBeam = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, gateWidth + 1.8), prisonMetal);
signBeam.position.set(prison.x + pw / 2, pwh + 1.8, prison.z);
scene.add(signBeam);
const signFace = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.38, gateWidth + 1.4), new THREE.MeshLambertMaterial({ color: 0x1a1a1a, emissive: 0x0a0a08, emissiveIntensity: 0.3 }));
signFace.position.set(prison.x + pw / 2 - 0.2, pwh + 1.8, prison.z);
scene.add(signFace);

// Gate doors — dark oak with raised panels, rails, and stud rows
const gateHalfW = gateWidth / 2;
const oakMat    = new THREE.MeshLambertMaterial({ color: 0x1e0f05 }); // dark oak base
const oakFrame  = new THREE.MeshLambertMaterial({ color: 0x2c1a09 }); // slightly lighter frame
const oakPanel  = new THREE.MeshLambertMaterial({ color: 0x160c03 }); // recessed panel
const oakStud   = new THREE.MeshLambertMaterial({ color: 0x18120a }); // iron stud

const dt = pwt + 0.25;   // door thickness 0.85
const dw = gateHalfW;    // door width 3
const dh = pwh;           // door height 10
// dir: -1 = protrude toward -x (interior face), +1 = protrude toward +x (exterior face)
function buildDoorFace(door, faceX, dir) {
  const o = (n) => faceX + dir * n; // offset helper

  // ── Horizontal rails: top frieze, centre divider, bottom plinth ──
  const railDefs = [
    { cy: dh/2 - 0.52, rh: 0.95 },
    { cy: 0.0,           rh: 0.72 },
    { cy: -dh/2 + 0.55, rh: 1.05 },
  ];
  for (const { cy, rh } of railDefs) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.10, rh, dw - 0.02), oakPanel);
    rail.position.set(o(0.05), cy, 0);
    door.add(rail);
    const raise = new THREE.Mesh(new THREE.BoxGeometry(0.12, rh - 0.18, dw - 0.16), oakFrame);
    raise.position.set(o(0.06), cy, 0);
    door.add(raise);
    const studsZ = 7;
    for (let s = 0; s < studsZ; s++) {
      const sz = -dw/2 + 0.25 + s * ((dw - 0.5) / (studsZ - 1));
      const stud = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, 0.10), oakStud);
      stud.position.set(o(0.09), cy, sz);
      door.add(stud);
    }
  }

  // ── Vertical stiles ──
  for (const sz of [-1, 1]) {
    const stile = new THREE.Mesh(new THREE.BoxGeometry(0.10, dh, 0.22), oakPanel);
    stile.position.set(o(0.05), 0, sz * (dw/2 - 0.11));
    door.add(stile);
  }

  // ── Raised panels: upper + lower ──
  const panelDefs = [
    { cy:  2.1, ph: 3.5 },
    { cy: -2.3, ph: 3.3 },
  ];
  for (const { cy, ph } of panelDefs) {
    const pw2 = dw - 0.55;
    const bg = new THREE.Mesh(new THREE.BoxGeometry(0.07, ph, pw2), oakPanel);
    bg.position.set(o(0.035), cy, 0);
    door.add(bg);
    const field = new THREE.Mesh(new THREE.BoxGeometry(0.10, ph - 0.28, pw2 - 0.28), oakFrame);
    field.position.set(o(0.05), cy, 0);
    door.add(field);
    for (const [isH, len, oz, oy] of [
      [true,  pw2, 0,           ph/2 - 0.09],
      [true,  pw2, 0,          -ph/2 + 0.09],
      [false, ph,  pw2/2-0.09, 0            ],
      [false, ph, -pw2/2+0.09, 0            ],
    ]) {
      const mol = new THREE.Mesh(new THREE.BoxGeometry(0.12, isH ? 0.12 : len, isH ? len : 0.12), oakMat);
      mol.position.set(o(0.06), cy + oy, oz);
      door.add(mol);
    }
    const ps = 6;
    for (const oy of [ph/2 - 0.09, -ph/2 + 0.09]) {
      for (let s = 0; s < ps; s++) {
        const sz = -pw2/2 + 0.15 + s * ((pw2 - 0.3) / (ps - 1));
        const stud = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), oakStud);
        stud.position.set(o(0.10), cy + oy, sz);
        door.add(stud);
      }
    }
  }
}

const gateDoorL = new THREE.Mesh(new THREE.BoxGeometry(dt, dh, dw), oakMat);
const gatePivotL = new THREE.Group();
gatePivotL.position.set(prison.x + pw / 2, 0, prison.z - gateWidth / 2);
gateDoorL.position.set(0, dh / 2, dw / 2);
gatePivotL.add(gateDoorL);
scene.add(gatePivotL);
collidables.push(gateDoorL);
buildDoorFace(gateDoorL, -dt/2 - 0.01, -1); // interior face
buildDoorFace(gateDoorL, +dt/2 + 0.01, +1); // exterior face

const gateDoorR = new THREE.Mesh(new THREE.BoxGeometry(dt, dh, dw), oakMat);
const gatePivotR = new THREE.Group();
gatePivotR.position.set(prison.x + pw / 2, 0, prison.z + gateWidth / 2);
gateDoorR.position.set(0, dh / 2, -dw / 2);
gatePivotR.add(gateDoorR);
scene.add(gatePivotR);
collidables.push(gateDoorR);
buildDoorFace(gateDoorR, -dt/2 - 0.01, -1); // interior face
buildDoorFace(gateDoorR, +dt/2 + 0.01, +1); // exterior face
let gateOpenProgress = 0;

const towerH = pwh + 3.5;
const towerCorners = [
  { x: prison.x + pw / 2 - 1.5, z: prison.z - pw / 2 + 1.5, fX: -1, fZ:  1 },
  { x: prison.x - pw / 2 + 1.5, z: prison.z - pw / 2 + 1.5, fX:  1, fZ:  1 },
  { x: prison.x + pw / 2 - 1.5, z: prison.z + pw / 2 - 1.5, fX: -1, fZ: -1 },
  { x: prison.x - pw / 2 + 1.5, z: prison.z + pw / 2 - 1.5, fX:  1, fZ: -1 },
];

towerCorners.forEach(tc => {
  const fX = tc.fX, fZ = tc.fZ;

  const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, towerH, 3.4), prisonWallMat);
  base.position.set(tc.x, towerH / 2, tc.z);
  base.castShadow = true; base.receiveShadow = true;
  scene.add(base);

  // Invisible collider for tower
  const towerCollider = new THREE.Mesh(new THREE.BoxGeometry(3.9, towerH, 3.9), colliderMat);
  towerCollider.position.set(tc.x, towerH / 2, tc.z);
  towerCollider.updateMatrixWorld(true);
  collidables.push(towerCollider);

  for (const cx of [-1, 1]) for (const cz of [-1, 1]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.32, towerH, 0.32), prisonAccent);
    col.position.set(tc.x + cx * 1.55, towerH / 2, tc.z + cz * 1.55);
    col.castShadow = true;
    scene.add(col);
  }

  const midBand = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.2, 3.6), prisonWallDark);
  midBand.position.set(tc.x, towerH * 0.5, tc.z);
  scene.add(midBand);

  const platform = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.35, 5.2), prisonWallDark);
  platform.position.set(tc.x, towerH + 0.18, tc.z);
  platform.castShadow = true;
  scene.add(platform);

  for (const side of [-1, 1]) {
    const railX = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.5, 0.15), prisonMetal);
    railX.position.set(tc.x, towerH + 0.6, tc.z + side * 2.55);
    scene.add(railX);
    const railZ = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.5, 5.4), prisonMetal);
    railZ.position.set(tc.x + side * 2.55, towerH + 0.6, tc.z);
    scene.add(railZ);
  }

  const ghH = 2.4;
  const ghW = 4.8;
  const wt = 0.22;
  const ghY = towerH + 0.35 + ghH / 2;

  const backWall = new THREE.Mesh(new THREE.BoxGeometry(ghW, ghH, wt), prisonWallMat);
  backWall.position.set(tc.x, ghY, tc.z - fZ * (ghW / 2 - wt));
  scene.add(backWall);

  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.1, ghH, wt), prisonWallMat);
    pillar.position.set(tc.x + side * 1.85, ghY, tc.z + fZ * (ghW / 2 - wt));
    scene.add(pillar);
  }
  const header = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, wt), prisonWallDark);
  header.position.set(tc.x, towerH + 0.35 + ghH - 0.3, tc.z + fZ * (ghW / 2 - wt));
  scene.add(header);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, wt + 0.1), prisonWallDark);
  sill.position.set(tc.x, towerH + 0.35 + ghH * 0.35, tc.z + fZ * (ghW / 2 - wt));
  scene.add(sill);
  for (let wb = -1; wb <= 1; wb++) {
    const wbar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, ghH * 0.52, 5), prisonMetal);
    wbar.position.set(tc.x + wb * 0.65, towerH + 0.35 + ghH * 0.6, tc.z + fZ * (ghW / 2 - wt) + fZ * 0.05);
    scene.add(wbar);
  }

  for (const side of [-1, 1]) {
    const sideWall = new THREE.Mesh(new THREE.BoxGeometry(wt, ghH, ghW), prisonWallMat);
    sideWall.position.set(tc.x + side * (ghW / 2 - wt), ghY, tc.z);
    scene.add(sideWall);
    const swSill = new THREE.Mesh(new THREE.BoxGeometry(wt + 0.1, 0.15, 1.4), prisonWallDark);
    swSill.position.set(tc.x + side * (ghW / 2 - wt), towerH + 0.35 + ghH * 0.38, tc.z);
    scene.add(swSill);
  }

  const roof = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.28, 5.5), prisonCap);
  roof.position.set(tc.x, towerH + 0.35 + ghH + 0.14, tc.z);
  roof.castShadow = true;
  scene.add(roof);
  const roofLip = new THREE.Mesh(new THREE.BoxGeometry(5.7, 0.1, 5.7), prisonMetal);
  roofLip.position.set(tc.x, towerH + 0.35 + ghH + 0.0, tc.z);
  scene.add(roofLip);

  const lightBase = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.3, 8), prisonMetal);
  lightBase.position.set(tc.x, towerH + 0.35 + ghH + 0.43, tc.z);
  scene.add(lightBase);
  const lightDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0xddddaa, emissive: 0x888844, emissiveIntensity: 0.8 })
  );
  lightDome.position.set(tc.x, towerH + 0.35 + ghH + 0.58, tc.z);
  scene.add(lightDome);
});


// Flood lights
{
  const floodMat = new THREE.MeshLambertMaterial({ color: 0x999966, emissive: 0x555533, emissiveIntensity: 0.7 });
  const floodPositions = [
    { x: prison.x, z: prison.z - pw/2 - 0.1, ry: 0 },
    { x: prison.x, z: prison.z + pw/2 + 0.1, ry: Math.PI },
    { x: prison.x - pw/2 - 0.1, z: prison.z, ry: -Math.PI/2 },
  ];
  floodPositions.forEach(({ x, z, ry }) => {
    const flood = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.3), floodMat);
    flood.position.set(x, pwh * 0.75, z);
    flood.rotation.y = ry;
    scene.add(flood);
  });
}

// ═══════════════════════════════════════════════════════════
// PERIMETER BILLBOARDS — one per outer wall, highway-style
// `half` and `ct` are defined in 03_terrain.js (same global scope)
// ═══════════════════════════════════════════════════════════
{
  const WALL_TOP   = CONFIG.cliffHeight + 4 - 3;  // = 36 (top of outer cliff walls)
  const BB_W       = 30.75;  // face width (+25%)
  const BB_H       = 13.31;  // face height (+10%)
  const POLE_H     = 16.1;   // pole height above wall top
  const POLE_GAP   = 22.0;   // pole spacing (matched to wider board)

  const poleMat  = new THREE.MeshLambertMaterial({ color: 0x3a3830 });
  const beamMat  = new THREE.MeshLambertMaterial({ color: 0x2e2c28 });
  const sideMat  = new THREE.MeshLambertMaterial({ color: 0x4a4844 });  // back / sides

  // ── Billboard canvas helper ──
  function _drawBBCanvas(canvas, text, bgColor, fgColor, fontBase) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 1024, 512);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = fgColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = fontBase;
    ctx.font = `bold ${size}px "EB Garamond", Georgia, serif`;
    while (ctx.measureText(text).width > 921) {
      size -= 4;
      ctx.font = `bold ${size}px "EB Garamond", Georgia, serif`;
    }
    ctx.fillText(text, 512, 256);
  }

  const _adCanvas  = document.createElement('canvas'); _adCanvas.width  = 1024; _adCanvas.height = 512;
  const _depCanvas = document.createElement('canvas'); _depCanvas.width = 1024; _depCanvas.height = 512;
  _drawBBCanvas(_adCanvas,  'YOUR AD HERE', '#e8e4d8', '#1a1a1a', 130);
  _drawBBCanvas(_depCanvas, 'DEPORTED',     '#141008', '#e2c87e', 154);

  const _adTex  = new THREE.CanvasTexture(_adCanvas);
  const _depTex = new THREE.CanvasTexture(_depCanvas);
  const faceMat = new THREE.MeshLambertMaterial({ map: _adTex });
  const depMat  = new THREE.MeshLambertMaterial({ map: _depTex });

  // Redraw with EB Garamond once the web font is loaded
  document.fonts.load('bold 128px "EB Garamond"').then(() => {
    _drawBBCanvas(_adCanvas,  'YOUR AD HERE', '#e8e4d8', '#1a1a1a', 108);
    _drawBBCanvas(_depCanvas, 'DEPORTED',     '#141008', '#e2c87e', 128);
    _adTex.needsUpdate  = true;
    _depTex.needsUpdate = true;
  });

  function _spawnBillboard(bx, bz, ry, mat) {
    const g = new THREE.Group();
    g.position.set(bx, WALL_TOP, bz);
    g.rotation.y = ry;

    // Two steel poles (slightly tapered at base)
    for (const sx of [-1, 1]) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.27, 0.34, POLE_H, 8),
        poleMat
      );
      pole.position.set(sx * POLE_GAP / 2, POLE_H / 2, 0);
      g.add(pole);
    }

    // Horizontal cross-bars between the poles
    for (const frac of [0.3, 0.65]) {
      const xbar = new THREE.Mesh(
        new THREE.BoxGeometry(POLE_GAP - 0.4, 0.22, 0.22),
        beamMat
      );
      xbar.position.set(0, POLE_H * frac, 0);
      g.add(xbar);
    }

    // Top I-beam spanning the full board width
    const topBeam = new THREE.Mesh(
      new THREE.BoxGeometry(BB_W + 1, 0.42, 0.42),
      beamMat
    );
    topBeam.position.set(0, POLE_H + 0.21, 0);
    g.add(topBeam);

    // Billboard back panel
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(BB_W, BB_H, 0.22),
      sideMat
    );
    back.position.set(0, POLE_H + BB_H / 2 + 0.42, 0);
    g.add(back);

    // Billboard face (facing local +Z = inward toward map)
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(BB_W, BB_H, 0.10),
      mat || faceMat
    );
    face.position.set(0, POLE_H + BB_H / 2 + 0.42, 0.16);
    g.add(face);

    scene.add(g);
  }

  const wo = half + ct / 2;  // wall centre offset from map origin (= 131.5)
  _spawnBillboard(  0,  -wo,   0,            depMat  );  // North — DEPORTED
  _spawnBillboard(  0,   wo,   Math.PI,      faceMat );  // South — YOUR AD HERE
  _spawnBillboard(  wo,   0,  -Math.PI / 2,  depMat  );  // East  — DEPORTED
  _spawnBillboard( -wo,   0,   Math.PI / 2,  faceMat );  // West  — YOUR AD HERE
}

// ═══════════════════════════════════════════════════════════
// JUNGLE — Trees and Bushes
// ═══════════════════════════════════════════════════════════

// Depot temple exclusion — matches positions in 07_loot.js
const _depotClearR2 = 13 * 13; // reduced from 22 — grass grows up to shed edge
const _depotPos = [
  [half - 16,  half - 16],
  [half - 16, -(half - 16)],
  [-(half - 16), -(half - 16)],
];
function _nearDepot(x, z) {
  for (const [dx, dz] of _depotPos) {
    const ddx = x - dx, ddz = z - dz;
    if (ddx * ddx + ddz * ddz < _depotClearR2) return true;
  }
  return false;
}

// Stone cover wall positions — exclusion so nothing spawns inside them
const _wallPositions = [
  // Inner 15 — radius ~33–81
  [  28,   18], [ -32,  -22], [  48,  -38],
  [ -52,   42], [   4,   52], [   2,  -58],
  [  62,   12], [ -66,  -14], [  38,   62],
  [ -42,  -68], [ -60,   48], [  58,  -48],
  [  22,  -72], [ -26,   74], [  78,  -22],
  // Outer 10 — radius ~114, tight against the perimeter wall, every 36°
  [ 114,    0], [  92,   67], [  35,  108],
  [ -35,  108], [ -92,   67], [-114,    0],
  [ -92,  -67], [ -35, -108], [  35, -108],
  [  92,  -67],
];
const _wallClearR2 = 3.5 * 3.5;
function _nearWall(x, z) {
  for (const [wx, wz] of _wallPositions) {
    const dx = x - wx, dz = z - wz;
    if (dx * dx + dz * dz < _wallClearR2) return true;
  }
  return false;
}

function canPlaceAt(x, z) {
  if (getVolcanoHeight(x, z) > 1) return false;
  if (Math.abs(x - prison.x) < pw / 2 + 10 && Math.abs(z - prison.z) < pw / 2 + 10) return false;
  if (Math.abs(x) > half - 12 || Math.abs(z) > half - 12) return false;
  if (isInStream(x, z)) return false;
  if (_nearDepot(x, z)) return false;
  if (_nearWall(x, z)) return false;
  return true;
}
// Looser version for ground cover — allows placement right up to the wall base
function canPlaceGround(x, z) {
  if (getVolcanoHeight(x, z) > 1) return false;
  if (Math.abs(x - prison.x) < pw / 2 + 3 && Math.abs(z - prison.z) < pw / 2 + 3) return false;
  if (Math.abs(x) > half - 2 || Math.abs(z) > half - 2) return false;
  if (isInCanalWater(x, z)) return false;
  if (_nearDepot(x, z)) return false;
  if (_nearWall(x, z)) return false;
  return true;
}

// Proximity guard — populated as objects are placed, checked by each new object
const _placedObjList = [];
function _tooClose(x, z, r) {
  for (const p of _placedObjList) {
    const dx = x - p.x, dz = z - p.z;
    if (dx*dx + dz*dz < (r + p.r) * (r + p.r)) return true;
  }
  return false;
}

// Shared invisible collider material — meshes using this are NOT added to the scene.
// Instead, updateMatrixWorld(true) is called after positioning so that Box3.setFromObject()
// and Raycaster both get a correct world transform without issuing any draw calls.
const invisibleColliderMat = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
  colorWrite: false
});

// ── Procedural textures — created once, shared across all instances ──
function _makeBarkTex() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const ctx = c.getContext('2d');
  // Warm mid-brown base
  ctx.fillStyle = '#7a3e18'; ctx.fillRect(0, 0, 128, 256);
  // Dark vertical streaks (main bark character)
  for (let i = 0; i < 14; i++) {
    const sx = Math.random() * 128;
    const sw = 1.2 + Math.random() * 5.5;
    const g = ctx.createLinearGradient(sx - sw, 0, sx + sw, 0);
    g.addColorStop(0, 'rgba(16,5,1,0)');
    g.addColorStop(0.5, `rgba(16,5,1,${0.55 + Math.random() * 0.35})`);
    g.addColorStop(1, 'rgba(16,5,1,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 256);
  }
  // Light highlight streaks between dark ones
  for (let i = 0; i < 6; i++) {
    const sx = Math.random() * 128;
    const g = ctx.createLinearGradient(sx - 2, 0, sx + 2, 0);
    g.addColorStop(0, 'rgba(200,110,45,0)');
    g.addColorStop(0.5, `rgba(200,110,45,${0.18 + Math.random() * 0.18})`);
    g.addColorStop(1, 'rgba(200,110,45,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 256);
  }
  // Horizontal grain/crack lines
  let y = 0;
  while (y < 256) {
    y += 5 + Math.random() * 18;
    ctx.strokeStyle = `rgba(12,4,0,${0.08 + Math.random() * 0.22})`;
    ctx.lineWidth = Math.random() < 0.4 ? 1.2 : 0.6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(40, y + (Math.random()-0.5)*4, 88, y + (Math.random()-0.5)*4, 128, y + (Math.random()-0.5)*3);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 4);
  return t;
}

function _makeLeafTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  // Vibrant mid-green base — bright enough to survive instance color multiplication
  ctx.fillStyle = '#4a9a20'; ctx.fillRect(0, 0, 256, 256);
  // Soft shadow blobs — subtle depth, not heavy spots
  for (let i = 0; i < 38; i++) {
    const lx = Math.random() * 256, ly = Math.random() * 256;
    const lr = 8 + Math.random() * 24;
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
    g.addColorStop(0, `rgba(4,18,1,${0.28 + Math.random() * 0.18})`);
    g.addColorStop(0.5, `rgba(4,18,1,${0.10 + Math.random() * 0.10})`);
    g.addColorStop(1, 'rgba(4,18,1,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(lx, ly, lr, 0, 6.28); ctx.fill();
  }
  // Gentle sun-dapple highlights
  for (let i = 0; i < 20; i++) {
    const lx = Math.random() * 256, ly = Math.random() * 256;
    const lr = 5 + Math.random() * 16;
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
    g.addColorStop(0, `rgba(110,230,40,${0.18 + Math.random() * 0.14})`);
    g.addColorStop(1, 'rgba(110,230,40,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(lx, ly, lr, 0, 6.28); ctx.fill();
  }
  // Fine noise — individual leaf edges
  for (let i = 0; i < 140; i++) {
    const nx = Math.random() * 256, ny = Math.random() * 256;
    ctx.fillStyle = Math.random() < 0.55
      ? `rgba(5,20,2,${0.12 + Math.random()*0.16})`
      : `rgba(85,200,28,${0.08 + Math.random()*0.12})`;
    ctx.fillRect(nx, ny, 1 + Math.random() * 2.5, 1 + Math.random() * 2.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  return t;
}

function _makeArborvitaeTex() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const ctx = c.getContext('2d');
  // Medium green base — bright enough to show texture after instance color ×0.7-1.0
  ctx.fillStyle = '#3a9018'; ctx.fillRect(0, 0, 128, 256);
  // Subtle horizontal branch layers — hint of depth, not obvious stripes
  let by = 0;
  while (by < 256) {
    const bh = 10 + Math.random() * 9;
    // Soft light at top
    ctx.fillStyle = `rgba(85,200,35,${0.14 + Math.random() * 0.10})`;
    ctx.fillRect(0, by, 128, bh * 0.35);
    // Soft shadow below
    ctx.fillStyle = `rgba(5,22,2,${0.18 + Math.random() * 0.12})`;
    ctx.fillRect(0, by + bh * 0.35, 128, bh * 0.65);
    by += bh;
  }
  // Arc scales — light suggestion of needles
  for (let i = 0; i < 55; i++) {
    const ax = Math.random() * 128, ay = Math.random() * 256;
    const ar = 3 + Math.random() * 6;
    ctx.strokeStyle = `rgba(3,14,1,${0.18 + Math.random() * 0.18})`;
    ctx.lineWidth = 0.6 + Math.random() * 0.8;
    ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI); ctx.stroke();
  }
  // Light needle tips
  for (let i = 0; i < 40; i++) {
    const ax = Math.random() * 128, ay = Math.random() * 256;
    ctx.fillStyle = `rgba(100,220,45,${0.14 + Math.random() * 0.14})`;
    ctx.fillRect(ax, ay, 1.2, 2 + Math.random() * 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 5);
  return t;
}

function _makeCrateTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3a1a08'; ctx.fillRect(0, 0, 256, 256);
  for (let p = 0; p < 4; p++) {
    const px = p * 64;
    ctx.fillStyle = p % 2 === 0 ? 'rgba(220,130,60,0.07)' : 'rgba(0,0,0,0.09)';
    ctx.fillRect(px + 2, 0, 60, 256);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(px, 0, 2, 256);
  }
  for (let i = 0; i < 35; i++) {
    const y = Math.random() * 256;
    ctx.strokeStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.09})`;
    ctx.lineWidth = 0.5 + Math.random() * 0.6;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y + (Math.random()-0.5)*5); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(12,5,1,0.82)'; ctx.lineWidth = 13; ctx.lineCap = 'square';
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(256,256); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(256,0); ctx.lineTo(0,256); ctx.stroke();
  ctx.strokeStyle = 'rgba(180,100,40,0.20)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(256,256); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(256,0); ctx.lineTo(0,256); ctx.stroke();
  ctx.strokeStyle = 'rgba(10,4,1,0.88)'; ctx.lineWidth = 18; ctx.lineCap = 'square';
  ctx.strokeRect(9, 9, 238, 238);
  ctx.strokeStyle = 'rgba(160,90,35,0.22)'; ctx.lineWidth = 6;
  ctx.strokeRect(9, 9, 238, 238);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

const _barkTex      = _makeBarkTex();
const _leafTex      = _makeLeafTex();
const _arborTex     = _makeArborvitaeTex();
const _crateTex     = _makeCrateTex();

// ── Willow + Palm Trees — 5 draw calls, improved geometry ──
// Willow: trunk + dense layered canopy/droops (2 calls)
// Palm:   trunk + 12 outer + 6 inner fronds in one geo (2 calls)
// + 1 for ferns below
{
  const treePlacements = [];
  const treeGridSize = 18;
  for (let gx = -half + 15; gx < half - 15; gx += treeGridSize) {
    for (let gz = -half + 15; gz < half - 15; gz += treeGridSize) {
      const x = gx + (seededRand() - 0.5) * treeGridSize * 0.7;
      const z = gz + (seededRand() - 0.5) * treeGridSize * 0.7;
      if (canPlaceAt(x, z) && !_tooClose(x, z, 2.5)) { treePlacements.push({ x, z }); _placedObjList.push({ x, z, r: 2.5 }); }
    }
  }
  const oakPlaces = [], palmPlaces = [];
  treePlacements.forEach(p => (seededRand() < 0.5 ? oakPlaces : palmPlaces).push(p));

  const _tDummy = new THREE.Object3D();
  const _tCol   = new THREE.Color();

  // ── 3 overlapping textured spheres per tree — organic silhouette from all angles ──
  // Green palette — darker, more varied
  const _oakGreenPalette = [
    [0.55, 0.65, 0.40],  // natural muted
    [0.48, 0.62, 0.32],  // fresh mid
    [0.38, 0.54, 0.24],  // forest dark
    [0.60, 0.58, 0.36],  // warm yellow-green
    [0.32, 0.50, 0.20],  // deep dark
    [0.50, 0.60, 0.34],  // cool mid
    [0.42, 0.58, 0.28],  // muted forest
    [0.58, 0.66, 0.38],  // olive green
  ];

  // Clone leaf texture for each sphere layer with different UV repeat — breaks up visible tiling
  const _leafTexB = _leafTex.clone(); _leafTexB.repeat.set(1.4, 1.8); _leafTexB.needsUpdate = true;
  const _leafTexC = _leafTex.clone(); _leafTexC.repeat.set(2.8, 2.3); _leafTexC.needsUpdate = true;

  const canopyMatA = new THREE.MeshLambertMaterial({ map: _leafTex });
  const canopyMatB = new THREE.MeshLambertMaterial({ map: _leafTexB });
  const canopyMatC = new THREE.MeshLambertMaterial({ map: _leafTexC });

  const oakTrunkInst   = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.50, 1, 9), new THREE.MeshLambertMaterial({map:_barkTex}), oakPlaces.length);
  const oakCanopyInst  = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), canopyMatA, oakPlaces.length);
  const oakCanopy2Inst = new THREE.InstancedMesh(new THREE.SphereGeometry(1,  9, 7), canopyMatB, oakPlaces.length);
  const oakCanopy3Inst = new THREE.InstancedMesh(new THREE.SphereGeometry(1,  8, 6), canopyMatC, oakPlaces.length);
  oakTrunkInst.castShadow = true;
  oakCanopyInst.castShadow = true; oakCanopy2Inst.castShadow = false; oakCanopy3Inst.castShadow = false;

  oakPlaces.forEach(({ x, z }, i) => {
    const h = getTerrainHeight(x, z);
    const canopyR = 3.0 + seededRand() * 6.5;
    // Ensure trunk is tall enough that the sphere bottom stays above player eye height (1.7)
    const trunkH = Math.max(2.0 + seededRand() * 8.0, canopyR + 1.0);
    const trunkR = 0.28 + seededRand() * 0.36;
    // Per-tree offset directions for secondary spheres — smaller offset so spheres overlap more
    const offAngle = seededRand() * 6.28;
    const offDist  = canopyR * 0.22;
    const ox = Math.sin(offAngle) * offDist, oz = Math.cos(offAngle) * offDist;
    const baseY = h + trunkH + canopyR * 0.55;

    _tDummy.position.set(x, h + trunkH / 2, z);
    _tDummy.scale.set(trunkR / 0.33, trunkH, trunkR / 0.33);
    _tDummy.rotation.set(0, seededRand() * 6.28, 0);
    _tDummy.updateMatrix(); oakTrunkInst.setMatrixAt(i, _tDummy.matrix);

    // Main sphere — centred on canopy
    _tDummy.position.set(x, baseY, z);
    _tDummy.scale.set(canopyR, canopyR * 0.88, canopyR);
    _tDummy.rotation.set(0, seededRand() * 6.28, 0);
    _tDummy.updateMatrix(); oakCanopyInst.setMatrixAt(i, _tDummy.matrix);

    // Secondary — slightly offset, sunk deep into main so seam disappears
    _tDummy.position.set(x + ox, baseY + canopyR * 0.30, z + oz);
    _tDummy.scale.set(canopyR * 0.76, canopyR * 0.72, canopyR * 0.76);
    _tDummy.rotation.set(0, seededRand() * 6.28, 0);
    _tDummy.updateMatrix(); oakCanopy2Inst.setMatrixAt(i, _tDummy.matrix);

    // Tertiary — opposite side, sunk into main body, lower bulge
    _tDummy.position.set(x - ox * 0.9, baseY - canopyR * 0.18, z - oz * 0.9);
    _tDummy.scale.set(canopyR * 0.70, canopyR * 0.62, canopyR * 0.70);
    _tDummy.rotation.set(0, seededRand() * 6.28, 0);
    _tDummy.updateMatrix(); oakCanopy3Inst.setMatrixAt(i, _tDummy.matrix);

    const hv = Math.sin(x*127.3+z*311.7)*0.5+0.5;
    _tCol.setRGB(0.50+hv*0.24, 0.38+hv*0.20, 0.24+hv*0.14); oakTrunkInst.setColorAt(i, _tCol);
    const gp = _oakGreenPalette[Math.floor((Math.sin(x*53.7+z*89.3)*0.5+0.5) * _oakGreenPalette.length) % _oakGreenPalette.length];
    _tCol.setRGB(gp[0], gp[1], gp[2]);
    oakCanopyInst.setColorAt(i, _tCol); oakCanopy2Inst.setColorAt(i, _tCol); oakCanopy3Inst.setColorAt(i, _tCol);

    const trunkCol = new THREE.Mesh(new THREE.BoxGeometry(trunkR*2.2, trunkH, trunkR*2.2), invisibleColliderMat);
    trunkCol.position.set(x, h+trunkH/2, z); trunkCol.updateMatrixWorld(true); collidables.push(trunkCol);
    const trunkHit = new THREE.Mesh(new THREE.BoxGeometry(trunkR*1.8, trunkH, trunkR*1.8), invisibleColliderMat);
    trunkHit.position.set(x, h+trunkH/2, z); trunkHit.updateMatrixWorld(true); targets.push(trunkHit);
    const canopyHit = new THREE.Mesh(new THREE.BoxGeometry(canopyR*2.0, canopyR*1.0, canopyR*2.0), invisibleColliderMat);
    canopyHit.position.set(x, baseY, z); canopyHit.updateMatrixWorld(true);
    targets.push(canopyHit); collidables.push(canopyHit);
  });

  // ── Palm frond geometry: 7 outer fronds + 3 small upright top fronds ──
  const palmFrondGeo = (() => {
    const pos = [], col = [], idx = [];
    // 7 main outer fronds — arch out and droop
    const frondS = [[0,0,0.04],[0.35,0.45,0.20],[0.75,0.40,0.12],[1.00,-0.05,0.03]];
    for (let i = 0; i < 7; i++) {
      const ba=i/7*Math.PI*2, sa=Math.sin(ba), ca=Math.cos(ba), pa=Math.cos(ba), pca=-Math.sin(ba);
      const base=pos.length/3;
      frondS.forEach(([d,h,hw],si) => {
        const t=si/(frondS.length-1);
        pos.push(sa*d-pa*hw,h,ca*d+pca*hw, sa*d+pa*hw,h,ca*d-pca*hw);
        const r=0.08+t*0.22, g=0.32+t*0.44, b=0.04+t*0.10;
        col.push(r,g,b, r,g,b);
      });
      for (let s=0;s<frondS.length-1;s++){const b=base+s*2;idx.push(b,b+1,b+2,b+1,b+3,b+2);}
    }
    // 3 small upright top fronds — short, nearly vertical, break up flat top
    const topS = [[0,0.025,0.038],[0.15,0.40,0.088],[0.275,0.725,0.050],[0.35,0.90,0.025]];
    for (let i = 0; i < 3; i++) {
      const ba=(i/3*Math.PI*2)+Math.PI/6, sa=Math.sin(ba), ca=Math.cos(ba), pa=Math.cos(ba), pca=-Math.sin(ba);
      const base=pos.length/3;
      topS.forEach(([d,h,hw],si) => {
        const t=si/(topS.length-1);
        pos.push(sa*d-pa*hw,h,ca*d+pca*hw, sa*d+pa*hw,h,ca*d-pca*hw);
        const r=0.10+t*0.18, g=0.38+t*0.38, b=0.05+t*0.09;
        col.push(r,g,b, r,g,b);
      });
      for (let s=0;s<topS.length-1;s++){const b=base+s*2;idx.push(b,b+1,b+2,b+1,b+3,b+2);}
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(col), 3));
    g.setIndex(idx); g.computeVertexNormals(); return g;
  })();

  const palmTrunkInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13,0.30,1,8), new THREE.MeshLambertMaterial({map:_barkTex}), palmPlaces.length);
  const palmFrondInst = new THREE.InstancedMesh(palmFrondGeo, new THREE.MeshLambertMaterial({vertexColors:true, side:THREE.DoubleSide}), palmPlaces.length);
  palmTrunkInst.castShadow = true; palmFrondInst.castShadow = true;

  palmPlaces.forEach(({ x, z }, i) => {
    const h = getTerrainHeight(x, z);
    const trunkH = 7.5 + seededRand() * 5.5;
    const trunkR = 0.24 + seededRand() * 0.16;
    const frondR = 4.5 + seededRand() * 2.8;
    const lean   = (seededRand()-0.5) * 0.12;
    _tDummy.position.set(x, h+trunkH/2, z);
    _tDummy.scale.set(trunkR/0.215, trunkH, trunkR/0.215);
    _tDummy.rotation.set(lean, seededRand()*6.28, lean*0.5);
    _tDummy.updateMatrix(); palmTrunkInst.setMatrixAt(i, _tDummy.matrix);
    _tDummy.position.set(x+Math.sin(lean)*trunkH*0.3, h+trunkH, z);
    _tDummy.scale.set(frondR, frondR*0.55, frondR);
    _tDummy.rotation.set(0, seededRand()*6.28, 0);
    _tDummy.updateMatrix(); palmFrondInst.setMatrixAt(i, _tDummy.matrix);
    const hv = Math.sin(x*89.1+z*203.4)*0.5+0.5;
    _tCol.setRGB(0.48+hv*0.26, 0.40+hv*0.20, 0.28+hv*0.16); palmTrunkInst.setColorAt(i, _tCol);
    _tCol.setRGB(0.68+hv*0.20, 0.80+hv*0.14, 0.50+hv*0.18); palmFrondInst.setColorAt(i, _tCol);
    const trunkCol = new THREE.Mesh(new THREE.BoxGeometry(trunkR*2.9,trunkH,trunkR*2.9), invisibleColliderMat);
    trunkCol.position.set(x, h+trunkH/2, z); trunkCol.updateMatrixWorld(true); collidables.push(trunkCol);
    const trunkHit = new THREE.Mesh(new THREE.BoxGeometry(trunkR*2.5,trunkH,trunkR*2.5), invisibleColliderMat);
    trunkHit.position.set(x, h+trunkH/2, z); trunkHit.updateMatrixWorld(true); targets.push(trunkHit);
    const frondHit = new THREE.Mesh(new THREE.BoxGeometry(frondR*1.1,frondR*0.45,frondR*1.1), invisibleColliderMat);
    frondHit.position.set(x, h+trunkH+frondR*0.1, z); frondHit.updateMatrixWorld(true);
    targets.push(frondHit); collidables.push(frondHit);
  });

  [oakTrunkInst,oakCanopyInst,oakCanopy2Inst,oakCanopy3Inst,palmTrunkInst,palmFrondInst].forEach(m => {
    m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; scene.add(m);
  });
}

// ── Instanced Ferns (replaces bushes) — 1 draw call ──
{
  const fernPlacements = [];
  const fernGrid = 10;
  for (let gx = -half+20; gx < half-20; gx += fernGrid) {
    for (let gz = -half+20; gz < half-20; gz += fernGrid) {
      const x = gx + (seededRand()-0.5)*fernGrid*0.8 + fernGrid/2;
      const z = gz + (seededRand()-0.5)*fernGrid*0.8 + fernGrid/2;
      if (canPlaceAt(x, z)) fernPlacements.push({ x, z });
    }
  }
  // 7-frond fern: each frond arches up then droops at tip
  const fernGeo = (() => {
    const pos = [], col = [], idx = [];
    for (let i = 0; i < 7; i++) {
      const ba = i / 7 * Math.PI * 2;
      const sa = Math.sin(ba), ca = Math.cos(ba);
      const pa = Math.cos(ba), pca = -Math.sin(ba);
      const segs = [ [0.02,0.02,0.05], [0.35,0.30,0.22], [0.70,0.38,0.15], [1.00,0.14,0.04] ];
      const base = pos.length / 3;
      segs.forEach(([d, h, hw], si) => {
        const t = si / (segs.length - 1);
        pos.push(sa*d-pa*hw, h, ca*d+pca*hw,  sa*d+pa*hw, h, ca*d-pca*hw);
        col.push(0.08+t*0.18, 0.35+t*0.32, 0.03+t*0.12,
                 0.08+t*0.18, 0.35+t*0.32, 0.03+t*0.12);
      });
      for (let s = 0; s < segs.length-1; s++) {
        const b = base + s*2; idx.push(b,b+1,b+2, b+1,b+3,b+2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(col), 3));
    g.setIndex(idx); g.computeVertexNormals(); return g;
  })();

  const fernMat  = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const fernInst = new THREE.InstancedMesh(fernGeo, fernMat, fernPlacements.length);
  fernInst.castShadow = false;
  const _fDummy = new THREE.Object3D(), _fCol = new THREE.Color();
  fernPlacements.forEach(({ x, z }, i) => {
    const h = getTerrainHeight(x, z);
    const s = 1.063 + seededRand() * 1.488;
    _fDummy.position.set(x, h, z);
    _fDummy.scale.set(s, s, s);
    _fDummy.rotation.set(0, seededRand()*6.28, 0);
    _fDummy.updateMatrix();
    fernInst.setMatrixAt(i, _fDummy.matrix);
    const hv = Math.sin(x*53.1+z*97.3)*0.5+0.5;
    _fCol.setRGB(0.36+hv*0.12, 0.50+hv*0.14, 0.24+hv*0.10);
    fernInst.setColorAt(i, _fCol);
  });
  fernInst.instanceMatrix.needsUpdate = true;
  fernInst.instanceColor.needsUpdate  = true;
  scene.add(fernInst);
}

// ── Instanced Rocks ──
const rockColors = [0x8a8278, 0x7a7068, 0x9a9088, 0x6a6258, 0x8a8070, 0x5a5248, 0xa09888, 0x706860];
{
  const rockPlacements = [];
  const rockGridSize = 21;
  for (let gx = -half + 25; gx < half - 25; gx += rockGridSize) {
    for (let gz = -half + 25; gz < half - 25; gz += rockGridSize) {
      const x = gx + (seededRand() - 0.5) * rockGridSize * 0.6;
      const z = gz + (seededRand() - 0.5) * rockGridSize * 0.6;
      if (canPlaceAt(x, z) && !_tooClose(x, z, 1.5)) { rockPlacements.push({ x, z }); _placedObjList.push({ x, z, r: 1.5 }); }
    }
  }

  const crateInst = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ map: _crateTex, color: 0xffdbaf }),
    rockPlacements.length
  );
  crateInst.castShadow = true;
  const dummy = new THREE.Object3D();

  rockPlacements.forEach(({ x, z }, i) => {
    const h  = getTerrainHeight(x, z);
    const sz = 1.4 + seededRand() * 1.2;
    const yRot = seededRand() * 6.28;
    dummy.position.set(x, h + sz * 0.5, z);
    dummy.scale.set(sz, sz, sz);
    dummy.rotation.set(0, yRot, 0);
    dummy.updateMatrix();
    crateInst.setMatrixAt(i, dummy.matrix);
    const collider = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz), invisibleColliderMat);
    collider.position.set(x, h + sz * 0.5, z);
    collider.rotation.y = yRot;
    collider.updateMatrixWorld(true);
    collidables.push(collider);
    const crateHit = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz), invisibleColliderMat);
    crateHit.position.set(x, h + sz * 0.5, z);
    crateHit.rotation.y = yRot;
    crateHit.updateMatrixWorld(true);
    targets.push(crateHit);
  });
  crateInst.instanceMatrix.needsUpdate = true;
  scene.add(crateInst);
}

// ── Volcano crates — 10 fixed positions on the slope ──
{
  const volcR = CONFIG.volcanoRadius;
  const volcCratePositions = [
    { r: 0.52, a: 0.00 }, { r: 0.62, a: 0.63 }, { r: 0.45, a: 1.26 },
    { r: 0.58, a: 1.88 }, { r: 0.40, a: 2.51 }, { r: 0.55, a: 3.14 },
    { r: 0.48, a: 3.77 }, { r: 0.60, a: 4.40 }, { r: 0.42, a: 5.03 },
    { r: 0.50, a: 5.65 },
  ];
  volcCratePositions.forEach(({ r, a }, idx) => {
    const x = Math.cos(a) * volcR * r;
    const z = Math.sin(a) * volcR * r;
    const h = getTerrainHeight(x, z);
    const sz = 1.4 + (idx % 3) * 0.4;
    const yRot = a + 0.4;
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(sz, sz, sz),
      new THREE.MeshLambertMaterial({ map: _crateTex, color: 0xffdbaf })
    );
    crate.position.set(x, h + sz * 0.5, z);
    crate.rotation.y = yRot;
    crate.castShadow = true;
    scene.add(crate);
    const collider = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz), invisibleColliderMat);
    collider.position.set(x, h + sz * 0.5, z);
    collider.rotation.y = yRot;
    collider.updateMatrixWorld(true);
    collidables.push(collider);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz), invisibleColliderMat);
    hit.position.set(x, h + sz * 0.5, z);
    hit.rotation.y = yRot;
    hit.updateMatrixWorld(true);
    targets.push(hit);
  });
}

// ── Instanced Marble Pillars with Ivy ──
{
  const pillarPlacements = [];
  const pillarGrid = 42;
  for (let gx = -half + 18; gx < half - 18; gx += pillarGrid) {
    for (let gz = -half + 18; gz < half - 18; gz += pillarGrid) {
      const x = gx + (seededRand() - 0.5) * pillarGrid * 0.7;
      const z = gz + (seededRand() - 0.5) * pillarGrid * 0.7;
      if (canPlaceAt(x, z) && !_tooClose(x, z, 1.5)) { pillarPlacements.push({ x, z }); _placedObjList.push({ x, z, r: 1.5 }); }
    }
  }

  const stoneMat   = new THREE.MeshLambertMaterial({ color: 0xBCB8B0 }); // match ammo shed
  const shaftGeo   = new THREE.CylinderGeometry(0.52, 0.63, 1, 8);
  const baseGeo    = new THREE.BoxGeometry(1.61, 0.37, 1.61);
  const capitalGeo = new THREE.BoxGeometry(1.78, 0.32, 1.78);
  const n = pillarPlacements.length;
  const shaftInst   = new THREE.InstancedMesh(shaftGeo,   stoneMat, n);
  const baseInst    = new THREE.InstancedMesh(baseGeo,    stoneMat, n);
  const capitalInst = new THREE.InstancedMesh(capitalGeo, stoneMat, n);

  const _pDummy = new THREE.Object3D(), _pCol = new THREE.Color();
  pillarPlacements.forEach(({ x, z }, i) => {
    const h = getTerrainHeight(x, z);
    const pillarH = 5.52 + seededRand() * 2.53;
    const shaftH  = pillarH - 0.28 - 0.24;
    const yRot = seededRand() * 6.28;
    const hv = Math.sin(x*73.1+z*137.9)*0.5+0.5;

    _pDummy.position.set(x, h+0.14, z);
    _pDummy.scale.set(1,1,1); _pDummy.rotation.set(0,yRot,0);
    _pDummy.updateMatrix(); baseInst.setMatrixAt(i, _pDummy.matrix);

    _pDummy.position.set(x, h+0.28+shaftH/2, z);
    _pDummy.scale.set(1,shaftH,1); _pDummy.rotation.set(0,yRot,0);
    _pDummy.updateMatrix(); shaftInst.setMatrixAt(i, _pDummy.matrix);

    _pDummy.position.set(x, h+pillarH-0.12, z);
    _pDummy.scale.set(1,1,1); _pDummy.rotation.set(0,yRot,0);
    _pDummy.updateMatrix(); capitalInst.setMatrixAt(i, _pDummy.matrix);

    _pCol.setRGB(0.84+hv*0.08, 0.80+hv*0.06, 0.70+hv*0.08);
    baseInst.setColorAt(i,_pCol); shaftInst.setColorAt(i,_pCol); capitalInst.setColorAt(i,_pCol);

    const col2 = new THREE.Mesh(new THREE.BoxGeometry(1.30,pillarH,1.30), invisibleColliderMat);
    col2.position.set(x, h+pillarH/2, z); col2.updateMatrixWorld(true); collidables.push(col2);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.26,pillarH,1.26), invisibleColliderMat);
    hit.position.set(x, h+pillarH/2, z); hit.updateMatrixWorld(true); targets.push(hit);
  });

  [shaftInst, baseInst, capitalInst].forEach(m => {
    m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
    m.castShadow = true; scene.add(m);
  });
}

// Volcano LOS/bullet blocker
const bulletBlockers = [];

const vBase = new THREE.Mesh(
  new THREE.CylinderGeometry(CONFIG.volcanoRadius * 1.05, CONFIG.volcanoRadius * 1.05, CONFIG.volcanoHeight * 0.55, 16),
  invisibleColliderMat
);
vBase.position.set(0, CONFIG.volcanoHeight * 0.275, 0);

const vMid = new THREE.Mesh(
  new THREE.CylinderGeometry(CONFIG.volcanoRadius * 0.65, CONFIG.volcanoRadius * 1.0, CONFIG.volcanoHeight * 0.45, 16),
  invisibleColliderMat
);
vMid.position.set(0, CONFIG.volcanoHeight * 0.60, 0);

const vTop = new THREE.Mesh(
  new THREE.CylinderGeometry(CONFIG.volcanoRadius * 0.22, CONFIG.volcanoRadius * 0.60, CONFIG.volcanoHeight * 0.35, 12),
  invisibleColliderMat
);
vTop.position.set(0, CONFIG.volcanoHeight * 0.875, 0);

for (let i = 0; i < 25; i++) {
  const angle = seededRand() * Math.PI * 2;
  const r = 10 + seededRand() * (CONFIG.volcanoRadius - 14);
  const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
  const h = Math.min(getTerrainHeight(x,z), getTerrainHeight(x-0.8,z), getTerrainHeight(x+0.8,z), getTerrainHeight(x,z-0.8), getTerrainHeight(x,z+0.8));
  const sz = 1.2 + seededRand() * 1.4;
  const yRot = seededRand() * 6.28;

  // Compute terrain normal by sampling neighbours — tilts crate to match slope
  const step = 0.8;
  const hL = getTerrainHeight(x - step, z);
  const hR = getTerrainHeight(x + step, z);
  const hD = getTerrainHeight(x, z - step);
  const hU = getTerrainHeight(x, z + step);
  const slopeX = Math.atan2(hR - hL, step * 2);
  const slopeZ = Math.atan2(hU - hD, step * 2);

  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(sz, sz, sz),
    new THREE.MeshLambertMaterial({ map: _crateTex, color: 0xffdbaf })
  );
  crate.position.set(x, h + sz * 0.5, z);
  crate.rotation.set(0, yRot, 0);
  crate.castShadow = true;
  scene.add(crate);

  // Bullet hitbox — tilted to match visual
  const crateHit = new THREE.Mesh(
    new THREE.BoxGeometry(sz, sz, sz),
    invisibleColliderMat
  );
  crateHit.position.set(x, h + sz * 0.5, z);
  crateHit.rotation.set(0, yRot, 0);
  crateHit.updateMatrixWorld(true);
  targets.push(crateHit);

  // Use visible crate mesh as player collider — invisible colliders can have BB issues
  collidables.push(crate);
}

// ── Dirt patch data — precomputed so grass loop can avoid them ──
const _dirtPatches = [];
{
  const dpGrid = 20;
  for (let gx = -half; gx < half; gx += dpGrid) {
    for (let gz = -half; gz < half; gz += dpGrid) {
      const x = gx + (seededRand() - 0.5) * dpGrid * 1.2;
      const z = gz + (seededRand() - 0.5) * dpGrid * 1.2;
      if (!canPlaceGround(x, z)) continue;
      const r = (2.5 + seededRand() * 4.0) * 1.25;
      _dirtPatches.push({ x, z, r });
    }
  }
}

// ── Instanced Grass Tufts — 5-blade tapered fan, 1 draw call ──
// Each instance is a cluster of 5 blades fanning outward from a shared base,
// matching the reference: wide tapered blades, dark base → bright tip, outward lean.
{
  // ── Build tuft geometry (5 tapered blades, baked into one BufferGeometry) ──
  // Blade config: [azimuth_deg, lean_deg] — azimuth spreads blades, lean tilts them out
  const bladeDefs = [
    [  0,  12],   // center — nearly upright
    [ 38,  30],   // inner left
    [-38,  30],   // inner right
    [ 68,  48],   // outer left
    [-68,  48],   // outer right
  ];
  const bH  = 0.256;  // blade length (20% shorter)
  const bBW = 0.026;  // base half-width
  const bTW = 0.005;  // tip half-width
  const BASE_COL = [0.06, 0.26, 0.04];   // very dark green at soil
  const TIP_COL  = [0.40, 0.88, 0.20];   // bright lime-green at tip

  const vCount = bladeDefs.length * 4;   // 4 verts per blade
  const positions = new Float32Array(vCount * 3);
  const colors    = new Float32Array(vCount * 3);
  const indices   = [];

  bladeDefs.forEach(([azDeg, leanDeg], bi) => {
    const az   = azDeg   * Math.PI / 180;
    const lean = leanDeg * Math.PI / 180;
    const vi   = bi * 4;

    // Lean direction unit vector (XZ plane)
    const lx = Math.sin(az), lz = Math.cos(az);
    // Perpendicular (for blade width)
    const px = Math.cos(az), pz = -Math.sin(az);
    // Tip world offset
    const tx = Math.sin(lean) * lx * bH;
    const ty = Math.cos(lean) * bH;
    const tz = Math.sin(lean) * lz * bH;

    // v0 base-left, v1 base-right, v2 tip-left, v3 tip-right
    const vd = [
      [-bBW * px, 0,  -bBW * pz],
      [ bBW * px, 0,   bBW * pz],
      [tx - bTW * px, ty, tz - bTW * pz],
      [tx + bTW * px, ty, tz + bTW * pz],
    ];
    vd.forEach(([vx, vy, vz], k) => {
      const pi = (vi + k) * 3;
      positions[pi] = vx; positions[pi+1] = vy; positions[pi+2] = vz;
      const isBase = k < 2;
      const ci = (vi + k) * 3;
      colors[ci]   = isBase ? BASE_COL[0] : TIP_COL[0];
      colors[ci+1] = isBase ? BASE_COL[1] : TIP_COL[1];
      colors[ci+2] = isBase ? BASE_COL[2] : TIP_COL[2];
    });
    indices.push(vi, vi+1, vi+2,  vi+1, vi+3, vi+2);
  });

  const grassGeo = new THREE.BufferGeometry();
  grassGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  grassGeo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  grassGeo.setIndex(indices);
  const grassMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });

  // ── Place tufts on a jittered grid ──
  const grassPlacements = [];
  const grassGrid = 0.55;
  for (let gx = -half; gx < half; gx += grassGrid) {
    for (let gz = -half; gz < half; gz += grassGrid) {
      const x = gx + (seededRand() - 0.5) * grassGrid * 0.9;
      const z = gz + (seededRand() - 0.5) * grassGrid * 0.9;
      if (!canPlaceGround(x, z)) continue;
      let inDirt = false;
      for (const p of _dirtPatches) {
        const dx = x - p.x, dz = z - p.z;
        if (dx*dx + dz*dz < p.r * p.r * 0.52) { inDirt = true; break; }
      }
      if (inDirt) continue;
      grassPlacements.push({ x, z });
    }
  }

  const grassInst = new THREE.InstancedMesh(grassGeo, grassMat, grassPlacements.length);

  // Palette: mostly rich greens with slight variation
  const grassPalette = [
    [0.55, 0.92, 0.28],  // bright fresh green
    [0.38, 0.72, 0.18],  // mid green
    [0.28, 0.58, 0.12],  // dark forest green
    [0.48, 0.85, 0.22],  // vivid green
    [0.32, 0.65, 0.15],  // cool dark
  ];

  const _gDummy = new THREE.Object3D();
  const _gCol   = new THREE.Color();
  grassPlacements.forEach(({ x, z }, i) => {
    const h = getTerrainHeight(x, z);
    const s = 0.65 + seededRand() * 0.80;  // size variation: small to large tufts
    _gDummy.position.set(x, h, z);
    _gDummy.scale.set(s, s * (0.8 + seededRand() * 0.45), s);
    _gDummy.rotation.set(0, seededRand() * 6.28, 0);  // random azimuth only — lean baked in
    _gDummy.updateMatrix();
    grassInst.setMatrixAt(i, _gDummy.matrix);
    // Smooth spatial color — nearby tufts cluster in similar hue
    const fi = Math.abs(Math.sin(x * 0.28 + z * 0.41) * 0.6 + Math.cos(x * 1.5 - z * 1.1) * 0.4);
    const [r, g, b] = grassPalette[Math.floor(fi * grassPalette.length) % grassPalette.length];
    _gCol.setRGB(r, g, b);
    grassInst.setColorAt(i, _gCol);
  });
  grassInst.instanceMatrix.needsUpdate = true;
  grassInst.instanceColor.needsUpdate  = true;
  scene.add(grassInst);
}

// ── Instanced Dirt Patches — smooth organic blobs, no grass inside ──
{
  // Large central gradient + small perimeter bumps → soft organic edge, no hard outline
  const dc = document.createElement('canvas'); dc.width = dc.height = 256;
  const dctx = dc.getContext('2d');
  const g0 = dctx.createRadialGradient(128, 128, 0, 128, 128, 118);
  g0.addColorStop(0,    'rgba(255,255,255,1.0)');
  g0.addColorStop(0.55, 'rgba(255,255,255,0.92)');
  g0.addColorStop(0.78, 'rgba(255,255,255,0.45)');
  g0.addColorStop(0.92, 'rgba(255,255,255,0.10)');
  g0.addColorStop(1.0,  'rgba(255,255,255,0)');
  dctx.fillStyle = g0; dctx.fillRect(0, 0, 256, 256);
  [ [88,52,30], [168,60,24], [196,140,28], [155,205,22], [72,178,26], [50,115,20], [130,40,18] ]
    .forEach(([bx, by, br]) => {
      const g = dctx.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0,   'rgba(255,255,255,0.45)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.15)');
      g.addColorStop(1,   'rgba(255,255,255,0)');
      dctx.fillStyle = g; dctx.fillRect(0, 0, 256, 256);
    });
  const dirtTex = new THREE.CanvasTexture(dc);

  const dirtGeo = new THREE.PlaneGeometry(1, 1);
  const dirtMat = new THREE.MeshBasicMaterial({
    map: dirtTex, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, color: 0xffffff
  });
  const dirtInst = new THREE.InstancedMesh(dirtGeo, dirtMat, _dirtPatches.length);
  dirtInst.castShadow = false;
  dirtInst.renderOrder = 1;

  const dirtPalette = [
    [0.34, 0.21, 0.09],
    [0.44, 0.29, 0.12],
    [0.38, 0.23, 0.08],
    [0.29, 0.18, 0.07],
    [0.50, 0.34, 0.16],
  ];

  const _ddDummy = new THREE.Object3D();
  const _ddCol = new THREE.Color();
  _dirtPatches.forEach(({ x, z, r }, i) => {
    const h = getTerrainHeight(x, z);
    const diameter = r * 2.0;
    const aspect = 0.7 + seededRand() * 0.6;
    _ddDummy.position.set(x, h + 0.015, z);
    _ddDummy.scale.set(diameter, diameter * aspect, diameter);
    _ddDummy.rotation.set(-Math.PI / 2, 0, seededRand() * Math.PI * 2);
    _ddDummy.updateMatrix();
    dirtInst.setMatrixAt(i, _ddDummy.matrix);
    const fi = Math.abs(Math.sin(x * 113.7 + z * 197.3) * 0.5 + Math.cos(x * 71.1 - z * 153.9) * 0.5);
    const [rv, g, b] = dirtPalette[Math.floor(fi * dirtPalette.length) % dirtPalette.length];
    _ddCol.setRGB(rv, g, b);
    dirtInst.setColorAt(i, _ddCol);
  });
  dirtInst.instanceMatrix.needsUpdate = true;
  dirtInst.instanceColor.needsUpdate = true;
  scene.add(dirtInst);
}

// ═══════════════════════════════════════════════════════════

// ── Roman stone cover walls — 15 scattered waist-high barriers ──
{
  const wallMat   = new THREE.MeshBasicMaterial({ color: 0xC8C4BB });
  const pillarMat = new THREE.MeshBasicMaterial({ color: 0xBEBAB2 });

  const wl = 3.5, wh = 1.29, wt = 0.55; // wh = 1.12 * 1.15
  const pw = 0.46, ph = wh + 0.20;

  const walls = _wallPositions.map(([wx, wz], i) => {
    const facings = ['EW','EW','NS','NS','EW','EW','NS','NS','EW','EW','NS','NS','EW','EW','NS','NS','EW','NS','EW','NS','EW','NS','EW','NS','EW'];
    return [wx, wz, facings[i]];
  });

  for (const [wx, wz, facing] of walls) {
    // Skip canPlaceAt — it excludes _nearWall positions. Use direct checks instead.
    if (getVolcanoHeight(wx, wz) > 1) continue;
    if (Math.abs(wx) > half - 12 || Math.abs(wz) > half - 12) continue;
    const isEW = facing === 'EW';
    const h = getTerrainHeight(wx, wz);

    const wallGeo = isEW
      ? new THREE.BoxGeometry(wl, wh, wt)
      : new THREE.BoxGeometry(wt, wh, wl);
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(wx, h + wh / 2, wz);
    scene.add(wall);
    collidables.push(wall);

    for (const gy of [0.35, 0.72]) {
      const lineGeo = isEW
        ? new THREE.BoxGeometry(wl + 0.02, 0.04, wt + 0.02)
        : new THREE.BoxGeometry(wt + 0.02, 0.04, wl + 0.02);
      const line = new THREE.Mesh(lineGeo, pillarMat);
      line.position.set(wx, h + gy, wz);
      scene.add(line);
    }

    for (const s of [-1, 1]) {
      const ex = isEW ? wx + s * (wl / 2 + pw / 2) : wx;
      const ez = isEW ? wz : wz + s * (wl / 2 + pw / 2);
      const eh = getTerrainHeight(ex, ez);
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pw), pillarMat);
      pillar.position.set(ex, eh + ph / 2, ez);
      scene.add(pillar);
      collidables.push(pillar);
    }
  }
}

// ── Canal-top grass — both inner AND outer wall top edges, matching ground grass look ──
{
  const CANAL_TOP_Y = 0.847;  // matches terrain.js canalH
  const INNER_EDGE  = 83.75;  // CANAL_R(85) - canalOuter(1.25)
  const OUTER_EDGE  = 86.25;  // CANAL_R(85) + canalOuter(1.25)
  const SPACING     = 1.1;

  // Ground grass palette — same as the grassPalette above so blades match
  const cgPalette = [
    new THREE.Color(0.55, 0.92, 0.28),
    new THREE.Color(0.38, 0.72, 0.18),
    new THREE.Color(0.28, 0.58, 0.12),
    new THREE.Color(0.48, 0.85, 0.22),
    new THREE.Color(0.32, 0.65, 0.14),
  ];

  // Same blade geometry as ground grass (BLADES=3, same bH/bBW/bTW)
  const BLADES = 3, bH = 0.38, bBW = 0.052, bTW = 0.016;
  const _cp = new Float32Array(BLADES*4*3), _cc = new Float32Array(BLADES*4*3), _ci = [];
  // White vertex colors — instance color provides the actual hue variation
  for (let b = 0; b < BLADES; b++) {
    const vi = b*4, ang = (b/BLADES)*Math.PI;
    const px = Math.cos(ang), pz = Math.sin(ang);
    const lean = 0.18 + (b/BLADES)*0.12;
    const tx = Math.sin(lean)*px*bH, ty = Math.cos(lean)*bH, tz = Math.sin(lean)*pz*bH;
    [[-bBW*px,0,-bBW*pz],[bBW*px,0,bBW*pz],[tx-bTW*px,ty,tz-bTW*pz],[tx+bTW*px,ty,tz+bTW*pz]]
      .forEach(([vx,vy,vz],k) => {
        const pi=(vi+k)*3, isBase=k<2;
        _cp[pi]=vx; _cp[pi+1]=vy; _cp[pi+2]=vz;
        // base half-brightness so instanceColor controls the final shade
        _cc[pi]=isBase?0.35:0.85; _cc[pi+1]=isBase?0.35:0.85; _cc[pi+2]=isBase?0.35:0.85;
      });
    _ci.push(vi,vi+1,vi+2, vi+1,vi+3,vi+2);
  }
  const cgGeo = new THREE.BufferGeometry();
  cgGeo.setAttribute('position', new THREE.BufferAttribute(_cp, 3));
  cgGeo.setAttribute('color',    new THREE.BufferAttribute(_cc, 3));
  cgGeo.setIndex(_ci);
  const cgMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });

  // Both inner and outer edges, all 4 sides
  const cgPos = [];
  const hlen = INNER_EDGE - 0.1;
  for (let t = -hlen; t <= hlen; t += SPACING) {
    for (const edge of [INNER_EDGE, OUTER_EDGE]) {
      cgPos.push([ t,     CANAL_TOP_Y, -edge ]);  // south
      cgPos.push([ t,     CANAL_TOP_Y,  edge ]);  // north
      cgPos.push([ edge,  CANAL_TOP_Y,  t    ]);  // east
      cgPos.push([-edge,  CANAL_TOP_Y,  t    ]);  // west
    }
  }

  const cgInst = new THREE.InstancedMesh(cgGeo, cgMat, cgPos.length);
  cgInst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cgPos.length*3), 3);
  const _cgD = new THREE.Object3D(), _cgC = new THREE.Color();
  cgPos.forEach(([px, py, pz], i) => {
    _cgD.position.set(px, py, pz);
    _cgD.rotation.y = (i * 2.399) % (Math.PI * 2);  // golden-angle spread
    const sc = 0.82 + (Math.abs(Math.sin(i*7.3)) * 0.35);
    _cgD.scale.set(sc, sc * (0.9 + Math.abs(Math.sin(i*3.1))*0.2), sc);
    _cgD.updateMatrix();
    cgInst.setMatrixAt(i, _cgD.matrix);
    _cgC.copy(cgPalette[i % cgPalette.length]);
    cgInst.setColorAt(i, _cgC);
  });
  cgInst.instanceMatrix.needsUpdate = true;
  cgInst.instanceColor.needsUpdate  = true;
  scene.add(cgInst);
}

// ── Decorative low bushes — 20 scattered, visual cover only, no colliders ──
{
  const bushColors = [0x3a7a1a, 0x2d6614, 0x4a8c20, 0x336018, 0x528c24];
  const rng = (() => { let s = 9371; return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; }; })();

  const bushPositions = [];
  let attempts = 0;
  while (bushPositions.length < 20 && attempts++ < 2000) {
    const angle = rng() * Math.PI * 2;
    const r = 25 + rng() * 80; // spread across map, avoid center
    const bx = Math.cos(angle) * r, bz = Math.sin(angle) * r;
    if (!canPlaceAt(bx, bz)) continue;
    if (isInCanalWater(bx, bz)) continue;
    if (_tooClose(bx, bz, 12)) continue;
    bushPositions.push([bx, bz]);
    _placedObjList.push({ x: bx, z: bz, r: 10 });
  }

  for (const [bx, bz] of bushPositions) {
    const bh = getTerrainHeight(bx, bz);
    const group = new THREE.Group();
    group.position.set(bx, bh, bz);
    group.rotation.y = rng() * Math.PI * 2;

    const baseColor = bushColors[Math.floor(rng() * bushColors.length)];
    const darkColor = (baseColor & 0xFEFEFE) >> 1; // 50% darker
    const scale = (0.9 + rng() * 0.7) * 0.55; // size variety

    // Layered blob structure: wide base, narrower mid, small top
    const blobs = [
      { r: 1.10 * scale, y: 0.55 * scale, x:  0,              z:  0 },
      { r: 0.85 * scale, y: 0.90 * scale, x:  0.5 * scale,    z:  0.2 * scale },
      { r: 0.80 * scale, y: 0.85 * scale, x: -0.4 * scale,    z: -0.3 * scale },
      { r: 0.65 * scale, y: 1.20 * scale, x:  0.15 * scale,   z:  0.1 * scale },
      { r: 0.45 * scale, y: 1.50 * scale, x: -0.1 * scale,    z: -0.1 * scale },
    ];

    blobs.forEach(({ r, y, x, z }, i) => {
      const col = i < 2 ? darkColor : baseColor;
      const mat = new THREE.MeshLambertMaterial({ color: col });
      const geo = new THREE.SphereGeometry(r, 6, 5);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      group.add(mesh);
    });

    scene.add(group);
  }
}
// BOTS — AI with shooting, prison spawn, ammo seeking
// ═══════════════════════════════════════════════════════════
const BOT_NAMES = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Golf','Hotel','India','Juliet',
  'Kilo','Lima','Mike','November','Oscar','Papa','Quebec','Romeo','Sierra','Tango'];

function createBot(x, z, name) {
  const h = getGroundHeight(x, z);
  const group = new THREE.Group();
  group.position.set(x, h, z);

  const bodyColor = [0xCC6622, 0xBB5511, 0xDD7733, 0xC05A18][Math.floor(Math.random() * 4)];
  const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xD2B48C });

  // Torso (slightly shorter to make room for belt)
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.4), bodyMat);
  body.position.y = 1.3; body.castShadow = true; group.add(body);

  // Belt
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.38), new THREE.MeshLambertMaterial({ color: 0x3a3020 }));
  belt.position.y = 0.88; group.add(belt);

  // Neck
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.16), skinMat);
  neck.position.y = 1.72; group.add(neck);

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), skinMat);
  head.position.y = 1.9; head.castShadow = true;
  head.userData.isHead = true; group.add(head);

  // Helmet
  const helmet = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.16, 8), new THREE.MeshLambertMaterial({ color: 0x555555 }));
  helmet.position.y = 2.06; helmet.userData.isHead = true; group.add(helmet);

  // Legs with boots (combined into 2 pieces per leg)
  for (const s of [-0.15, 0.15]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.22), new THREE.MeshLambertMaterial({ color: 0xBB6622 }));
    leg.position.set(s, 0.5, 0); leg.castShadow = true; group.add(leg);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.28), new THREE.MeshLambertMaterial({ color: 0x2a2218 }));
    boot.position.set(s, 0.09, 0.02); group.add(boot);
  }

  // Arms
  for (const s of [-0.45, 0.45]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.2), bodyMat);
    arm.position.set(s, 1.15, 0); arm.castShadow = true; group.add(arm);
  }

  // Weapon with stock
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.5), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
  gun.position.set(0.45, 1.1, -0.3); group.add(gun);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.14), new THREE.MeshLambertMaterial({ color: 0x3d2812 }));
  stock.position.set(0.45, 1.1, -0.02); group.add(stock);

  scene.add(group);
  group.children.forEach(c => targets.push(c));

  const bot = {
    group, name,
    hp: 100,
    alive: true,
    hasAmmo: false,
    moveDir: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
    moveTimer: 2 + Math.random() * 4,
    speed: 1.5 + Math.random() * 1.5,
    walkPhase: Math.random() * 6.28,
    shootCooldown: 0,
    shootAccuracy: 0.12 + Math.random() * 0.16,
    aggroRange: 30 + Math.random() * 20,
    ammoTimer: 30,  // arm after 30s then begin shooting
    exitDelay: 0,
    exitedPrison: false,
    velocityY: 0,
    isGrounded: true,
    waypoint: null,
    fleeTarget: null,
    parts: { body, head, legs: group.children.filter((_, i) => i >= 3 && i <= 4), arms: group.children.filter((_, i) => i >= 5) },
  };
  bots.push(bot);
  return bot;
}

// Bots only spawn in Auto Join (bot match) mode — called from startBotMatch()
function spawnBots() {
  for (let i = 0; i < 20; i++) {
    const row = Math.floor(i / 5);
    const col = i % 5;
    const px = CONFIG.prisonPos.x - CONFIG.prisonSize / 2 + 5 + col * ((CONFIG.prisonSize - 10) / 4);
    const pz = CONFIG.prisonPos.z - CONFIG.prisonSize / 2 + 5 + row * ((CONFIG.prisonSize - 10) / 3);
    const bot = createBot(px, pz, BOT_NAMES[i] || 'Bot');
    bot.exitDelay = i * 0.4;
  }
}

function updateBots(dt) {
  for (const bot of bots) {
    if (!bot.alive) continue;

    // Phase check — don't move during lobby/countdown
    if (state.phase === 'lobby' || state.phase === 'countdown') continue;

    const bx = bot.group.position.x, bz = bot.group.position.z;

    // Check if bot is still inside prison
    const inPrison = Math.abs(bx - prison.x) < pw / 2 && Math.abs(bz - prison.z) < pw / 2;

    // If in prison or near gate, head for exit
    if (inPrison || (Math.abs(bx - (prison.x + pw/2)) < 8 && Math.abs(bz - prison.z) < pw/2 && bot.exitDelay <= 0 && !bot.exitedPrison)) {
      bot.exitDelay -= dt;
      if (bot.exitDelay > 0) {
        bot.walkPhase += dt * 1;
        const swing = Math.sin(bot.walkPhase) * 0.1;
        if (bot.parts.legs[0]) bot.parts.legs[0].rotation.x = swing;
        if (bot.parts.legs[1]) bot.parts.legs[1].rotation.x = -swing;
        continue;
      }
      // Target: gate center first (prison.z), then once past the wall, mark as exited
      const wallX = prison.x + pw / 2;
      if (bx < wallX + 3) {
        // Still inside or at the gate — aim straight through center
        bot.moveDir.set(1, 0, (prison.z - bz) * 0.3).normalize();
      } else {
        // Past the wall — scatter outward
        bot.exitedPrison = true;
      }
      bot.speed = 4.5;
      const newX = bx + bot.moveDir.x * bot.speed * dt;
      const newZ = bz + bot.moveDir.z * bot.speed * dt;
      bot.group.position.x = newX;
      bot.group.position.z = newZ;
      const th = getGroundHeight(bot.group.position.x, bot.group.position.z);
      bot.group.position.y += (th - bot.group.position.y) * Math.min(1, dt * 18);
      bot.group.rotation.y = Math.atan2(bot.moveDir.x, bot.moveDir.z);
      bot.walkPhase += dt * bot.speed * 3;
      const swing = Math.sin(bot.walkPhase) * 0.4;
      if (bot.parts.legs[0]) bot.parts.legs[0].rotation.x = swing;
      if (bot.parts.legs[1]) bot.parts.legs[1].rotation.x = -swing;
      if (bot.parts.arms[0]) bot.parts.arms[0].rotation.x = -swing * 0.6;
      if (bot.parts.arms[1]) bot.parts.arms[1].rotation.x = swing * 0.6;
      continue;
    }

    const dx = camera.position.x - bx;
    const dz = camera.position.z - bz;
    const distToPlayer = Math.sqrt(dx * dx + dz * dz);

    // Arm timer
    if (!bot.hasAmmo) {
      bot.ammoTimer -= dt;
      for (const d of depotCorners) {
        if (Math.sqrt((bx - d.x) ** 2 + (bz - d.z) ** 2) < 14) { bot.ammoTimer = 0; break; }
      }
      if (bot.ammoTimer <= 0) bot.hasAmmo = true;
    }

    // ── TOP PRIORITY: engage player if in range ──
    const engaging = bot.hasAmmo && distToPlayer < bot.aggroRange && !state.playerDead;
    if (engaging) {
      bot.group.rotation.y = Math.atan2(dx, dz);
      const botEye = new THREE.Vector3(bx, bot.group.position.y + 1.7, bz);
      const toPlayer = new THREE.Vector3(dx, camera.position.y - botEye.y, dz).normalize();
      const losRay = new THREE.Raycaster(botEye, toPlayer, 0, distToPlayer);
      const losHits = losRay.intersectObjects(collidables, false);
      let volcanoBlocking = false;
      const stepSize = distToPlayer / 20;
      for (let s = 1; s < 20; s++) {
        const t = s * stepSize;
        const volH = getVolcanoHeight(botEye.x + toPlayer.x * t, botEye.z + toPlayer.z * t);
        if (volH > 0.8 && botEye.y + toPlayer.y * t < volH - 0.1) { volcanoBlocking = true; break; }
      }
      bot.shootCooldown -= dt;
      if (bot.shootCooldown <= 0 && losHits.length === 0 && !volcanoBlocking) {
        bot.shootCooldown = 0.8 + Math.random() * 1.5;
        const hitChance = Math.max(0.08, 0.48 - distToPlayer * 0.005 - bot.shootAccuracy);
        if (Math.random() < hitChance) {
          const dmg = 8 + Math.floor(Math.random() * 7);
          if (state.armor > 0) { state.armor = Math.max(0, state.armor - dmg); }
          else { state.hp = Math.max(0, state.hp - dmg); }
          updateHUD();
          const dv = document.getElementById('damage-vignette');
          dv.classList.add('show');
          setTimeout(() => dv.classList.remove('show'), 350);
          SFX.hitmarker();
        }
        playNoise(0.06, 0.08 * Math.max(0.2, 1 - distToPlayer / 80), 3000, 'bandpass');
      }
    }

    // ── MOVEMENT: always pick a destination and walk to it ──
    if (state.waterRising) {
      // Each bot gets a unique slice of the volcano slope (by index)
      if (!bot.fleeTarget) {
        const botIdx = bots.indexOf(bot);
        const angle = (botIdx / bots.length) * Math.PI * 2;
        const r = 15 + (botIdx % 5) * 5; // 15-35, 5 distinct rings
        bot.fleeTarget = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
      }
      const arrived = Math.sqrt((bx - bot.fleeTarget.x) ** 2 + (bz - bot.fleeTarget.z) ** 2) < 4;
      if (arrived) {
        // Orbit around volcano at current radius once arrived
        const curAngle = Math.atan2(bz, bx);
        const orbitR = Math.sqrt(bx * bx + bz * bz) || 20;
        const nextAngle = curAngle + 0.4;
        bot.fleeTarget = { x: Math.cos(nextAngle) * orbitR, z: Math.sin(nextAngle) * orbitR };
      }
      bot.moveDir.set(bot.fleeTarget.x - bx, 0, bot.fleeTarget.z - bz).normalize();
      bot.speed = 5;
      bot.group.rotation.y = Math.atan2(bot.moveDir.x, bot.moveDir.z);
    } else {
      // Normal wander — always have a waypoint, never stall
      if (!bot.waypoint || Math.sqrt((bx - bot.waypoint.x) ** 2 + (bz - bot.waypoint.z) ** 2) < 6) {
        const angle = Math.random() * Math.PI * 2;
        const r = 40 + Math.random() * 75;
        bot.waypoint = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
      }
      bot.moveDir.set(bot.waypoint.x - bx, 0, bot.waypoint.z - bz).normalize();
      bot.speed = engaging ? 2.0 : 3.0;
      if (!engaging) bot.group.rotation.y = Math.atan2(bot.moveDir.x, bot.moveDir.z);
    }

    const newX = bx + bot.moveDir.x * bot.speed * dt;
    const newZ = bz + bot.moveDir.z * bot.speed * dt;

    const atBoundary = Math.abs(newX) >= half - 12 || Math.abs(newZ) >= half - 12;
    const atVolcano = getVolcanoHeight(newX, newZ) > (state.waterRising ? 40 : 18);

    // Detect canal wall crossing geometrically (square canal at r≈85)
    const CANAL_INNER = 83.5, CANAL_OUTER = 86.5;
    const maxNow = Math.max(Math.abs(bx), Math.abs(bz));
    const maxNext = Math.max(Math.abs(newX), Math.abs(newZ));
    if ((maxNow < CANAL_INNER && maxNext >= CANAL_INNER) ||
        (maxNow > CANAL_OUTER && maxNext <= CANAL_OUTER)) {
      if (bot.isGrounded) { bot.velocityY = 9; bot.isGrounded = false; }
    }

    if (!atBoundary && !atVolcano) {
      bot.group.position.x = newX;
      bot.group.position.z = newZ;
    } else {
      // Blocked — immediately pick a new waypoint so bot never stalls
      const angle = Math.random() * Math.PI * 2;
      const r = 30 + Math.random() * 50;
      bot.waypoint = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
      bot.fleeTarget = null;
    }

    // Jump physics — gravity each frame
    bot.velocityY -= 22 * dt;
    bot.group.position.y += bot.velocityY * dt;
    const th = getGroundHeight(bot.group.position.x, bot.group.position.z);
    if (bot.group.position.y <= th) {
      bot.group.position.y = th;
      bot.velocityY = 0;
      bot.isGrounded = true;
    }

    bot.walkPhase += dt * bot.speed * 3;
    const swing = Math.sin(bot.walkPhase) * 0.4;
    if (bot.parts.legs[0]) bot.parts.legs[0].rotation.x = swing;
    if (bot.parts.legs[1]) bot.parts.legs[1].rotation.x = -swing;
    if (bot.parts.arms[0]) bot.parts.arms[0].rotation.x = -swing * 0.6;
    if (bot.parts.arms[1]) bot.parts.arms[1].rotation.x = swing * 0.6;
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

    // Death: tip over
    bot.group.rotation.x = Math.PI / 2;
    bot.group.position.y = getGroundHeight(bot.group.position.x, bot.group.position.z) + 0.3;

    // Remove from targets after brief delay
    setTimeout(() => {
      bot.group.children.forEach(c => {
        const idx = targets.indexOf(c);
        if (idx >= 0) targets.splice(idx, 1);
      });
    }, 200);


  }
}

function findBotByPart(mesh) {
  for (const bot of bots) {
    if (!bot.alive) continue;
    if (bot.group.children.includes(mesh)) return bot;
  }
  return null;
}

// Kill feed
const killFeedEntries = [];
function addKillFeedEntry(botName, isHead) {
  const el = document.getElementById('kill-feed');
  killFeedEntries.push({ name: botName, head: isHead, time: Date.now() });
  // Keep last 5
  if (killFeedEntries.length > 5) killFeedEntries.shift();
  el.innerHTML = killFeedEntries.map(e =>
    `<div class="entry">You ${e.head ? '⊕' : '→'} ${e.name}${e.head ? ' (headshot)' : ''}</div>`
  ).join('');
  // Auto-clear old entries
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

depotCorners.forEach(({ x, z }) => {
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

  // Roman temple materials — MeshBasicMaterial = unlit, always renders exact color
  const stone   = new THREE.MeshBasicMaterial({ color: 0xF0EDE8 }); // warm white marble
  const stoneDk = new THREE.MeshBasicMaterial({ color: 0xC8C4BC }); // slightly darker white
  const roofMat = new THREE.MeshBasicMaterial({ color: 0x5B2C8B }); // royal purple roof

  // Helper — add mesh as child of rotated group (local coords)
  const addM = (geo, mat, lx, ly, lz, rx, ry, rz) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(lx, ly, lz);
    if (rx != null) m.rotation.x = rx;
    if (ry != null) m.rotation.y = ry;
    if (rz != null) m.rotation.z = rz;
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    return m;
  };

  // ── Podium steps — wide overhangs for visibility, height kept ≤0.60 so player eye stays above ──
  addM(new THREE.BoxGeometry(bw + 5.0, 0.22, bd + 5.0), stoneDk, 0, 0.11, 0);
  addM(new THREE.BoxGeometry(bw + 3.0, 0.20, bd + 3.0), stone,   0, 0.32, 0);
  addM(new THREE.BoxGeometry(bw + 1.0, 0.18, bd + 1.0), stoneDk, 0, 0.51, 0);

  // ── Solid side walls (local ±X) ──
  for (const sx of [-1, 1]) {
    const wx = sx * (bw / 2 - wt / 2);
    addM(new THREE.BoxGeometry(wt, wallH, bd), stone, wx, wallH / 2, 0);
  }

  // ── Column helper: base + shaft + accent band + capital ──
  const addCol = (lx, lz) => {
    addM(new THREE.CylinderGeometry(colR * 1.28, colR * 1.28, 0.22, 12), stoneDk, lx, 0.11, lz);
    addM(new THREE.CylinderGeometry(colR, colR * 1.06, colH, 12), stone, lx, colH / 2, lz);
    addM(new THREE.CylinderGeometry(colR + 0.04, colR + 0.04, colH * 0.36, 12), stoneDk, lx, colH * 0.24, lz);
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
  addM(new THREE.BoxGeometry(bw + colR * 2 + 0.8, entH, bd + colR * 2 + 0.8), stone, 0, entY + entH / 2, 0);
  addM(new THREE.BoxGeometry(bw + colR * 2 + 1.2, 0.22, bd + colR * 2 + 1.2), stoneDk, 0, entY + entH + 0.11, 0);

  // ── Pediment (triangular gable) — front (+Z) and back (-Z) ──
  const pedBaseY = entY + entH + 0.22;
  const ridgeH   = 2.0;
  const pedW     = bw + colR * 2 + 0.8;
  const rakeAng  = Math.atan2(ridgeH, pedW / 2);
  const rakeLen  = Math.sqrt((pedW / 2) ** 2 + ridgeH ** 2) + 0.3;
  for (const pz of [-1, 1]) {
    const pzp = pz * (bd / 2 + colR + 0.4);
    addM(new THREE.BoxGeometry(pedW, ridgeH, wt), stone, 0, pedBaseY + ridgeH / 2, pzp);
    addM(new THREE.BoxGeometry(pedW + 0.2, 0.22, wt + 0.06), stoneDk, 0, pedBaseY + 0.11, pzp);
    for (const sx of [-1, 1]) {
      addM(new THREE.BoxGeometry(rakeLen, 0.22, wt + 0.08), stoneDk,
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
  const cs = 1.05, crateLocalY = 0.60 + cs / 2; // sit on top of podium (podium top = 0.60)

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

// ── Outer-ring scattered loot — 10 crates beyond the canal ──
{
  const outerLoot = [
    [ 104,  34, 'ammo_m4'],
    [  65,  89, 'armor'],
    [   0, 110, 'health'],
    [ -65,  89, 'ammo_pistol'],
    [-104,  34, 'ammo_m4'],
    [-104, -34, 'armor'],
    [ -65, -89, 'health'],
    [   0,-110, 'ammo_m4'],
    [  65, -89, 'ammo_pistol'],
    [ 104, -34, 'armor'],
  ];
  for (const [x, z, type] of outerLoot) spawnLoot(x, z, type);
}
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

    // ── HANDGUARD (solid polymer AK-style, no rails) ──
    add(B(0.052,0.022,0.215), mDark,   0, 0.014,-0.425);
    add(B(0.056,0.024,0.215), mDark,   0,-0.016,-0.425);
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

    // ── AK PISTOL GRIP ──
    add(B(0.038,0.094,0.046), mBlack,  0,-0.126,-0.130,-0.30,0,0);
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
    add(B(0.052,0.044,0.148), skin,       0.130,-0.064, 0.085+pOff, 0,-0.08,0);
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
const impactParticles = [];
function spawnImpact(pos, normal) {
  for (let i = 0; i < 4 + Math.floor(Math.random() * 4); i++) {
    const p = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 4, 3),
      new THREE.MeshBasicMaterial({ color: 0xccbb88 })
    );
    p.position.copy(pos);
    const dir = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2)
      .add(normal.clone().multiplyScalar(2));
    p.userData = { vel: dir.multiplyScalar(0.8 + Math.random() * 1.5), life: 0.25 + Math.random() * 0.3 };
    scene.add(p);
    impactParticles.push(p);
  }
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
    const isDynamic = (obj === gateDoorL || obj === gateDoorR);
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
// Toggled by CONFIG.newPhysics in 01_config.js
// ═══════════════════════════════════════════════════════════

const PHYS = {
  FIXED_STEP:  1 / 60,   // 60 Hz fixed timestep — deterministic, same result every run
  STEP_HEIGHT: 0.45,     // Max ledge auto-step (curbs, terrain lips)
  SKIN_WIDTH:  0.015,    // Stop just before surface to prevent tunneling
  MAX_ITER:    4,        // Max slide iterations per step (handles corners)
};

let _physAccum = 0;     // Leftover time between fixed steps

// Capsule state.
//   pos = FEET position in world space (not eye/camera)
//   vel = world velocity (XYZ)
//   grounded = true when standing on something
const phys = {
  pos:      new THREE.Vector3(),
  vel:      new THREE.Vector3(),
  grounded: false,
};

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
// Returns the Y of any ledge we should step up onto (0 = no step needed).
function _moveHorizontal(pos, deltaX, deltaZ, radius, height, stepHeight) {
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

  // Horizontal movement
  const stepUpY = _moveHorizontal(
    phys.pos,
    inputDir.x * speed * fixedDt,
    inputDir.z * speed * fixedDt,
    radius, height, PHYS.STEP_HEIGHT
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

  // World bounds
  const bound = CONFIG.islandSize * 0.5 - 1;
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

  // Smooth camera height for crouch transition
  const targetHeight = state.crouching ? CONFIG.crouchHeight : CONFIG.playerHeight;
  const lerpRate = state.crouching ? 14 : 7;
  state.smoothCameraHeight += (targetHeight - state.smoothCameraHeight) * Math.min(1, dt * lerpRate);

  // Sync camera to capsule (eye = feet + smooth height)
  camera.position.set(phys.pos.x, phys.pos.y + state.smoothCameraHeight, phys.pos.z);

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
  footstep() {
    // Varied footstep — alternates between two tones for left/right feel
    const crush = 120 + Math.random() * 80;
    playNoise(0.06, 0.22, crush, 'lowpass');
    playNoise(0.03, 0.12, 180, 'lowpass');
    setTimeout(() => playNoise(0.04, 0.08, 400, 'bandpass'), 20);
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
    const species = Math.floor(Math.random() * 4);
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
          osc.start(t0); osc.stop(t0 + 0.12);
        }, t);
      }
    } else if (species === 1) {
      // Rapid staccato finch trill — natural rhythmic burst
      const base = 2600 + Math.random() * 500;
      const chirps = 6 + Math.floor(Math.random() * 5);
      for (let i = 0; i < chirps; i++) {
        setTimeout(() => {
          const ctx2 = ensureAudio();
          const t0 = ctx2.currentTime;
          const osc = ctx2.createOscillator(); osc.type = 'sine';
          const f = base + (Math.random() - 0.5) * 300;
          osc.frequency.setValueAtTime(f, t0);
          osc.frequency.linearRampToValueAtTime(f * 1.12, t0 + 0.025);
          const g = ctx2.createGain();
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(0.038, t0 + 0.008);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.055);
          osc.connect(g).connect(getMaster());
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
          osc.start(t0); osc.stop(t0 + 0.33);
        }, i * 400 + Math.random() * 60);
      }
    } else {
      // Long descending whistle — like a jungle oriole
      const ctx2 = ensureAudio();
      const t0 = ctx2.currentTime;
      const osc = ctx2.createOscillator(); osc.type = 'sine';
      const startF = 2200 + Math.random() * 400;
      osc.frequency.setValueAtTime(startF, t0);
      osc.frequency.linearRampToValueAtTime(startF * 0.72, t0 + 0.35);
      osc.frequency.linearRampToValueAtTime(startF * 0.58, t0 + 0.6);
      const g = ctx2.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.048, t0 + 0.03);
      g.gain.setValueAtTime(0.04, t0 + 0.3);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.65);
      osc.connect(g).connect(getMaster());
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
state.yaw   = 0;
state.shakeOffset = new THREE.Vector3();
state.physicsTime = 0;
state.pitch = 0;

// ── Drone camera for menu background ──
const droneCamera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 1, 1200);
const droneClock = { angle: 0, height: 95, radius: 108 };
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
  droneClock.height = 88 + Math.sin(droneClock.angle * 0.7) * 12;
  droneCamera.position.set(cx, droneClock.height, cz);
  // Look toward island center at a lower angle — more cinematic horizon view
  droneCamera.lookAt(
    Math.sin(droneClock.angle * 1.3) * 20,
    14,
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
  if (e.button === 0) shoot();
  if (e.button === 2) { state.ads = true; crosshair.style.display = 'none'; adsVignette.classList.add('active'); }
});
document.addEventListener('mouseup', (e) => {
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
  // We are the target — apply damage to our own HP
  if (evt.target === state.myId) {
    if (evt.targetHp !== undefined)    state.hp    = evt.targetHp;
    else state.hp = Math.max(0, state.hp - evt.damage);
    if (evt.targetArmor !== undefined) state.armor = evt.targetArmor;
    updateHUD();
    return;
  }
  // Remote player is the target
  const rp = (state.remotePlayers || {})[evt.target];
  if (!rp) return;
  if (evt.targetHp !== undefined) rp.hp = evt.targetHp;
  else rp.hp = Math.max(0, (rp.hp !== undefined ? rp.hp : 100) - evt.damage);
  if (evt.targetDead || rp.hp <= 0) {
    rp.dead = true;
    if (rp.mesh) rp.mesh.visible = false;
  }
}

// Fire-and-forget shoot message to server
function sendShoot(targetId, damage, headshot) {
  const sock = (state && state.ws) ? state.ws : (typeof ws !== 'undefined' ? ws : null);
  if (sock && sock.readyState === 1) {
    sock.send(JSON.stringify({ type: 'shoot', targetId, damage, headshot }));
  }
}

// SHOOTING — First shot accurate, spread accumulates with rapid fire
// ═══════════════════════════════════════════════════════════
const raycaster = new THREE.Raycaster();
let hitmarkerTimeout = null, muzzleTimeout = null, crosshairResetTimeout = null;
let spreadAccum = 0;        // Accumulated spread from rapid fire
let lastShotTime = 0;

function shoot() {
  if (!state.canFire || state.reloading || state.playerDead || (state.phase !== 'playing' && !state.inLobby)) return;
  const wep = CONFIG.weapons[state.currentWeapon];
  if (state.ammo[state.currentWeapon] <= 0) {
    SFX.empty_click();
    reload();
    return;
  }

  state.ammo[state.currentWeapon]--;
  state.canFire = false;

  const isM4 = state.currentWeapon === 'm4';

  // Gunshot sound
  if (isM4) { SFX.gunshot_m4(); showMuzzleFlash(); }
  else SFX.gunshot_pistol();

  // Spread accumulation: resets if enough time has passed since last shot
  const now = performance.now();
  const timeSinceLast = now - lastShotTime;
  if (timeSinceLast > 400) {
    spreadAccum = 0; // Reset — this shot is a "first shot", perfectly accurate if ADS
  } else {
    spreadAccum = Math.min(spreadAccum + 0.008, 0.04); // Build up spread
  }
  lastShotTime = now;

  // Spread: base weapon spread + accumulated rapid-fire spread — captured BEFORE recoil
  const baseSpread = state.ads ? wep.adsSpread : wep.spread;
  const totalSpread = baseSpread + spreadAccum;
  const dir = new THREE.Vector3(
    (Math.random() - 0.5) * totalSpread,
    (Math.random() - 0.5) * totalSpread,
    -1
  ).normalize();
  dir.applyQuaternion(camera.quaternion); // Use pre-recoil direction
  const shotOrigin = camera.position.clone();

  // Recoil (camera kick) — applied AFTER capturing shot direction
  const recoil = state.ads ? wep.recoilAds : wep.recoilHip;
  state.pitch += recoil * (0.7 + Math.random() * 0.3);
  state.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, state.pitch));
  state.yaw += (Math.random() - 0.5) * recoil * 0.3;

  weaponGroup.position.z += 0.06;
  weaponGroup.rotation.x -= 0.08;

  // Project barrel tip to screen coords for muzzle flash — M4 only
  if (isM4) {
    const localTip = new THREE.Vector3(0.03, -0.01, -0.925);
    const worldTip = localTip.clone().applyMatrix4(weaponGroup.matrixWorld);
    const ndc = worldTip.clone().project(camera);
    const sx = ( ndc.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-ndc.y * 0.5 + 0.5) * window.innerHeight;
    muzzleFlash.style.left = sx + 'px';
    muzzleFlash.style.top  = sy + 'px';
    muzzleFlash.style.transform = `translate(-50%,-50%) rotate(${Math.random()*360}deg)`;
    muzzleFlash.classList.add('flash');
    clearTimeout(muzzleTimeout);
    muzzleTimeout = setTimeout(() => muzzleFlash.classList.remove('flash'), 55);
  }

  crosshair.classList.add('fired');
  clearTimeout(crosshairResetTimeout);
  crosshairResetTimeout = setTimeout(() => crosshair.classList.remove('fired'), 150);

  raycaster.set(shotOrigin, dir);
  raycaster.far = wep.range || 500;

  const remoteTargets = getRemotePlayerMeshes();
  const intersects = raycaster.intersectObjects([...targets, ...remoteTargets], false);

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

  if (intersects.length > 0) {
    const hit = intersects[0];
    if (paneDist < hit.distance) {
      // Shot stopped by window glass
      spawnImpact(paneHits[0].point, paneHits[0].face ? paneHits[0].face.normal : new THREE.Vector3(0, 1, 0));
    } else if (blockDist !== null && blockDist < hit.distance) {
      // Shot stopped by volcano terrain
      spawnImpact(
        new THREE.Vector3(shotOrigin.x + dir.x * blockDist, shotOrigin.y + dir.y * blockDist, shotOrigin.z + dir.z * blockDist),
        new THREE.Vector3(0, 1, 0)
      );
    } else {
      const isHead = hit.object.userData.isHead;
      const dmg = isHead ? wep.headDmg : wep.bodyDmg;

      spawnImpact(hit.point, hit.face ? hit.face.normal : new THREE.Vector3(0, 1, 0));

      const bot = findBotByPart(hit.object);
      if (bot) {
        hitmarker.classList.add('show');
        hitmarker.style.filter = isHead ? 'hue-rotate(200deg) brightness(2)' : 'none';
        clearTimeout(hitmarkerTimeout);
        hitmarkerTimeout = setTimeout(() => hitmarker.classList.remove('show'), 120);

        if (isHead) SFX.headshot();
        else SFX.hitmarker();

        const wasAlive = bot.alive;
        damageBot(bot, dmg, isHead);
        if (wasAlive && !bot.alive) SFX.kill_chaching();
      } else {
        // Not a bot — check remote players
        const remoteHit = findRemotePlayerByPart(hit.object);
        if (remoteHit && !remoteHit.rp.dead) {
          hitmarker.classList.add('show');
          hitmarker.style.filter = isHead ? 'hue-rotate(200deg) brightness(2)' : 'none';
          clearTimeout(hitmarkerTimeout);
          hitmarkerTimeout = setTimeout(() => hitmarker.classList.remove('show'), 120);
          if (isHead) SFX.headshot(); else SFX.hitmarker();
          // No friendly fire during warmup lobby — hitmarker shows but no damage sent
          if (!state.inLobby) sendShoot(remoteHit.id, dmg, isHead);
        }
      }
    }
  } else if (paneDist < Infinity) {
    // Shot hit window glass with no target behind it
    spawnImpact(paneHits[0].point, paneHits[0].face ? paneHits[0].face.normal : new THREE.Vector3(0, 1, 0));
  }

  updateHUD();
  setTimeout(() => { state.canFire = true; }, wep.fireRate);
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
  const w = 150, h = 150, scale = w / CONFIG.islandSize, cx = w / 2, cy = h / 2;
  mCtx.fillStyle = '#0a6699'; mCtx.fillRect(0, 0, w, h);
  const iSize = CONFIG.islandSize * scale;
  mCtx.fillStyle = '#3a5a2a';
  mCtx.fillRect(cx - iSize / 2, cy - iSize / 2, iSize, iSize);

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

  // Bots (alive = red dots)
  bots.forEach(b => {
    if (!b.alive) return;
    mCtx.fillStyle = '#ff4444';
    mCtx.beginPath();
    mCtx.arc(cx + b.group.position.x * scale, cy + b.group.position.z * scale, 2, 0, Math.PI * 2);
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
  if (state.crouching) speed *= CONFIG.crouchSpeedMult;

  if (CONFIG.newPhysics) {
    // ═══════════════════════════════════════════════════
    // NEW PHYSICS — capsule sweep-and-slide (08b_physics.js)
    // ═══════════════════════════════════════════════════
    physicsUpdate(fixedDt, smoothedMove, speed);

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
function update() {
  requestAnimationFrame(update);
  const renderDt = Math.min(clock.getDelta(), 0.05);

  refreshDynamicColliders();

  // ── Fixed-timestep physics accumulator ──
  // Catches up all missed 64Hz ticks since last render frame.
  // Player position is only ever advanced in steps of exactly FIXED_DT.
  physicsAccumulator += renderDt;
  while (physicsAccumulator >= FIXED_DT) {
    physicsStep(FIXED_DT);
    physicsAccumulator -= FIXED_DT;
  }

  // Canal boost HUD
  if (streamBoostEl) streamBoostEl.style.display = state.inCanal ? "block" : "none";

  if (!state.locked) {
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
    state.countdownTime = state.matchStartAt
      ? 1 - (Date.now() - state.matchStartAt) / 1000
      : state.countdownTime - renderDt;
    const num = Math.ceil(state.countdownTime);
    const cdEl = document.getElementById('countdown-num');
    if (num > 0 && num <= 10) {
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
      cdEl.classList.remove('show');
      state.gateOpening = true;
      SFX.gate_creak();
      const idx1 = collidables.indexOf(gateDoorL);
      if (idx1 >= 0) collidables.splice(idx1, 1);
      const idx2 = collidables.indexOf(gateDoorR);
      if (idx2 >= 0) collidables.splice(idx2, 1);
    }
  }

  // Check player death
  if (state.phase === 'playing' && state.hp <= 0 && !state.playerDead) {
    state.playerDead = true;
    state.phase = 'gameover';
    const goScreen = document.getElementById('game-over-screen');
    document.getElementById('go-kills').textContent = state.kills;
    const m = Math.floor(state.matchTime / 60);
    const s = Math.floor(state.matchTime % 60);
    document.getElementById('go-time').textContent = m + ':' + String(s).padStart(2, '0');
    setTimeout(() => goScreen.classList.add('show'), 500);
    document.getElementById('spectate-banner').classList.add('show');
  }

  // Check victory
  if (state.phase === 'playing' && !state.playerDead) {
    const aliveBotsCount = bots.filter(b => b.alive).length;
    if (aliveBotsCount === 0) {
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

  // Spectate mode
  if (state.playerDead) {
    const aliveBots = bots.filter(b => b.alive);
    if (aliveBots.length > 0) {
      const specBot = aliveBots[state.spectateIndex % aliveBots.length];
      const specPos = specBot.group.position;
      camera.position.lerp(new THREE.Vector3(specPos.x - 5, specPos.y + 4, specPos.z - 5), renderDt * 3);
      camera.lookAt(specPos.x, specPos.y + 1.5, specPos.z);
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

  if (!state.playerDead) updateBots(renderDt);

  // Snapshot interpolation — render each remote player at (now - INTERP_DELAY),
  // smoothly interpolating between two real received snapshots. No rubber-banding.
  const INTERP_DELAY = 100; // ms behind real-time
  const renderTime = Date.now() - INTERP_DELAY;

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
    rp.mesh.position.x = s0.x + (s1.x - s0.x) * alpha;
    rp.mesh.position.y = s0.y + (s1.y - s0.y) * alpha;
    rp.mesh.position.z = s0.z + (s1.z - s0.z) * alpha;

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

    // Crouch — smoothly lower the whole group when opponent is crouching
    const crouchTarget = rp.crouching ? -0.5 : 0;
    rp.crouchY += (crouchTarget - rp.crouchY) * Math.min(1, renderDt * 10);
    rp.mesh.position.y += rp.crouchY;
  }

  // Debug overlay - remote player distances


  // ── Match timer & water rise ──
  state.matchTime += renderDt;
  const remaining = Math.max(0, state.matchDuration - state.matchTime);
  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);
  document.getElementById('match-timer').textContent =
    String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');

  const aliveCount = bots.filter(b => b.alive).length + (state.playerDead ? 0 : 1);
  document.getElementById('alive-val').textContent = aliveCount;

  // Volcano eruption
  const eruptionTime = state.waterRiseStart - 15;
  if (state.matchTime >= eruptionTime && !state.erupted) {
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

  if (state.matchTime >= state.waterRiseStart) {
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

    const waterPosAttr = water.geometry.attributes.position;
    for (let i = 0; i < waterPosAttr.count; i++) {
      const wx = waterPosAttr.getX(i);
      const wy = waterPosAttr.getY(i);
      const wave = Math.sin(wx * 0.3 + clock.elapsedTime * 1.5) * Math.cos(wy * 0.3 + clock.elapsedTime) * 0.15;
      waterPosAttr.setZ(i, wave);
    }
    waterPosAttr.needsUpdate = true;

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
      const botFeetY = bot.group.position.y;
      if (state.waterLevel > botFeetY + 0.4) {
        bot.hp -= renderDt * 5;
        if (bot.hp <= 0) {
          bot.alive = false;
          bot.group.rotation.x = Math.PI / 2;
          bot.group.position.y = state.waterLevel;
          setTimeout(() => {
            bot.group.children.forEach(c => {
              const idx = targets.indexOf(c);
              if (idx >= 0) targets.splice(idx, 1);
            });
          }, 200);
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
  const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const _lootWP = new THREE.Vector3();
  const allLootSources = [...lootItems, ...depotCrates];
  for (const loot of allLootSources) {
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
    const toLoot = new THREE.Vector3(dx, 0, dz).normalize();
    const dot = lookDir.x * toLoot.x + lookDir.z * toLoot.z;
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

  // Smoke
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
  const restPos = state.currentWeapon === 'm4' ? new THREE.Vector3(0.25, -0.22, -0.38) : new THREE.Vector3(0.2, -0.2, -0.3);
  let targetPos;

  if (state.reloadPhase === 'down' || state.switchPhase === 'down') {
    targetPos = restPos.clone();
    targetPos.y = -0.7;
    targetPos.x += 0.05;
    weaponGroup.rotation.x = -0.3;
  } else if (state.reloadPhase === 'up' || state.switchPhase === 'up') {
    targetPos = restPos.clone();
  } else if (state.ads) {
    const adsX = state.currentWeapon === 'm4' ? 0 : -0.15;
    targetPos = new THREE.Vector3(adsX, -0.04, restPos.z + 0.06);
  } else {
    targetPos = restPos.clone();
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

  // Impact particles
  for (let i = impactParticles.length - 1; i >= 0; i--) {
    const p = impactParticles[i];
    p.userData.vel.y -= 9.8 * renderDt;
    p.position.addScaledVector(p.userData.vel, renderDt);
    p.userData.life -= renderDt;
    if (p.userData.life <= 0) { scene.remove(p); p.geometry.dispose(); p.material.dispose(); impactParticles.splice(i, 1); }
  }

  // Performance stats
  perfFrames++;
  if (clock.elapsedTime - perfLastTime >= 1) {
    const fps = perfFrames;
    perfFrames = 0;
    perfLastTime = clock.elapsedTime;
    const info = renderer.info;
    const tris = info.render.triangles;
    const calls = info.render.calls;
    document.getElementById('perf-stats').textContent =
      `FPS: ${fps} | Tris: ${(tris/1000).toFixed(1)}k | Calls: ${calls}`;
  }

  // Apply head bob (position) + landing pitch kick (rotation) for this frame only
  camera.position.add(state.shakeOffset);
  camera.position.y += headBobY;
  euler.set(state.pitch + landingBobY, state.yaw, 0, 'YXZ');
  camera.quaternion.setFromEuler(euler);
  if (window.skyDome) window.skyDome.position.copy(camera.position);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(weaponScene, weaponCamera);
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
  state.matchStartAt = Date.now();
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
    CONFIG.prisonPos.x + (Math.random() - 0.5) * 8,
    CONFIG.playerHeight,
    CONFIG.prisonPos.z + (Math.random() - 0.5) * 8
  );
  state.ammo.m4 = 30; state.ammo.pistol = 15;
  state.reserveAmmo.m4 = 90; state.reserveAmmo.pistol = 45;
  try { connectToServer(); } catch(e) { console.error("connectToServer failed:", e); }
};
update();

document.getElementById('go-restart').addEventListener('click', () => location.reload());
document.getElementById('win-restart').addEventListener('click', () => location.reload());

document.addEventListener('click', () => {
  if (state.playerDead) state.spectateIndex++;
});

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
const _remoteHitboxMat = new THREE.MeshBasicMaterial({ colorWrite: false });

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

  group.add(new THREE.Mesh(mergedGeo, _remotePlayerMat));

  // Invisible hitbox — separate so it stays at the fixed head position for raycasting
  const hitbox = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4), _remoteHitboxMat);
  hitbox.position.y = -0.10;
  hitbox.userData.isHead = true;
  group.add(hitbox);

  group.userData.id = id;
  scene.add(group);
  return group;
}
function removeRemotePlayer(id) {
  const rp = state.remotePlayers[id];
  if (!rp) return;
  scene.remove(rp.mesh);
  delete state.remotePlayers[id];
  console.log('Player left:', id);
}

function updateRemotePlayers(playerList) {
  const seen = new Set();
  const now = Date.now();

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
    rp.mesh.visible = !p.dead;

    rp.snapshots.push({ t: now, x: p.x, y: p.y, z: p.z, yaw: p.yaw, crouch: p.crouch });
    // Keep ~600ms of history; always retain at least 2 for interpolation
    const cutoff = now - 600;
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
    scene.remove(bot.group);
    bot.group.children.forEach(c => {
      const idx = targets.indexOf(c);
      if (idx >= 0) targets.splice(idx, 1);
    });
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
// Format: [0x01][count] then per player: 6-byte id | flags | hp | armor | uint16 yaw | int16 x,y,z (×100)
const _UNPACK_SCALE = 1 / 100;
function unpackWorld(ab) {
  const dv = new DataView(ab);
  const count = dv.getUint8(1);
  const players = [];
  let off = 2;
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
    players.push({ id, hp, armor, yaw, x, y, z, dead: !!(flags & 1), crouch: !!(flags & 2) });
  }
  return players;
}

function connectToServer() {
  console.log('Connecting to wss://deported.onrender.com');
  state.ws = new WebSocket('wss://deported.onrender.com');
  state.ws.binaryType = 'arraybuffer';

  state.ws.onopen = () => {
    console.log('WS connected — waiting for player to click play');
    state.wsReady = true;
    // In pvp mode, send join immediately on connect
    if (state.gameMode === 'pvp') sendJoin();
  };

  state.ws.onmessage = (event) => {
    // Binary world snapshot
    if (event.data instanceof ArrayBuffer) {
      const dv = new DataView(event.data);
      if (dv.getUint8(0) === 0x01) {
        state.lastWorldAt = Date.now();
        updateRemotePlayers(unpackWorld(event.data));
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
        state.countdownTime = 10;
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
        // Reset player to clean match start — no warmup gear carries over
        state.hp = 100;
        state.armor = 0;
        state.ammo = { m4: 0, pistol: 0 };
        state.reserveAmmo = { m4: 0, pistol: 0 };
        if (typeof updateHUD === 'function') updateHUD();
        state.velocityY = 0;
        camera.position.set(
          CONFIG.prisonPos.x + (Math.random() - 0.5) * 10,
          CONFIG.playerHeight,
          CONFIG.prisonPos.z + (Math.random() - 0.5) * 10
        );
        { const chatEl = document.getElementById('chat-container');
          if (chatEl) chatEl.style.setProperty('display', 'flex', 'important'); }
        // Can't call requestPointerLock from WS handler (not a user gesture) — flag it
        // and catch on next canvas click. Show prompt so player knows to click.
        state.pendingLock = true;
        { const pl = document.getElementById('click-to-play');
          if (pl) pl.style.setProperty('display', 'flex', 'important'); }
        break;
      case 'chat':
        addChatMessage(msg.id || 'unknown', msg.text || '');
        break;
      case 'events':
        for (const evt of msg.events) {
          if (evt.type === 'hit') applyHitEvent(evt);
        }
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
    setTimeout(connectToServer, 3000);
  };

  state.ws.onerror = (err) => {
    console.error('WS error', err);
  };
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
    (state.shooting    ? 64 : 0);
  _inputDV.setUint8(23, keys);
  state.ws.send(_inputBuf);
}

// Heartbeat — keeps connection alive when tab is backgrounded
setInterval(sendInputToServer, 50);

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
