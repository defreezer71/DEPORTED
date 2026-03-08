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
    r = (0.13 + grass + warmth + Math.random() * 0.025) * 0.8;
    g = (0.36 + grass + Math.random() * 0.045) * 0.8;
    b = (0.07 + grass * 0.4 - warmth * 0.5) * 0.8;
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
