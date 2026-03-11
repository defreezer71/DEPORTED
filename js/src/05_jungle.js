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
      const w  = (0.4 + Math.random() * 0.35) * 4.4;
      const ht = w * (2.6 + Math.random() * 1.0);
      dummy.position.set(x, h + ht * 0.5, z);
      dummy.scale.set(w * 1.25, ht, w * 1.25);
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
        new THREE.BoxGeometry(w * 1.35, ht * 1.05, w * 1.35),
        invisibleColliderMat
      );
      bushCol.position.set(x, h + ht * 0.5, z);
      scene.add(bushCol);
      collidables.push(bushCol);
      const bushHit = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.85, ht, w * 0.85),
        invisibleColliderMat
      );
      bushHit.position.set(x, h + ht * 0.5, z);
      scene.add(bushHit);
      targets.push(bushHit);
    } else {
      // Decorative small bush — no collider, walkthrough
      const dr     = 0.546 + Math.random() * 0.858;
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

  // Crate visuals — 3 instanced meshes: main body, wood slat H, wood slat V
  const crateBodyGeo = new THREE.BoxGeometry(1, 1, 1);
  const crateBodyMat = new THREE.MeshLambertMaterial({ color: 0x8B6914 });
  const crateInst    = new THREE.InstancedMesh(crateBodyGeo, crateBodyMat, rockPlacements.length);
  crateInst.castShadow = true;

  const slatHGeo  = new THREE.BoxGeometry(1.01, 0.08, 0.12);
  const slatMat   = new THREE.MeshLambertMaterial({ color: 0x5C4008 });
  const slatHInst = new THREE.InstancedMesh(slatHGeo, slatMat, rockPlacements.length * 2);
  slatHInst.castShadow = false;

  const slatVGeo  = new THREE.BoxGeometry(0.12, 0.08, 1.01);
  const slatVInst = new THREE.InstancedMesh(slatVGeo, slatMat, rockPlacements.length * 2);
  slatVInst.castShadow = false;

  const dummy = new THREE.Object3D();

  rockPlacements.forEach(({ x, z }, i) => {
    const h  = getTerrainHeight(x, z);
    const sz = 1.4 + Math.random() * 1.2;  // crate size 1.4–2.6 units
    const yRot = Math.random() * 6.28;

    // Main crate body
    dummy.position.set(x, h + sz * 0.5, z);
    dummy.scale.set(sz, sz, sz);
    dummy.rotation.set(0, yRot, 0);
    dummy.updateMatrix();
    crateInst.setMatrixAt(i, dummy.matrix);

    // Horizontal slats (top + bottom band)
    [-0.3, 0.3].forEach((yOff, si) => {
      dummy.position.set(x, h + sz * 0.5 + sz * yOff, z);
      dummy.scale.set(sz, sz, sz);
      dummy.rotation.set(0, yRot, 0);
      dummy.updateMatrix();
      slatHInst.setMatrixAt(i * 2 + si, dummy.matrix);
    });

    // Vertical slats (front + back band)
    [-0.3, 0.3].forEach((xOff, si) => {
      dummy.position.set(x, h + sz * 0.5 + sz * xOff, z);
      dummy.scale.set(sz, sz, sz);
      dummy.rotation.set(0, yRot, 0);
      dummy.updateMatrix();
      slatVInst.setMatrixAt(i * 2 + si, dummy.matrix);
    });

    // Player collider — exact crate size, perfect fit since it's already a box
    const collider = new THREE.Mesh(
      new THREE.BoxGeometry(sz, sz, sz),
      invisibleColliderMat
    );
    collider.position.set(x, h + sz * 0.5, z);
    collider.rotation.y = yRot;
    scene.add(collider);
    collidables.push(collider);

    // Bullet hitbox — same as collider
    const crateHit = new THREE.Mesh(
      new THREE.BoxGeometry(sz, sz, sz),
      invisibleColliderMat
    );
    crateHit.position.set(x, h + sz * 0.5, z);
    crateHit.rotation.y = yRot;
    scene.add(crateHit);
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
  const sz = 1.2 + Math.random() * 1.4;
  const yRot = Math.random() * 6.28;

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
    new THREE.MeshLambertMaterial({ color: 0x8B6914 })
  );
  crate.position.set(x, h + sz * 0.3, z);
  crate.rotation.set(0, yRot, 0);
  crate.castShadow = true;
  scene.add(crate);

  // Dark wood slats — horizontal band, same tilt
  [-0.3, 0.3].forEach(yOff => {
    const slat = new THREE.Mesh(
      new THREE.BoxGeometry(sz * 1.01, sz * 0.08, sz * 0.12),
      new THREE.MeshLambertMaterial({ color: 0x5C4008 })
    );
    slat.position.set(x, h + sz * 0.3 + sz * yOff, z);
    slat.rotation.set(0, yRot, 0);
    scene.add(slat);
  });
  [-0.3, 0.3].forEach(xOff => {
    const slat = new THREE.Mesh(
      new THREE.BoxGeometry(sz * 0.12, sz * 0.08, sz * 1.01),
      new THREE.MeshLambertMaterial({ color: 0x5C4008 })
    );
    slat.position.set(x, h + sz * 0.3 + sz * xOff, z);
    slat.rotation.set(0, yRot, 0);
    scene.add(slat);
  });

  // Bullet hitbox — tilted to match visual
  const crateHit = new THREE.Mesh(
    new THREE.BoxGeometry(sz, sz, sz),
    invisibleColliderMat
  );
  crateHit.position.set(x, h + sz * 0.3, z);
  crateHit.rotation.set(0, yRot, 0);
  scene.add(crateHit);
  targets.push(crateHit);

  // Player collider — matched to visual
  const collider = new THREE.Mesh(
    new THREE.BoxGeometry(sz, sz, sz),
    invisibleColliderMat
  );
  collider.position.set(x, h + sz * 0.3, z);
  scene.add(collider);
  collidables.push(collider);
}



// ═══════════════════════════════════════════════════════════
