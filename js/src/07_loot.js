// LOOT SYSTEM
// ═══════════════════════════════════════════════════════════
const LOOT_TYPES = {
  ammo_m4: { label: 'M4 Ammo x30', color: 0xccaa44, height: 0.15 },
  ammo_pistol: { label: '1911 Ammo x15', color: 0xcc8833, height: 0.12 },
  health: { label: 'Health Pack +50', color: 0x44cc66, height: 0.15 },
  armor: { label: 'Armor +50', color: 0x4488cc, height: 0.15 },
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
