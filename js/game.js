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

  prisonPos: { x: -75, z: 75 },
  prisonSize: 23,           // 15% larger
  prisonWallHeight: 10,

  moveSpeed: 11.97,         // 5% slower
  adsSpeedMult: 0.65,
  jumpForce: 9,
  gravity: 25,
  mouseSens: 0.0018,
  adsSens: 0.00108,
  adsFov: 55,
  normalFov: 75,
  playerHeight: 1.7,
  playerRadius: 0.4,
  moveSmoothing: 0.15,      // Strafe smoothing factor (lower = smoother)
  crouchHeight: 1.0,        // Camera height when crouched
  crouchSpeedMult: 0.5,     // 50% speed when crouched

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
  matchTime: 0,           // Elapsed seconds
  sprintTimer: 0,         // Counts down from 15 once gate fully opens
  waterRising: false,
  waterLevel: 0.05,
  waterRiseStart: 120,    // Water starts rising at 2:30
  matchDuration: 600,     // 10 minute match
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
scene.background = new THREE.Color(0x1a6fdb);
scene.fog = new THREE.FogExp2(0x2a88e8, 0.002);

// Bright yellow sun — no glow ring
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(10, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xFFEE00 })
);
sunMesh.position.set(80, 140, -60);
scene.add(sunMesh);

const camera = new THREE.PerspectiveCamera(CONFIG.normalFov, window.innerWidth / window.innerHeight, 0.35, 600);
camera.position.set(CONFIG.prisonPos.x, CONFIG.playerHeight, CONFIG.prisonPos.z);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
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
sun.position.set(80, 200, -60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 600;
sun.shadow.camera.left = -170; sun.shadow.camera.right = 170;
sun.shadow.camera.top = 170; sun.shadow.camera.bottom = -170;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x4488ff, 0x2d7a0a, 0.7));

// ═══════════════════════════════════════════════════════════
// TERRAIN — Meandering stream as carved depression
// ═══════════════════════════════════════════════════════════
const half = CONFIG.islandSize / 2;

// ── STREAM: circular ring with NO north bulge. Waterfall connects via explicit channel. ──
const streamHalfWidth = 5;
const streamBaseRadius = 82;
const streamSegments = 80;
const streamPoints = [];
for (let i = 0; i <= streamSegments; i++) {
  const angle = (i / streamSegments) * Math.PI * 2;
  const meander = Math.sin(angle * 3) * 8 + Math.sin(angle * 7) * 3 + Math.cos(angle * 5) * 4;
  const r = streamBaseRadius + meander;
  streamPoints.push({ x: Math.cos(angle) * r, z: Math.sin(angle) * r });
}

const wfTargetX = 0;
const wfWallZ = -half;

let wfChannelEndZ = -streamBaseRadius;
{
  let bestDist = Infinity;
  for (let i = 0; i < streamPoints.length; i++) {
    const dx = Math.abs(streamPoints[i].x);
    if (dx < 12 && streamPoints[i].z < 0) {
      const dz = streamPoints[i].z;
      if (dz < -20 && dx < bestDist) { bestDist = dx; wfChannelEndZ = dz; }
    }
  }
  wfChannelEndZ += streamHalfWidth;
}

function distToStream(x, z) {
  let minDist = Infinity;
  for (let i = 0; i < streamPoints.length - 1; i++) {
    const p = streamPoints[i], q = streamPoints[i + 1];
    const dx = q.x - p.x, dz = q.z - p.z;
    const len2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / len2));
    const dist = Math.sqrt((x - p.x - t*dx) ** 2 + (z - p.z - t*dz) ** 2);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

function isInStream(x, z) {
  return distToStream(x, z) < streamHalfWidth;
}

function getStreamDepth(x, z) {
  const d = distToStream(x, z);
  if (d > streamHalfWidth) return 0;
  return (1 - (d / streamHalfWidth) ** 2) * 0.06;
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
  if (vh > 0.5) return vh;
  const streamDep = getStreamDepth(x, z);
  const noiseFactor = streamDep > 0 ? Math.max(0, 1 - streamDep * 2) : 1;
  const baseH = Math.sin(x * 0.15) * Math.cos(z * 0.15) * 0.3 * noiseFactor;
  return baseH - streamDep;
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
  const dist = Math.sqrt(x * x + y * y);
  const inStream = isInStream(x, y);

  let r, g, b;
  if (h > 2) {
    const t = Math.min(h / CONFIG.volcanoHeight, 1);
    const vN1 = Math.sin(x * 3.1 + y * 2.0) * 0.040 + Math.sin(x * 7.3) * 0.025;
    const vN2 = Math.cos(x * 5.2 - y * 3.1) * 0.032 + Math.sin(y * 8.4) * 0.020;
    const vN3 = Math.sin(x * 12.7 + y * 9.3) * 0.015 + Math.cos(x * 18.1 - y * 14.6) * 0.010;
    const vN4 = Math.sin(x * 0.8 + y * 1.1) * 0.055;
    const vN5 = Math.cos(x * 24.3 - y * 19.7) * 0.006;
    const strata = Math.sin(h * 2.8) * 0.035 + Math.sin(h * 0.9) * 0.022;
    const midBlend  = Math.max(0, Math.min(1, (t - 0.25) / 0.35));
    const ashBlend  = Math.max(0, (t - 0.68) / 0.32);
    const lavaBlend = Math.max(0, (t - 0.88) / 0.12);
    const baseR = 0.14 + vN4 * 0.5;
    const baseG = 0.11 + vN4 * 0.4;
    const baseB = 0.10 + vN4 * 0.3;
    const oxR = 0.38 + vN1 * 0.8;
    const oxG = 0.22 + vN2 * 0.5;
    const oxB = 0.10;
    const ashR = 0.52 + vN3 + strata;
    const ashG = 0.50 + vN3 + strata * 0.8;
    const ashB = 0.48 + vN2 * 0.5 + strata * 0.6;
    const lavaR = 0.85 + vN5;
    const lavaG = 0.28 + vN5;
    const lavaB = 0.04;
    r = baseR + (oxR - baseR) * midBlend + (ashR - oxR) * ashBlend * midBlend + (lavaR - ashR) * lavaBlend + vN5 * 0.5;
    g = baseG + (oxG - baseG) * midBlend + (ashG - oxG) * ashBlend * midBlend + (lavaG - ashG) * lavaBlend + vN5 * 0.2;
    b = baseB + (oxB - baseB) * midBlend + (ashB - oxB) * ashBlend * midBlend + (lavaB - ashB) * lavaBlend;
  } else if (inStream) {
    const d = distToStream(x, y);
    const t = d / streamHalfWidth;
    r = 0.04 + t * 0.14;
    g = 0.18 + t * 0.20;
    b = 0.55 - t * 0.22;
  } else {
    const n1 = Math.sin(x * 0.48 + 0.3) * Math.cos(y * 0.71 + 0.1) * 0.09;
    const n2 = Math.sin(x * 2.31 + y * 1.72) * 0.045;
    const n3 = Math.sin(x * 0.11 - 0.2) * Math.cos(y * 0.094 + 0.5) * 0.07;
    const n4 = Math.sin(x * 5.7 + y * 4.3) * 0.02;
    const n5 = Math.cos(x * 9.1 - y * 7.8) * 0.012;
    const grass = n1 + n2 + n3 + n4 + n5;
    const warmth = Math.sin(x * 0.07 + y * 0.05) * 0.025;
    r = (0.07 + grass + warmth + Math.random() * 0.025) * 0.58;
    g = (0.26 + grass + Math.random() * 0.045) * 0.58;
    b = (0.05 + grass * 0.4 - warmth * 0.5) * 0.58;
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
const smokeMat = new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.22 });
const smokeInst = new THREE.InstancedMesh(smokeGeo, smokeMat, SMOKE_COUNT);
smokeInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(smokeInst);

// Store per-instance smoke data (replaces smokeParticles array of meshes)
const smokeParticles = [];
const _smokeDummy = new THREE.Object3D();
for (let i = 0; i < SMOKE_COUNT; i++) {
  const size = 1.0 + Math.random() * 2.5;
  const baseY = CONFIG.volcanoHeight + 1 + Math.random() * 16;
  smokeParticles.push({
    baseY,
    phase: Math.random() * 6.28,
    speed: 0.4 + Math.random() * 0.8,
    size,
    ox: (Math.random() - 0.5) * 6,
    oz: (Math.random() - 0.5) * 6,
    index: i
  });
  // Set initial matrix so nothing is at origin on frame 0
  _smokeDummy.position.set((Math.random() - 0.5) * 6, baseY, (Math.random() - 0.5) * 6);
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

// ── Rising bubble particles along perimeter ──
const bubbleGroup = new THREE.Group();
const bubbleMat = new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.35 });
for (let i = 0; i < 40; i++) {
  const angle = Math.random() * Math.PI * 2;
  const dist = half - 4 - Math.random() * 12;
  const bx = Math.cos(angle) * dist;
  const bz = Math.sin(angle) * dist;
  if (Math.abs(bx - CONFIG.prisonPos.x) < CONFIG.prisonSize / 2 + 5 &&
      Math.abs(bz - CONFIG.prisonPos.z) < CONFIG.prisonSize / 2 + 5) continue;
  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(0.4 + Math.random() * 0.7, 5, 4),
    bubbleMat
  );
  bubble.position.set(bx, -1 + Math.random() * 2, bz);
  bubble.userData = { speed: 0.4 + Math.random() * 0.8, phase: Math.random() * 6.28 };
  bubbleGroup.add(bubble);
}
scene.add(bubbleGroup);

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
    const band = Math.sin(vy * 1.8) * 0.06 + Math.sin(vy * 4.3) * 0.03;
    const nx = Math.sin(vx * 0.41 + pz * 0.17) * 0.05 + Math.cos(vx * 1.2) * 0.03;
    const t = (vy + 5) / (avgH + 5);
    const base = 0.36 + t * 0.12 + band + nx;
    cols2[i*3] = Math.min(1, base + 0.08);
    cols2[i*3+1] = Math.min(1, base * 0.88);
    cols2[i*3+2] = Math.min(1, base * 0.72);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols2, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.position.set(px, avgH / 2 - 3, pz);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  collidables.push(mesh);
});
// ═══════════════════════════════════════════════════════════
// PRISON COMPOUND — Taller walls
// ═══════════════════════════════════════════════════════════
const prison = { x: CONFIG.prisonPos.x, z: CONFIG.prisonPos.z, size: CONFIG.prisonSize };
const pw = prison.size;
const pwh = CONFIG.prisonWallHeight;
const pwt = 0.6;

// ── Prison materials — layered concrete tones ──
const prisonWallMat   = new THREE.MeshLambertMaterial({ color: 0x6a6a62 });
const prisonWallDark  = new THREE.MeshLambertMaterial({ color: 0x4e4e48 });
const prisonAccent    = new THREE.MeshLambertMaterial({ color: 0x58524a });
const prisonMetal     = new THREE.MeshLambertMaterial({ color: 0x38383a });
const prisonRust      = new THREE.MeshLambertMaterial({ color: 0x6b4030 });
const prisonCap       = new THREE.MeshLambertMaterial({ color: 0x505048 });

// Invisible collider material — colorWrite: false keeps it hidden
// but lets Box3.setFromObject() measure it correctly
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

  // Horizontal concrete band at mid-height
  const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.18, d + 0.04), prisonWallDark);
  band.position.set(x, h * 0.45, z);
  scene.add(band);

  // Lower base strip
  const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.35, d + 0.1), prisonAccent);
  base.position.set(x, 0.175, z);
  base.receiveShadow = true;
  scene.add(base);

  // Invisible collider — padded +0.5 on the thin axis to prevent clipping
  const cw = w < d ? w + 0.5 : w;
  const cd = d < w ? d + 0.5 : d;
  const collider = new THREE.Mesh(new THREE.BoxGeometry(cw, h, cd), colliderMat);
  collider.position.set(x, h / 2, z);
  scene.add(collider);
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

// Vertical pilasters
{
  const pilasterMat = new THREE.MeshLambertMaterial({ color: 0x5c5c54 });
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

// Gate doors
const gateHalfW = gateWidth / 2;
const gateDoorMat = new THREE.MeshLambertMaterial({ color: 0x3a3028 });

const gateDoorL = new THREE.Mesh(new THREE.BoxGeometry(pwt + 0.25, pwh, gateHalfW), gateDoorMat);
const gatePivotL = new THREE.Group();
gatePivotL.position.set(prison.x + pw / 2, 0, prison.z - gateWidth / 2);
gateDoorL.position.set(0, pwh / 2, gateHalfW / 2);
gatePivotL.add(gateDoorL);
scene.add(gatePivotL);
// Push the actual door mesh — refreshDynamicColliders updates its world BB each frame
// so collision follows the door as it swings open
collidables.push(gateDoorL);

const gateDoorR = new THREE.Mesh(new THREE.BoxGeometry(pwt + 0.25, pwh, gateHalfW), gateDoorMat);
const gatePivotR = new THREE.Group();
gatePivotR.position.set(prison.x + pw / 2, 0, prison.z + gateWidth / 2);
gateDoorR.position.set(0, pwh / 2, -gateHalfW / 2);
gatePivotR.add(gateDoorR);
scene.add(gatePivotR);
collidables.push(gateDoorR);

// Iron bars + cross bracing on each door
for (const door of [gateDoorL, gateDoorR]) {
  for (let b = 0; b < 4; b++) {
    const bar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, pwh * 0.85, 5),
      prisonMetal
    );
    bar.position.set(0.18, 0, (b / 3 - 0.5) * gateHalfW * 0.72);
    door.add(bar);
  }
  const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, gateHalfW * 0.9), prisonMetal);
  hBar.position.set(0.18, pwh * 0.15, 0);
  door.add(hBar);
  const hBar2 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, gateHalfW * 0.9), prisonMetal);
  hBar2.position.set(0.18, -pwh * 0.2, 0);
  door.add(hBar2);
  for (let r = 0; r < 3; r++) {
    const rust = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.18), prisonRust);
    rust.position.set(0.22, pwh * 0.1 - r * pwh * 0.15, (Math.random() - 0.5) * gateHalfW * 0.6);
    door.add(rust);
  }
}
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
  scene.add(towerCollider);
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
// JUNGLE — Trees and Bushes
// ═══════════════════════════════════════════════════════════
function canPlaceAt(x, z) {
  if (getVolcanoHeight(x, z) > 1) return false;
  if (Math.abs(x - prison.x) < pw / 2 + 10 && Math.abs(z - prison.z) < pw / 2 + 10) return false;
  if (Math.abs(x) > half - 12 || Math.abs(z) > half - 12) return false;
  if (isInStream(x, z)) return false; // No trees/bushes in stream
  return true;
}

// Shared invisible collider material — colorWrite:false is required so that
// THREE.Box3().setFromObject() can still compute a real bounding box.
// Using visible:false breaks setFromObject and returns an empty/zero-size box.
const invisibleColliderMat = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
  colorWrite: false
});

// ── Instanced Trees — 2 draw calls for all trunks + all canopies ──
{
  const treePlacements = [];
  const treeGridSize = 18;
  for (let gx = -half + 15; gx < half - 15; gx += treeGridSize) {
    for (let gz = -half + 15; gz < half - 15; gz += treeGridSize) {
      const x = gx + (Math.random() - 0.5) * treeGridSize * 0.7;
      const z = gz + (Math.random() - 0.5) * treeGridSize * 0.7;
      if (canPlaceAt(x, z)) treePlacements.push({ x, z });
    }
  }

  const treeCount = treePlacements.length;

  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.62, 1, 8);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x2e1e0f });
  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  trunkInst.castShadow = true;

  const flareGeo = new THREE.CylinderGeometry(0.55, 0.90, 1, 8);
  const flareMat = new THREE.MeshLambertMaterial({ color: 0x271808 });
  const flareInst = new THREE.InstancedMesh(flareGeo, flareMat, treeCount);
  flareInst.castShadow = false;

  const canopyGeo = new THREE.SphereGeometry(1, 10, 8);
  const canopyMat = new THREE.MeshLambertMaterial({ color: 0x1e4d0f });
  const canopyInst = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount);
  canopyInst.castShadow = true;

  const canopy2Geo = new THREE.SphereGeometry(1, 9, 7);
  const canopy2Mat = new THREE.MeshLambertMaterial({ color: 0x2e6b18 });
  const canopy2Inst = new THREE.InstancedMesh(canopy2Geo, canopy2Mat, treeCount);
  canopy2Inst.castShadow = false;

  const canopy3Geo = new THREE.SphereGeometry(1, 8, 6);
  const canopy3Mat = new THREE.MeshLambertMaterial({ color: 0x3d8220 });
  const canopy3Inst = new THREE.InstancedMesh(canopy3Geo, canopy3Mat, treeCount);
  canopy3Inst.castShadow = false;

  const dummy = new THREE.Object3D();

  treePlacements.forEach(({ x, z }, i) => {
    const h = getTerrainHeight(x, z);
    const trunkH   = 5.5 + Math.random() * 4.0;
    const trunkR   = 0.42 + Math.random() * 0.32;
    const canopyR  = (2.2 + Math.random() * 2.8) * 1.5;
    const scaleY   = 0.55 + Math.random() * 0.28;
    const lean     = (Math.random() - 0.5) * 0.06;

    dummy.position.set(x, h + trunkH / 2, z);
    dummy.scale.set(trunkR / 0.44, trunkH, trunkR / 0.44);
    dummy.rotation.set(lean, Math.random() * 6.28, lean * 0.5);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(x, h + 0.55, z);
    dummy.scale.set(trunkR / 0.44 * 1.1, 1.1, trunkR / 0.44 * 1.1);
    dummy.rotation.set(0, Math.random() * 6.28, 0);
    dummy.updateMatrix();
    flareInst.setMatrixAt(i, dummy.matrix);

    const jx = (Math.random()-0.5)*0.6, jz = (Math.random()-0.5)*0.6;
    dummy.position.set(x + jx, h + trunkH + canopyR * 0.25, z + jz);
    dummy.scale.set(canopyR, canopyR * scaleY, canopyR);
    dummy.rotation.set(lean * 0.3, Math.random() * 6.28, 0);
    dummy.updateMatrix();
    canopyInst.setMatrixAt(i, dummy.matrix);

    const c2r = canopyR * (0.60 + Math.random() * 0.18);
    dummy.position.set(x + jx + (Math.random()-0.5)*1.2, h + trunkH + canopyR * 0.52 + c2r * 0.1, z + jz + (Math.random()-0.5)*1.2);
    dummy.scale.set(c2r, c2r * (scaleY * 0.88 + 0.08), c2r);
    dummy.rotation.set(0, Math.random() * 6.28, 0);
    dummy.updateMatrix();
    canopy2Inst.setMatrixAt(i, dummy.matrix);

    const c3r = canopyR * (0.35 + Math.random() * 0.15);
    dummy.position.set(x + jx * 0.3, h + trunkH + canopyR * 0.8 + c3r * 0.3, z + jz * 0.3);
    dummy.scale.set(c3r, c3r * (scaleY * 0.75 + 0.15), c3r);
    dummy.rotation.set(0, Math.random() * 6.28, 0);
    dummy.updateMatrix();
    canopy3Inst.setMatrixAt(i, dummy.matrix);

    // Trunk PLAYER collider — generous, prevents walking through
    const trunkCol = new THREE.Mesh(
      new THREE.BoxGeometry(trunkR * 2.4, trunkH, trunkR * 2.4),
      invisibleColliderMat
    );
    trunkCol.position.set(x, h + trunkH / 2, z);
    scene.add(trunkCol);
    collidables.push(trunkCol);

    // Trunk BULLET hitbox — tight to visual trunk cylinder
    const trunkHit = new THREE.Mesh(
      new THREE.BoxGeometry(trunkR * 1.8, trunkH, trunkR * 1.8),
      invisibleColliderMat
    );
    trunkHit.position.set(x, h + trunkH / 2, z);
    scene.add(trunkHit);
    targets.push(trunkHit);

    // Canopy BULLET hitbox — tight to visual squashed sphere
    const canopyHit = new THREE.Mesh(
      new THREE.BoxGeometry(canopyR * 1.3, canopyR * scaleY * 1.4, canopyR * 1.3),
      invisibleColliderMat
    );
    canopyHit.position.set(x, h + trunkH + canopyR * 0.35, z);
    scene.add(canopyHit);
    targets.push(canopyHit);
  });

  trunkInst.instanceMatrix.needsUpdate = true;
  flareInst.instanceMatrix.needsUpdate = true;
  canopyInst.instanceMatrix.needsUpdate = true;
  canopy2Inst.instanceMatrix.needsUpdate = true;
  canopy3Inst.instanceMatrix.needsUpdate = true;
  scene.add(trunkInst);
  scene.add(flareInst);
  scene.add(canopyInst);
  scene.add(canopy2Inst);
  scene.add(canopy3Inst);
}

// ── Instanced Bushes ──
{
  const bushPlacements = [];
  const bushGridSize = 14;
  for (let gx = -half + 20; gx < half - 20; gx += bushGridSize) {
    for (let gz = -half + 20; gz < half - 20; gz += bushGridSize) {
      const x = gx + (Math.random() - 0.5) * bushGridSize * 0.8 + bushGridSize / 2;
      const z = gz + (Math.random() - 0.5) * bushGridSize * 0.8 + bushGridSize / 2;
      if (canPlaceAt(x, z)) bushPlacements.push({ x, z });
    }
  }

  // bushInst  = arborvitae cone body  (even indices)
  // bush2Inst = arborvitae base trunk  (even indices)
  // bush3Inst = decorative small bush  (odd indices, no collider)
  const bushGeo  = new THREE.ConeGeometry(0.5, 1, 6);
  const bushMat  = new THREE.MeshLambertMaterial({ color: 0x1a4a0e });
  const bushInst = new THREE.InstancedMesh(bushGeo, bushMat, bushPlacements.length);
  bushInst.castShadow = true;
  const bush2Geo  = new THREE.CylinderGeometry(0.25, 0.38, 0.5, 6);
  const bush2Mat  = new THREE.MeshLambertMaterial({ color: 0x243318 });
  const bush2Inst = new THREE.InstancedMesh(bush2Geo, bush2Mat, bushPlacements.length);
  bush2Inst.castShadow = false;
  const bush3Geo  = new THREE.SphereGeometry(1, 6, 4);
  const bush3Mat  = new THREE.MeshLambertMaterial({ color: 0x2d5c18 });
  const bush3Inst = new THREE.InstancedMesh(bush3Geo, bush3Mat, bushPlacements.length);
  bush3Inst.castShadow = false;
  const dummy = new THREE.Object3D();
  const zeroMatrix = (() => { const d = new THREE.Object3D(); d.scale.set(0,0,0); d.updateMatrix(); return d.matrix.clone(); })();
  bushPlacements.forEach(({ x, z }, i) => {
    const h = getTerrainHeight(x, z);
    if (i % 2 === 0) {
      // Arborvitae
      const w  = (0.4 + Math.random() * 0.35) * 2.2;
      const ht = w * (2.6 + Math.random() * 1.0);
      dummy.position.set(x, h + ht * 0.5, z);
      dummy.scale.set(w, ht, w);
      dummy.rotation.set(0, Math.random() * 6.28, 0);
      dummy.updateMatrix();
      bushInst.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, h + 0.25, z);
      dummy.scale.set(w * 0.55, 1, w * 0.55);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      bush2Inst.setMatrixAt(i, dummy.matrix);
      bush3Inst.setMatrixAt(i, zeroMatrix);
      const bushCol = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.1, ht * 1.05, w * 1.1),
        invisibleColliderMat
      );
      bushCol.position.set(x, h + ht * 0.5, z);
      scene.add(bushCol);
      collidables.push(bushCol);
      const bushHit = new THREE.Mesh(
        new THREE.BoxGeometry(w, ht, w),
        invisibleColliderMat
      );
      bushHit.position.set(x, h + ht * 0.5, z);
      scene.add(bushHit);
      targets.push(bushHit);
    } else {
      // Decorative small bush — no collider, walkthrough
      const dr     = 0.35 + Math.random() * 0.55;
      const dScaleY = 0.28 + Math.random() * 0.22;
      dummy.position.set(x, h + dr * dScaleY * 0.5, z);
      dummy.scale.set(dr, dr * dScaleY, dr);
      dummy.rotation.set(0, Math.random() * 6.28, 0);
      dummy.updateMatrix();
      bush3Inst.setMatrixAt(i, dummy.matrix);
      bushInst.setMatrixAt(i, zeroMatrix);
      bush2Inst.setMatrixAt(i, zeroMatrix);
    }
  });
  bushInst.instanceMatrix.needsUpdate = true;
  bush2Inst.instanceMatrix.needsUpdate = true;
  bush3Inst.instanceMatrix.needsUpdate = true;
  scene.add(bushInst);
  scene.add(bush2Inst);
  scene.add(bush3Inst);
}
}

// ── Instanced Rocks ──
const rockColors = [0x8a8278, 0x7a7068, 0x9a9088, 0x6a6258, 0x8a8070, 0x5a5248, 0xa09888, 0x706860];
{
  const rockPlacements = [];
  const rockGridSize = 21;
  for (let gx = -half + 25; gx < half - 25; gx += rockGridSize) {
    for (let gz = -half + 25; gz < half - 25; gz += rockGridSize) {
      const x = gx + (Math.random() - 0.5) * rockGridSize * 0.6;
      const z = gz + (Math.random() - 0.5) * rockGridSize * 0.6;
      if (canPlaceAt(x, z)) rockPlacements.push({ x, z });
    }
  }

  const rockGeo = new THREE.DodecahedronGeometry(0.7, 0);
  const rockMat = new THREE.MeshPhongMaterial({ color: 0x8a8278, flatShading: true });
  const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, rockPlacements.length);
  rockInst.castShadow = true;

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  rockPlacements.forEach(({ x, z }, i) => {
    const h = getTerrainHeight(x, z);
    const rockSize = 1.0 + Math.random() * 1.0;
    const rw = rockSize * (1.0 + Math.random() * 0.5);
    const rh = rockSize * (0.6 + Math.random() * 0.4);
    const rd = rockSize * (1.0 + Math.random() * 0.5);

    dummy.position.set(x, h + rh * 0.5, z);
    dummy.scale.set(rw, rh, rd);
    dummy.rotation.set(Math.random() * 0.3, Math.random() * 6.28, Math.random() * 0.2);
    dummy.updateMatrix();
    rockInst.setMatrixAt(i, dummy.matrix);
    rockInst.setColorAt(i, col.set(rockColors[Math.floor(Math.random() * rockColors.length)]));

    // Rock PLAYER collider — generous, prevents walking through
    const collider = new THREE.Mesh(
      new THREE.BoxGeometry(rw * 1.0, rh + 2, rd * 1.0),
      invisibleColliderMat
    );
    collider.position.set(x, h + rh * 0.5, z);
    scene.add(collider);
    collidables.push(collider);

    // Rock BULLET hitbox — tight to visual rock shape
    const rockHit = new THREE.Mesh(
      new THREE.BoxGeometry(rw * 0.8, rh * 1.0, rd * 0.8),
      invisibleColliderMat
    );
    rockHit.position.set(x, h + rh * 0.5, z);
    scene.add(rockHit);
    targets.push(rockHit);
  });

  rockInst.instanceMatrix.needsUpdate = true;
  if (rockInst.instanceColor) rockInst.instanceColor.needsUpdate = true;
  scene.add(rockInst);
}

// Volcano LOS/bullet blocker
const bulletBlockers = [];

const vBase = new THREE.Mesh(
  new THREE.CylinderGeometry(CONFIG.volcanoRadius * 1.05, CONFIG.volcanoRadius * 1.05, CONFIG.volcanoHeight * 0.55, 16),
  invisibleColliderMat
);
vBase.position.set(0, CONFIG.volcanoHeight * 0.275, 0);
scene.add(vBase);
bulletBlockers.push(vBase);

const vMid = new THREE.Mesh(
  new THREE.CylinderGeometry(CONFIG.volcanoRadius * 0.65, CONFIG.volcanoRadius * 1.0, CONFIG.volcanoHeight * 0.45, 16),
  invisibleColliderMat
);
vMid.position.set(0, CONFIG.volcanoHeight * 0.60, 0);
scene.add(vMid);
bulletBlockers.push(vMid);

const vTop = new THREE.Mesh(
  new THREE.CylinderGeometry(CONFIG.volcanoRadius * 0.22, CONFIG.volcanoRadius * 0.60, CONFIG.volcanoHeight * 0.35, 12),
  invisibleColliderMat
);
vTop.position.set(0, CONFIG.volcanoHeight * 0.875, 0);
scene.add(vTop);
bulletBlockers.push(vTop);

for (let i = 0; i < 25; i++) {
  const angle = Math.random() * Math.PI * 2;
  const r = 10 + Math.random() * (CONFIG.volcanoRadius - 14);
  const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
  const h = getTerrainHeight(x, z);
  const rockSize = 0.8 + Math.random() * 1.8;
  const rw = rockSize * (0.9 + Math.random() * 0.3);
  const rh = rockSize * (0.4 + Math.random() * 0.5);
  const rd = rockSize * (0.9 + Math.random() * 0.3);

  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(rockSize * 0.65, 1),
    new THREE.MeshPhongMaterial({ color: rockColors[Math.floor(Math.random() * rockColors.length)], flatShading: true })
  );
  rock.position.set(x, h + rh * 0.45, z);
  rock.rotation.set(Math.random() * 0.3, Math.random() * 6.28, Math.random() * 0.2);
  rock.scale.set(rw / rockSize, rh / rockSize, rd / rockSize);
  rock.castShadow = true;
  scene.add(rock);
  targets.push(rock);

  const collider = new THREE.Mesh(
    new THREE.BoxGeometry(rw * 0.65, rh + 2, rd * 0.65),
    invisibleColliderMat
  );
  collider.position.set(x, h + rh * 0.5 - 0.5, z);
  scene.add(collider);
  collidables.push(collider);
}

// ═══════════════════════════════════════════════════════════
// BOTS — AI with shooting, prison spawn, ammo seeking
// ═══════════════════════════════════════════════════════════
const BOT_NAMES = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Golf','Hotel','India','Juliet',
  'Kilo','Lima','Mike','November','Oscar','Papa','Quebec','Romeo','Sierra','Tango'];

function createBot(x, z, name) {
  const h = getTerrainHeight(x, z);
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
    shootAccuracy: 0.12 + Math.random() * 0.16, // 20% better (was 0.15+0.20)
    aggroRange: 30 + Math.random() * 20,
    exitDelay: 0,
    exitedPrison: false,
    parts: { body, head, legs: group.children.filter((_, i) => i >= 3 && i <= 4), arms: group.children.filter((_, i) => i >= 5) },
  };
  bots.push(bot);
  return bot;
}

// Spawn all bots inside prison — spread out, staggered exit
for (let i = 0; i < 20; i++) {
  const row = Math.floor(i / 5);
  const col = i % 5;
  const px = CONFIG.prisonPos.x - CONFIG.prisonSize / 2 + 5 + col * ((CONFIG.prisonSize - 10) / 4);
  const pz = CONFIG.prisonPos.z - CONFIG.prisonSize / 2 + 5 + row * ((CONFIG.prisonSize - 10) / 3);
  const bot = createBot(px, pz, BOT_NAMES[i] || 'Bot');
  bot.exitDelay = i * 0.4;
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
      const th = getTerrainHeight(bot.group.position.x, bot.group.position.z);
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

    // Flee rising water — head uphill toward volcano
    if (state.waterRising && state.waterLevel > getTerrainHeight(bx, bz) - 1) {
      bot.moveDir.set(-bx, 0, -bz).normalize(); // Move toward center (volcano)
      bot.speed = 3;
    }
    // If has ammo and player is in range — engage (with LOS check)
    else if (bot.hasAmmo && distToPlayer < bot.aggroRange && !state.playerDead) {
      // Line of sight check — can bot see player?
      const botEye = new THREE.Vector3(bx, bot.group.position.y + 1.7, bz);
      const toPlayer = new THREE.Vector3(dx, camera.position.y - botEye.y, dz).normalize();
      const losRay = new THREE.Raycaster(botEye, toPlayer, 0, distToPlayer);
      const losHits = losRay.intersectObjects(collidables, false); // raycaster handles its own BB

      // Also check if shot path passes through volcano terrain
      let volcanoBlocking = false;
      {
        const steps = 20;
        const stepSize = distToPlayer / steps;
        for (let s = 1; s < steps; s++) {
          const t = s * stepSize;
          const px = botEye.x + toPlayer.x * t;
          const py = botEye.y + toPlayer.y * t;
          const pz = botEye.z + toPlayer.z * t;
          const volH = getVolcanoHeight(px, pz);
          if (volH > 0.8 && py < volH - 0.1) { volcanoBlocking = true; break; }
        }
      }

      const hasLOS = losHits.length === 0 && !volcanoBlocking;

      // Face player
      bot.group.rotation.y = Math.atan2(dx, dz);

      // Strafe slightly while shooting
      const strafeDir = new THREE.Vector3(-dz, 0, dx).normalize();
      bot.moveDir.copy(strafeDir).multiplyScalar(Math.sin(bot.walkPhase) > 0 ? 1 : -1);
      bot.speed = 1.5;

      // Shoot at player (only if LOS clear)
      bot.shootCooldown -= dt;
      if (bot.shootCooldown <= 0 && hasLOS) {
        bot.shootCooldown = 0.8 + Math.random() * 1.5; // Fire every 0.8-2.3 seconds
        // Accuracy check — distance affects accuracy
        const hitChance = Math.max(0.08, 0.48 - distToPlayer * 0.005 - bot.shootAccuracy); // 20% better
        if (Math.random() < hitChance) {
          // Hit player
          const dmg = 8 + Math.floor(Math.random() * 7); // 8-14 damage
          if (state.armor > 0) {
            state.armor = Math.max(0, state.armor - dmg);
          } else {
            state.hp = Math.max(0, state.hp - dmg);
          }
          updateHUD();
          // Flash red vignette
          const dv = document.getElementById('damage-vignette');
          dv.classList.add('show');
          setTimeout(() => dv.classList.remove('show'), 350);
          SFX.hitmarker();
        }
        // Bot gunshot sound (quieter, distant)
        playNoise(0.06, 0.08 * Math.max(0.2, 1 - distToPlayer / 80), 3000, 'bandpass');
      }
    }
    // No ammo — seek loot
    else if (!bot.hasAmmo) {
      let nearestLoot = null, nearestDist = Infinity;
      for (const loot of lootItems) {
        if (loot.userData.lootType !== 'ammo_m4' && loot.userData.lootType !== 'ammo_pistol') continue;
        const ld = Math.sqrt((bx - loot.position.x) ** 2 + (bz - loot.position.z) ** 2);
        if (ld < nearestDist) { nearestDist = ld; nearestLoot = loot; }
      }
      if (nearestLoot && nearestDist > 2) {
        bot.moveDir.set(nearestLoot.position.x - bx, 0, nearestLoot.position.z - bz).normalize();
        bot.speed = 2.5;
      } else if (nearestLoot && nearestDist <= 2) {
        // Pick up ammo
        bot.hasAmmo = true;
        scene.remove(nearestLoot); nearestLoot.geometry.dispose(); nearestLoot.material.dispose();
        const idx = lootItems.indexOf(nearestLoot);
        if (idx >= 0) lootItems.splice(idx, 1);
      } else {
        // Wander randomly
        bot.moveTimer -= dt;
        if (bot.moveTimer <= 0) {
          bot.moveDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
          bot.moveTimer = 2 + Math.random() * 5;
        }
        bot.speed = 2;
      }
    }
    // Has ammo but player out of range — wander
    else {
      bot.moveTimer -= dt;
      if (bot.moveTimer <= 0) {
        bot.moveDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
        bot.moveTimer = 2 + Math.random() * 5;
        bot.speed = 1.5 + Math.random() * 1.5;
      }
    }

    const newX = bx + bot.moveDir.x * bot.speed * dt;
    const newZ = bz + bot.moveDir.z * bot.speed * dt;

    let canMove = true;
    if (Math.abs(newX) >= half - 12 || Math.abs(newZ) >= half - 12) canMove = false;
    if (canMove && getVolcanoHeight(newX, newZ) > 18) canMove = false;
    if (canMove && checkBotCollision(newX, newZ, bot)) canMove = false;

    if (canMove) {
      bot.group.position.x = newX;
      bot.group.position.z = newZ;
    } else {
      bot.moveDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      bot.moveTimer = 1 + Math.random() * 2;
    }

    const th = getTerrainHeight(bot.group.position.x, bot.group.position.z);
    bot.group.position.y += (th - bot.group.position.y) * Math.min(1, dt * 18);
    if (!bot.hasAmmo || distToPlayer >= bot.aggroRange || state.playerDead) {
      bot.group.rotation.y = Math.atan2(bot.moveDir.x, bot.moveDir.z);
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
    bot.group.position.y = getTerrainHeight(bot.group.position.x, bot.group.position.z) + 0.3;

    // Remove from targets after brief delay
    setTimeout(() => {
      bot.group.children.forEach(c => {
        const idx = targets.indexOf(c);
        if (idx >= 0) targets.splice(idx, 1);
      });
    }, 200);

    // Drop loot pile
    const types = ['ammo_m4', 'ammo_pistol', 'health', 'armor'];
    const drop = types[Math.floor(Math.random() * types.length)];
    spawnLoot(bot.group.position.x, bot.group.position.z, drop);
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
    // Bullet box — rectangular with small cylinders on top
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
    // Health pack — white box with red cross
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
    // Armored vest — wider box with shoulder straps
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
}

// ═══════════════════════════════════════════════════════════
// AMMO DEPOTS — 4 corner sheds with interactive crates
// ═══════════════════════════════════════════════════════════
const depotCorners = [
  { x:  half - 6, z:  half - 6, open: 'east'  }, // SE — open toward east wall
  { x: -half + 6, z:  half - 6, open: 'west'  }, // SW — open toward west wall
  { x:  half - 6, z: -half + 6, open: 'east'  }, // NE — open toward east wall
  { x: -half + 6, z: -half + 6, open: 'west'  }, // NW — open toward west wall
];

// ── Shed materials — weathered wood planks ──
const shedMat      = new THREE.MeshLambertMaterial({ color: 0x7a5618 }); // aged plank
const shedDark     = new THREE.MeshLambertMaterial({ color: 0x4e3209 }); // deep shadow wood
const shedLight    = new THREE.MeshLambertMaterial({ color: 0x9a6e28 }); // highlighted board
const floorMat     = new THREE.MeshLambertMaterial({ color: 0x2e1608 }); // dark earth floor
const roofMat      = new THREE.MeshLambertMaterial({ color: 0x3a2808 }); // dark shingle
const roofRust     = new THREE.MeshLambertMaterial({ color: 0x6b3818 }); // rusted overhang
const crateM4Mat   = new THREE.MeshLambertMaterial({ color: 0x4a3800 }); // dark olive — M4 ammo
const crate19Mat   = new THREE.MeshLambertMaterial({ color: 0x3d1a00 }); // dark brown — pistol ammo
const crateArMat   = new THREE.MeshLambertMaterial({ color: 0x0d2a4a }); // dark navy — armor
const crateHpMat   = new THREE.MeshLambertMaterial({ color: 0x8b0000 }); // deep red — health
const depotCrates  = [];

depotCorners.forEach(({ x, z, open }) => {
  const h = getTerrainHeight(x, z);
  const sw = 6.6, sd = 5.0, sh = 3.6, wt = 0.22;

  // Floor — raised wood deck
  const floor = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.1, 0.18, sd + 0.1), floorMat);
  floor.position.set(x, h + 0.09, z);
  floor.receiveShadow = true;
  scene.add(floor);
  // Floor plank lines (dark strips)
  for (let p = -2; p <= 2; p++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.02, 0.06), shedDark);
    plank.position.set(x, h + 0.19, z + p * 0.9);
    scene.add(plank);
  }

  // Walls — each with a horizontal mid-board accent strip
  const allWalls = [
    { px: 0,     pz: -sd/2, w: sw,  d: wt, axis: 'north' },
    { px: 0,     pz:  sd/2, w: sw,  d: wt, axis: 'south' },
    { px: -sw/2, pz: 0,     w: wt,  d: sd, axis: 'west'  },
    { px:  sw/2, pz: 0,     w: wt,  d: sd, axis: 'east'  },
  ];
  allWalls.forEach(({ px, pz, w, d, axis }) => {
    if (axis === open) return;
    // Main wall
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, sh, d), shedMat);
    wall.position.set(x + px, h + sh / 2, z + pz);
    wall.castShadow = true; wall.receiveShadow = true;
    scene.add(wall); collidables.push(wall);
    // Horizontal board strip at mid height
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.10, d + 0.02), shedDark);
    strip.position.set(x + px, h + sh * 0.5, z + pz);
    scene.add(strip);
    // Bottom base strip
    const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.18, d + 0.04), shedDark);
    base.position.set(x + px, h + 0.09, z + pz);
    scene.add(base);
    // Vertical corner post on each end of wall
    const postH = sh + 0.1;
    for (const s of [-1, 1]) {
      const isX = (d > w); // side walls run along Z
      const postX = isX ? x + px : x + px + s * (w / 2 - 0.05);
      const postZ = isX ? z + pz + s * (d / 2 - 0.05) : z + pz;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, postH, 0.14), shedDark);
      post.position.set(postX, h + postH / 2, postZ);
      post.castShadow = true;
      scene.add(post);
    }
  });

  // Open-face door frame — two posts + header beam
  const openAxis = allWalls.find(w => w.axis === open);
  if (openAxis) {
    const { px, pz, w, d } = openAxis;
    for (const s of [-1, 1]) {
      const isX = (d > w);
      const fpX = isX ? x + px : x + px + s * (w / 2 - 0.08);
      const fpZ = isX ? z + pz + s * (d / 2 - 0.08) : z + pz;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, sh + 0.15, 0.16), shedDark);
      post.position.set(fpX, h + (sh + 0.15) / 2, fpZ);
      scene.add(post);
    }
    const header = new THREE.Mesh(new THREE.BoxGeometry(isX => isX ? wt + 0.1 : w, 0.2, isX => isX ? d : wt + 0.1), shedLight);
    // Simplified header beam above doorway
    const hdrW = (d > w) ? wt + 0.1 : w;
    const hdrD = (d > w) ? d : wt + 0.1;
    const hdr = new THREE.Mesh(new THREE.BoxGeometry(hdrW, 0.2, hdrD), shedLight);
    hdr.position.set(x + px, h + sh + 0.05, z + pz);
    scene.add(hdr);
  }

  // Pitched roof — two sloping panels + ridge beam
  const ridgeH = 0.9;
  const roofAngle = Math.atan2(ridgeH, sw / 2);
  const panelW = Math.sqrt((sw / 2) ** 2 + ridgeH ** 2) + 0.3;
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(panelW, 0.16, sd + 0.7), roofMat);
    panel.rotation.z = side * roofAngle;
    panel.position.set(x + side * sw / 4, h + sh + ridgeH / 2, z);
    panel.castShadow = true;
    scene.add(panel);
    // Rusty overhang lip
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.10, sd + 0.8), roofRust);
    lip.rotation.z = side * roofAngle;
    lip.position.set(x + side * (panelW / 2 + 0.05), h + sh + ridgeH / 2 - panelW * Math.sin(roofAngle) / 2, z);
    scene.add(lip);
  }
  // Ridge beam
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, sd + 0.8), shedDark);
  ridge.position.set(x, h + sh + ridgeH + 0.04, z);
  scene.add(ridge);
  // Gable end triangles
  for (const side of [-1, 1]) {
    const gable = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.1, ridgeH, wt), shedMat);
    gable.position.set(x, h + sh + ridgeH / 2, z + side * (sd / 2 + wt / 2));
    scene.add(gable);
  }

  // 4 crates — spaced evenly along Z, back of shed
  const crateBackX = open === 'east' ? x - sw * 0.26 : x + sw * 0.26;
  const white  = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const yellow = new THREE.MeshBasicMaterial({ color: 0xffdd44 });
  const red    = new THREE.MeshBasicMaterial({ color: 0xff2222 });
  const blue   = new THREE.MeshBasicMaterial({ color: 0x44aaff });
  const black  = new THREE.MeshLambertMaterial({ color: 0x000000 });

  [
    { oz: -2.0, mat: crateM4Mat,  type: 'depot_ammo_m4',    label: '[F] +10 M4 Ammo',   icon: 'ammo_large'  },
    { oz: -0.6, mat: crate19Mat,  type: 'depot_ammo_pistol', label: '[F] +10 Pistol Ammo', icon: 'ammo_small' },
    { oz:  0.8, mat: crateArMat,  type: 'depot_armor',       label: '[F] Full Armor',    icon: 'armor'       },
    { oz:  2.0, mat: crateHpMat,  type: 'depot_health',      label: '[F] +50 Health',    icon: 'health'      },
  ].forEach(({ oz, mat, type, label, icon }) => {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.85), mat);
    const cy = h + 0.60;
    crate.position.set(crateBackX, cy, z + oz);
    crate.userData = { lootType: type, label, depot: true, baseY: cy,
                       shedX: x, shedZ: z, shedHW: sw / 2, shedHD: sd / 2 };
    scene.add(crate); depotCrates.push(crate);
    collidables.push(crate); // solid — player can't walk through, can jump on

    // Crate plank lines
    for (const py of [-0.22, 0.22]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.04, 0.88), black);
      line.position.set(crateBackX, cy + py, z + oz); scene.add(line);
    }

    // Icon — flat face-up plaque on crate top, then 3D symbol above it
    const iconY = cy + 0.43;  // top face of crate
    const bx = crateBackX, bz = z + oz;
    // White backing plaque flush on crate top
    const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.04, 0.60), white);
    plaque.position.set(bx, iconY + 0.02, bz); scene.add(plaque);

    if (icon === 'ammo_large') {
      // M4 — large standing rifle bullet, gold/brass coloured
      const brass = new THREE.MeshLambertMaterial({ color: 0xc8960c });
      const tip_m = new THREE.MeshLambertMaterial({ color: 0xd4a017 });
      const case_m = new THREE.MeshLambertMaterial({ color: 0x8b6914 });
      // Cartridge case (wider, shorter)
      const cas = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.085, 0.28, 10), case_m);
      cas.position.set(bx, iconY + 0.20, bz); scene.add(cas);
      // Bullet body (narrower, sits on top of case)
      const bod = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.09, 0.18, 10), brass);
      bod.position.set(bx, iconY + 0.43, bz); scene.add(bod);
      // Pointed tip
      const tipp = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.14, 10), tip_m);
      tipp.position.set(bx, iconY + 0.59, bz); scene.add(tipp);
      // Primer ring at bottom
      const primer = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.092, 0.03, 10), new THREE.MeshLambertMaterial({color:0xaaaaaa}));
      primer.position.set(bx, iconY + 0.07, bz); scene.add(primer);
    }
    else if (icon === 'ammo_small') {
      // Pistol — two smaller bullets side by side
      const brass = new THREE.MeshLambertMaterial({ color: 0xb8860b });
      const silv = new THREE.MeshLambertMaterial({ color: 0xcccccc });
      for (const ox of [-0.10, 0.10]) {
        const cas = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.052, 0.20, 8), brass);
        cas.position.set(bx + ox, iconY + 0.17, bz); scene.add(cas);
        const bod = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.055, 0.12, 8), silv);
        bod.position.set(bx + ox, iconY + 0.34, bz); scene.add(bod);
        const tipp = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.10, 8), silv);
        tipp.position.set(bx + ox, iconY + 0.45, bz); scene.add(tipp);
      }
    }
    else if (icon === 'armor') {
      // Blue shield — clean hexagonal shield silhouette
      const shBlue = new THREE.MeshLambertMaterial({ color: 0x2255cc });
      const shLight = new THREE.MeshLambertMaterial({ color: 0x88aaff });
      // Main shield body — tall rounded rectangle
      const shBody = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.30, 0.08), shBlue);
      shBody.position.set(bx, iconY + 0.28, bz); scene.add(shBody);
      // Angled shoulders (chamfer illusion)
      const shL = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.20, 0.08), shBlue);
      shL.rotation.z = 0.42; shL.position.set(bx - 0.21, iconY + 0.34, bz); scene.add(shL);
      const shR = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.20, 0.08), shBlue);
      shR.rotation.z = -0.42; shR.position.set(bx + 0.21, iconY + 0.34, bz); scene.add(shR);
      // Bottom point
      const shPt = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.18, 4), shBlue);
      shPt.rotation.y = Math.PI/4;
      shPt.position.set(bx, iconY + 0.10, bz); scene.add(shPt);
      // Inner emboss line (lighter stripe down center)
      const shEmb = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.09), shLight);
      shEmb.position.set(bx, iconY + 0.29, bz); scene.add(shEmb);
    }
    else if (icon === 'health') {
      // Classic red cross on white — clean and clear
      const crossRed = new THREE.MeshLambertMaterial({ color: 0xdd1111 });
      // Horizontal bar
      const hb = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.09), crossRed);
      hb.position.set(bx, iconY + 0.21, bz); scene.add(hb);
      // Vertical bar
      const vb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.46, 0.09), crossRed);
      vb.position.set(bx, iconY + 0.21, bz); scene.add(vb);
      // White outline/border behind
      const border = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.50, 0.07), white);
      border.position.set(bx, iconY + 0.21, bz - 0.01); scene.add(border);
      // Re-render cross on top of border
      const hb2 = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.10), crossRed);
      hb2.position.set(bx, iconY + 0.21, bz + 0.01); scene.add(hb2);
      const vb2 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.46, 0.10), crossRed);
      vb2.position.set(bx, iconY + 0.21, bz + 0.01); scene.add(vb2);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// WEAPON MODEL
// ═══════════════════════════════════════════════════════════
const weaponGroup = new THREE.Group();
camera.add(weaponGroup);
scene.add(camera);

function createWeaponModel(type) {
  while (weaponGroup.children.length) weaponGroup.remove(weaponGroup.children[0]);

  // ── Shared materials ──
  const metalDark  = new THREE.MeshLambertMaterial({ color: 0x141414 });
  const metalMid   = new THREE.MeshLambertMaterial({ color: 0x252525 });
  const metalLight = new THREE.MeshLambertMaterial({ color: 0x3e3e3e });
  const metalShine = new THREE.MeshLambertMaterial({ color: 0x505050 }); // highlight edges
  const wood       = new THREE.MeshLambertMaterial({ color: 0x52320e });
  const woodDark   = new THREE.MeshLambertMaterial({ color: 0x30180a });
  const woodLight  = new THREE.MeshLambertMaterial({ color: 0x6e4a1a });
  const skin       = new THREE.MeshLambertMaterial({ color: 0xc4a882 });
  const glove      = new THREE.MeshLambertMaterial({ color: 0x2a3820 });
  const gloveLight = new THREE.MeshLambertMaterial({ color: 0x3a5030 });

  function add(geo, mat, px, py, pz, rx=0, ry=0, rz=0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    if (rx||ry||rz) m.rotation.set(rx, ry, rz);
    weaponGroup.add(m); return m;
  }
  const B  = (w,h,d) => new THREE.BoxGeometry(w,h,d);
  const Cy = (rt,rb,h,s=8) => new THREE.CylinderGeometry(rt,rb,h,s);
  const PI2 = Math.PI/2;

  if (type === 'm4') {
    // ── Barrel assembly ──
    add(Cy(0.011,0.013,0.58,10), metalDark,   0.03,-0.008,-0.66, PI2,0,0); // main barrel
    add(Cy(0.016,0.016,0.04,8),  metalShine,  0.03,-0.008,-0.90, PI2,0,0); // muzzle crown
    add(B(0.008,0.032,0.008),    metalDark,   0.03, 0.018,-0.88);           // front sight post
    add(B(0.020,0.006,0.002),    metalShine,  0.03, 0.020,-0.88);           // sight hood

    // ── Handguard — M-LOK style ──
    add(B(0.058,0.048,0.36),  metalMid,   0.03,-0.020,-0.53);              // outer shroud
    add(B(0.062,0.010,0.36),  metalLight, 0.03, 0.004,-0.53);              // top rail
    add(B(0.062,0.010,0.36),  metalDark,  0.03,-0.044,-0.53);              // bottom rail
    // M-LOK slot cutouts (thin dark strips)
    for (let s=0; s<4; s++) {
      add(B(0.060,0.010,0.030), metalDark, 0.03,-0.020,-0.38+s*0.085);
    }
    add(B(0.010,0.048,0.36),  metalMid,   0.003,-0.020,-0.53);             // left rail
    add(B(0.010,0.048,0.36),  metalMid,   0.057,-0.020,-0.53);             // right rail

    // ── Upper receiver ──
    add(B(0.062,0.072,0.26),  metalMid,   0.03,-0.028,-0.27);
    add(B(0.064,0.010,0.26),  metalLight, 0.03, 0.008,-0.27);              // top rail (receiver)
    // Charging handle
    add(B(0.014,0.014,0.038), metalShine, 0.03, 0.010,-0.20);
    add(B(0.030,0.012,0.010), metalLight, 0.03, 0.010,-0.22);              // handle ear
    // Ejection port
    add(B(0.004,0.028,0.055), metalShine, 0.065,-0.020,-0.22);

    // ── Lower receiver ──
    add(B(0.058,0.062,0.22),  metalDark,  0.03,-0.072,-0.25);
    // Trigger guard
    add(B(0.058,0.008,0.055), metalMid,   0.03,-0.090,-0.17);
    add(Cy(0.006,0.006,0.055,6), metalMid, 0.03,-0.094,-0.17, 0,0,PI2);    // guard bow
    // Trigger
    add(B(0.008,0.022,0.006), metalShine, 0.03,-0.074,-0.18);

    // ── Magazine ──
    add(B(0.036,0.175,0.064), metalDark,  0.03,-0.168,-0.325, -0.14,0,0);  // body
    add(B(0.040,0.014,0.068), metalLight, 0.03,-0.258,-0.330, -0.14,0,0);  // base plate
    add(B(0.038,0.010,0.062), metalMid,   0.03,-0.090,-0.320);             // mag catch groove

    // ── Pistol grip ──
    add(B(0.038,0.105,0.044), woodDark,  0.03,-0.143,-0.138, -0.28,0,0);
    add(B(0.002,0.095,0.040), woodLight, 0.018,-0.140,-0.138,-0.28,0,0);   // left panel
    add(B(0.002,0.095,0.040), woodLight, 0.042,-0.140,-0.138,-0.28,0,0);   // right panel
    add(B(0.040,0.014,0.046), metalDark, 0.03,-0.192,-0.152,-0.28,0,0);   // grip base

    // ── Stock — collapsible ──
    add(B(0.042,0.058,0.195), wood,      0.03,-0.038,-0.020);
    add(B(0.044,0.060,0.022), metalDark, 0.03,-0.038, 0.083);              // butt pad
    add(B(0.016,0.008,0.160), metalMid,  0.022,-0.012,-0.015);             // top tube
    add(B(0.016,0.008,0.160), metalMid,  0.038,-0.012,-0.015);             // bottom tube
    // Stock end plate
    add(B(0.048,0.065,0.010), metalDark, 0.03,-0.038,-0.110);

    // ── Rear sight (flip-up style) ──
    add(B(0.028,0.022,0.008), metalDark,  0.03, 0.012,-0.168);
    add(B(0.010,0.018,0.004), metalShine, 0.024,0.018,-0.168);             // left post
    add(B(0.010,0.018,0.004), metalShine, 0.036,0.018,-0.168);             // right post

    // ── Hands and arms ──
    // Left hand gripping handguard
    add(B(0.064,0.044,0.086), glove,     0.03,-0.048,-0.488);
    add(B(0.010,0.040,0.080), gloveLight,0.000,-0.046,-0.488);             // thumb
    add(B(0.054,0.036,0.155), skin,      0.050,-0.058,-0.360, 0,0.18,0);  // left forearm
    // Right hand on grip
    add(B(0.052,0.064,0.062), glove,     0.03,-0.118,-0.118);
    add(B(0.012,0.060,0.058), gloveLight,0.000,-0.116,-0.116);             // thumb side
    add(B(0.052,0.042,0.125), skin,      0.012,-0.098,-0.040, 0,-0.14,0); // right forearm

  } else {
    // ── 1911 Pistol — detailed ──
    const pOff = -0.18;

    // Slide — top, with serrations
    add(B(0.034,0.044,0.230), metalDark,  0.15, 0.000,-0.10+pOff);
    add(B(0.036,0.008,0.230), metalLight, 0.15, 0.022,-0.10+pOff);        // top highlight edge
    // Serration grooves (rear of slide)
    for (let s=0; s<5; s++) {
      add(B(0.036,0.036,0.003), metalShine, 0.15,0.002,-0.010+pOff-s*0.008);
    }
    // Ejection port cutout
    add(B(0.004,0.022,0.050), metalShine, 0.168,0.004,-0.065+pOff);
    // Slide stop lever
    add(B(0.004,0.008,0.028), metalMid, 0.130,-0.010,-0.080+pOff);

    // Frame
    add(B(0.032,0.038,0.175), metalMid,  0.15,-0.036,-0.065+pOff);
    // Trigger guard — box + front curve
    add(B(0.032,0.008,0.058), metalMid,  0.15,-0.052,-0.060+pOff);
    add(B(0.034,0.028,0.008), metalMid,  0.15,-0.042,-0.085+pOff);        // guard front
    // Trigger
    add(B(0.010,0.024,0.007), metalShine, 0.15,-0.038,-0.064+pOff);
    // Thumb safety
    add(B(0.004,0.008,0.018), metalShine, 0.130,0.006,-0.040+pOff);
    // Hammer
    add(B(0.012,0.018,0.012), metalDark,  0.15,0.024, 0.008+pOff);
    add(B(0.008,0.010,0.008), metalShine, 0.15,0.030, 0.002+pOff);

    // Wood grip panels — checkered look
    add(B(0.005,0.078,0.042), wood,      0.168,-0.090,-0.005+pOff, -0.18,0,0);
    add(B(0.005,0.078,0.042), wood,      0.132,-0.090,-0.005+pOff, -0.18,0,0);
    add(B(0.005,0.006,0.040), woodLight, 0.168,-0.062,-0.004+pOff, -0.18,0,0); // top strip
    add(B(0.005,0.006,0.040), woodLight, 0.132,-0.062,-0.004+pOff, -0.18,0,0);
    // Backstrap
    add(B(0.032,0.090,0.042), metalDark, 0.15,-0.090, 0.002+pOff, -0.18,0,0);
    // Magazine base
    add(B(0.026,0.010,0.034), metalLight, 0.15,-0.140,-0.008+pOff);

    // Barrel + suppressor
    add(Cy(0.010,0.010,0.068,8), metalMid,  0.15,0.005,-0.255+pOff, PI2,0,0); // barrel
    add(Cy(0.020,0.020,0.155,10),metalDark, 0.15,0.004,-0.305+pOff, PI2,0,0); // suppressor body
    // Suppressor wraps (ridges)
    for (let r=0; r<6; r++) {
      add(Cy(0.022,0.022,0.006,10), metalMid, 0.15,0.004,-0.238+pOff-r*0.020, PI2,0,0);
    }
    add(Cy(0.020,0.016,0.012,10), metalLight, 0.15,0.004,-0.387+pOff, PI2,0,0); // end cap

    // Sights
    add(B(0.009,0.016,0.007), metalShine, 0.15, 0.027,-0.210+pOff);       // front sight
    add(B(0.026,0.013,0.007), metalShine, 0.15, 0.027,-0.005+pOff);       // rear sight
    add(B(0.006,0.013,0.007), metalDark,  0.143,0.027,-0.005+pOff);       // rear notch L
    add(B(0.006,0.013,0.007), metalDark,  0.157,0.027,-0.005+pOff);       // rear notch R

    // Right hand + forearm
    add(B(0.064,0.052,0.072), glove,      0.15,-0.064, 0.002+pOff);
    add(B(0.014,0.048,0.068), gloveLight, 0.130,-0.062, 0.000+pOff);      // thumb
    add(B(0.052,0.044,0.148), skin,       0.130,-0.064, 0.085+pOff, 0,-0.08,0);
  }

  const wp = type === 'm4' ? {x:0.25,y:-0.22,z:-0.38} : {x:0.2,y:-0.2,z:-0.3};
  weaponGroup.position.set(wp.x, wp.y, wp.z);
  weaponGroup.rotation.set(0, 0, 0);

  // ── Krunker-style weapon always-on-top ──
  // depthTest:false + renderOrder:999 renders weapon over all world geometry.
  // frustumCulled:false prevents Three.js from hiding weapon parts when their
  // bounding sphere drifts outside the camera frustum (FIX for weapon vanishing).
  weaponGroup.traverse(child => {
    if (child.isMesh) {
      child.renderOrder = 999;
      child.frustumCulled = false;
      // Clone the material so we don't mutate the shared material objects
      child.material = child.material.clone();
      child.material.depthTest = false;
    }
  });
}
createWeaponModel('m4');
let weaponBobPhase = 0;

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
const collidableCache = []; // { bb: Box3, dynamic: bool, obj: mesh }

function buildCollisionCache() {
  collidableCache.length = 0;
  for (const obj of collidables) {
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

  // Test player as a full vertical column — feet, knee, waist, chest, head.
  // This prevents the camera (eye level only) from entering objects
  // whose bottom edge is below eye height but above feet.
  const testHeights = [
    feetY + 0.05,        // feet
    feetY + currentH * 0.3,  // knee
    feetY + currentH * 0.6,  // waist
    feetY + currentH * 0.85, // chest
    newPos.y,            // head/camera
  ];

  let blocked = false;
  let stepUpY = 0;

  for (const entry of collidableCache) {
    const bb = entry.bb;

    // Quick XZ rejection before checking heights
    if (newPos.x + r <= bb.min.x || newPos.x - r >= bb.max.x) continue;
    if (newPos.z + r <= bb.min.z || newPos.z - r >= bb.max.z) continue;

    const objTop = bb.max.y;
    const objBottom = bb.min.y;

    // Check if any of the player's body points are inside this collider's Y range
    let bodyIntersects = false;
    for (const testY of testHeights) {
      if (testY > objBottom && testY < objTop) {
        bodyIntersects = true;
        break;
      }
    }
    if (!bodyIntersects) continue;

    // How far above feet is the top of this object?
    const heightAboveFeet = objTop - feetY;

    // Allow stepping over very small ledges only (curbs, small lips)
    if (heightAboveFeet > 0 && heightAboveFeet <= 0.4) {
      stepUpY = Math.max(stepUpY, objTop + currentH + 0.01);
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

// ── Drone camera for menu background ──
const droneCamera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 1, 800);
const droneClock = { angle: 0, height: 95, radius: 155 };
const overlayCanvas = document.getElementById('overlay-canvas');
overlayCanvas.width = window.innerWidth;
overlayCanvas.height = window.innerHeight;
overlayCanvas.style.position = 'absolute';
overlayCanvas.style.inset = '0';
// Use a second renderer for drone view
const droneRenderer = new THREE.WebGLRenderer({ canvas: overlayCanvas, antialias: false });
droneRenderer.setSize(window.innerWidth, window.innerHeight);
droneRenderer.setPixelRatio(1); // Keep perf light
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
  // Don't start game if they clicked the music button
  if (e.target.id === 'music-toggle-btn' || e.target.closest('#music-toggle-btn')) return;
  renderer.domElement.requestPointerLock();
});
renderer.domElement.addEventListener('click', () => {
  if (!document.pointerLockElement && state.phase !== 'lobby') {
    renderer.domElement.requestPointerLock();
  }
});
document.addEventListener('pointerlockchange', () => {
  state.locked = !!document.pointerLockElement;
  if (state.phase === 'lobby' && !state.locked) {
    overlay.classList.remove('hidden');
  } else if (state.locked) {
    overlay.classList.add('hidden');
  }
});

document.addEventListener('mousemove', (e) => {
  if (!state.locked) return;
  const sens = state.ads ? CONFIG.adsSens : CONFIG.mouseSens;
  euler.setFromQuaternion(camera.quaternion);
  euler.y -= e.movementX * sens;
  euler.x -= e.movementY * sens;
  euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, euler.x));
  camera.quaternion.setFromEuler(euler);
});

document.addEventListener('keydown', (e) => {
  if (!state.locked) return;
  switch (e.code) {
    case 'KeyW': state.moveForward = true; break;
    case 'KeyS': state.moveBack = true; break;
    case 'KeyA': state.moveLeft = true; break;
    case 'KeyD': state.moveRight = true; break;
    case 'Space':
      if (state.isGrounded) { state.velocityY = CONFIG.jumpForce; state.isGrounded = false; }
      break;
    case 'Digit1':
      if (state.currentWeapon !== 'm4' && !state.reloading && !state.switching) { switchWeapon('m4'); }
      break;
    case 'Digit2':
      if (state.currentWeapon !== 'pistol' && !state.reloading && !state.switching) { switchWeapon('pistol'); }
      break;
    case 'KeyR': reload(); break;
    case 'KeyF': pickupLoot(); break;
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
  if (e.button === 2) { state.ads = true; crosshair.classList.add('ads'); adsVignette.classList.add('active'); }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 2) { state.ads = false; crosshair.classList.remove('ads'); adsVignette.classList.remove('active'); }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ═══════════════════════════════════════════════════════════
// SHOOTING — First shot accurate, spread accumulates with rapid fire
// ═══════════════════════════════════════════════════════════
const raycaster = new THREE.Raycaster();
let hitmarkerTimeout = null, muzzleTimeout = null, crosshairResetTimeout = null;
let spreadAccum = 0;        // Accumulated spread from rapid fire
let lastShotTime = 0;

function shoot() {
  if (!state.canFire || state.reloading || state.playerDead || state.phase !== 'playing') return;
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
  if (isM4) SFX.gunshot_m4();
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
  euler.setFromQuaternion(camera.quaternion);
  euler.x += recoil * (0.7 + Math.random() * 0.3);
  euler.y += (Math.random() - 0.5) * recoil * 0.3;
  camera.quaternion.setFromEuler(euler);

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

  const intersects = raycaster.intersectObjects(targets, false);

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

  if (intersects.length > 0) {
    const hit = intersects[0];
    if (blockDist !== null && blockDist < hit.distance) {
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
      }
    }
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
    if (type === 'depot_health')     { state.health = Math.min(100, state.health + 50); updateHUD(); SFX.pickup(); }
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

  // Stream (draw meandering path)
  mCtx.beginPath();
  mCtx.moveTo(cx + streamPoints[0].x * scale, cy + streamPoints[0].z * scale);
  for (let i = 1; i < streamPoints.length; i++) {
    mCtx.lineTo(cx + streamPoints[i].x * scale, cy + streamPoints[i].z * scale);
  }
  mCtx.strokeStyle = '#1199dd'; mCtx.lineWidth = 2; mCtx.stroke();

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
// ═══════════════════════════════════════════════════════════
// GAME LOOP
// ═══════════════════════════════════════════════════════════
const clock = new THREE.Clock();
const moveVec = new THREE.Vector3();
const smoothedMove = new THREE.Vector3(); // Smoothed movement for less jerky strafing
const fwd = new THREE.Vector3();
const rgt = new THREE.Vector3();
let minimapTimer = 0;
let perfFrames = 0, perfLastTime = 0;

// ── Instanced Ash Cloud Pool — 1 draw call for ALL ash particles ──
const ASH_POOL_SIZE = 300;
const ashGeo = new THREE.SphereGeometry(1, 5, 4); // unit sphere, scaled per instance
const ashMat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.7, color: 0x444444 });
const ashMesh = new THREE.InstancedMesh(ashGeo, ashMat, ASH_POOL_SIZE);
ashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(ashMesh);

// Per-instance data arrays
const ashActive    = new Array(ASH_POOL_SIZE).fill(false);
const ashPos       = Array.from({ length: ASH_POOL_SIZE }, () => new THREE.Vector3());
const ashVel       = Array.from({ length: ASH_POOL_SIZE }, () => new THREE.Vector3());
const ashSize      = new Float32Array(ASH_POOL_SIZE);
const ashGrowRate  = new Float32Array(ASH_POOL_SIZE);
const ashLife      = new Float32Array(ASH_POOL_SIZE);
const ashMaxLife   = new Float32Array(ASH_POOL_SIZE);
const ashOpacity   = new Float32Array(ASH_POOL_SIZE);
const ashColors    = [0x333333, 0x444444, 0x555555, 0x3a3020, 0x4a4a4a];
const ashColorObjs = ashColors.map(c => new THREE.Color(c));

// Set up per-instance color buffer
ashMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ASH_POOL_SIZE * 3), 3);

const _ashDummy = new THREE.Object3D();

function spawnAshCloud(size, upVel, life) {
  // Find a free slot in the pool
  for (let i = 0; i < ASH_POOL_SIZE; i++) {
    if (ashActive[i]) continue;
    ashActive[i]   = true;
    ashSize[i]     = size;
    ashGrowRate[i] = 0.3 + Math.random() * 0.8;
    ashLife[i]     = life;
    ashMaxLife[i]  = life + 5;
    ashPos[i].set(
      (Math.random() - 0.5) * 12,
      CONFIG.volcanoHeight + Math.random() * 3,
      (Math.random() - 0.5) * 12
    );
    ashVel[i].set(
      (Math.random() - 0.5) * 2,
      upVel,
      (Math.random() - 0.5) * 2
    );
    // Random ash color
    const col = ashColorObjs[Math.floor(Math.random() * ashColorObjs.length)];
    ashMesh.instanceColor.setXYZ(i, col.r, col.g, col.b);
    return;
  }
  // Pool full — silently skip (no new mesh created)
}

function updateAshClouds(dt) {
  for (let i = 0; i < ASH_POOL_SIZE; i++) {
    if (!ashActive[i]) {
      // Hide inactive instances by scaling to zero
      _ashDummy.position.set(0, -9999, 0);
      _ashDummy.scale.set(0, 0, 0);
      _ashDummy.updateMatrix();
      ashMesh.setMatrixAt(i, _ashDummy.matrix);
      continue;
    }

    ashVel[i].y *= 0.998;
    ashVel[i].x *= 0.99;
    ashVel[i].z *= 0.99;
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

  // Drive shared material opacity from average of active particles
  ashMat.opacity = 0.65;
}

function update() {
  requestAnimationFrame(update);
  const dt = Math.min(clock.getDelta(), 0.05);

  refreshDynamicColliders(); // Recompute only gate doors each frame

  // Sprint HUD — always update (even if pointer temporarily unlocked)
  if (state.phase === 'playing' || state.phase === 'countdown') {
    const _sa = state.sprintTimer > 0;
    if (streamBoostEl) streamBoostEl.style.display = _sa ? "block" : "none";
    if (sprintCdEl && _sa) sprintCdEl.textContent = Math.ceil(state.sprintTimer);
  }

  if (!state.locked) {
    if (state.phase === 'lobby') {
      updateDroneCamera(dt);
      droneRenderer.render(scene, droneCamera);
    }
    renderer.render(scene, camera); return;
  }

  // ── Game phase management ──
  if (state.phase === 'lobby') {
    // Player just clicked — start countdown
    state.phase = 'countdown';
    state.countdownTime = 10;
  }

  if (state.phase === 'countdown') {
    state.countdownTime -= dt;
    const num = Math.ceil(state.countdownTime);
    const cdEl = document.getElementById('countdown-num');
    if (num > 0 && num <= 10) {
      cdEl.textContent = num;
      cdEl.classList.add('show');
    }
    // Fade out menu music over 5 seconds when countdown hits 5
    const music = document.getElementById('menu-music');
    if (music && !music.paused && state.countdownTime <= 5) {
      // Smooth linear fade: vol goes from current down to 0 over remaining time
      music.volume = Math.max(0, (state.countdownTime / 5) * 0.75);
      if (state.countdownTime <= 0) { music.pause(); music.currentTime = 0; }
    }
    if (state.countdownTime <= 0) {
      state.phase = 'playing';
      cdEl.classList.remove('show');
      // Start gate swing open animation
      state.gateOpening = true;
      // Gate creak sound
      SFX.gate_creak();
      // Remove door colliders so bots can walk through
      const idx1 = collidables.indexOf(gateDoorL);
      if (idx1 >= 0) collidables.splice(idx1, 1);
      const idx2 = collidables.indexOf(gateDoorR);
      if (idx2 >= 0) collidables.splice(idx2, 1);
    }
    // Allow free roam — don't return, fall through to movement code
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

  // Check victory — all bots dead
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
        if (music) {
          music.currentTime = 48; // Start 14 seconds into the song
          music.volume = 0.75;
          music.play();
        }
      }, 500);
    }
  }

  // If dead — spectate mode (follow alive bots)
  if (state.playerDead) {
    const aliveBots = bots.filter(b => b.alive);
    if (aliveBots.length > 0) {
      const specBot = aliveBots[state.spectateIndex % aliveBots.length];
      const specPos = specBot.group.position;
      camera.position.lerp(new THREE.Vector3(specPos.x - 5, specPos.y + 4, specPos.z - 5), dt * 3);
      camera.lookAt(specPos.x, specPos.y + 1.5, specPos.z);
    }
    updateBots(dt);
    // Continue water/loot/particles updates below but skip player movement
  }

  // Sprint HUD — declared here so it's in scope for movement block below
  const sprintActive = state.sprintTimer > 0;
  if (streamBoostEl) streamBoostEl.style.display = sprintActive ? "block" : "none";
  if (sprintCdEl && sprintActive) sprintCdEl.textContent = Math.ceil(state.sprintTimer);

  // Skip player movement if dead
  if (!state.playerDead) {

  // Movement with smoothing
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  rgt.crossVectors(fwd, new THREE.Vector3(0, -1, 0)).normalize();
  moveVec.set(0, 0, 0);
  if (state.moveForward) moveVec.add(fwd);
  if (state.moveBack) moveVec.sub(fwd);
  if (state.moveLeft) moveVec.add(rgt);
  if (state.moveRight) moveVec.sub(rgt);

  if (moveVec.lengthSq() > 0) moveVec.normalize();

  const smoothFactor = 1 - Math.pow(CONFIG.moveSmoothing, dt * 60);
  smoothedMove.lerp(moveVec, smoothFactor);

  // Current height based on crouch state
  const targetHeight = state.crouching ? CONFIG.crouchHeight : CONFIG.playerHeight;
  // Smoothly interpolate camera height — faster crouching down, slower standing up
  const lerpRate = state.crouching ? 14 : 7;
  state.smoothCameraHeight += (targetHeight - state.smoothCameraHeight) * Math.min(1, dt * lerpRate);
  // Smooth crouch transition
  const currentHeight = camera.position.y - getTerrainHeight(camera.position.x, camera.position.z);
  const heightDiff = targetHeight - currentHeight;

  if (smoothedMove.lengthSq() > 0.001) {
    let speed = state.ads ? CONFIG.moveSpeed * CONFIG.adsSpeedMult : CONFIG.moveSpeed;
    // Slower when swimming in risen water
    const swimCheck = state.waterRising && state.waterLevel > getTerrainHeight(camera.position.x, camera.position.z) + 0.8;
    if (swimCheck) speed *= 0.55;
    if (sprintActive) speed *= 1.5;
    if (state.crouching) speed *= CONFIG.crouchSpeedMult;
    const frame = smoothedMove.clone().multiplyScalar(speed * dt);

    // Try X movement with step-up
    const testPosX = camera.position.clone();
    testPosX.x += frame.x;
    const collX = checkCollisionAndStep(testPosX);
    if (!collX.blocked) {
      camera.position.x = testPosX.x;
      if (collX.stepUpY > camera.position.y) {
        camera.position.y = collX.stepUpY;
        state.velocityY = 0;
        state.isGrounded = true;
      }
    }

    // Try Z movement with step-up
    const testPosZ = camera.position.clone();
    testPosZ.z += frame.z;
    const collZ = checkCollisionAndStep(testPosZ);
    if (!collZ.blocked) {
      camera.position.z = testPosZ.z;
      if (collZ.stepUpY > camera.position.y) {
        camera.position.y = collZ.stepUpY;
        state.velocityY = 0;
        state.isGrounded = true;
      }
    }
  }

  // Gravity
  if (!state.isGrounded || state.velocityY > 0) {
    state.velocityY -= CONFIG.gravity * dt;
    camera.position.y += state.velocityY * dt;
  }

  // Floor height = max of terrain and any object we're standing on
  let floorH = getTerrainHeight(camera.position.x, camera.position.z);
  const r = CONFIG.playerRadius;
  for (const entry of collidableCache) {
    const objBB = entry.bb;
    if (camera.position.x > objBB.min.x - r && camera.position.x < objBB.max.x + r &&
        camera.position.z > objBB.min.z - r && camera.position.z < objBB.max.z + r) {
      const objTop = objBB.max.y;
      const feetCrouch  = camera.position.y - CONFIG.crouchHeight;
      const feetStand   = camera.position.y - CONFIG.playerHeight;
      const nearTop = (feetCrouch >= objTop - 0.6 && feetCrouch <= objTop + 1.2) ||
                      (feetStand  >= objTop - 0.6 && feetStand  <= objTop + 1.2);
      if (nearTop) {
        floorH = Math.max(floorH, objTop);
      }
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
    camera.position.y = floatLevel;
    state.velocityY = 0;
    state.isGrounded = true;
  }

  // Smooth crouch camera transition
  if (state.isGrounded) {
    camera.position.y += (standY - camera.position.y) * dt * 20;
  }

  // Footstep sounds — no steps when swimming
  const isSwimming = state.waterRising && state.waterLevel > getTerrainHeight(camera.position.x, camera.position.z) + 0.8;
  if (smoothedMove.lengthSq() > 0.01 && state.isGrounded && !isSwimming) {
    let stepSpeed = state.crouching ? 2.5 : 4.5;
    if (state.ads) stepSpeed *= 0.6;
    footstepTimer += dt * stepSpeed;
    if (footstepTimer >= 1) {
      footstepTimer = 0;
      SFX.footstep();
    }
  }

  const bound = half - 1;
  camera.position.x = Math.max(-bound, Math.min(bound, camera.position.x));
  camera.position.z = Math.max(-bound, Math.min(bound, camera.position.z));

  } // End of if (!state.playerDead) block

  // Animate gate doors swinging open
  if (state.gateOpening && gateOpenProgress < 1) {
    gateOpenProgress += dt * 0.5;
    if (gateOpenProgress > 1) {
      gateOpenProgress = 1;
      if (state.sprintTimer === 0) state.sprintTimer = 15;
    }
    const angle = gateOpenProgress * Math.PI * 0.45;
    gatePivotL.rotation.y = angle;
    gatePivotR.rotation.y = -angle;
  }

  // Shared updates — run regardless of alive/dead
  if (!state.playerDead) updateBots(dt);

  // ── Match timer & water rise ──
  state.matchTime += dt;
  if (state.sprintTimer > 0) state.sprintTimer = Math.max(0, state.sprintTimer - dt);
  const remaining = Math.max(0, state.matchDuration - state.matchTime);
  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);
  document.getElementById('match-timer').textContent =
    String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');

  // Alive count
  const aliveCount = bots.filter(b => b.alive).length + (state.playerDead ? 0 : 1);
  document.getElementById('alive-val').textContent = aliveCount;

  // Volcano eruption — 15 seconds before water rise
  const eruptionTime = state.waterRiseStart - 15;
  if (state.matchTime >= eruptionTime && !state.erupted) {
    state.erupted = true;

    // Stop the pre-eruption slow smoke immediately
    smokeInst.visible = false;
    waterWarning.textContent = '⚠ VOLCANO ERUPTING — WATER RISING IN 15 SECONDS ⚠';
    waterWarning.style.fontSize = '28px';
    waterWarning.classList.add('show');
    setTimeout(() => waterWarning.classList.remove('show'), 5000);
    // Initial massive burst
    for (let i = 0; i < 152; i++) spawnAshCloud(3 + Math.random() * 6, 14 + Math.random() * 28, 12 + Math.random() * 15);
    // Deep constant bass eruption rumble
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
    // Grey haze plane
    const hazeGeo = new THREE.PlaneGeometry(CONFIG.islandSize * 1.5, CONFIG.islandSize * 1.5);
    const hazeMat = new THREE.MeshBasicMaterial({ color: 0x777777, transparent: true, opacity: 0, side: THREE.DoubleSide });
    const haze = new THREE.Mesh(hazeGeo, hazeMat);
    haze.rotation.x = -Math.PI / 2; haze.position.y = 45;
    scene.add(haze);
    state.hazePlane = haze;
  }

  // Continuous ash plume till match end
  if (state.erupted) {
    state.ashTimer = (state.ashTimer || 0) + dt;
    if (state.ashTimer > 0.07) {
      state.ashTimer = 0;
      spawnAshCloud(2.5 + Math.random() * 5, 8 + Math.random() * 18, 10 + Math.random() * 14);
    }
  }

  // Update all ash via instanced pool — replaces per-mesh loop
  updateAshClouds(dt);

  // Fade in haze
  if (state.hazePlane) {
    const timeSinceEruption = Math.max(0, state.matchTime - eruptionTime);
    const targetOpacity = Math.min(0.35, timeSinceEruption * 0.003);
    state.hazePlane.material.opacity += (targetOpacity - state.hazePlane.material.opacity) * dt * 0.5;
    const dimFactor = Math.max(0.35, 1 - timeSinceEruption * 0.004);
    sun.intensity = 1.6 * dimFactor;
    sunMesh.material.color.setHex(dimFactor > 0.6 ? 0xFFEE00 : 0xCC8800);
  }

  // Screen shake — 5 seconds on eruption
  if (state.erupted && state.matchTime < eruptionTime + 5 && !state.playerDead) {
    const shakeIntensity = 0.12 * (1 - (state.matchTime - eruptionTime) / 5);
    camera.position.x += (Math.random() - 0.5) * shakeIntensity;
    camera.position.y += (Math.random() - 0.5) * shakeIntensity * 0.5;
    camera.position.z += (Math.random() - 0.5) * shakeIntensity * 0.25;
  }

  // Water starts rising after waterRiseStart seconds
  if (state.matchTime >= state.waterRiseStart) {
    if (!state.waterRising) {
      state.waterRising = true;
      water.visible = true;
    }

    const rawProgress = (state.matchTime - state.waterRiseStart) / (state.matchDuration - state.waterRiseStart);
    const timeSinceRise = state.matchTime - state.waterRiseStart;
    let riseProgress;
    if (timeSinceRise < 10) {
      riseProgress = (timeSinceRise / 10) * 0.02;
    } else {
      const normalProgress = (timeSinceRise - 10) / (state.matchDuration - state.waterRiseStart - 10);
      riseProgress = 0.02 + Math.pow(normalProgress, 0.70) * 0.98;
    }
    state.waterLevel = -0.3 + riseProgress * (CONFIG.volcanoHeight * 0.85 + 0.3);
    water.position.y = state.waterLevel;

    // Water wave effect
    const waterPosAttr = water.geometry.attributes.position;
    for (let i = 0; i < waterPosAttr.count; i++) {
      const wx = waterPosAttr.getX(i);
      const wy = waterPosAttr.getY(i);
      const wave = Math.sin(wx * 0.3 + clock.elapsedTime * 1.5) * Math.cos(wy * 0.3 + clock.elapsedTime) * 0.15;
      waterPosAttr.setZ(i, wave);
    }
    waterPosAttr.needsUpdate = true;

    // Water damage to player
    const playerCurrentH = state.crouching ? CONFIG.crouchHeight : CONFIG.playerHeight;
    const playerFeetY = camera.position.y - playerCurrentH;
    const kneeY = playerFeetY + 0.4;
    if (state.waterLevel > kneeY) {
      state.waterDmgTimer += dt;
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

    // Water damage to bots
    for (const bot of bots) {
      if (!bot.alive) continue;
      const botFeetY = bot.group.position.y;
      if (state.waterLevel > botFeetY + 0.4) {
        bot.hp -= dt * 5;
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
  ambientTimer -= dt;
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
  const allLootSources = [...lootItems, ...depotCrates];
  for (const loot of allLootSources) {
    const dx = loot.position.x - camera.position.x;
    const dz = loot.position.z - camera.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > closestDist) continue;
    if (loot.userData.depot) {
      const { shedX, shedZ, shedHW, shedHD } = loot.userData;
      if (Math.abs(camera.position.x - shedX) > shedHW ||
          Math.abs(camera.position.z - shedZ) > shedHD) continue;
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
    loot.rotation.y += dt * 1.5;
  }

  // Smoke — only animate pre-eruption slow smoke while volcano has not erupted yet
  if (!state.erupted) {
  for (const s of smokeParticles) {
    _smokeDummy.position.set(
      s.ox + Math.sin(clock.elapsedTime * 0.3 + s.phase) * 2.5,
      s.baseY + Math.sin(clock.elapsedTime * s.speed + s.phase) * 2,
      s.oz + Math.cos(clock.elapsedTime * 0.2 + s.phase) * 2.5
    );
    _smokeDummy.scale.setScalar(s.size);
    _smokeDummy.updateMatrix();
    smokeInst.setMatrixAt(s.index, _smokeDummy.matrix);
  }
  smokeInst.instanceMatrix.needsUpdate = true;
  }

  // Water vignette
  if (state.waterRising) {
    const maxWater = CONFIG.volcanoHeight * 0.85;
    const progress = Math.min(1, Math.max(0, state.waterLevel / maxWater));
    waterVignette.style.opacity = (progress * 0.9).toFixed(2);
  } else {
    waterVignette.style.opacity = 0;
  }

  // Bubble animation
  if (!state.waterRising) {
    bubbleGroup.visible = true;
    bubbleGroup.children.forEach(b => {
      b.position.y += b.userData.speed * dt;
      b.material.opacity = 0.2 + Math.sin(clock.elapsedTime * 1.5 + b.userData.phase) * 0.15;
      if (b.position.y > 3) b.position.y = -2 - Math.random() * 2;
    });
  } else {
    bubbleGroup.visible = false;
  }

  // Weapon bob + reload animation
  const isMoving = smoothedMove.lengthSq() > 0.01;
  weaponBobPhase += dt * (isMoving ? 10 : 1.5);
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
    targetPos = new THREE.Vector3(0, -0.15, restPos.z - 0.05);
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
  const lerpSpeed = state.reloadPhase ? 6 : 12;
  weaponGroup.position.lerp(targetPos, dt * lerpSpeed);
  if (!state.reloadPhase) {
    weaponGroup.rotation.x += (0 - weaponGroup.rotation.x) * dt * 10;
  } else {
    weaponGroup.rotation.x += (-0.3 - weaponGroup.rotation.x) * dt * 6;
  }
  weaponGroup.rotation.y += (0 - weaponGroup.rotation.y) * dt * 10;

  // FOV
  camera.fov += ((state.ads ? CONFIG.adsFov : CONFIG.normalFov) - camera.fov) * dt * 10;
  camera.updateProjectionMatrix();

  // Particles
  for (let i = impactParticles.length - 1; i >= 0; i--) {
    const p = impactParticles[i];
    p.userData.vel.y -= 9.8 * dt;
    p.position.addScaledVector(p.userData.vel, dt);
    p.userData.life -= dt;
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

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  droneCamera.aspect = window.innerWidth / window.innerHeight;
  droneCamera.updateProjectionMatrix();
  droneRenderer.setSize(window.innerWidth, window.innerHeight);
  overlayCanvas.width = window.innerWidth;
  overlayCanvas.height = window.innerHeight;
});
// Hide drone canvas once game starts
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) overlayCanvas.style.display = 'none';
});

updateHUD();
buildCollisionCache(); // Pre-compute all collidable bounding boxes once
update();

// Restart handlers
document.getElementById('go-restart').addEventListener('click', () => location.reload());
document.getElementById('win-restart').addEventListener('click', () => location.reload());

// Spectate — click to cycle through alive bots
document.addEventListener('click', () => {
  if (state.playerDead) {
    state.spectateIndex++;
  }
});
