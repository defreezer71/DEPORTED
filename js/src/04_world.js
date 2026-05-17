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
