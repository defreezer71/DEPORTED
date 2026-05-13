// JUNGLE — Trees and Bushes
// ═══════════════════════════════════════════════════════════
function canPlaceAt(x, z) {
  if (getVolcanoHeight(x, z) > 1) return false;
  if (Math.abs(x - prison.x) < pw / 2 + 10 && Math.abs(z - prison.z) < pw / 2 + 10) return false;
  if (Math.abs(x) > half - 12 || Math.abs(z) > half - 12) return false;
  if (isInStream(x, z)) return false; // No trees/bushes in stream
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

// ── Instanced Dandelions — thin stem + 3-plane star head, 1 draw call ──
{
  const dandelionPlacements = [];
  const dGrid = 3.5;
  for (let gx = -half + 8; gx < half - 8; gx += dGrid) {
    for (let gz = -half + 8; gz < half - 8; gz += dGrid) {
      const x = gx + (seededRand() - 0.5) * dGrid;
      const z = gz + (seededRand() - 0.5) * dGrid;
      if (!canPlaceAt(x, z)) continue;
      dandelionPlacements.push({ x, z });
    }
  }

  // Geometry: 2-plane thin stem (8 verts) + 3-plane star head (12 verts) = 20 verts, 10 tris
  // Head planes at 0°, 60°, 120° around Y — reads as a round puffball from any angle
  const sH = 0.275, sW = 0.0145;     // stem height, half-width (−30% total)
  const hR = 0.094, hY = sH - 0.01, hT = hY + 0.065;   // head radius, base-y, top-y (−30% total)
  const c60 = 0.5, s60 = 0.866;      // cos/sin 60°

  const dv = new Float32Array([
    // Stem plane 1 (along X)
    -sW, 0,   0,   sW, 0,   0,   -sW, sH,  0,   sW, sH,  0,
    // Stem plane 2 (along Z)
     0,  0, -sW,    0, 0,  sW,    0,  sH, -sW,   0, sH,  sW,
    // Head plane A (0°, along X)
    -hR,      hY,  0,        hR,      hY,  0,        -hR,      hT,  0,        hR,      hT,  0,
    // Head plane B (60°)
    -hR*c60,  hY, -hR*s60,   hR*c60,  hY,  hR*s60,  -hR*c60,  hT, -hR*s60,  hR*c60,  hT,  hR*s60,
    // Head plane C (120°)
     hR*c60,  hY, -hR*s60,  -hR*c60,  hY,  hR*s60,   hR*c60,  hT, -hR*s60, -hR*c60,  hT,  hR*s60,
  ]);

  // Stem: dark green base → mid green top. Head: pure white (instance color provides hue).
  const dCol = new Float32Array([
    // Stem plane 1
    0.04,0.12,0.01,  0.04,0.12,0.01,  0.10,0.28,0.03,  0.10,0.28,0.03,
    // Stem plane 2
    0.04,0.12,0.01,  0.04,0.12,0.01,  0.10,0.28,0.03,  0.10,0.28,0.03,
    // Head A, B, C — pure white so instance color tints cleanly
    1,1,1,  1,1,1,  1,1,1,  1,1,1,
    1,1,1,  1,1,1,  1,1,1,  1,1,1,
    1,1,1,  1,1,1,  1,1,1,  1,1,1,
  ]);

  const dIdx = [
    0,1,2, 1,3,2,    // stem 1
    4,5,6, 5,7,6,    // stem 2
    8,9,10, 9,11,10, // head A
    12,13,14, 13,15,14, // head B
    16,17,18, 17,19,18, // head C
  ];

  const dandelionGeo = new THREE.BufferGeometry();
  dandelionGeo.setAttribute('position', new THREE.BufferAttribute(dv, 3));
  dandelionGeo.setAttribute('color',    new THREE.BufferAttribute(dCol, 3));
  dandelionGeo.setIndex(dIdx);
  const dandelionMat  = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const dandelionInst = new THREE.InstancedMesh(dandelionGeo, dandelionMat, dandelionPlacements.length);
  dandelionInst.castShadow = false;

  // Head color palette: mostly greens, one yellow, whites
  const dPalette = [
    [0.18, 0.78, 0.18],   // bright green
    [1.00, 0.94, 0.18],   // pale yellow (1 yellow kept)
    [0.97, 0.97, 0.92],   // white puffball
    [0.10, 0.58, 0.22],   // forest green
    [0.95, 0.98, 0.85],   // cream/off-white
    [0.25, 0.82, 0.32],   // vivid green
  ];

  const _dDummy = new THREE.Object3D();
  const _dCol   = new THREE.Color();
  dandelionPlacements.forEach(({ x, z }, i) => {
    const h = getTerrainHeight(x, z);
    const s = 0.397 + seededRand() * 0.470;    // −30% total
    _dDummy.position.set(x, h, z);
    _dDummy.scale.set(s, s * (0.85 + seededRand() * 0.40), s);
    _dDummy.rotation.y = seededRand() * 6.28;
    _dDummy.updateMatrix();
    dandelionInst.setMatrixAt(i, _dDummy.matrix);

    // Multi-prime hash — no grid pattern
    const fi = Math.abs(
      Math.sin(x * 173.1 + z * 251.7) * 0.5 +
      Math.cos(x * 97.3  - z * 139.4) * 0.3 +
      Math.sin((x - z)   * 61.7)      * 0.2
    );
    const [r, g, b] = dPalette[Math.floor(fi * dPalette.length) % dPalette.length];
    _dCol.setRGB(r, g, b);
    dandelionInst.setColorAt(i, _dCol);
  });
  dandelionInst.instanceMatrix.needsUpdate = true;
  dandelionInst.instanceColor.needsUpdate  = true;
  scene.add(dandelionInst);
}

// ── Instanced Ferns — 3-plane tapered fronds radiating from centre, 1 draw call ──
{
  const fernPlacements = [];
  const fernGridSize = 11;
  for (let gx = -half + 12; gx < half - 12; gx += fernGridSize) {
    for (let gz = -half + 12; gz < half - 12; gz += fernGridSize) {
      const x = gx + (seededRand() - 0.5) * fernGridSize * 0.85 + fernGridSize * 0.4;
      const z = gz + (seededRand() - 0.5) * fernGridSize * 0.85 + fernGridSize * 0.4;
      if (!canPlaceAt(x, z)) continue;
      fernPlacements.push({ x, z });
    }
  }

  // 3 frond planes at 0°, 60°, 120° — tapered (wide base → narrow tip)
  // Base vertex color is dark so stems stay dark green regardless of instance tint.
  // Tip vertex color is white so instance color fully controls the tip hue.
  const fH = 0.68, fW = 0.52, fT = 0.055;   // height, base half-width, tip half-width
  const c60 = 0.5, s60 = 0.866;

  const fv = new Float32Array([
    // Plane 0 (0°, along X)
    -fW, 0,  0,      fW,  0,  0,     -fT, fH, 0,     fT, fH, 0,
    // Plane 1 (60°)
    -fW*c60, 0, -fW*s60,   fW*c60, 0, fW*s60,   -fT*c60, fH, -fT*s60,   fT*c60, fH, fT*s60,
    // Plane 2 (120°)
     fW*c60, 0, -fW*s60,  -fW*c60, 0, fW*s60,    fT*c60, fH, -fT*s60,  -fT*c60, fH, fT*s60,
  ]);
  const fc = new Float32Array([
    0.03,0.14,0.02, 0.03,0.14,0.02, 1,1,1, 1,1,1,
    0.03,0.14,0.02, 0.03,0.14,0.02, 1,1,1, 1,1,1,
    0.03,0.14,0.02, 0.03,0.14,0.02, 1,1,1, 1,1,1,
  ]);
  const fIdx = [0,1,2,1,3,2,  4,5,6,5,7,6,  8,9,10,9,11,10];

  const fernGeo  = new THREE.BufferGeometry();
  fernGeo.setAttribute('position', new THREE.BufferAttribute(fv, 3));
  fernGeo.setAttribute('color',    new THREE.BufferAttribute(fc, 3));
  fernGeo.setIndex(fIdx);
  const fernMat  = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const fernInst = new THREE.InstancedMesh(fernGeo, fernMat, fernPlacements.length);

  // Fern tip color palette — varied greens
  const fernPalette = [
    [0.20, 0.80, 0.18],   // bright green
    [0.12, 0.55, 0.14],   // forest green
    [0.28, 0.72, 0.22],   // yellow-green
    [0.10, 0.62, 0.28],   // cool green
    [0.22, 0.68, 0.16],   // medium green
  ];

  const _fDummy = new THREE.Object3D();
  const _fCol   = new THREE.Color();
  fernPlacements.forEach(({ x, z }, i) => {
    const h = getTerrainHeight(x, z);
    const s = 0.7 + seededRand() * 1.1;
    _fDummy.position.set(x, h, z);
    _fDummy.scale.set(s, s * (0.75 + seededRand() * 0.45), s);
    _fDummy.rotation.y = seededRand() * 6.28;
    _fDummy.updateMatrix();
    fernInst.setMatrixAt(i, _fDummy.matrix);
    const fi = Math.abs(Math.sin(x * 97.3 + z * 181.7) * 0.5 + Math.cos(x * 61.1 - z * 143.9) * 0.5);
    const [r, g, b] = fernPalette[Math.floor(fi * fernPalette.length) % fernPalette.length];
    _fCol.setRGB(r, g, b);
    fernInst.setColorAt(i, _fCol);
  });
  fernInst.instanceMatrix.needsUpdate = true;
  fernInst.instanceColor.needsUpdate  = true;
  scene.add(fernInst);
}

// ── Wildflower Accents — tiny bright-top crossed quads, 1 draw call ──
{
  const flowerPlacements = [];
  const flowerGridSize = 9;
  for (let gx = -half + 10; gx < half - 10; gx += flowerGridSize) {
    for (let gz = -half + 10; gz < half - 10; gz += flowerGridSize) {
      const x = gx + (seededRand() - 0.5) * flowerGridSize * 0.9;
      const z = gz + (seededRand() - 0.5) * flowerGridSize * 0.9;
      if (!canPlaceAt(x, z)) continue;
      flowerPlacements.push({ x, z });
    }
  }

  // Short stem + bright top — very thin blades with vivid tip
  const fh = 0.255, fw = 0.153;
  const fv = new Float32Array([
    -fw*0.5, 0,    0,      fw*0.5,  0,    0,     -fw*0.08, fh,  0,      fw*0.08, fh,  0,
     0,       0,  -fw*0.5,  0,      0,   fw*0.5,  0,       fh, -fw*0.08, 0,      fh,  fw*0.08,
  ]);
  // Stem is dark green, top is white-ish (instance color provides the hue)
  const fc = new Float32Array([
    0.05,0.12,0.02,  0.05,0.12,0.02,  0.95,0.92,0.88,  0.95,0.92,0.88,
    0.05,0.12,0.02,  0.05,0.12,0.02,  0.95,0.92,0.88,  0.95,0.92,0.88,
  ]);
  const fIdx = [0,1,2, 1,3,2,  4,5,6, 5,7,6];
  const flowerGeo  = new THREE.BufferGeometry();
  flowerGeo.setAttribute('position', new THREE.BufferAttribute(fv, 3));
  flowerGeo.setAttribute('color',    new THREE.BufferAttribute(fc, 3));
  flowerGeo.setIndex(fIdx);
  const flowerMat  = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const flowerInst = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerPlacements.length);

  const _fDummy = new THREE.Object3D();
  const _fCol   = new THREE.Color();
  // Palette: greens + lavender + white + blue (no yellow)
  const flowerPalette = [
    [0.22, 0.82, 0.25],  // bright green
    [0.85, 0.60, 1.00],  // lavender
    [1.0,  1.0,  1.0 ],  // white
    [0.12, 0.62, 0.20],  // dark green
    [0.55, 0.85, 1.00],  // sky blue
  ];
  flowerPlacements.forEach(({ x, z }, i) => {
    const h   = getTerrainHeight(x, z);
    const s   = 0.4675 + seededRand() * 0.5525;
    _fDummy.position.set(x, h, z);
    _fDummy.scale.set(s, s * (0.8 + seededRand() * 0.5), s);
    _fDummy.rotation.y = seededRand() * 6.28;
    _fDummy.updateMatrix();
    flowerInst.setMatrixAt(i, _fDummy.matrix);
    // Pick palette color from hash — never repeating in a grid pattern
    const fi = Math.abs(Math.sin(x * 173.1 + z * 251.7) * Math.cos(x * 97.3 - z * 139.4));
    const [r, g, b] = flowerPalette[Math.floor(fi * flowerPalette.length)];
    _fCol.setRGB(r, g, b);
    flowerInst.setColorAt(i, _fCol);
  });
  flowerInst.instanceMatrix.needsUpdate = true;
  flowerInst.instanceColor.needsUpdate  = true;
  scene.add(flowerInst);
}

// ═══════════════════════════════════════════════════════════
