// ═══════════════════════════════════════════════════════════
// PRISON COMPOUND — Taller walls
// ═══════════════════════════════════════════════════════════
const prison = { x: CONFIG.prisonPos.x, z: CONFIG.prisonPos.z, size: CONFIG.prisonSize };
const pw = prison.size;
const pwh = CONFIG.prisonWallHeight;
const pwt = 0.6;

// ── Prison materials — layered concrete tones ──
const prisonWallMat   = new THREE.MeshLambertMaterial({ color: 0x6a6a62 }); // weathered concrete
const prisonWallDark  = new THREE.MeshLambertMaterial({ color: 0x4e4e48 }); // deep shadow tone
const prisonAccent    = new THREE.MeshLambertMaterial({ color: 0x58524a }); // warm grey-brown
const prisonMetal     = new THREE.MeshLambertMaterial({ color: 0x38383a }); // dark iron
const prisonRust      = new THREE.MeshLambertMaterial({ color: 0x6b4030 }); // rust/oxide
const prisonCap       = new THREE.MeshLambertMaterial({ color: 0x505048 }); // wall cap

function createPrisonWall(x, z, w, h, d) {
  // Main wall body
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), prisonWallMat);
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  collidables.push(mesh);
  targets.push(mesh);

  // Wall cap (darker top strip)
  const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, 0.22, d + 0.05), prisonCap);
  cap.position.set(x, h + 0.11, z);
  cap.castShadow = true;
  scene.add(cap);

  // Horizontal concrete band at mid-height
  const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.18, d + 0.04), prisonWallDark);
  band.position.set(x, h * 0.45, z);
  scene.add(band);

  // Lower base strip — slightly wider, darker
  const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.35, d + 0.1), prisonAccent);
  base.position.set(x, 0.175, z);
  base.receiveShadow = true;
  scene.add(base);

  return mesh;
}

// North wall (z-)
createPrisonWall(prison.x, prison.z - pw / 2, pw, pwh, pwt);
// South wall (z+) — full wall
createPrisonWall(prison.x, prison.z + pw / 2, pw, pwh, pwt);
// East wall (x+) — GATE OPENING facing volcano (split with gap)
const gateWidth = 6;
const eastWallLen = (pw - gateWidth) / 2;
createPrisonWall(prison.x + pw / 2, prison.z - pw / 2 + eastWallLen / 2, pwt, pwh, eastWallLen);
createPrisonWall(prison.x + pw / 2, prison.z + pw / 2 - eastWallLen / 2, pwt, pwh, eastWallLen);
// West wall — full
createPrisonWall(prison.x - pw / 2, prison.z, pwt, pwh, pw);

// Vertical pilasters along each wall face — break up flat surfaces
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

// Gate posts on east wall — beefier, with light fixtures
for (const side of [-1, 1]) {
  // Main post — wider and taller
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, pwh + 2.2, 0.8), prisonAccent);
  post.position.set(prison.x + pw / 2, (pwh + 2.2) / 2, prison.z + side * (gateWidth / 2));
  post.castShadow = true;
  scene.add(post);
  // Post cap
  const postCap = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 1.1), prisonMetal);
  postCap.position.set(prison.x + pw / 2, pwh + 2.2 + 0.12, prison.z + side * (gateWidth / 2));
  scene.add(postCap);
  // Light box on post
  const lightBox = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.4), new THREE.MeshLambertMaterial({ color: 0x888860, emissive: 0x444420, emissiveIntensity: 0.6 }));
  lightBox.position.set(prison.x + pw / 2 - 0.3, pwh + 1.6, prison.z + side * (gateWidth / 2));
  scene.add(lightBox);
}

// Gate sign above entrance — "DEPORTED" lettering beam
const signBeam = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, gateWidth + 1.8), prisonMetal);
signBeam.position.set(prison.x + pw / 2, pwh + 1.8, prison.z);
scene.add(signBeam);
// Sign face plate
const signFace = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.38, gateWidth + 1.4), new THREE.MeshLambertMaterial({ color: 0x1a1a1a, emissive: 0x0a0a08, emissiveIntensity: 0.3 }));
signFace.position.set(prison.x + pw / 2 - 0.2, pwh + 1.8, prison.z);
scene.add(signFace);

// Gate doors — heavier metal look with cross-bracing
const gateHalfW = gateWidth / 2;
const gateDoorMat = new THREE.MeshLambertMaterial({ color: 0x3a3028 });
const gateDoorL = new THREE.Mesh(new THREE.BoxGeometry(pwt + 0.25, pwh, gateHalfW), gateDoorMat);
const gatePivotL = new THREE.Group();
gatePivotL.position.set(prison.x + pw / 2, 0, prison.z - gateWidth / 2);
gateDoorL.position.set(0, pwh / 2, gateHalfW / 2);
gatePivotL.add(gateDoorL);
scene.add(gatePivotL);
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
  // Vertical bars
  for (let b = 0; b < 4; b++) {
    const bar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, pwh * 0.85, 5),
      prisonMetal
    );
    bar.position.set(0.18, 0, (b / 3 - 0.5) * gateHalfW * 0.72);
    door.add(bar);
  }
  // Horizontal cross-bar
  const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, gateHalfW * 0.9), prisonMetal);
  hBar.position.set(0.18, pwh * 0.15, 0);
  door.add(hBar);
  const hBar2 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, gateHalfW * 0.9), prisonMetal);
  hBar2.position.set(0.18, -pwh * 0.2, 0);
  door.add(hBar2);
  // Rust streaks on door face
  for (let r = 0; r < 3; r++) {
    const rust = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.18), prisonRust);
    rust.position.set(0.22, pwh * 0.1 - r * pwh * 0.15, (Math.random() - 0.5) * gateHalfW * 0.6);
    door.add(rust);
  }
}
let gateOpenProgress = 0;

// Battlements (merlons) along all wall tops — crenellated parapet
{
  const merlon = new THREE.MeshLambertMaterial({ color: 0x606058 });
  const wallEdges = [
    { axis: 'x', fixed: prison.z - pw/2, from: prison.x - pw/2, to: prison.x + pw/2 },
    { axis: 'x', fixed: prison.z + pw/2, from: prison.x - pw/2, to: prison.x + pw/2 },
    { axis: 'z', fixed: prison.x - pw/2, from: prison.z - pw/2, to: prison.z + pw/2 },
    { axis: 'z', fixed: prison.x + pw/2, from: prison.z - pw/2, to: prison.z + pw/2 },
  ];
  wallEdges.forEach(({ axis, fixed, from, to }, wallIdx) => {
    const count = 12;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const pos = from + (to - from) * t;
      // Skip gate area on east wall
      if (wallIdx === 3 && Math.abs((from + (to-from)*t) - prison.z) < gateWidth / 2 + 0.3) continue;
      const mx = axis === 'x' ? pos : fixed;
      const mz = axis === 'x' ? fixed : pos;
      const m = new THREE.Mesh(new THREE.BoxGeometry(
        axis === 'x' ? 1.1 : pwt + 0.15,
        0.9,
        axis === 'x' ? pwt + 0.15 : 1.1
      ), merlon);
      m.position.set(mx, pwh + 0.45, mz);
      m.castShadow = true;
      scene.add(m);
    }
  });
}

// Barbed wire coils along wall tops between merlons
{
  const wireMat = new THREE.MeshLambertMaterial({ color: 0x555548 });
  const wireEdges = [
    { axis: 'x', fixed: prison.z - pw/2, from: prison.x - pw/2, to: prison.x + pw/2 },
    { axis: 'x', fixed: prison.z + pw/2, from: prison.x - pw/2, to: prison.x + pw/2 },
    { axis: 'z', fixed: prison.x - pw/2, from: prison.z - pw/2, to: prison.z + pw/2 },
  ];
  wireEdges.forEach(({ axis, fixed, from, to }) => {
    const wireLen = to - from;
    const wx = axis === 'x' ? (from + to) / 2 : fixed;
    const wz = axis === 'x' ? fixed : (from + to) / 2;
    const wire = new THREE.Mesh(new THREE.BoxGeometry(
      axis === 'x' ? wireLen : 0.08,
      0.08,
      axis === 'x' ? 0.08 : wireLen
    ), wireMat);
    wire.position.set(wx, pwh + 0.12, wz);
    scene.add(wire);
    // Barb spikes along wire
    const barbCount = Math.floor(wireLen / 1.5);
    for (let b = 0; b < barbCount; b++) {
      const bt = (b + 0.5) / barbCount;
      const bx = axis === 'x' ? from + wireLen * bt : fixed;
      const bz = axis === 'x' ? fixed : from + wireLen * bt;
      const barb = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.28, 4), wireMat);
      barb.rotation.z = Math.PI / 2;
      barb.position.set(bx, pwh + 0.14, bz);
      scene.add(barb);
    }
  });
}

// Guard towers — upgraded with more detail
const towerH = pwh + 3.5;
// Each tower has an inward-facing direction for the guard house opening
// fX, fZ = unit direction from corner toward prison center (dominant axis)
const towerCorners = [
  { x: prison.x + pw / 2 - 1.5, z: prison.z - pw / 2 + 1.5, fX: -1, fZ:  1 }, // NE → faces SW (inward)
  { x: prison.x - pw / 2 + 1.5, z: prison.z - pw / 2 + 1.5, fX:  1, fZ:  1 }, // NW → faces SE (inward)
  { x: prison.x + pw / 2 - 1.5, z: prison.z + pw / 2 - 1.5, fX: -1, fZ: -1 }, // SE → faces NW (inward)
  { x: prison.x - pw / 2 + 1.5, z: prison.z + pw / 2 - 1.5, fX:  1, fZ: -1 }, // SW → faces NE (inward)
];

towerCorners.forEach(tc => {
  // Derived facing helpers — front is the inward-open side
  const fX = tc.fX, fZ = tc.fZ;
  // Main tower shaft — slightly wider
  const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, towerH, 3.4), prisonWallMat);
  base.position.set(tc.x, towerH / 2, tc.z);
  base.castShadow = true; base.receiveShadow = true;
  scene.add(base);
  collidables.push(base);

  // Vertical corner strips — structural columns
  for (const cx of [-1, 1]) for (const cz of [-1, 1]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.32, towerH, 0.32), prisonAccent);
    col.position.set(tc.x + cx * 1.55, towerH / 2, tc.z + cz * 1.55);
    col.castShadow = true;
    scene.add(col);
  }

  // Tower mid band
  const midBand = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.2, 3.6), prisonWallDark);
  midBand.position.set(tc.x, towerH * 0.5, tc.z);
  scene.add(midBand);

  // Overhang platform — wider than tower
  const platform = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.35, 5.2), prisonWallDark);
  platform.position.set(tc.x, towerH + 0.18, tc.z);
  platform.castShadow = true;
  scene.add(platform);

  // Platform edge rail
  for (const side of [-1, 1]) {
    const railX = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.5, 0.15), prisonMetal);
    railX.position.set(tc.x, towerH + 0.6, tc.z + side * 2.55);
    scene.add(railX);
    const railZ = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.5, 5.4), prisonMetal);
    railZ.position.set(tc.x + side * 2.55, towerH + 0.6, tc.z);
    scene.add(railZ);
  }

  // Guard house — faces inward toward prison center using fX, fZ
  const ghH = 2.4;
  const ghW = 4.8;
  const wt = 0.22;
  const ghY = towerH + 0.35 + ghH / 2;

  // Back wall is on the OUTER side (away from center)
  // fZ dominates: if |fZ|=1 the house is oriented along Z axis (back/front along Z, sides along X)
  // if |fX|=1 and fZ=0 it would be along X — but all our corners have both fX and fZ = ±1 diagonal
  // We pick the Z-dominant layout and rotate by fZ/fX sign
  // Actually: build in local space, back = -fZ direction, front(opening) = +fZ direction
  // For diagonal corners pick fZ as the primary open axis (players see it from inside)

  // Back wall — outer face (opposite of inward direction)
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(ghW, ghH, wt), prisonWallMat);
  backWall.position.set(tc.x, ghY, tc.z - fZ * (ghW / 2 - wt));
  scene.add(backWall);

  // Front wall: two pillars with opening — faces inward (+fZ side)
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.1, ghH, wt), prisonWallMat);
    pillar.position.set(tc.x + side * 1.85, ghY, tc.z + fZ * (ghW / 2 - wt));
    scene.add(pillar);
  }
  // Window header
  const header = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, wt), prisonWallDark);
  header.position.set(tc.x, towerH + 0.35 + ghH - 0.3, tc.z + fZ * (ghW / 2 - wt));
  scene.add(header);
  // Window sill
  const sill = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, wt + 0.1), prisonWallDark);
  sill.position.set(tc.x, towerH + 0.35 + ghH * 0.35, tc.z + fZ * (ghW / 2 - wt));
  scene.add(sill);
  // Window bars
  for (let wb = -1; wb <= 1; wb++) {
    const wbar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, ghH * 0.52, 5), prisonMetal);
    wbar.position.set(tc.x + wb * 0.65, towerH + 0.35 + ghH * 0.6, tc.z + fZ * (ghW / 2 - wt) + fZ * 0.05);
    scene.add(wbar);
  }

  // Side walls — along X axis
  for (const side of [-1, 1]) {
    const sideWall = new THREE.Mesh(new THREE.BoxGeometry(wt, ghH, ghW), prisonWallMat);
    sideWall.position.set(tc.x + side * (ghW / 2 - wt), ghY, tc.z);
    scene.add(sideWall);
    // Side window sill
    const swSill = new THREE.Mesh(new THREE.BoxGeometry(wt + 0.1, 0.15, 1.4), prisonWallDark);
    swSill.position.set(tc.x + side * (ghW / 2 - wt), towerH + 0.35 + ghH * 0.38, tc.z);
    scene.add(swSill);
  }

  // Roof — slightly pitched appearance with overhang
  const roof = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.28, 5.5), prisonCap);
  roof.position.set(tc.x, towerH + 0.35 + ghH + 0.14, tc.z);
  roof.castShadow = true;
  scene.add(roof);
  // Roof lip
  const roofLip = new THREE.Mesh(new THREE.BoxGeometry(5.7, 0.1, 5.7), prisonMetal);
  roofLip.position.set(tc.x, towerH + 0.35 + ghH + 0.0, tc.z);
  scene.add(roofLip);

  // Searchlight on roof
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

// ── Prison stone floor — cobblestone yard ──
{
  // Base yard slab — slightly raised above terrain
  const yardMat = new THREE.MeshLambertMaterial({ color: 0x7a7870 }); // worn stone
  const yardSlab = new THREE.Mesh(new THREE.BoxGeometry(pw - pwt * 2, 0.18, pw - pwt * 2), yardMat);
  yardSlab.position.set(prison.x, 0.09, prison.z);
  yardSlab.receiveShadow = true;
  scene.add(yardSlab);
  collidables.push(yardSlab); // solid floor — prevents feet sinking through

  // Cobblestone grid — rows of slightly varied stone blocks
  const stoneMats = [
    new THREE.MeshLambertMaterial({ color: 0x6e6c64 }),
    new THREE.MeshLambertMaterial({ color: 0x7c7a72 }),
    new THREE.MeshLambertMaterial({ color: 0x686660 }),
    new THREE.MeshLambertMaterial({ color: 0x74726a }),
  ];
  const stoneW = 1.4, stoneD = 1.0, stoneH = 0.12;
  const gapX = 0.12, gapZ = 0.10;
  const startX = prison.x - pw / 2 + pwt + stoneW / 2 + 0.2;
  const startZ = prison.z - pw / 2 + pwt + stoneD / 2 + 0.2;
  const endX   = prison.x + pw / 2 - pwt - 0.2;
  const endZ   = prison.z + pw / 2 - pwt - 0.2;
  let rowIdx = 0;
  for (let sz = startZ; sz < endZ; sz += stoneD + gapZ, rowIdx++) {
    // Offset every other row for brick-bond pattern
    const offsetX = (rowIdx % 2) * (stoneW + gapX) * 0.5;
    for (let sx = startX - offsetX; sx < endX; sx += stoneW + gapX) {
      // Slight random size variation
      const sw = stoneW * (0.88 + Math.random() * 0.18);
      const sd = stoneD * (0.88 + Math.random() * 0.16);
      const sy = stoneH * (0.85 + Math.random() * 0.22);
      const mat = stoneMats[Math.floor(Math.random() * stoneMats.length)];
      const stone = new THREE.Mesh(new THREE.BoxGeometry(sw, sy, sd), mat);
      stone.position.set(sx, 0.18 + sy / 2, sz);
      stone.receiveShadow = true;
      scene.add(stone);
    }
  }

  // Perimeter stone border — slightly darker edging strip
  const borderMat = new THREE.MeshLambertMaterial({ color: 0x5e5c56 });
  const borders = [
    { x: prison.x,            z: prison.z - pw/2 + pwt + 0.35, w: pw - pwt*2, d: 0.55 },
    { x: prison.x,            z: prison.z + pw/2 - pwt - 0.35, w: pw - pwt*2, d: 0.55 },
    { x: prison.x - pw/2 + pwt + 0.35, z: prison.z, w: 0.55, d: pw - pwt*2 },
    { x: prison.x + pw/2 - pwt - 0.35, z: prison.z, w: 0.55, d: pw - pwt*2 },
  ];
  borders.forEach(({ x, z, w, d }) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, d), borderMat);
    b.position.set(x, 0.14, z);
    b.receiveShadow = true;
    scene.add(b);
  });

  // Central drain / manhole detail
  const drainMat = new THREE.MeshLambertMaterial({ color: 0x3a3836 });
  const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 10), drainMat);
  drain.position.set(prison.x - 3, 0.23, prison.z);
  scene.add(drain);
  // Grate lines on drain
  for (let g = -1; g <= 1; g++) {
    const grate = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 1.0), drainMat);
    grate.position.set(prison.x - 3 + g * 0.3, 0.28, prison.z);
    scene.add(grate);
  }
}

// Internal prison yard features — adds depth when viewed from inside
// Central guard booth
{
  const boothMat = new THREE.MeshLambertMaterial({ color: 0x5a5a52 });
  const boothX = prison.x - 3, boothZ = prison.z;
  const booth = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.2, 2.2), boothMat);
  booth.position.set(boothX, 1.6, boothZ);
  booth.castShadow = true; booth.receiveShadow = true;
  scene.add(booth); collidables.push(booth);
  const boothRoof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 2.6), prisonCap);
  boothRoof.position.set(boothX, 3.3, boothZ);
  scene.add(boothRoof);
  // Booth window strips
  for (const side of [-1, 1]) {
    const bwin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 1.0), new THREE.MeshLambertMaterial({ color: 0x334455, emissive: 0x112233, emissiveIntensity: 0.4 }));
    bwin.position.set(boothX + side * 1.1, 2.0, boothZ);
    scene.add(bwin);
  }
}

// Flood lights on wall faces — emissive fixtures
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

// Spikes along top of prison walls — larger, more menacing
// Wall spikes removed

// ═══════════════════════════════════════════════════════════
