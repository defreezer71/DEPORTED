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
  const bH  = 0.218;  // blade length
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
    const scale = (0.9 + rng() * 0.7) * 0.6325; // size variety

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
    // Collision proxy — same footprint as the bush cluster
    const _bCol = new THREE.Mesh(
      new THREE.BoxGeometry(2.0 * scale, 1.4 * scale, 2.0 * scale),
      new THREE.MeshBasicMaterial()
    );
    _bCol.position.set(bx, bh + 0.7 * scale, bz);
    _bCol.updateMatrixWorld(true);
    collidables.push(_bCol);
  }
}
