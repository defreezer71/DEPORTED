// WEAPON MODEL
// ═══════════════════════════════════════════════════════════
const weaponGroup = new THREE.Group();
camera.add(weaponGroup);
scene.add(camera);

function createWeaponModel(type) {
  while (weaponGroup.children.length) weaponGroup.remove(weaponGroup.children[0]);

  // ── Shared materials ──
  const metalDark  = new THREE.MeshLambertMaterial({ color: 0x141414 });
  const metalMid   = new THREE.MeshLambertMaterial({ color: 0x252525 });
  const metalLight = new THREE.MeshLambertMaterial({ color: 0x3e3e3e });
  const metalShine = new THREE.MeshLambertMaterial({ color: 0x505050 }); // highlight edges
  const wood       = new THREE.MeshLambertMaterial({ color: 0x52320e });
  const woodDark   = new THREE.MeshLambertMaterial({ color: 0x30180a });
  const woodLight  = new THREE.MeshLambertMaterial({ color: 0x6e4a1a });
  const skin       = new THREE.MeshLambertMaterial({ color: 0xc4a882 });
  const glove      = new THREE.MeshLambertMaterial({ color: 0x2a3820 });
  const gloveLight = new THREE.MeshLambertMaterial({ color: 0x3a5030 });

  function add(geo, mat, px, py, pz, rx=0, ry=0, rz=0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    if (rx||ry||rz) m.rotation.set(rx, ry, rz);
    weaponGroup.add(m); return m;
  }
  const B  = (w,h,d) => new THREE.BoxGeometry(w,h,d);
  const Cy = (rt,rb,h,s=8) => new THREE.CylinderGeometry(rt,rb,h,s);
  const PI2 = Math.PI/2;

  if (type === 'm4') {
    // ── Barrel assembly ──
    add(Cy(0.011,0.013,0.58,10), metalDark,   0.03,-0.008,-0.66, PI2,0,0); // main barrel
    add(Cy(0.016,0.016,0.04,8),  metalShine,  0.03,-0.008,-0.90, PI2,0,0); // muzzle crown
    add(B(0.008,0.032,0.008),    metalDark,   0.03, 0.018,-0.88);           // front sight post
    add(B(0.020,0.006,0.002),    metalShine,  0.03, 0.020,-0.88);           // sight hood

    // ── Handguard — M-LOK style ──
    add(B(0.058,0.048,0.36),  metalMid,   0.03,-0.020,-0.53);              // outer shroud
    add(B(0.062,0.010,0.36),  metalLight, 0.03, 0.004,-0.53);              // top rail
    add(B(0.062,0.010,0.36),  metalDark,  0.03,-0.044,-0.53);              // bottom rail
    // M-LOK slot cutouts (thin dark strips)
    for (let s=0; s<4; s++) {
      add(B(0.060,0.010,0.030), metalDark, 0.03,-0.020,-0.38+s*0.085);
    }
    add(B(0.010,0.048,0.36),  metalMid,   0.003,-0.020,-0.53);             // left rail
    add(B(0.010,0.048,0.36),  metalMid,   0.057,-0.020,-0.53);             // right rail

    // ── Upper receiver ──
    add(B(0.062,0.072,0.26),  metalMid,   0.03,-0.028,-0.27);
    add(B(0.064,0.010,0.26),  metalLight, 0.03, 0.008,-0.27);              // top rail (receiver)
    // Charging handle
    add(B(0.014,0.014,0.038), metalShine, 0.03, 0.010,-0.20);
    add(B(0.030,0.012,0.010), metalLight, 0.03, 0.010,-0.22);              // handle ear
    // Ejection port
    add(B(0.004,0.028,0.055), metalShine, 0.065,-0.020,-0.22);

    // ── Lower receiver ──
    add(B(0.058,0.062,0.22),  metalDark,  0.03,-0.072,-0.25);
    // Trigger guard
    add(B(0.058,0.008,0.055), metalMid,   0.03,-0.090,-0.17);
    add(Cy(0.006,0.006,0.055,6), metalMid, 0.03,-0.094,-0.17, 0,0,PI2);    // guard bow
    // Trigger
    add(B(0.008,0.022,0.006), metalShine, 0.03,-0.074,-0.18);

    // ── Magazine ──
    add(B(0.036,0.175,0.064), metalDark,  0.03,-0.168,-0.325, -0.14,0,0);  // body
    add(B(0.040,0.014,0.068), metalLight, 0.03,-0.258,-0.330, -0.14,0,0);  // base plate
    add(B(0.038,0.010,0.062), metalMid,   0.03,-0.090,-0.320);             // mag catch groove

    // ── Pistol grip ──
    add(B(0.038,0.105,0.044), woodDark,  0.03,-0.143,-0.138, -0.28,0,0);
    add(B(0.002,0.095,0.040), woodLight, 0.018,-0.140,-0.138,-0.28,0,0);   // left panel
    add(B(0.002,0.095,0.040), woodLight, 0.042,-0.140,-0.138,-0.28,0,0);   // right panel
    add(B(0.040,0.014,0.046), metalDark, 0.03,-0.192,-0.152,-0.28,0,0);   // grip base

    // ── Stock — collapsible ──
    add(B(0.042,0.058,0.195), wood,      0.03,-0.038,-0.020);
    add(B(0.044,0.060,0.022), metalDark, 0.03,-0.038, 0.083);              // butt pad
    add(B(0.016,0.008,0.160), metalMid,  0.022,-0.012,-0.015);             // top tube
    add(B(0.016,0.008,0.160), metalMid,  0.038,-0.012,-0.015);             // bottom tube
    // Stock end plate
    add(B(0.048,0.065,0.010), metalDark, 0.03,-0.038,-0.110);

    // ── Rear sight (flip-up style) ──
    add(B(0.028,0.022,0.008), metalDark,  0.03, 0.012,-0.168);
    add(B(0.010,0.018,0.004), metalShine, 0.024,0.018,-0.168);             // left post
    add(B(0.010,0.018,0.004), metalShine, 0.036,0.018,-0.168);             // right post

    // ── Hands and arms ──
    // Left hand gripping handguard
    add(B(0.064,0.044,0.086), glove,     0.03,-0.048,-0.488);
    add(B(0.010,0.040,0.080), gloveLight,0.000,-0.046,-0.488);             // thumb
    add(B(0.054,0.036,0.155), skin,      0.050,-0.058,-0.360, 0,0.18,0);  // left forearm
    // Right hand on grip
    add(B(0.052,0.064,0.062), glove,     0.03,-0.118,-0.118);
    add(B(0.012,0.060,0.058), gloveLight,0.000,-0.116,-0.116);             // thumb side
    add(B(0.052,0.042,0.125), skin,      0.012,-0.098,-0.040, 0,-0.14,0); // right forearm

  } else {
    // ── 1911 Pistol — detailed ──
    const pOff = -0.18;

    // Slide — top, with serrations
    add(B(0.034,0.044,0.230), metalDark,  0.15, 0.000,-0.10+pOff);
    add(B(0.036,0.008,0.230), metalLight, 0.15, 0.022,-0.10+pOff);        // top highlight edge
    // Serration grooves (rear of slide)
    for (let s=0; s<5; s++) {
      add(B(0.036,0.036,0.003), metalShine, 0.15,0.002,-0.010+pOff-s*0.008);
    }
    // Ejection port cutout
    add(B(0.004,0.022,0.050), metalShine, 0.168,0.004,-0.065+pOff);
    // Slide stop lever
    add(B(0.004,0.008,0.028), metalMid, 0.130,-0.010,-0.080+pOff);

    // Frame
    add(B(0.032,0.038,0.175), metalMid,  0.15,-0.036,-0.065+pOff);
    // Trigger guard — box + front curve
    add(B(0.032,0.008,0.058), metalMid,  0.15,-0.052,-0.060+pOff);
    add(B(0.034,0.028,0.008), metalMid,  0.15,-0.042,-0.085+pOff);        // guard front
    // Trigger
    add(B(0.010,0.024,0.007), metalShine, 0.15,-0.038,-0.064+pOff);
    // Thumb safety
    add(B(0.004,0.008,0.018), metalShine, 0.130,0.006,-0.040+pOff);
    // Hammer
    add(B(0.012,0.018,0.012), metalDark,  0.15,0.024, 0.008+pOff);
    add(B(0.008,0.010,0.008), metalShine, 0.15,0.030, 0.002+pOff);

    // Wood grip panels — checkered look
    add(B(0.005,0.078,0.042), wood,      0.168,-0.090,-0.005+pOff, -0.18,0,0);
    add(B(0.005,0.078,0.042), wood,      0.132,-0.090,-0.005+pOff, -0.18,0,0);
    add(B(0.005,0.006,0.040), woodLight, 0.168,-0.062,-0.004+pOff, -0.18,0,0); // top strip
    add(B(0.005,0.006,0.040), woodLight, 0.132,-0.062,-0.004+pOff, -0.18,0,0);
    // Backstrap
    add(B(0.032,0.090,0.042), metalDark, 0.15,-0.090, 0.002+pOff, -0.18,0,0);
    // Magazine base
    add(B(0.026,0.010,0.034), metalLight, 0.15,-0.140,-0.008+pOff);

    // Barrel + suppressor
    add(Cy(0.010,0.010,0.068,8), metalMid,  0.15,0.005,-0.255+pOff, PI2,0,0); // barrel
    add(Cy(0.020,0.020,0.155,10),metalDark, 0.15,0.004,-0.305+pOff, PI2,0,0); // suppressor body
    // Suppressor wraps (ridges)
    for (let r=0; r<6; r++) {
      add(Cy(0.022,0.022,0.006,10), metalMid, 0.15,0.004,-0.238+pOff-r*0.020, PI2,0,0);
    }
    add(Cy(0.020,0.016,0.012,10), metalLight, 0.15,0.004,-0.387+pOff, PI2,0,0); // end cap

    // Sights
    add(B(0.009,0.016,0.007), metalShine, 0.15, 0.027,-0.210+pOff);       // front sight
    add(B(0.026,0.013,0.007), metalShine, 0.15, 0.027,-0.005+pOff);       // rear sight
    add(B(0.006,0.013,0.007), metalDark,  0.143,0.027,-0.005+pOff);       // rear notch L
    add(B(0.006,0.013,0.007), metalDark,  0.157,0.027,-0.005+pOff);       // rear notch R

    // Right hand + forearm
    add(B(0.064,0.052,0.072), glove,      0.15,-0.064, 0.002+pOff);
    add(B(0.014,0.048,0.068), gloveLight, 0.130,-0.062, 0.000+pOff);      // thumb
    add(B(0.052,0.044,0.148), skin,       0.130,-0.064, 0.085+pOff, 0,-0.08,0);
  }

  const wp = type === 'm4' ? {x:0.25,y:-0.22,z:-0.38} : {x:0.2,y:-0.2,z:-0.3};
  weaponGroup.position.set(wp.x, wp.y, wp.z);
  weaponGroup.rotation.set(0, 0, 0);

  // ── Krunker-style weapon always-on-top ──
  // depthTest:false + renderOrder:999 renders weapon over all world geometry.
  // frustumCulled:false prevents Three.js from hiding weapon parts when their
  // bounding sphere drifts outside the camera frustum (FIX for weapon vanishing).
  weaponGroup.traverse(child => {
    if (child.isMesh) {
      child.renderOrder = 999;
      child.frustumCulled = false;
      // Clone the material so we don't mutate the shared material objects
      child.material = child.material.clone();
      child.material.depthTest = false;
    }
  });
}
createWeaponModel('m4');
let weaponBobPhase = 0;

// ═══════════════════════════════════════════════════════════
// BULLET IMPACTS
// ═══════════════════════════════════════════════════════════
const impactParticles = [];
function spawnImpact(pos, normal) {
  for (let i = 0; i < 4 + Math.floor(Math.random() * 4); i++) {
    const p = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 4, 3),
      new THREE.MeshBasicMaterial({ color: 0xccbb88 })
    );
    p.position.copy(pos);
    const dir = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2)
      .add(normal.clone().multiplyScalar(2));
    p.userData = { vel: dir.multiplyScalar(0.8 + Math.random() * 1.5), life: 0.25 + Math.random() * 0.3 };
    scene.add(p);
    impactParticles.push(p);
  }
}

// ═══════════════════════════════════════════════════════════
// COLLISION — pre-cached bounding boxes for performance
// ═══════════════════════════════════════════════════════════
const playerBB = new THREE.Box3();
const objBB = new THREE.Box3();

// Cache: static objects get their BB computed once at startup.
// Dynamic objects (gate doors) are flagged and recomputed each frame.
const collidableCache = []; // { bb: Box3, dynamic: bool, obj: mesh }

function buildCollisionCache() {
  collidableCache.length = 0;
  for (const obj of collidables) {
    obj.updateMatrixWorld(true); // force world matrix before BB compute
    const isDynamic = (obj === gateDoorL || obj === gateDoorR);
    const bb = new THREE.Box3().setFromObject(obj);
    collidableCache.push({ bb, dynamic: isDynamic, obj });
  }
}

function refreshDynamicColliders() {
  for (const entry of collidableCache) {
    if (entry.dynamic) entry.bb.setFromObject(entry.obj);
  }
}

function checkCollisionAndStep(newPos) {
  const r = CONFIG.playerRadius;
  const currentH = state.crouching ? CONFIG.crouchHeight : CONFIG.playerHeight;
  const feetY = newPos.y - currentH;

  // Test player as a full vertical column — feet, knee, waist, chest, head.
  // This prevents the camera (eye level only) from entering objects
  // whose bottom edge is below eye height but above feet.
  const testHeights = [
    feetY + 0.05,        // feet
    feetY + currentH * 0.3,  // knee
    feetY + currentH * 0.6,  // waist
    feetY + currentH * 0.85, // chest
    newPos.y,            // head/camera
  ];

  let blocked = false;
  let stepUpY = 0;

  for (const entry of collidableCache) {
    const bb = entry.bb;

    // Quick XZ rejection before checking heights
    if (newPos.x + r <= bb.min.x || newPos.x - r >= bb.max.x) continue;
    if (newPos.z + r <= bb.min.z || newPos.z - r >= bb.max.z) continue;

    const objTop = bb.max.y;
    const objBottom = bb.min.y;

    // Check if any of the player's body points are inside this collider's Y range
    let bodyIntersects = false;
    for (const testY of testHeights) {
      if (testY > objBottom && testY < objTop) {
        bodyIntersects = true;
        break;
      }
    }
    if (!bodyIntersects) continue;

    // How far above feet is the top of this object?
    const heightAboveFeet = objTop - feetY;

    // Allow stepping over very small ledges only (curbs, small lips)
    if (heightAboveFeet > 0 && heightAboveFeet <= 0.4) {
      stepUpY = Math.max(stepUpY, objTop + currentH + 0.01);
    } else {
      blocked = true;
      break;
    }
  }
  return { blocked, stepUpY };
}

// Bot collision check — uses cache
function checkBotCollision(x, z, botSelf) {
  for (const entry of collidableCache) {
    const bb = entry.bb;
    if (x > bb.min.x - 0.5 && x < bb.max.x + 0.5 &&
        z > bb.min.z - 0.5 && z < bb.max.z + 0.5) {
      return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════
