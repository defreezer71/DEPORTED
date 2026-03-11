// WEAPON MODEL
// ═══════════════════════════════════════════════════════════
const weaponGroup = new THREE.Group();
camera.add(weaponGroup);
scene.add(camera);

// muzzle flash state — declared before createWeaponModel so function can assign into them
var muzzleFlashGroup = null;
var muzzleFlashMats  = [];
var muzzleFlashLight = null;
var _muzzleTimer = 0;
var MUZZLE_DUR = 0.060;

function createWeaponModel(type) {
  while (weaponGroup.children.length) weaponGroup.remove(weaponGroup.children[0]);

  const mBlack  = new THREE.MeshPhongMaterial({ color: 0x0d0d0d, shininess: 50 });
  const mDark   = new THREE.MeshPhongMaterial({ color: 0x161616, shininess: 40 });
  const mMetal  = new THREE.MeshPhongMaterial({ color: 0x272727, shininess: 90,  specular: new THREE.Color(0x444444) });
  const mEdge   = new THREE.MeshPhongMaterial({ color: 0x424242, shininess: 140, specular: new THREE.Color(0x888888) });
  const mChrome = new THREE.MeshPhongMaterial({ color: 0x585858, shininess: 220, specular: new THREE.Color(0xbbbbbb) });
  const mLens   = new THREE.MeshPhongMaterial({ color: 0x001122, shininess: 300, specular: new THREE.Color(0x224488), emissive: new THREE.Color(0x000811) });
  const mGlove  = new THREE.MeshPhongMaterial({ color: 0x1a2410, shininess: 8 });
  const mGlvL   = new THREE.MeshPhongMaterial({ color: 0x283418, shininess: 12 });
  const mSkin   = new THREE.MeshPhongMaterial({ color: 0xc4a882, shininess: 5 });

  function add(geo, mat, px, py, pz, rx, ry, rz) {
    rx = rx||0; ry = ry||0; rz = rz||0;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    if (rx||ry||rz) m.rotation.set(rx, ry, rz);
    weaponGroup.add(m); return m;
  }
  const B  = (w,h,d) => new THREE.BoxGeometry(w,h,d);
  const Cy = (rt,rb,h,s) => new THREE.CylinderGeometry(rt,rb,h,s||10);
  const PI2 = Math.PI/2;

  if (type === 'm4') {

    // ── BARREL ──
    add(Cy(0.013,0.015,0.500,12), mDark,   0, 0.000,-0.590, PI2,0,0);  // main profile
    add(Cy(0.020,0.020,0.028,12), mMetal,  0, 0.000,-0.645, PI2,0,0);  // gas block
    add(Cy(0.004,0.004,0.240, 6), mDark,   0, 0.022,-0.512, PI2,0,0);  // gas tube
    // A2 birdcage flash hider
    add(Cy(0.018,0.014,0.062, 6), mMetal,  0, 0.000,-0.880, PI2,0,0);
    add(Cy(0.011,0.011,0.014, 6), mChrome, 0, 0.000,-0.914, PI2,0,0);  // crown
    for (let t=0;t<5;t++) {
      const a = t/5*Math.PI*2;
      add(B(0.006,0.016,0.058), mEdge, Math.cos(a)*0.016, Math.sin(a)*0.016, -0.880, 0,0,a);
    }

    // ── HANDGUARD (free-float M-LOK 13") ──
    add(B(0.058,0.058,0.370), mDark,   0, 0.000,-0.500);
    add(B(0.062,0.012,0.370), mMetal,  0, 0.029,-0.500);   // top Picatinny
    add(B(0.062,0.012,0.370), mBlack,  0,-0.029,-0.500);   // bottom
    add(B(0.012,0.058,0.370), mMetal,  0.029, 0.000,-0.500);
    add(B(0.012,0.058,0.370), mMetal, -0.029, 0.000,-0.500);
    add(Cy(0.032,0.032,0.022,12), mEdge, 0,0.000,-0.316, PI2,0,0);    // barrel nut ring
    for (let s=0;s<6;s++) {
      add(B(0.004,0.014,0.022), mBlack,  0.031, 0.000,-0.360+s*0.056); // M-LOK R
      add(B(0.004,0.014,0.022), mBlack, -0.031, 0.000,-0.360+s*0.056); // M-LOK L
    }

    // ── UPPER RECEIVER ──
    add(B(0.062,0.074,0.245), mDark,   0,-0.012,-0.234);
    add(B(0.064,0.012,0.245), mMetal,  0, 0.031,-0.234);  // top rail
    add(B(0.018,0.014,0.040), mMetal,  0, 0.030,-0.160);  // charging handle body
    add(B(0.034,0.012,0.010), mEdge,   0, 0.028,-0.180);  // T latch
    add(Cy(0.009,0.009,0.010,8), mMetal, 0.034,-0.006,-0.230, 0,0,PI2); // forward assist
    add(B(0.005,0.026,0.056), mEdge,   0.033,-0.008,-0.214);  // ejection port
    add(B(0.003,0.020,0.048), mBlack,  0.034,-0.008,-0.214);  // port shadow

    // ── LOWER RECEIVER ──
    add(B(0.056,0.060,0.200), mDark,   0,-0.060,-0.234);
    add(B(0.060,0.018,0.030), mMetal,  0,-0.026,-0.122);  // upper-lower junction ledge
    add(Cy(0.004,0.004,0.064,8), mChrome, 0,-0.028,-0.272, 0,0,PI2); // rear takedown pin
    add(Cy(0.004,0.004,0.064,8), mChrome, 0,-0.028,-0.170, 0,0,PI2); // front takedown pin
    add(B(0.058,0.010,0.058), mMetal,  0,-0.086,-0.168);  // trigger guard top
    add(Cy(0.008,0.008,0.058,8), mMetal, 0,-0.092,-0.168, 0,0,PI2);  // guard bow
    add(B(0.010,0.028,0.008), mChrome, 0,-0.069,-0.170);  // trigger
    add(Cy(0.008,0.008,0.008,8), mEdge, -0.030,-0.042,-0.222);        // selector switch

    // ── PMAG GEN3 ──
    add(B(0.040,0.168,0.074), mBlack,  0,-0.162,-0.298,-0.14,0,0); // body
    add(B(0.042,0.012,0.076), mDark,   0,-0.250,-0.306,-0.14,0,0); // base pad
    add(B(0.044,0.014,0.076), mMetal,  0,-0.086,-0.292);             // mag catch groove
    add(B(0.042,0.010,0.008), mMetal,  0,-0.148,-0.290,-0.14,0,0); // window stripe 1
    add(B(0.042,0.010,0.008), mMetal,  0,-0.175,-0.295,-0.14,0,0); // window stripe 2
    add(B(0.042,0.010,0.008), mMetal,  0,-0.202,-0.300,-0.14,0,0); // window stripe 3

    // ── MOE PISTOL GRIP ──
    add(B(0.040,0.112,0.050), mBlack,  0,-0.136,-0.120,-0.28,0,0);
    add(B(0.042,0.012,0.052), mDark,   0,-0.200,-0.130,-0.28,0,0); // plug
    for (let f=0;f<3;f++) add(B(0.044,0.004,0.044), mDark, 0,-0.100+f*-0.026,-0.118,-0.28,0,0);
    add(B(0.002,0.094,0.044), mEdge,   0.022,-0.134,-0.120,-0.28,0,0); // texture R
    add(B(0.002,0.094,0.044), mEdge,  -0.022,-0.134,-0.120,-0.28,0,0); // texture L

    // ── CRANE STOCK (6-pos) ──
    add(Cy(0.020,0.022,0.210,12), mMetal,  0,-0.018,-0.020, PI2,0,0); // buffer tube
    add(B(0.048,0.060,0.010),     mDark,   0,-0.025,-0.128);           // end plate
    add(B(0.044,0.056,0.148),     mBlack,  0,-0.022, 0.046);           // stock body
    add(B(0.048,0.058,0.016),     mDark,   0,-0.022, 0.122);           // butt pad
    add(B(0.046,0.008,0.148),     mDark,   0,-0.048, 0.046);           // bottom lug
    add(B(0.012,0.014,0.008),     mEdge,   0, 0.002, 0.024);           // lock button
    add(Cy(0.007,0.007,0.012,8),  mEdge,   0.024,-0.022, 0.076, 0,0,PI2); // QD mount

    // ── REAR BUIS ──
    add(B(0.034,0.028,0.012), mDark,    0, 0.018,-0.152);
    add(B(0.010,0.024,0.005), mChrome,  0.010, 0.022,-0.152);
    add(B(0.010,0.024,0.005), mChrome, -0.010, 0.022,-0.152);

    // ── AIMPOINT RED DOT ──
    add(B(0.054,0.016,0.072), mMetal,  0, 0.039,-0.218);              // mount base
    add(B(0.066,0.010,0.026), mEdge,   0, 0.035,-0.207);              // front mount ring
    add(B(0.066,0.010,0.026), mEdge,   0, 0.035,-0.229);              // rear mount ring
    add(Cy(0.022,0.022,0.080,14), mBlack,  0, 0.052,-0.218, PI2,0,0); // tube body
    add(Cy(0.024,0.022,0.012,14), mEdge,   0, 0.052,-0.262, PI2,0,0); // objective rim
    add(Cy(0.019,0.019,0.006,14), mLens,   0, 0.052,-0.268, PI2,0,0); // objective lens
    add(Cy(0.024,0.022,0.012,14), mEdge,   0, 0.052,-0.174, PI2,0,0); // eyepiece rim
    add(Cy(0.019,0.019,0.006,14), mLens,   0, 0.052,-0.168, PI2,0,0); // eyepiece lens
    add(Cy(0.010,0.010,0.022, 8), mEdge,   0, 0.076,-0.218, 0,0,PI2); // elevation turret
    add(Cy(0.010,0.010,0.022, 8), mEdge,   0.022, 0.064,-0.218, PI2,0,0); // windage turret

    // ── STUBBY VERTICAL FOREGRIP ──
    add(B(0.028,0.082,0.024), mBlack,  0,-0.060,-0.512, 0.05,0,0);
    add(Cy(0.013,0.010,0.016,10), mDark, 0,-0.106,-0.516, 0.05,0,0); // rounded tip
    add(B(0.026,0.010,0.022), mMetal,  0,-0.026,-0.506);              // rail mount

    // ── MUZZLE FLASH SETUP (M4 only) ──
    muzzleFlashMats  = [];
    muzzleFlashGroup = new THREE.Group();
    muzzleFlashGroup.position.set(0, 0, -0.922);
    muzzleFlashGroup.visible = false;
    weaponGroup.add(muzzleFlashGroup);
    var mkFM = function(col) {
      return new THREE.MeshBasicMaterial({
        color: col, transparent: true, opacity: 1.0,
        depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      });
    };
    var fgeoA = new THREE.PlaneGeometry(0.112, 0.112);
    var fgeoB = new THREE.PlaneGeometry(0.058, 0.170);
    var fgeoC = new THREE.PlaneGeometry(0.044, 0.044);
    for (var fi=0;fi<3;fi++) {
      var fm = mkFM(0xffee44);
      var fp = new THREE.Mesh(fgeoA, fm);
      fp.rotation.z = fi * Math.PI/3;
      muzzleFlashGroup.add(fp);
      muzzleFlashMats.push(fm);
    }
    var bm1 = mkFM(0xff9900); var bm2 = mkFM(0xff9900);
    var beam1 = new THREE.Mesh(fgeoB, bm1); beam1.rotation.z =  Math.PI/4;
    var beam2 = new THREE.Mesh(fgeoB, bm2); beam2.rotation.z = -Math.PI/4;
    muzzleFlashGroup.add(beam1, beam2);
    muzzleFlashMats.push(bm1, bm2);
    var cm = mkFM(0xffffff);
    muzzleFlashGroup.add(new THREE.Mesh(fgeoC, cm));
    muzzleFlashMats.push(cm);
    muzzleFlashLight = new THREE.PointLight(0xffcc33, 0, 10);
    muzzleFlashGroup.add(muzzleFlashLight);

    // ── LEFT HAND (foregrip) ──
    add(B(0.062,0.048,0.048), mGlove,  0,-0.052,-0.490, 0.05,0,0);
    add(B(0.014,0.040,0.040), mGlvL,  -0.032,-0.046,-0.484, 0.04,0,0); // thumb
    for (let f=0;f<4;f++) add(B(0.060,0.014,0.034), mGlvL, 0,-0.030+f*-0.020,-0.498, 0.05,0,0);
    add(B(0.046,0.040,0.120), mSkin,  -0.006,-0.055,-0.392, 0, 0.14,0);

    // ── RIGHT HAND (trigger) ──
    add(B(0.054,0.066,0.055), mGlove,  0,-0.110,-0.112);
    add(B(0.014,0.060,0.050), mGlvL,  -0.030,-0.108,-0.110); // thumb
    add(B(0.012,0.020,0.044), mGlvL,   0.022,-0.074,-0.110); // index on trigger
    for (let f=0;f<3;f++) add(B(0.052,0.014,0.048), mGlvL, 0,-0.096+f*-0.018,-0.100);
    add(B(0.046,0.040,0.118), mSkin,  -0.002,-0.083,-0.045, 0,-0.12,0);

  } else {
    // ── 1911 PISTOL (unchanged) ──
    const metalDark  = new THREE.MeshLambertMaterial({ color: 0x141414 });
    const metalMid   = new THREE.MeshLambertMaterial({ color: 0x252525 });
    const metalLight = new THREE.MeshLambertMaterial({ color: 0x3e3e3e });
    const metalShine = new THREE.MeshLambertMaterial({ color: 0x505050 });
    const wood       = new THREE.MeshLambertMaterial({ color: 0x52320e });
    const woodLight  = new THREE.MeshLambertMaterial({ color: 0x6e4a1a });
    const skin       = new THREE.MeshLambertMaterial({ color: 0xc4a882 });
    const glove      = new THREE.MeshLambertMaterial({ color: 0x2a3820 });
    const gloveLight = new THREE.MeshLambertMaterial({ color: 0x3a5030 });
    const pOff = -0.18;
    add(B(0.034,0.044,0.230), metalDark,  0.15, 0.000,-0.10+pOff);
    add(B(0.036,0.008,0.230), metalLight, 0.15, 0.022,-0.10+pOff);
    for (let s=0;s<5;s++) add(B(0.036,0.036,0.003), metalShine, 0.15,0.002,-0.010+pOff-s*0.008);
    add(B(0.004,0.022,0.050), metalShine, 0.168,0.004,-0.065+pOff);
    add(B(0.004,0.008,0.028), metalMid,   0.130,-0.010,-0.080+pOff);
    add(B(0.032,0.038,0.175), metalMid,   0.15,-0.036,-0.065+pOff);
    add(B(0.032,0.008,0.058), metalMid,   0.15,-0.052,-0.060+pOff);
    add(B(0.034,0.028,0.008), metalMid,   0.15,-0.042,-0.085+pOff);
    add(B(0.010,0.024,0.007), metalShine, 0.15,-0.038,-0.064+pOff);
    add(B(0.004,0.008,0.018), metalShine, 0.130,0.006,-0.040+pOff);
    add(B(0.012,0.018,0.012), metalDark,  0.15,0.024, 0.008+pOff);
    add(B(0.008,0.010,0.008), metalShine, 0.15,0.030, 0.002+pOff);
    add(B(0.005,0.078,0.042), wood,       0.168,-0.090,-0.005+pOff, -0.18,0,0);
    add(B(0.005,0.078,0.042), wood,       0.132,-0.090,-0.005+pOff, -0.18,0,0);
    add(B(0.005,0.006,0.040), woodLight,  0.168,-0.062,-0.004+pOff, -0.18,0,0);
    add(B(0.005,0.006,0.040), woodLight,  0.132,-0.062,-0.004+pOff, -0.18,0,0);
    add(B(0.032,0.090,0.042), metalDark,  0.15,-0.090, 0.002+pOff, -0.18,0,0);
    add(B(0.026,0.010,0.034), metalLight, 0.15,-0.140,-0.008+pOff);
    add(Cy(0.010,0.010,0.068,8),  metalMid,   0.15,0.005,-0.255+pOff, PI2,0,0);
    add(Cy(0.020,0.020,0.155,10), metalDark,  0.15,0.004,-0.305+pOff, PI2,0,0);
    for (let r=0;r<6;r++) add(Cy(0.022,0.022,0.006,10), metalMid, 0.15,0.004,-0.238+pOff-r*0.020, PI2,0,0);
    add(Cy(0.020,0.016,0.012,10), metalLight, 0.15,0.004,-0.387+pOff, PI2,0,0);
    add(B(0.009,0.016,0.007), metalShine, 0.15, 0.027,-0.210+pOff);
    add(B(0.026,0.013,0.007), metalShine, 0.15, 0.027,-0.005+pOff);
    add(B(0.006,0.013,0.007), metalDark,  0.143,0.027,-0.005+pOff);
    add(B(0.006,0.013,0.007), metalDark,  0.157,0.027,-0.005+pOff);
    add(B(0.064,0.052,0.072), glove,      0.15,-0.064, 0.002+pOff);
    add(B(0.014,0.048,0.068), gloveLight, 0.130,-0.062, 0.000+pOff);
    add(B(0.052,0.044,0.148), skin,       0.130,-0.064, 0.085+pOff, 0,-0.08,0);
  }

  const wp = type === 'm4' ? {x:0.25,y:-0.22,z:-0.38} : {x:0.2,y:-0.2,z:-0.3};
  weaponGroup.position.set(wp.x, wp.y, wp.z);
  weaponGroup.rotation.set(0, 0, 0);
}
createWeaponModel('m4');
let weaponBobPhase = 0;

// ═══════════════════════════════════════════════════════════
// MUZZLE FLASH CONTROL
// ═══════════════════════════════════════════════════════════
function showMuzzleFlash() {
  if (!muzzleFlashGroup) return;
  muzzleFlashGroup.visible = true;
  _muzzleTimer = MUZZLE_DUR;
  if (muzzleFlashLight) muzzleFlashLight.intensity = 8.0;
  muzzleFlashGroup.rotation.z = Math.random() * Math.PI * 2;
  for (var i=0;i<muzzleFlashMats.length;i++) muzzleFlashMats[i].opacity = 1.0;
}

function updateMuzzleFlash(dt) {
  if (!muzzleFlashGroup || _muzzleTimer <= 0) {
    if (muzzleFlashGroup) muzzleFlashGroup.visible = false;
    if (muzzleFlashLight) muzzleFlashLight.intensity = 0;
    return;
  }
  _muzzleTimer -= dt;
  var t = Math.max(0, _muzzleTimer / MUZZLE_DUR);
  for (var i=0;i<muzzleFlashMats.length;i++) muzzleFlashMats[i].opacity = t;
  if (muzzleFlashLight) muzzleFlashLight.intensity = 8.0 * t;
  if (_muzzleTimer <= 0) {
    muzzleFlashGroup.visible = false;
    if (muzzleFlashLight) muzzleFlashLight.intensity = 0;
  }
}

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
const collidableCache = []; window._collidableCache = collidableCache; // { bb: Box3, dynamic: bool, obj: mesh }

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
