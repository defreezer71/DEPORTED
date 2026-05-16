// JUNGLE — Trees and Bushes
// ═══════════════════════════════════════════════════════════
function canPlaceAt(x, z) {
  if (getVolcanoHeight(x, z) > 1) return false;
  if (Math.abs(x - prison.x) < pw / 2 + 10 && Math.abs(z - prison.z) < pw / 2 + 10) return false;
  if (Math.abs(x) > half - 12 || Math.abs(z) > half - 12) return false;
  if (isInStream(x, z)) return false;
  return true;
}
// Looser version for ground cover — allows placement right up to the wall base
function canPlaceGround(x, z) {
  if (getVolcanoHeight(x, z) > 1) return false;
  if (Math.abs(x - prison.x) < pw / 2 + 3 && Math.abs(z - prison.z) < pw / 2 + 3) return false;
  if (Math.abs(x) > half - 2 || Math.abs(z) > half - 2) return false;
  if (isInStream(x, z)) return false;
  return true;
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

const _barkTex      = _makeBarkTex();
const _leafTex      = _makeLeafTex();
const _arborTex     = _makeArborvitaeTex();

// ── Instanced Trees — 2 draw calls for all trunks + all canopies ──
{
  const treePlacements = [];
  const treeGridSize = 18;
  for (let gx = -half + 15; gx < half - 15; gx += treeGridSize) {
    for (let gz = -half + 15; gz < half - 15; gz += treeGridSize) {
      const x = gx + (seededRand() - 0.5) * treeGridSize * 0.7;
      const z = gz + (seededRand() - 0.5) * treeGridSize * 0.7;
      if (canPlaceAt(x, z)) treePlacements.push({ x, z });
    }
  }

  const treeCount = treePlacements.length;

  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.62, 1, 8);
  const trunkMat = new THREE.MeshLambertMaterial({ map: _barkTex });
  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  trunkInst.castShadow = true;

  const flareGeo = new THREE.CylinderGeometry(0.55, 0.90, 1, 8);
  const flareMat = new THREE.MeshLambertMaterial({ map: _barkTex });
  const flareInst = new THREE.InstancedMesh(flareGeo, flareMat, treeCount);
  flareInst.castShadow = false;

  const _trunkCol = new THREE.Color();

  const canopyGeo = new THREE.SphereGeometry(1, 10, 8);
  const canopyMat = new THREE.MeshLambertMaterial({ map: _leafTex });
  const canopyInst = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount);
  canopyInst.castShadow = true;

  const canopy2Geo = new THREE.SphereGeometry(1, 9, 7);
  const canopy2Mat = new THREE.MeshLambertMaterial({ map: _leafTex });
  const canopy2Inst = new THREE.InstancedMesh(canopy2Geo, canopy2Mat, treeCount);
  canopy2Inst.castShadow = false;

  const canopy3Geo = new THREE.SphereGeometry(1, 8, 6);
  const canopy3Mat = new THREE.MeshLambertMaterial({ map: _leafTex });
  const canopy3Inst = new THREE.InstancedMesh(canopy3Geo, canopy3Mat, treeCount);
  canopy3Inst.castShadow = false;

  const _treeCol = new THREE.Color();

  const dummy = new THREE.Object3D();

  treePlacements.forEach(({ x, z }, i) => {
    const h = getTerrainHeight(x, z);
    const trunkH   = 5.5 + seededRand() * 4.0;
    const trunkR   = 0.42 + seededRand() * 0.32;
    const canopyR  = (2.2 + seededRand() * 2.8) * 1.5;
    const scaleY   = 0.55 + seededRand() * 0.28;
    const lean     = (seededRand() - 0.5) * 0.06;

    dummy.position.set(x, h + trunkH / 2, z);
    dummy.scale.set(trunkR / 0.44, trunkH, trunkR / 0.44);
    dummy.rotation.set(lean, seededRand() * 6.28, lean * 0.5);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(x, h + 0.55, z);
    dummy.scale.set(trunkR / 0.44 * 1.1, 1.1, trunkR / 0.44 * 1.1);
    dummy.rotation.set(0, seededRand() * 6.28, 0);
    dummy.updateMatrix();
    flareInst.setMatrixAt(i, dummy.matrix);

    const jx = (seededRand()-0.5)*0.6, jz = (seededRand()-0.5)*0.6;
    dummy.position.set(x + jx, h + trunkH + canopyR * 0.25, z + jz);
    dummy.scale.set(canopyR, canopyR * scaleY, canopyR);
    dummy.rotation.set(lean * 0.3, seededRand() * 6.28, 0);
    dummy.updateMatrix();
    canopyInst.setMatrixAt(i, dummy.matrix);

    const c2r = canopyR * (0.60 + seededRand() * 0.18);
    dummy.position.set(x + jx + (seededRand()-0.5)*1.2, h + trunkH + canopyR * 0.52 + c2r * 0.1, z + jz + (seededRand()-0.5)*1.2);
    dummy.scale.set(c2r, c2r * (scaleY * 0.88 + 0.08), c2r);
    dummy.rotation.set(0, seededRand() * 6.28, 0);
    dummy.updateMatrix();
    canopy2Inst.setMatrixAt(i, dummy.matrix);

    const c3r = canopyR * (0.35 + seededRand() * 0.15);
    dummy.position.set(x + jx * 0.3, h + trunkH + canopyR * 0.8 + c3r * 0.3, z + jz * 0.3);
    dummy.scale.set(c3r, c3r * (scaleY * 0.75 + 0.15), c3r);
    dummy.rotation.set(0, seededRand() * 6.28, 0);
    dummy.updateMatrix();
    canopy3Inst.setMatrixAt(i, dummy.matrix);

    // Per-instance color — multi-prime hash, no seededRand consumption
    const tf1 = Math.sin(x * 127.341 + z * 311.723);
    const tf2 = Math.sin(x *  89.127 - z * 203.401 + 1.9);
    const tf3 = Math.sin((x + z) * 53.17 + (x - z) * 71.39);
    const hv  = (tf1 * 0.5 + tf2 * 0.3 + tf3 * 0.2) * 0.5 + 0.5;
    const hv2 = (tf2 * 0.5 + tf3 * 0.5) * 0.5 + 0.5;
    const hv3 = (tf3 * 0.6 + tf1 * 0.4) * 0.5 + 0.5;

    // Trunk: warm vs cool bark shift
    _trunkCol.setRGB(0.75 + hv * 0.35, 0.78 + hv2 * 0.25, 0.70 + hv3 * 0.30);
    trunkInst.setColorAt(i, _trunkCol);
    _trunkCol.setRGB(0.65 + hv * 0.32, 0.68 + hv2 * 0.22, 0.62 + hv3 * 0.26);
    flareInst.setColorAt(i, _trunkCol);

    // Canopy: narrow band centred on muted forest green, slight per-tree variance only.
    // Multiplier range ~0.52–0.72 (±15%) — no extremes.
    _treeCol.setRGB(0.52 + hv * 0.16 + hv2 * 0.04, 0.54 + hv * 0.16 + hv3 * 0.03, 0.42 + hv * 0.12 + hv2 * 0.04);
    canopyInst.setColorAt(i, _treeCol);
    _treeCol.setRGB(0.57 + hv * 0.15 + hv2 * 0.04, 0.59 + hv * 0.15 + hv3 * 0.03, 0.45 + hv * 0.11 + hv2 * 0.04);
    canopy2Inst.setColorAt(i, _treeCol);
    _treeCol.setRGB(0.62 + hv * 0.14 + hv2 * 0.04, 0.64 + hv * 0.14 + hv3 * 0.03, 0.48 + hv * 0.11 + hv2 * 0.04);
    canopy3Inst.setColorAt(i, _treeCol);

    // Trunk PLAYER collider — generous, prevents walking through
    const trunkCol = new THREE.Mesh(
      new THREE.BoxGeometry(trunkR * 2.4, trunkH, trunkR * 2.4),
      invisibleColliderMat
    );
    trunkCol.position.set(x, h + trunkH / 2, z);
    trunkCol.updateMatrixWorld(true);
    collidables.push(trunkCol);

    // Trunk BULLET hitbox — tight to visual trunk cylinder
    const trunkHit = new THREE.Mesh(
      new THREE.BoxGeometry(trunkR * 1.8, trunkH, trunkR * 1.8),
      invisibleColliderMat
    );
    trunkHit.position.set(x, h + trunkH / 2, z);
    trunkHit.updateMatrixWorld(true);
    targets.push(trunkHit);

    // Canopy BULLET hitbox — tight to visual squashed sphere
    const canopyHit = new THREE.Mesh(
      new THREE.BoxGeometry(canopyR * 1.3, canopyR * scaleY * 1.4, canopyR * 1.3),
      invisibleColliderMat
    );
    canopyHit.position.set(x, h + trunkH + canopyR * 0.35, z);
    canopyHit.updateMatrixWorld(true);
    targets.push(canopyHit);
    collidables.push(canopyHit);  // solid shell — player can't jump inside
  });

  trunkInst.instanceMatrix.needsUpdate = true;
  flareInst.instanceMatrix.needsUpdate = true;
  canopyInst.instanceMatrix.needsUpdate = true;
  canopy2Inst.instanceMatrix.needsUpdate = true;
  canopy3Inst.instanceMatrix.needsUpdate = true;
  trunkInst.instanceColor.needsUpdate  = true;
  flareInst.instanceColor.needsUpdate  = true;
  canopyInst.instanceColor.needsUpdate  = true;
  canopy2Inst.instanceColor.needsUpdate = true;
  canopy3Inst.instanceColor.needsUpdate = true;
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
      const x = gx + (seededRand() - 0.5) * bushGridSize * 0.8 + bushGridSize / 2;
      const z = gz + (seededRand() - 0.5) * bushGridSize * 0.8 + bushGridSize / 2;
      if (canPlaceAt(x, z)) bushPlacements.push({ x, z });
    }
  }

  // bushInst  = arborvitae cone body  (even indices)
  // bush2Inst = arborvitae base trunk  (even indices)
  // bush3Inst = decorative small bush  (odd indices, no collider)
  const bushGeo  = new THREE.ConeGeometry(0.5, 1, 6);
  const bushMat  = new THREE.MeshLambertMaterial({ map: _arborTex });
  const bushInst = new THREE.InstancedMesh(bushGeo, bushMat, bushPlacements.length);
  bushInst.castShadow = true;
  const bush2Geo  = new THREE.CylinderGeometry(0.25, 0.38, 0.5, 6);
  const bush2Mat  = new THREE.MeshLambertMaterial({ color: 0x0a1806 });
  const bush2Inst = new THREE.InstancedMesh(bush2Geo, bush2Mat, bushPlacements.length);
  bush2Inst.castShadow = false;
  const bush3Geo  = new THREE.SphereGeometry(1, 6, 4);
  const bush3Mat  = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const bush3Inst = new THREE.InstancedMesh(bush3Geo, bush3Mat, bushPlacements.length);
  bush3Inst.castShadow = false;
  const _bushCol = new THREE.Color();
  const dummy = new THREE.Object3D();
  const zeroMatrix = (() => { const d = new THREE.Object3D(); d.scale.set(0,0,0); d.updateMatrix(); return d.matrix.clone(); })();
  bushPlacements.forEach(({ x, z }, i) => {
    const h = getTerrainHeight(x, z);
    if (i % 2 === 0) {
      // Arborvitae
      const w  = (0.4 + seededRand() * 0.35) * 4.4;
      const ht = w * (2.6 + seededRand() * 1.0);
      dummy.position.set(x, h + ht * 0.5, z);
      dummy.scale.set(w * 1.25, ht, w * 1.25);
      dummy.rotation.set(0, seededRand() * 6.28, 0);
      dummy.updateMatrix();
      bushInst.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, h + 0.25, z);
      dummy.scale.set(w * 0.55, 1, w * 0.55);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      bush2Inst.setMatrixAt(i, dummy.matrix);
      bush3Inst.setMatrixAt(i, zeroMatrix);
      // Arborvitae: narrow range, muted dark-to-medium green
      const bv = Math.sin(x * 73.4 + z * 197.1) * 0.5 + 0.5;
      _bushCol.setRGB(0.50 + bv * 0.18, 0.56 + bv * 0.14, 0.40 + bv * 0.14);
      bushInst.setColorAt(i, _bushCol);
      bush3Inst.setColorAt(i, _bushCol); // zero-scaled, harmless
      const bushCol = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.35, ht * 1.05, w * 1.35),
        invisibleColliderMat
      );
      bushCol.position.set(x, h + ht * 0.5, z);
      bushCol.updateMatrixWorld(true);
      collidables.push(bushCol);
      const bushHit = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.85, ht, w * 0.85),
        invisibleColliderMat
      );
      bushHit.position.set(x, h + ht * 0.5, z);
      bushHit.updateMatrixWorld(true);
      targets.push(bushHit);
    } else {
      // Decorative small bush — no collider, walkthrough
      const dr     = 0.546 + seededRand() * 0.858;
      const dScaleY = 0.28 + seededRand() * 0.22;
      dummy.position.set(x, h + dr * dScaleY * 0.5, z);
      dummy.scale.set(dr, dr * dScaleY, dr);
      dummy.rotation.set(0, seededRand() * 6.28, 0);
      dummy.updateMatrix();
      bush3Inst.setMatrixAt(i, dummy.matrix);
      bushInst.setMatrixAt(i, zeroMatrix);
      bush2Inst.setMatrixAt(i, zeroMatrix);
      // Round bush: muted medium-dark green, slight variance
      const bv2 = Math.cos(x * 41.7 - z * 83.2) * 0.5 + 0.5;
      _bushCol.setRGB(0.06 + bv2 * 0.10, 0.28 + bv2 * 0.12, 0.03 + bv2 * 0.04);
      bush3Inst.setColorAt(i, _bushCol);
      bushInst.setColorAt(i, _bushCol); // zero-scaled, harmless
    }
  });
  bushInst.instanceMatrix.needsUpdate = true;
  bush2Inst.instanceMatrix.needsUpdate = true;
  bush3Inst.instanceMatrix.needsUpdate = true;
  bushInst.instanceColor.needsUpdate  = true;
  bush3Inst.instanceColor.needsUpdate = true;
  scene.add(bushInst);
  scene.add(bush2Inst);
  scene.add(bush3Inst);
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
      if (canPlaceAt(x, z)) rockPlacements.push({ x, z });
    }
  }

  // Crate visuals — 3 instanced meshes: main body, wood slat H, wood slat V
  const crateBodyGeo = new THREE.BoxGeometry(1, 1, 1);
  const crateBodyMat = new THREE.MeshLambertMaterial({ color: 0xa06828 });
  const crateInst    = new THREE.InstancedMesh(crateBodyGeo, crateBodyMat, rockPlacements.length);
  crateInst.castShadow = true;

  const slatHGeo  = new THREE.BoxGeometry(1.12, 0.11, 1.12);
  const slatMat   = new THREE.MeshLambertMaterial({ color: 0x1e0c02 });
  const slatHInst = new THREE.InstancedMesh(slatHGeo, slatMat, rockPlacements.length * 2);
  slatHInst.castShadow = false;

  const slatVGeo  = new THREE.BoxGeometry(1.12, 0.11, 1.12);
  const slatVInst = new THREE.InstancedMesh(slatVGeo, slatMat, rockPlacements.length * 2);
  slatVInst.castShadow = false;

  const dummy = new THREE.Object3D();

  rockPlacements.forEach(({ x, z }, i) => {
    const h  = getTerrainHeight(x, z);
    const sz = 1.4 + seededRand() * 1.2;  // crate size 1.4–2.6 units
    const yRot = seededRand() * 6.28;

    // Main crate body
    dummy.position.set(x, h + sz * 0.5, z);
    dummy.scale.set(sz, sz, sz);
    dummy.rotation.set(0, yRot, 0);
    dummy.updateMatrix();
    crateInst.setMatrixAt(i, dummy.matrix);

    // Horizontal slats (top + bottom band)
    [-0.41, 0.41].forEach((yOff, si) => {
      dummy.position.set(x, h + sz * 0.5 + sz * yOff, z);
      dummy.scale.set(sz, sz, sz);
      dummy.rotation.set(0, yRot, 0);
      dummy.updateMatrix();
      slatHInst.setMatrixAt(i * 2 + si, dummy.matrix);
    });

    // Vertical slats (front + back band)
    [-0.41, 0.41].forEach((xOff, si) => {
      dummy.position.set(x, h + sz * 0.5 + sz * xOff, z);
      dummy.scale.set(sz, sz, sz);
      dummy.rotation.set(0, yRot, 0);
      dummy.updateMatrix();
      slatVInst.setMatrixAt(i * 2 + si, dummy.matrix);
    });

    // Player collider — exact crate size, perfect fit since it's already a box
    const collider = new THREE.Mesh(
      new THREE.BoxGeometry(sz * 1.2, sz * 1.2, sz * 1.2),
      invisibleColliderMat
    );
    collider.position.set(x, h + sz * 0.5, z);
    collider.rotation.y = 0;
    collider.updateMatrixWorld(true);
    collidables.push(collider);

    // Bullet hitbox — same as collider
    const crateHit = new THREE.Mesh(
      new THREE.BoxGeometry(sz, sz, sz),
      invisibleColliderMat
    );
    crateHit.position.set(x, h + sz * 0.5, z);
    crateHit.rotation.y = yRot;
    crateHit.updateMatrixWorld(true);
    targets.push(crateHit);
  });

  crateInst.instanceMatrix.needsUpdate = true;
  slatHInst.instanceMatrix.needsUpdate = true;
  slatVInst.instanceMatrix.needsUpdate = true;
  scene.add(crateInst);
  scene.add(slatHInst);
  scene.add(slatVInst);
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

  // Crate body — tilted to slope
  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(sz, sz, sz),
    new THREE.MeshLambertMaterial({ color: 0xa06828 })
  );
  crate.position.set(x, h + sz * 0.5, z);
  crate.rotation.set(0, yRot, 0);
  crate.castShadow = true;
  scene.add(crate);

  // Dark wood slats — full-wrap bands near top and bottom edges
  [-0.41, 0.41].forEach(yOff => {
    const slat = new THREE.Mesh(
      new THREE.BoxGeometry(sz * 1.12, sz * 0.11, sz * 1.12),
      new THREE.MeshLambertMaterial({ color: 0x1e0c02 })
    );
    slat.position.set(x, h + sz * 0.5 + sz * yOff, z);
    slat.rotation.set(0, yRot, 0);
    scene.add(slat);
  });

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

// ── Instanced Grass — uniform-width skinny shards, 1 draw call ──
{
  const grassPlacements = [];
  const grassGrid = 0.38;
  for (let gx = -half; gx < half; gx += grassGrid) {
    for (let gz = -half; gz < half; gz += grassGrid) {
      const x = gx + (seededRand() - 0.5) * grassGrid;
      const z = gz + (seededRand() - 0.5) * grassGrid;
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

  // 2 perpendicular planes — slightly wider blade, lighter base so it blends with terrain
  const gH = 0.107, gW = 0.016;
  const gv = new Float32Array([
    -gW, 0, 0,   gW, 0, 0,   -gW, gH, 0,   gW, gH, 0,   // Plane 0 (along X)
     0, 0, -gW,   0, 0, gW,   0, gH, -gW,   0, gH, gW,   // Plane 1 (along Z)
  ]);
  // Medium green base → soft muted tip (not white — prevents oversaturation)
  const gcol = new Float32Array([
    0.12,0.34,0.06, 0.12,0.34,0.06, 0.48,0.72,0.22, 0.48,0.72,0.22,
    0.12,0.34,0.06, 0.12,0.34,0.06, 0.48,0.72,0.22, 0.48,0.72,0.22,
  ]);
  const gIdx = [0,1,2, 1,3,2,  4,5,6, 5,7,6];

  const grassGeo  = new THREE.BufferGeometry();
  grassGeo.setAttribute('position', new THREE.BufferAttribute(gv, 3));
  grassGeo.setAttribute('color',    new THREE.BufferAttribute(gcol, 3));
  grassGeo.setIndex(gIdx);
  const grassMat  = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const grassInst = new THREE.InstancedMesh(grassGeo, grassMat, grassPlacements.length);

  const grassPalette = [
    [0.55, 0.80, 0.40],  // muted warm green
    [0.45, 0.72, 0.30],  // muted forest
    [0.60, 0.85, 0.42],  // muted fresh
    [0.50, 0.75, 0.38],  // muted cool
    [0.40, 0.65, 0.28],  // muted dark
  ];

  const _gDummy = new THREE.Object3D();
  const _gCol   = new THREE.Color();
  grassPlacements.forEach(({ x, z }, i) => {
    const h = getTerrainHeight(x, z);
    const s = 0.7 + seededRand() * 1.0;
    _gDummy.position.set(x, h, z);
    _gDummy.scale.set(s, s * (0.7 + seededRand() * 0.55), s);
    // Random lean — tilt 5–22° in a random azimuth direction so blades look organic not vertical
    const leanDir = seededRand() * 6.28;
    const leanAmt = 0.09 + seededRand() * 0.30;
    _gDummy.rotation.set(
      Math.sin(leanDir) * leanAmt,
      seededRand() * 6.28,
      Math.cos(leanDir) * leanAmt
    );
    _gDummy.updateMatrix();
    grassInst.setMatrixAt(i, _gDummy.matrix);
    const fi = Math.abs(Math.sin(x * 131.7 + z * 211.3) * 0.6 + Math.cos(x * 79.1 - z * 163.7) * 0.4);
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
