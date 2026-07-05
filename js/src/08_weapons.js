// WEAPON MODEL
// ═══════════════════════════════════════════════════════════
const weaponGroup = new THREE.Group();
weaponScene.add(weaponCamera);
weaponCamera.add(weaponGroup);
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
  const mWood   = new THREE.MeshPhongMaterial({ color: 0x7a4a1a, shininess: 15 });
  const mWoodDk = new THREE.MeshPhongMaterial({ color: 0x5a3010, shininess: 10 });
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

    // ── BARREL (short AK-style, ~300mm) ──
    add(Cy(0.015,0.017,0.330,10), mDark,   0, 0.000,-0.465, PI2,0,0);  // main barrel
    add(Cy(0.024,0.024,0.022,10), mMetal,  0, 0.000,-0.520, PI2,0,0);  // gas block
    add(Cy(0.005,0.005,0.185, 6), mDark,   0, 0.028,-0.445, PI2,0,0);  // gas tube
    // Krink-style expansion chamber muzzle device
    add(Cy(0.022,0.016,0.016,10), mMetal,  0, 0.000,-0.628, PI2,0,0);  // rear shoulder
    add(Cy(0.028,0.028,0.038,10), mMetal,  0, 0.000,-0.650, PI2,0,0);  // expansion body
    add(Cy(0.020,0.028,0.010,10), mEdge,   0, 0.000,-0.672, PI2,0,0);  // front taper
    add(Cy(0.014,0.014,0.008, 8), mChrome, 0, 0.000,-0.680, PI2,0,0);  // crown

    // ── HANDGUARD (wood) ──
    add(B(0.052,0.022,0.215), mWood,   0, 0.014,-0.425);
    add(B(0.056,0.024,0.215), mWoodDk, 0,-0.016,-0.425);
    for (let s=0; s<4; s++) {
      add(B(0.006,0.016,0.020), mBlack,  0.029, 0.008,-0.348+s*0.052);
      add(B(0.006,0.016,0.020), mBlack, -0.029, 0.008,-0.348+s*0.052);
    }

    // ── UPPER RECEIVER (AK dust cover) ──
    add(B(0.058,0.026,0.205), mDark,   0, 0.013,-0.215);
    add(B(0.060,0.008,0.205), mMetal,  0, 0.026,-0.215);   // top surface
    // Side charging handle (right)
    add(B(0.006,0.015,0.026), mMetal,  0.034, 0.006,-0.178);
    add(B(0.018,0.010,0.010), mEdge,   0.044, 0.010,-0.178);
    // Ejection port
    add(B(0.005,0.022,0.048), mEdge,   0.033,-0.002,-0.210);
    add(B(0.003,0.017,0.042), mBlack,  0.034,-0.002,-0.210);

    // ── LOWER RECEIVER ──
    add(B(0.056,0.050,0.205), mDark,   0,-0.027,-0.215);
    add(B(0.060,0.010,0.022), mMetal,  0,-0.002,-0.115);   // upper ledge
    // AK-style selector lever (right side)
    add(B(0.005,0.010,0.058), mMetal,  0.034,-0.004,-0.194);
    add(B(0.005,0.022,0.010), mEdge,   0.034,-0.004,-0.174);
    // Trigger guard
    add(B(0.055,0.010,0.052), mMetal,  0,-0.074,-0.166);
    add(Cy(0.008,0.008,0.055,8), mMetal, 0,-0.080,-0.166, 0,0,PI2);
    add(B(0.008,0.022,0.007), mChrome, 0,-0.057,-0.166);   // trigger

    // ── CURVED AK MAGAZINE ──
    add(B(0.042,0.060,0.072), mBlack,  0,-0.106,-0.260, 0.09,0,0);   // top section
    add(B(0.040,0.062,0.070), mBlack,  0,-0.168,-0.268, 0.19,0,0);   // mid curve
    add(B(0.040,0.060,0.070), mDark,   0,-0.226,-0.258, 0.27,0,0);   // lower body
    add(B(0.042,0.013,0.072), mMetal,  0,-0.268,-0.244, 0.27,0,0);   // base pad
    add(B(0.006,0.175,0.010), mMetal,  0,-0.178,-0.265, 0.16,0,0);   // rear spine rib
    add(B(0.044,0.010,0.010), mMetal,  0,-0.098,-0.258);              // mag catch groove

    // ── AK PISTOL GRIP (wood) ──
    add(B(0.038,0.094,0.046), mWood,   0,-0.126,-0.130,-0.30,0,0);
    add(B(0.040,0.012,0.048), mDark,   0,-0.190,-0.138,-0.30,0,0);
    for (let f=0;f<3;f++) add(B(0.040,0.004,0.040), mDark, 0,-0.108+f*-0.023,-0.128,-0.30,0,0);
    add(B(0.002,0.082,0.040), mEdge,   0.021,-0.128,-0.129,-0.30,0,0);
    add(B(0.002,0.082,0.040), mEdge,  -0.021,-0.128,-0.129,-0.30,0,0);

    // ── SKELETON SIDE-FOLDING STOCK (AKS-style) ──
    add(B(0.016,0.040,0.012), mMetal, -0.028,-0.012,-0.020);  // hinge block
    add(B(0.008,0.008,0.145), mDark,  -0.028, 0.002, 0.062);  // top arm
    add(B(0.008,0.008,0.145), mDark,  -0.028,-0.032, 0.062);  // bottom arm
    add(B(0.008,0.038,0.008), mDark,  -0.028,-0.015, 0.038);  // front brace
    add(B(0.008,0.038,0.008), mDark,  -0.028,-0.015, 0.092);  // mid brace
    add(B(0.012,0.064,0.020), mEdge,  -0.028,-0.015, 0.144);  // shoulder plate

    // ── AK FRONT SIGHT (open U-hood, tapered post) ──
    add(B(0.034,0.006,0.014), mMetal,  0, 0.031,-0.570);        // base wings
    add(Cy(0.001,0.004,0.020,4), mChrome, 0, 0.040,-0.570);     // tapered sight post (pointy tip)
    add(B(0.004,0.020,0.010), mMetal, -0.014, 0.040,-0.570);    // hood left
    add(B(0.004,0.020,0.010), mMetal,  0.014, 0.040,-0.570);    // hood right

    // ── AK REAR LEAF SIGHT — open U-notch (no leaf body/notch plug so view is clear) ──
    add(B(0.040,0.006,0.014), mMetal,  0,      0.030,-0.152);   // base
    add(B(0.010,0.022,0.010), mChrome,-0.018,  0.040,-0.152);   // left ear
    add(B(0.010,0.022,0.010), mChrome, 0.018,  0.040,-0.152);   // right ear

    // ── MUZZLE FLASH SETUP ──
    muzzleFlashMats  = [];
    muzzleFlashGroup = new THREE.Group();
    muzzleFlashGroup.position.set(0, 0, -0.698);
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

    // ── LEFT HAND (wrapped around handguard) ──
    add(B(0.060,0.046,0.050), mGlove,  0,-0.048,-0.450, 0.04,0,0);
    add(B(0.014,0.038,0.042), mGlvL,  -0.032,-0.042,-0.444, 0.04,0,0); // thumb
    for (let f=0;f<4;f++) add(B(0.058,0.012,0.036), mGlvL, 0,-0.028+f*-0.018,-0.462, 0.04,0,0);
    add(B(0.044,0.038,0.118), mSkin,  -0.005,-0.050,-0.368, 0, 0.12,0);

    // ── RIGHT HAND (trigger grip) ──
    add(B(0.054,0.064,0.055), mGlove,  0,-0.108,-0.113);
    add(B(0.014,0.058,0.050), mGlvL,  -0.030,-0.106,-0.111); // thumb
    add(B(0.012,0.018,0.044), mGlvL,   0.022,-0.072,-0.111); // index on trigger
    for (let f=0;f<3;f++) add(B(0.050,0.012,0.046), mGlvL, 0,-0.093+f*-0.018,-0.102);
    add(B(0.044,0.038,0.116), mSkin,  -0.001,-0.080,-0.046, 0,-0.10,0);

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
    // ── REAR SIGHT — open U-notch (near hammer, z≈-0.185) ──
    add(B(0.028,0.006,0.010), metalDark,  0.15,  0.022,-0.005+pOff);  // base
    add(B(0.008,0.020,0.010), metalShine, 0.138, 0.032,-0.005+pOff);  // left ear
    add(B(0.008,0.020,0.010), metalShine, 0.162, 0.032,-0.005+pOff);  // right ear
    // ── FRONT SIGHT — tapered post (near muzzle, z≈-0.390) ──
    add(B(0.024,0.005,0.010), metalDark,  0.15,  0.020,-0.210+pOff);  // base
    add(Cy(0.002,0.004,0.018,4), metalShine, 0.15, 0.031,-0.210+pOff);  // tapered post
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
// ── Impact particle pool ──
// Old code allocated 4–7 new Mesh + SphereGeometry + MeshBasicMaterial on every
// bullet hit and scene.remove()+dispose()'d them on expiry — heavy GC + GPU churn
// during sustained fire (~10 hits/s × 4–7 = 40–70 allocs/s), a top cause of the
// "frames drop when I shoot" hitching. Now: one shared geometry + material and a
// fixed ring pool of meshes toggled visible. No per-hit allocation, no add/remove.
const _IMPACT_POOL = 64;
const _impactGeo = new THREE.SphereGeometry(0.02, 4, 3);
const _impactMat = new THREE.MeshBasicMaterial({ color: 0xccbb88 });
const impactParticles = [];
let _impactHead = 0;
for (let i = 0; i < _IMPACT_POOL; i++) {
  const p = new THREE.Mesh(_impactGeo, _impactMat);
  p.visible = false;
  p.userData = { vel: new THREE.Vector3(), life: 0 };
  scene.add(p);
  impactParticles.push(p);
}

function spawnImpact(pos, normal) {
  const count = 4 + Math.floor(Math.random() * 4);
  for (let i = 0; i < count; i++) {
    const p = impactParticles[_impactHead];
    _impactHead = (_impactHead + 1) % _IMPACT_POOL; // ring: oldest recycled if saturated
    p.position.copy(pos);
    const dir = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2)
      .add(normal.clone().multiplyScalar(2));
    p.userData.vel.copy(dir.multiplyScalar(0.8 + Math.random() * 1.5));
    p.userData.life = 0.25 + Math.random() * 0.3;
    p.visible = true;
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
    // Gate doors are the only moving collidables, and they're island-only
    // (removed in the city build) — short-circuit before referencing them.
    const isDynamic = CONFIG.world === 'island' && (obj === gateDoorL || obj === gateDoorR);
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
  const headY = newPos.y;

  let blocked = false;
  let stepUpY = 0;

  for (const entry of collidableCache) {
    const bb = entry.bb;

    // Y band: skip colliders entirely below feet or entirely above head
    if (bb.max.y <= feetY || bb.min.y >= headY) continue;

    // XZ circle-vs-AABB: closest point on box to player centre
    // Replaces old square test which snagged on box corners.
    const cx = Math.max(bb.min.x, Math.min(newPos.x, bb.max.x));
    const cz = Math.max(bb.min.z, Math.min(newPos.z, bb.max.z));
    const dx = newPos.x - cx;
    const dz = newPos.z - cz;
    if (dx * dx + dz * dz >= r * r) continue;

    // Step-up: roll over small ledges (<= 0.4 m)
    const heightAboveFeet = bb.max.y - feetY;
    if (heightAboveFeet > 0 && heightAboveFeet <= 0.4) {
      stepUpY = Math.max(stepUpY, bb.max.y + currentH + 0.01);
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
