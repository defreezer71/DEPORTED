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
    addM(new THREE.CylinderGeometry(colR * 1.28, colR * 1.28, 0.22, 12), stone, lx, 0.11, lz);
    addM(new THREE.CylinderGeometry(colR, colR * 1.06, colH, 12), stone, lx, colH / 2, lz);
    // Three ring bands at 20%, 48%, 76% of shaft height
    for (const frac of [0.20, 0.48, 0.76])
      addM(new THREE.CylinderGeometry(colR + 0.055, colR + 0.055, 0.09, 12), groove, lx, colH * frac, lz);
    // Echinus — flared neck from shaft top up to capital
    addM(new THREE.CylinderGeometry(colR * 1.38, colR * 1.02, 0.26, 12), stone, lx, colH + 0.13, lz);
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
