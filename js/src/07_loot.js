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
const windowPanes = []; // glass panes that block bullets
const depotCorners = [
  { x:  half - 6, z:  half - 6, open: 'east'  },
  { x: -half + 6, z:  half - 6, open: 'west'  },
  { x:  half - 6, z: -half + 6, open: 'east'  },
  { x: -half + 6, z: -half + 6, open: 'west'  },
];

// ── Materials — military weathered look ──
const shedMat    = new THREE.MeshPhongMaterial({ color: 0x6b4f1a, shininess: 8 });
const shedDark   = new THREE.MeshPhongMaterial({ color: 0x3a2208, shininess: 4 });
const shedLight  = new THREE.MeshPhongMaterial({ color: 0x8a6a28, shininess: 12 });
const floorMat   = new THREE.MeshPhongMaterial({ color: 0x251405, shininess: 2 });
const roofMat    = new THREE.MeshPhongMaterial({ color: 0x4a5a3a, shininess: 28 });
const roofRust   = new THREE.MeshPhongMaterial({ color: 0x7a3a18, shininess: 6 });
const roofDark   = new THREE.MeshPhongMaterial({ color: 0x2a3020, shininess: 4 });
const metalMat   = new THREE.MeshPhongMaterial({ color: 0x777777, shininess: 55 });
const warnYellow = new THREE.MeshLambertMaterial({ color: 0xffcc00 });
const warnBlack  = new THREE.MeshLambertMaterial({ color: 0x111111 });
const crateM4Mat = new THREE.MeshPhongMaterial({ color: 0x4a5a18, shininess: 18 });
const crate19Mat = new THREE.MeshPhongMaterial({ color: 0x5a3810, shininess: 18 });
const crateArMat = new THREE.MeshPhongMaterial({ color: 0x0a2a5a, shininess: 22 });
const crateHpMat = new THREE.MeshPhongMaterial({ color: 0x991111, shininess: 18 });
const depotCrates = [];

depotCorners.forEach(({ x, z, open }) => {
  const h = getTerrainHeight(x, z);
  const sw = 8.25, sd = 6.25, sh = 5.85, wt = 0.22;

  // ── Floor — raised wood deck ──
  const floor = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.15, 0.22, sd + 0.15), floorMat);
  floor.position.set(x, h + 0.11, z);
  floor.receiveShadow = true;
  scene.add(floor);
  for (let p = -3; p <= 3; p++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.1, 0.026, 0.07), shedDark);
    plank.position.set(x, h + 0.235, z + p * 0.88);
    scene.add(plank);
  }

  // ── Walls ──
  // Window dimensions — defined early so back-wall cutout can use them
  const backAxis = open === 'east' ? 'west' : 'east';
  const wallPX   = open === 'east' ? x - sw / 2 : x + sw / 2;
  const winW     = sd * 0.50, winH = 0.45;
  const winCY    = h + sh * 0.72;
  const winBot   = winCY - winH / 2;
  const winTop   = winCY + winH / 2;
  const btmH     = winBot - h;
  const topH     = h + sh - winTop;
  const sideZ    = (sd - winW) / 2;

  const allWalls = [
    { px: 0,     pz: -sd/2, w: sw,  d: wt, axis: 'north' },
    { px: 0,     pz:  sd/2, w: sw,  d: wt, axis: 'south' },
    { px: -sw/2, pz: 0,     w: wt,  d: sd, axis: 'west'  },
    { px:  sw/2, pz: 0,     w: wt,  d: sd, axis: 'east'  },
  ];
  allWalls.forEach(({ px, pz, w, d, axis }) => {
    if (axis === open || axis === backAxis) return;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, sh, d), shedMat);
    wall.position.set(x + px, h + sh / 2, z + pz);
    wall.castShadow = true; wall.receiveShadow = true;
    scene.add(wall); collidables.push(wall);
    // Three horizontal board strips
    for (const ht of [0.25, 0.52, 0.78]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, 0.09, d + 0.03), shedDark);
      strip.position.set(x + px, h + sh * ht, z + pz);
      scene.add(strip);
    }
    // Bottom base strip
    const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.07, 0.22, d + 0.07), shedDark);
    base.position.set(x + px, h + 0.11, z + pz);
    scene.add(base);
    // Corner posts with metal caps
    const postH = sh + 0.14;
    for (const s of [-1, 1]) {
      const isXwall = (d > w);
      const postX = isXwall ? x + px : x + px + s * (w / 2 - 0.06);
      const postZ = isXwall ? z + pz + s * (d / 2 - 0.06) : z + pz;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, postH, 0.18), shedDark);
      post.position.set(postX, h + postH / 2, postZ);
      post.castShadow = true;
      scene.add(post);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.26), metalMat);
      cap.position.set(postX, h + postH + 0.045, postZ);
      scene.add(cap);
    }
    // Diagonal cross-brace on long walls
    if (w > d) {
      const br = new THREE.Mesh(new THREE.BoxGeometry(w * 0.86, 0.08, 0.11), shedDark);
      br.rotation.z = 0.40;
      br.position.set(x + px, h + sh * 0.50, z + pz + (axis === 'north' ? 0.12 : -0.12));
      scene.add(br);
    }
  });

  // ── Back wall — 4 pieces around window opening ──
  const bwPieces = [
    [wallPX, h + btmH / 2,              z,                    wt, btmH,  sd    ],  // bottom
    [wallPX, winTop + topH / 2,          z,                    wt, topH,  sd    ],  // top
    [wallPX, winCY,                      z - winW / 2 - sideZ / 2, wt, winH, sideZ],  // left
    [wallPX, winCY,                      z + winW / 2 + sideZ / 2, wt, winH, sideZ],  // right
  ];
  bwPieces.forEach(([bx2, by2, bz2, bw2, bh2, bd2]) => {
    const bwm = new THREE.Mesh(new THREE.BoxGeometry(bw2, bh2, bd2), shedMat);
    bwm.position.set(bx2, by2, bz2);
    bwm.castShadow = true; bwm.receiveShadow = true;
    scene.add(bwm); collidables.push(bwm);
  });
  // Base strip and corner posts for back wall
  const bwBase = new THREE.Mesh(new THREE.BoxGeometry(wt + 0.07, 0.22, sd + 0.07), shedDark);
  bwBase.position.set(wallPX, h + 0.11, z); scene.add(bwBase);
  const bwPostH = sh + 0.14;
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, bwPostH, 0.18), shedDark);
    post.position.set(wallPX, h + bwPostH / 2, z + s * (sd / 2 - 0.06));
    scene.add(post);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.26), metalMat);
    cap.position.set(wallPX, h + bwPostH + 0.045, z + s * (sd / 2 - 0.06));
    scene.add(cap);
  }

  // ── Open-face door frame with warning chevrons ──
  const openAxis = allWalls.find(aw => aw.axis === open);
  if (openAxis) {
    const { px, pz, w, d } = openAxis;
    const isX = (d > w);
    for (const s of [-1, 1]) {
      const fpX = isX ? x + px : x + px + s * (w / 2 - 0.10);
      const fpZ = isX ? z + pz + s * (d / 2 - 0.10) : z + pz;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, sh + 0.20, 0.22), shedDark);
      post.position.set(fpX, h + (sh + 0.20) / 2, fpZ);
      scene.add(post);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.11, 0.30), metalMat);
      cap.position.set(fpX, h + sh + 0.24, fpZ);
      scene.add(cap);
      // Warning chevron bands on lower half of door posts
      for (let b = 0; b < 6; b++) {
        const bMat = b % 2 === 0 ? warnYellow : warnBlack;
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.30, 0.24), bMat);
        band.position.set(fpX, h + 0.35 + b * 0.32, fpZ);
        scene.add(band);
      }
    }
    // Header beam
    const hdrW = isX ? wt + 0.14 : w;
    const hdrD = isX ? d : wt + 0.14;
    const hdr = new THREE.Mesh(new THREE.BoxGeometry(hdrW, 0.28, hdrD), shedLight);
    hdr.position.set(x + px, h + sh + 0.10, z + pz);
    scene.add(hdr);
  }

  // ── Window on interior back wall ──
  const signWallX = open === 'east' ? wallPX + 0.12 : wallPX - 0.12;
  const frameTh = 0.13;
  const glassMat = new THREE.MeshPhongMaterial({ color: 0x88aacc, transparent: true, opacity: 0.28, shininess: 120, depthWrite: false });
  const glassPane = new THREE.Mesh(new THREE.BoxGeometry(0.06, winH - frameTh * 2, winW - frameTh * 2), glassMat);
  glassPane.position.set(signWallX, winCY, z);
  scene.add(glassPane);
  windowPanes.push(glassPane);
  [
    [signWallX, winCY + winH / 2 - frameTh / 2, z,            0.20, frameTh,      winW + 0.05],
    [signWallX, winCY - winH / 2 + frameTh / 2, z,            0.20, frameTh,      winW + 0.05],
    [signWallX, winCY,                           z - winW / 2, 0.20, winH + 0.05,  frameTh    ],
    [signWallX, winCY,                           z + winW / 2, 0.20, winH + 0.05,  frameTh    ],
  ].forEach(([fx, fy, fz, fd, fh, fw]) => {
    const piece = new THREE.Mesh(new THREE.BoxGeometry(fd, fh, fw), shedDark);
    piece.position.set(fx, fy, fz);
    scene.add(piece);
  });

  // ── Corrugated metal roof ──
  const ridgeH = 1.1;
  const roofAngle = Math.atan2(ridgeH, sw / 2);
  const panelW = Math.sqrt((sw / 2) * (sw / 2) + ridgeH * ridgeH) + 0.45;
  const numCorrugations = 8;
  for (const side of [-1, 1]) {
    // Main panel
    const panel = new THREE.Mesh(new THREE.BoxGeometry(panelW, 0.13, sd + 0.95), roofMat);
    panel.rotation.z = side * roofAngle;
    panel.position.set(x + side * sw / 4, h + sh + ridgeH / 2, z);
    panel.castShadow = true; panel.receiveShadow = true;
    scene.add(panel);
    // Corrugation ridges running along shed depth
    for (let r = 0; r < numCorrugations; r++) {
      const t = (r / (numCorrugations - 1)) - 0.5;
      const ridge_strip = new THREE.Mesh(new THREE.BoxGeometry(panelW, 0.055, 0.11), roofDark);
      ridge_strip.rotation.z = side * roofAngle;
      ridge_strip.position.set(
        x + side * sw / 4,
        h + sh + ridgeH / 2 + 0.08,
        z + t * (sd + 0.7)
      );
      scene.add(ridge_strip);
    }
    // Rusty overhang lip
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.13, sd + 1.05), roofRust);
    lip.rotation.z = side * roofAngle;
    lip.position.set(
      x + side * (panelW / 2 + 0.07),
      h + sh + ridgeH / 2 - panelW * Math.sin(roofAngle) / 2,
      z
    );
    scene.add(lip);
    // Metal drip edge
    const drip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.20, sd + 1.05), metalMat);
    drip.rotation.z = side * roofAngle;
    drip.position.set(
      x + side * (panelW / 2 + 0.14),
      h + sh + ridgeH / 2 - panelW * Math.sin(roofAngle) / 2 - 0.06,
      z
    );
    scene.add(drip);
  }
  // Ridge beam + metal cap
  const ridgeBeam = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.30, sd + 1.05), shedDark);
  ridgeBeam.position.set(x, h + sh + ridgeH + 0.07, z);
  scene.add(ridgeBeam);
  const ridgeCap = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, sd + 1.05), metalMat);
  ridgeCap.position.set(x, h + sh + ridgeH + 0.25, z);
  scene.add(ridgeCap);
  // Gable end triangles with trim
  for (const side of [-1, 1]) {
    const gable = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.14, ridgeH, wt), shedMat);
    gable.position.set(x, h + sh + ridgeH / 2, z + side * (sd / 2 + wt / 2));
    scene.add(gable);
    const gTrim = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.20, 0.12, wt + 0.05), shedDark);
    gTrim.position.set(x, h + sh + ridgeH - 0.05, z + side * (sd / 2 + wt / 2));
    scene.add(gTrim);
  }

  // ── 4 crates — back of shed ──
  const crateBackX = open === 'east' ? x - sw * 0.26 : x + sw * 0.26;
  const white       = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 22 });
  const black       = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const metalStrip  = new THREE.MeshPhongMaterial({ color: 0x999999, shininess: 55 });
  const cornerMetal = new THREE.MeshPhongMaterial({ color: 0x666666, shininess: 65 });

  [
    { oz: -2.4, mat: crateM4Mat,  type: 'depot_ammo_m4',     label: '[F] +10 M4 Ammo',      icon: 'ammo_large'  },
    { oz: -0.7, mat: crate19Mat,  type: 'depot_ammo_pistol',  label: '[F] +10 Pistol Ammo',  icon: 'ammo_small'  },
    { oz:  0.9, mat: crateArMat,  type: 'depot_armor',        label: '[F] Full Armor',        icon: 'armor'       },
    { oz:  2.5, mat: crateHpMat,  type: 'depot_health',       label: '[F] +50 Health',        icon: 'health'      },
  ].forEach(({ oz, mat, type, label, icon }) => {
    const cs = 1.05;
    const crate = new THREE.Mesh(new THREE.BoxGeometry(cs, cs, cs), mat);
    const cy = h + 0.75;
    crate.position.set(crateBackX, cy, z + oz);
    crate.userData = { lootType: type, label, depot: true, baseY: cy,
                       shedX: x, shedZ: z, shedHW: sw / 2, shedHD: sd / 2 };
    scene.add(crate); depotCrates.push(crate);
    collidables.push(crate);

    const bx = crateBackX, bz = z + oz;

    // Three plank bands
    for (const py of [-0.32, 0, 0.32]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(cs + 0.03, 0.055, cs + 0.03), black);
      line.position.set(bx, cy + py, bz); scene.add(line);
    }
    // Metal corner brackets at all 4 vertical edges
    for (const cx2 of [-1, 1]) {
      for (const cz2 of [-1, 1]) {
        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.13, cs + 0.05, 0.13), cornerMetal);
        bracket.position.set(bx + cx2 * (cs / 2 - 0.01), cy, bz + cz2 * (cs / 2 - 0.01));
        scene.add(bracket);
      }
    }
    // Metal strap band around middle
    const strap = new THREE.Mesh(new THREE.BoxGeometry(cs + 0.05, 0.08, cs + 0.05), metalStrip);
    strap.position.set(bx, cy, bz); scene.add(strap);

    // Icon plaque on top
    const iconY = cy + cs / 2;
    const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.055, 0.74), white);
    plaque.position.set(bx, iconY + 0.028, bz); scene.add(plaque);

    if (icon === 'ammo_large') {
      // Rifle round — slim, green military tip (M4 / AK calibre), scaled 80%
      const brass    = new THREE.MeshPhongMaterial({ color: 0xc8960c, shininess: 45 });
      const case_m   = new THREE.MeshPhongMaterial({ color: 0x8b6914, shininess: 35 });
      const greenTip = new THREE.MeshPhongMaterial({ color: 0x336622, shininess: 55 });
      const primMat  = new THREE.MeshPhongMaterial({ color: 0xaaaaaa, shininess: 65 });
      const cas  = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.068, 0.32, 12), case_m);
      cas.position.set(bx, iconY + 0.20, bz); scene.add(cas);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.072, 0.08, 12), brass);
      neck.position.set(bx, iconY + 0.40, bz); scene.add(neck);
      const bod  = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.24, 12), brass);
      bod.position.set(bx, iconY + 0.56, bz); scene.add(bod);
      const tipp = new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.19, 12), greenTip);
      tipp.position.set(bx, iconY + 0.78, bz); scene.add(tipp);
      const prim = new THREE.Mesh(new THREE.CylinderGeometry(0.070, 0.070, 0.032, 12), primMat);
      prim.position.set(bx, iconY + 0.05, bz); scene.add(prim);
    }
    else if (icon === 'ammo_small') {
      // Pistol round — single, short, fat, round-nose silver tip (handgun calibre)
      const brass = new THREE.MeshPhongMaterial({ color: 0xb06010, shininess: 40 });
      const silv  = new THREE.MeshPhongMaterial({ color: 0xdddddd, shininess: 75 });
      const cas  = new THREE.Mesh(new THREE.CylinderGeometry(0.080, 0.075, 0.22, 10), brass);
      cas.position.set(bx, iconY + 0.17, bz); scene.add(cas);
      const bod  = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.080, 0.10, 10), silv);
      bod.position.set(bx, iconY + 0.33, bz); scene.add(bod);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), silv);
      dome.position.set(bx, iconY + 0.38, bz); scene.add(dome);
    }
    else if (icon === 'armor') {
      const shBlue  = new THREE.MeshPhongMaterial({ color: 0x1a44cc, shininess: 32 });
      const shLight = new THREE.MeshPhongMaterial({ color: 0x7799ff, shininess: 55 });
      const ag = new THREE.Group();
      ag.position.set(bx, iconY, bz);
      ag.rotation.y = open === 'east' ? Math.PI / 2 : -Math.PI / 2;
      scene.add(ag);
      const shBody = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.38, 0.11), shBlue);
      shBody.position.set(0, 0.34, 0); ag.add(shBody);
      const shL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.25, 0.11), shBlue);
      shL.rotation.z = 0.42; shL.position.set(-0.26, 0.42, 0); ag.add(shL);
      const shR = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.25, 0.11), shBlue);
      shR.rotation.z = -0.42; shR.position.set(0.26, 0.42, 0); ag.add(shR);
      const shPt = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.24, 4), shBlue);
      shPt.rotation.y = Math.PI / 4; shPt.position.set(0, 0.11, 0); ag.add(shPt);
      const shEmb = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.28, 0.12), shLight);
      shEmb.position.set(0, 0.35, 0); ag.add(shEmb);
    }
    else if (icon === 'health') {
      const crossRed = new THREE.MeshPhongMaterial({ color: 0xdd1111, shininess: 22 });
      const hg = new THREE.Group();
      hg.position.set(bx, iconY, bz);
      hg.rotation.y = open === 'east' ? Math.PI / 2 : -Math.PI / 2;
      scene.add(hg);
      const border = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.60, 0.09), white);
      border.position.set(0, 0.28, -0.01); hg.add(border);
      const hb = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.18, 0.11), crossRed);
      hb.position.set(0, 0.28, 0.01); hg.add(hb);
      const vb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.56, 0.11), crossRed);
      vb.position.set(0, 0.28, 0.01); hg.add(vb);
    }
  });
});
// ═══════════════════════════════════════════════════════════
