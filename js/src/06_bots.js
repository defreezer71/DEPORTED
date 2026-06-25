// BOTS — AI with shooting, prison spawn, ammo seeking
// Rendering: GLTF SkinnedMesh clones with AnimationMixer
// ═══════════════════════════════════════════════════════════
const BOT_NAMES = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Golf','Hotel','India','Juliet',
  'Kilo','Lima','Mike','November','Oscar','Papa','Quebec','Romeo','Sierra','Tango'];

const BOT_COUNT = 10;

// ── GLTF character system ──
// Each animation is a separate GLB (mesh + animation from same export = matching bind pose).
// Each bot gets one clone per animation; only the active one is visible.
const _animGltfs = {};        // animName → gltf (rifle set)
const _animGltfsPistol = {};  // animName → gltf (pistol set, falls back to rifle clips)
let characterReady = false;
let botInstMeshes = [];  // world-space hitbox meshes for raycasting

const _gltfLoader = new GLTFLoader();

async function loadCharacterAssets() {
  const loadGlb = path => new Promise((res, rej) =>
    _gltfLoader.load(path, res, null, rej));

  const animFiles = {
    aimIdle:        'models/StandingRifleV2.glb?v=3',
    rifleIdle:      'models/RifleIdle.glb',
    walk:           'models/RunningRifle.glb',
    walkBack:       'models/WalkingBackwards.glb',
    death:          'models/StandingDeathV2.glb?v=3',
    fire:           'models/RifleFiringV2.glb?v=3',
    reload:         'models/Reloading.glb',
    jump:           'models/RifleJump.glb',
    crouchIdle:     'models/IdleCrouch.glb',
    crouchWalk:     'models/CrouchWalking.glb',
    crouchWalkBack: 'models/CrouchWalkingBackwards.glb',
  };

  // Pistol-specific overrides — states not listed here share the rifle clips
  // (death, reload, crouchWalk, crouchWalkBack).
  const pistolFiles = {
    aimIdle:    'models/PistolAim.glb',
    rifleIdle:  'models/PistolIdle.glb',
    walk:       'models/PistolRun.glb',
    walkBack:   'models/PistolWalkBack.glb',
    fire:       'models/PistolFire.glb',
    jump:       'models/PistolJump.glb',
    crouchIdle: 'models/PistolKneelIdle.glb',
  };

  for (const [name, path] of Object.entries(animFiles)) {
    try {
      const gltf = await loadGlb(path);
      _animGltfs[name] = gltf;
      const clip = gltf.animations?.[0];
      console.log(`[Char] ${name}: ${clip ? clip.duration.toFixed(2)+'s' : 'NO CLIP'}`);
    } catch(e) { console.warn('Failed to load', name, path, e); }
  }

  // Pistol set: load overrides (deduped — PistolIdle is used twice), fall back to rifle
  const _pistolLoaded = {};
  for (const [name, path] of Object.entries(pistolFiles)) {
    try {
      if (!_pistolLoaded[path]) _pistolLoaded[path] = await loadGlb(path);
      _animGltfsPistol[name] = _pistolLoaded[path];
      const clip = _animGltfsPistol[name].animations?.[0];
      console.log(`[Char/pistol] ${name}: ${clip ? clip.duration.toFixed(2)+'s' : 'NO CLIP'}`);
    } catch(e) { console.warn('Failed to load pistol anim', name, path, '— falling back to rifle clip'); }
  }
  for (const name of Object.keys(animFiles)) {
    if (!_animGltfsPistol[name]) _animGltfsPistol[name] = _animGltfs[name];
  }

  characterReady = true;
  console.log('Character assets ready:', Object.keys(_animGltfs).join(', '));
  for (let i = 0; i < bots.length; i++) _attachBotMesh(bots[i], i);

  // Replace old box kill-cam player mesh with a real Dummy character clone
  if (_animGltfs['aimIdle']) {
    const pg = _animGltfs['aimIdle'];
    const { scale: pscale, footOffset: pfoot } = _measureScale(pg);
    const pclone = SkeletonUtils.clone(pg.scene);
    pclone.scale.setScalar(pscale);
    window._playerMeshFootOffset = pfoot;
    pclone.traverse(c => { if (c.isMesh) { c.castShadow = true; c.frustumCulled = false; } });
    const pmixer = new THREE.AnimationMixer(pclone);
    const pclip = pg.animations?.[0];
    if (pclip) { pmixer.clipAction(pclip).setLoop(THREE.LoopRepeat).play(); }
    let phips = null;
    pclone.traverse(o => { if (!phips && o.isBone && o.name.toLowerCase().includes('hips')) phips = o; });
    pclone.visible = false;
    scene.add(pclone);
    if (window._playerMesh) window._playerMesh.visible = false;
    window._playerMesh = pclone;
    window._playerMeshMixer = pmixer;
    window._playerMeshHips = phips ? { bone: phips, rx: phips.position.x, ry: phips.position.y } : null;
  }
}

function _findBone(root, namePart) {
  let found = null;
  root.traverse(o => { if (!found && o.isBone && o.name.includes(namePart)) found = o; });
  return found;
}

// Shared bot gun materials — created once
const _bgMats = (() => {
  const L = c => new THREE.MeshLambertMaterial({ color: c });
  return { blk: L(0x0d0d0d), drk: L(0x161616), mtl: L(0x303030), wood: L(0x7a4a1a), wdDk: L(0x5a3010) };
})();

function _makeBotGun() {
  const g = new THREE.Group();
  const { blk, drk, mtl, wood, wdDk } = _bgMats;
  const B  = (w,h,d) => new THREE.BoxGeometry(w,h,d);
  const Cy = (rt,rb,h,s=8) => new THREE.CylinderGeometry(rt,rb,h,s);
  const PI2 = Math.PI/2;
  const add = (geo, mat, px, py, pz, rx=0, ry=0, rz=0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px,py,pz); if(rx||ry||rz) m.rotation.set(rx,ry,rz);
    // No castShadow: ~20 parts × 20 bots = ~400 shadow-pass draw calls for
    // shadows nobody can see — the body rig's shadow covers the silhouette.
    g.add(m);
  };
  // Barrel
  add(Cy(0.015,0.017,0.330,8), drk,   0, 0.000,-0.465, PI2,0,0);
  add(Cy(0.024,0.024,0.030,8), mtl,   0, 0.000,-0.520, PI2,0,0);
  add(Cy(0.026,0.026,0.040,8), mtl,   0, 0.000,-0.650, PI2,0,0);
  // Handguard
  add(B(0.052,0.022,0.215), wood,   0, 0.014,-0.425);
  add(B(0.056,0.024,0.215), wdDk,   0,-0.016,-0.425);
  // Upper receiver
  add(B(0.058,0.026,0.205), drk,    0, 0.013,-0.215);
  add(B(0.060,0.008,0.205), mtl,    0, 0.026,-0.215);
  // Lower receiver
  add(B(0.056,0.050,0.205), drk,    0,-0.027,-0.215);
  // Magazine — ONE tilted box. A stepped multi-box "curve" reads as a separate
  // block glued onto the clip at bot-viewing distances.
  add(B(0.042,0.195,0.072), blk,    0,-0.150,-0.262, 0.18,0,0);
  add(B(0.044,0.014,0.074), mtl,    0,-0.250,-0.280, 0.18,0,0);  // base pad
  // Pistol grip
  add(B(0.038,0.094,0.046), wood,   0,-0.126,-0.130,-0.30,0,0);
  // Stock arms — run flush from the receiver back (rear edge z=-0.112) to the
  // butt plate; short enough that the butt doesn't clip into the chest
  add(B(0.008,0.008,0.214), drk,   -0.028, 0.002, -0.005);
  add(B(0.008,0.008,0.214), drk,   -0.028,-0.032, -0.005);
  add(B(0.012,0.064,0.020), mtl,   -0.028,-0.015,  0.112);
  // Front sight
  add(B(0.034,0.006,0.014), mtl,    0, 0.031,-0.570);
  return g;
}

// 1911-style pistol for bots holding the secondary. Built barrel-forward (-z),
// grip down/back (+y down, +z back), origin near the grip so it seats in the palm.
function _makeBotPistol() {
  const g = new THREE.Group();
  const { blk, drk, mtl, wood } = _bgMats;
  const B  = (w,h,d) => new THREE.BoxGeometry(w,h,d);
  const Cy = (rt,rb,h,s=8) => new THREE.CylinderGeometry(rt,rb,h,s);
  const PI2 = Math.PI/2;
  const add = (geo, mat, px, py, pz, rx=0, ry=0, rz=0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px,py,pz); if(rx||ry||rz) m.rotation.set(rx,ry,rz);
    g.add(m); // no castShadow — same reasoning as _makeBotGun
  };
  // Slide (top), barrel along -z
  add(B(0.026,0.030,0.200), mtl,  0, 0.020, -0.030);
  // Muzzle / bushing
  add(Cy(0.011,0.011,0.022,8), drk, 0, 0.020, -0.135, PI2,0,0);
  // Frame beneath the slide
  add(B(0.024,0.022,0.182), drk,  0,-0.004, -0.020);
  // Trigger guard
  add(B(0.018,0.030,0.010), drk,  0,-0.030,  0.012);
  add(B(0.020,0.008,0.044), drk,  0,-0.030, -0.012);
  // Grip — angled down and slightly back
  add(B(0.030,0.110,0.040), wood, 0,-0.070,  0.045, -0.30,0,0);
  // Magazine baseplate
  add(B(0.032,0.014,0.042), blk,  0,-0.124,  0.062, -0.30,0,0);
  // Hammer
  add(B(0.012,0.020,0.012), drk,  0, 0.030,  0.080);
  // Rear sight
  add(B(0.020,0.008,0.012), blk,  0, 0.038,  0.058);
  // Front sight
  add(B(0.006,0.010,0.008), blk,  0, 0.038, -0.120);
  return g;
}

function _measureScale(gltf) {
  const probe = SkeletonUtils.clone(gltf.scene);
  probe.updateMatrixWorld(true);
  let boneMinY = Infinity, boneMaxY = -Infinity;
  probe.traverse(o => {
    if (o.isBone) {
      const wp = new THREE.Vector3();
      o.getWorldPosition(wp);
      boneMinY = Math.min(boneMinY, wp.y);
      boneMaxY = Math.max(boneMaxY, wp.y);
    }
  });
  const charH = (boneMaxY > boneMinY) ? (boneMaxY - boneMinY) : 0;
  const scale = charH > 0.001 ? (CONFIG.playerHeight * 1.2) / charH : 0.0105;
  // footOffset lifts the mesh so feet land exactly on bot.pos.y
  const footOffset = charH > 0.001 ? -boneMinY * scale : 0;
  return { scale, footOffset };
}

function _cloneForAnim(animName, gltf, botIndex, scale) {
  const clone = SkeletonUtils.clone(gltf.scene);
  clone.scale.setScalar(scale);

  clone.traverse(child => {
    if (child.isMesh) { child.castShadow = true; child.frustumCulled = false; }
  });

  // Mixer — same GLB as clone, bind poses guaranteed to match
  const mixer = new THREE.AnimationMixer(clone);
  let clip = gltf.animations?.[0];

  let action = null;
  let actionB = null;
  if (clip) {
    action = mixer.clipAction(clip);
    if (animName === 'death' || animName === 'fire' || animName === 'jump' || animName === 'reload') {
      // Single-play, hold last frame — triggered on demand
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      // Two LoopOnce actions — manually crossfaded so we never hard-wrap back to frame 0.
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      action.time = Math.random() * clip.duration;

      actionB = mixer.clipAction(clip.clone());
      actionB.setLoop(THREE.LoopOnce, 1);
      actionB.clampWhenFinished = true;
    }
  }

  // Cache hips bone + its bind-pose XY so we can zero root-motion drift each frame.
  // In this FBX-sourced GLB, bone.x = world-X, bone.y = world-Z (forward), bone.z = world-Y (height).
  let hipsBone = null;
  clone.traverse(o => { if (!hipsBone && o.isBone && o.name.toLowerCase().includes('hips')) hipsBone = o; });
  const hipsRestX = hipsBone ? hipsBone.position.x : 0;
  const hipsRestY = hipsBone ? hipsBone.position.y : 0;

  // Cache hand bones for gun attachment. Match the wrist bone (e.g. "mixamorigRightHand"),
  // not the finger bones (RightHandIndex1, …), so prefer the shortest matching name.
  let rightHandBone = null, leftHandBone = null, rightForeArmBone = null;
  clone.traverse(o => {
    if (!o.isBone) return;
    const n = o.name.toLowerCase().replace(/[^a-z]/g, '');
    if (n.includes('righthand') && (!rightHandBone || o.name.length < rightHandBone.name.length)) rightHandBone = o;
    if (n.includes('lefthand')  && (!leftHandBone  || o.name.length < leftHandBone.name.length))  leftHandBone = o;
    if (n.includes('rightforearm') && (!rightForeArmBone || o.name.length < rightForeArmBone.name.length)) rightForeArmBone = o;
  });

  clone.visible = false;
  return { scene: clone, mixer, action, actionB, clipDur: clip?.duration ?? 0, xfActive: false, xfProg: 0, hipsBone, hipsRestX, hipsRestY, rightHandBone, leftHandBone, rightForeArmBone };
}

function _addWorldHitboxes(bot, index) {
  const mat = new THREE.MeshBasicMaterial();
  // Body cylinder — covers torso + legs up to the shoulders (~1.5), radius wide
  // enough to catch outstretched arms/hands on the rifle and feet mid-stride
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 8), mat.clone());
  body.userData.botIndex = index;
  body.userData.isHead = false;
  body.visible = false; // invisible but raycaster still detects it
  scene.add(body);
  botInstMeshes.push(body);
  // Head sphere
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), mat.clone());
  head.userData.botIndex = index;
  head.userData.isHead = true;
  head.visible = false;
  scene.add(head);
  botInstMeshes.push(head);
  bot.hitbox = body;
  bot.hitboxHead = head;
}

function _setBotAnim(bot, animName) {
  if (!bot.animScenes) return;
  // Always allow re-triggering fire (rapid shots restart the clip)
  if (bot.activeAnim === animName && animName !== 'fire') return;
  // DETACH inactive rigs from the scene graph — three r128 recurses into
  // invisible subtrees in updateMatrixWorld, so merely hiding them leaves
  // ~65 bones per rig × 10 rigs per character burning matrix updates every
  // frame. Re-adding is cheap (no GPU re-upload; renderer caches survive).
  const target = bot.animScenes[animName];
  for (const data of Object.values(bot.animScenes)) {
    if (data === target) continue;
    data.scene.visible = false;
    if (data.scene.parent) scene.remove(data.scene);
  }
  if (target) {
    if (!target.scene.parent) scene.add(target.scene);
    target.scene.visible = true;
    if ((animName === 'death' || animName === 'fire' || animName === 'jump' || animName === 'reload') && target.action) target.action.reset().play();
    bot.mesh = target.scene;
  }
  bot.activeAnim = animName;
}

function _attachBotMesh(bot, index) {
  if (!characterReady) return;
  bot.animScenes = {};
  bot.activeAnim = null;
  bot.mesh = null;

  const { scale, footOffset } = _animGltfs['aimIdle'] ? _measureScale(_animGltfs['aimIdle']) : { scale: 0.0105, footOffset: 0 };
  bot.footOffset = footOffset;

  const gltfMap = bot.weapon === 'pistol' ? _animGltfsPistol : _animGltfs;
  for (const [animName, gltf] of Object.entries(gltfMap)) {
    // Not added to the scene here — _setBotAnim attaches only the active rig
    bot.animScenes[animName] = _cloneForAnim(animName, gltf, index, scale);
  }

  bot.gunMesh = bot.weapon === 'pistol' ? _makeBotPistol() : _makeBotGun();
  bot.gunMesh.visible = false;
  scene.add(bot.gunMesh);

  _addWorldHitboxes(bot, index);
  _setBotAnim(bot, 'walk');
}

function findBotByMesh(mesh) {
  const idx = mesh?.userData?.botIndex;
  if (idx === undefined || idx === null) return null;
  const bot = bots[idx];
  return (bot && bot.alive) ? bot : null;
}
function findBotByInstance(mesh) { return findBotByMesh(mesh); }

// Kept for player kill-cam mesh in 12_main.js
function _makeICETex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 80;
  const x = c.getContext('2d');
  x.fillStyle = '#E06820'; x.fillRect(0, 0, 256, 80);
  x.font = 'bold 63px Arial Black, Impact, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#111111'; x.fillText('I.C.E.', 128, 40);
  x.strokeStyle = '#111111'; x.lineWidth = 2; x.strokeText('I.C.E.', 128, 40);
  return new THREE.CanvasTexture(c);
}
function _makeBagTex() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#C89040'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2400; i++) {
    const px = Math.random() * 128, py = Math.random() * 128;
    const v = (Math.random() - 0.5) * 28;
    x.fillStyle = `rgba(${v>0?255:0},${v>0?200:100},0,${Math.abs(v)/120})`;
    x.fillRect(px, py, 1.5, 1.5);
  }
  x.strokeStyle = 'rgba(80,50,10,0.12)'; x.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const lx = 15 + Math.random() * 98;
    x.beginPath(); x.moveTo(lx, 0); x.lineTo(lx + (Math.random()-0.5)*10, 128); x.stroke();
  }
  return new THREE.CanvasTexture(c);
}

loadCharacterAssets();

function createBot(x, z, name, index) {
  const h = getGroundHeight(x, z);
  const bot = {
    index,
    pos: new THREE.Vector3(x, h, z),
    yaw: 0,
    swing: 0,
    deadY: h,
    name,
    hp: 100,
    alive: true,
    // ~1 in 4 bots carries the pistol — visual variety only, AI/damage unchanged
    weapon: Math.random() < 0.25 ? 'pistol' : 'rifle',
    hasAmmo: true,
    moveDir: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
    moveTimer: 2 + Math.random() * 4,
    speed: 1.5 + Math.random() * 1.5,
    walkPhase: Math.random() * 6.28,
    shootCooldown: 0,
    shootAccuracy: 0.12 + Math.random() * 0.16,
    aggroRange: 30 + Math.random() * 20,
    ammoTimer: 0,
    reloadTimer: 55 + Math.random() * 20,
    exitDelay: 0,
    exitedPrison: false,
    velocityY: 0,
    isGrounded: true,
    canalJumpCount: 0,
    canalLandTimer: 0,
    waypoint: null,
    fleeTarget: null,
    prefersCrouch: Math.random() < 0.4,
    crouching: false,
    crouchTimer: 0,
    snapshots: [],
    shotTimes: [],
    mesh: null,
    mixer: null,
    currentAnimName: null,
    currentAction: null,
  };
  bots.push(bot);
  if (characterReady) _attachBotMesh(bot, index);
  return bot;
}

let _botShootUnlockedAt = Infinity; // set when match goes live

// Bot AI scratch — reused each frame (a fresh Vector3/Raycaster per engaging
// bot per frame was measurable GC churn with 20 bots)
const _aiEye = new THREE.Vector3(), _aiDir = new THREE.Vector3();
const _aiRay = new THREE.Raycaster();

// Gun sync helpers — reused each frame to avoid GC
const _gunPos = new THREE.Vector3();
const _gunQuat = new THREE.Quaternion();
const _gunOffVec = new THREE.Vector3();
const _gunRotQ = new THREE.Quaternion();
const _gunRotE = new THREE.Euler();

// --- Two-hand fit (live-tunable) ------------------------------------------
// Dial these from the browser console; changes apply every frame to all bots.
//   grip / fore : contact points on the gun mesh (METERS, gun-local).
//                 grip = pistol grip → right hand; fore = handguard → left hand.
//   rPalm/lPalm : wrist→palm offset (METERS, in each hand-bone's local frame) so the
//                 gun seats in the palm, not at the wrist bone.
//   roll        : extra roll about the barrel (RADIANS) to correct cant.
window.GUN_FIT = window.GUN_FIT || {
  grip:  [0, -0.090, -0.135],   // top of pistol grip, web of the right hand
  fore:  [0, -0.045, -0.500],   // underside of front handguard, cupped by the left palm
  rPalm: [0, 0.06, 0.01],       // hand-bone local: fingers run along +y, palm ≈ 60% to middle-finger base
  lPalm: [0, 0.07, 0.01],
  roll:  0,
  scaleMin: 0.9, scaleMax: 1.15,
};
// 1911 pistol: one real contact (the right palm). The gun is GLUED to the right
// hand bone with one fixed rotation (`rot`, hand-local Euler XYZ) — the pistol
// clips animate the hand as if it's holding the gun, so a single calibrated
// constant is correct in every pose. (The old forearm heuristic pointed the
// barrel along elbow→wrist and went backwards whenever the wrist cocked.)
window.PISTOL_FIT = window.PISTOL_FIT || {
  grip:  [0, -0.060, -0.020],   // contact on the gun seated at the palm — z tuned so the slide rear sits over the fist, not past the fingertips
  rPalm: [0, 0.02, 0.02],       // shorter than the rifle's — seats the slide rear into the thumb web
  mid:   [0, 0, -0.16],         // two-hand poses: seat offset in gun space (x right, y up, z backward) from the RIGHT-HAND anchor — z pushes the grip forward so it lands in the palm with the trigger under the index finger. (grip pin stays shared with the walk wrist-glue, so tune the clasp seat here, not via grip)
  rot:   [1.857, -0.195, -1.785], // hand→gun rotation: barrel along the forearm line at the PistolAim pose (probe-calibrated)
  roll:  0,                     // extra roll about the barrel (radians)
  scaleMin: 1.0, scaleMax: 1.0,
  // Pistol clips with an extended RIGHT (aiming) arm → seat the gun in the right
  // palm with the barrel along the right-forearm aim line; the left hand only
  // supports. PistolIdle (standing) is one of these. Not in this list → bent-arm
  // wrist-glue via `rot`. Live-tunable: push/splice anim names in the console
  // (e.g. PISTOL_FIT.twoHand.push('walk')) to test the moving poses.
  twoHand: ['aimIdle', 'fire', 'rifleIdle', 'walk', 'walkBack'],
};
// Toggle the two-hand fit (default on). Set window.GUN_AUTOFIT = false to use GUN_OFF instead.
if (window.GUN_AUTOFIT === undefined) window.GUN_AUTOFIT = true;
// Fallback single-hand offset (used if a left-hand bone is missing).
window.GUN_OFF = window.GUN_OFF || { px: 0.0, py: 0.0, pz: 0.0, rx: Math.PI / 2, ry: 0, rz: 0 };

const _GUN_UP_LOCAL = new THREE.Vector3(0, 1, 0); // gun's up: sights up, magazine down
// Scratch — reused each frame to avoid GC
const _hR = new THREE.Vector3(), _hL = new THREE.Vector3();
const _qR = new THREE.Quaternion(), _qL = new THREE.Quaternion();
const _palmR = new THREE.Vector3(), _palmL = new THREE.Vector3();
const _tgtR = new THREE.Vector3(), _tgtL = new THREE.Vector3();
const _gripV = new THREE.Vector3(), _foreV = new THREE.Vector3(), _axisL = new THREE.Vector3();
const _wFwd = new THREE.Vector3(), _wUp = new THREE.Vector3(0, 1, 0), _faP = new THREE.Vector3();
const _bx = new THREE.Vector3(), _by = new THREE.Vector3();
const _wx = new THREE.Vector3(), _wy = new THREE.Vector3();
const _mLocalInv = new THREE.Matrix4(), _mWorld = new THREE.Matrix4(), _mRot = new THREE.Matrix4();
const _qFit = new THREE.Quaternion(), _rollQ = new THREE.Quaternion();

// ── Shared character visual update — used by bots AND remote-player puppets ──
// `bot` is any entity with: pos (Vector3), yaw, alive, deadY, footOffset, weapon,
// animScenes, activeAnim (set via _setBotAnim first), gunMesh. Handles smooth yaw,
// anim scene placement, mixer/crossfade updates, and the two-hand gun fit.
function updateCharacterVisual(bot, dt) {
  // Smooth yaw rotation
  const targetYaw = bot.yaw;
  if (bot._smoothYaw === undefined) bot._smoothYaw = targetYaw;
  const yawDiff = Math.atan2(Math.sin(targetYaw - bot._smoothYaw), Math.cos(targetYaw - bot._smoothYaw));
  bot._smoothYaw += yawDiff * Math.min(1, dt * 8);

  for (const [animName, data] of Object.entries(bot.animScenes)) {
    if (!data.scene.parent) continue; // detached by _setBotAnim — skip entirely
    const fo = bot.footOffset ?? 0;
    if (!bot.alive) {
      data.scene.position.set(bot.pos.x, bot.deadY + fo, bot.pos.z);
    } else {
      data.scene.position.set(bot.pos.x, bot.pos.y + fo, bot.pos.z);
      data.scene.rotation.y = bot._smoothYaw;
    }
    if (data.scene.visible) {
      data.mixer.update(dt);

      // Kill root-motion XY drift (forward/lateral). bone.z = world-Y (height), leave it alone.
      // Skip stationary anims: their hips translation is weight-shift sway with the legs
      // counter-rotating to keep the feet planted — pinning the hips there transfers the
      // sway to the feet, which then "ice-skate" across the ground while idle.
      if (data.hipsBone && animName !== 'death'
          && animName !== 'rifleIdle' && animName !== 'aimIdle' && animName !== 'crouchIdle') {
        data.hipsBone.position.x = data.hipsRestX;
        data.hipsBone.position.y = data.hipsRestY;
      }

      // Manual crossfade loop — blend action→actionB near the clip end to avoid snap.
      // Uses direct weight control (no crossFadeTo) to prevent binding destruction.
      if (data.actionB && animName !== 'death') {
        const BLEND = 0.20;
        const remaining = data.clipDur - data.action.time;

        if (!data.xfActive && remaining < BLEND) {
          data.xfActive = true;
          data.xfProg = 0;
          data.actionB.reset();
          data.actionB.setEffectiveWeight(0);
          data.actionB.play();
        }

        if (data.xfActive) {
          data.xfProg = Math.min(1, data.xfProg + dt / BLEND);
          data.action.setEffectiveWeight(1 - data.xfProg);
          data.actionB.setEffectiveWeight(data.xfProg);
          if (data.xfProg >= 1) {
            data.action.setEffectiveWeight(0);
            const tmp = data.action; data.action = data.actionB; data.actionB = tmp;
            data.xfActive = false;
          }
        }
      }
    }
  }

  // Sync gun mesh into the hands. Two-hand fit: pistol grip → right hand,
  // handguard → left hand, barrel aligned to the line between the two hands.
  if (bot.gunMesh) {
    const activeData = bot.animScenes[bot.activeAnim];
    const rhBone = activeData?.rightHandBone;
    const lhBone = activeData?.leftHandBone;
    if (rhBone && bot.alive) {
      activeData.scene.updateMatrixWorld(true);
      const F = bot.weapon === 'pistol' ? window.PISTOL_FIT : window.GUN_FIT;
      rhBone.getWorldPosition(_hR);
      rhBone.getWorldQuaternion(_qR);
      if (!bot._gunGripRel) bot._gunGripRel = new THREE.Quaternion();

      // Contact points on the gun this frame, and the right-palm target (wrist + palm offset).
      _gripV.set(F.grip[0], F.grip[1], F.grip[2]);
      _palmR.set(F.rPalm[0], F.rPalm[1], F.rPalm[2]).applyQuaternion(_qR);
      _tgtR.copy(_hR).add(_palmR);

      // Reload/death let the left hand leave the gun — keep it glued to the right hand
      // only. Pistols never use the two-hand fit: both hands clasp the same point,
      // so the right→left palm axis is degenerate sideways noise.
      const anim = bot.activeAnim;
      const gripped = window.GUN_AUTOFIT && lhBone && anim !== 'reload' && anim !== 'death'
        && bot.weapon !== 'pistol';

      let fitOk = false;
      if (gripped) {
        lhBone.getWorldPosition(_hL);
        lhBone.getWorldQuaternion(_qL);
        _foreV.set(F.fore[0], F.fore[1], F.fore[2]);
        _palmL.set(F.lPalm[0], F.lPalm[1], F.lPalm[2]).applyQuaternion(_qL);
        _tgtL.copy(_hL).add(_palmL);
        // Degenerate-pose guard: if the hands drift too close together or stack
        // near-vertically (idle sway frames), the palm line is garbage — aligning
        // the barrel to it makes the rifle go vertical with random roll.
        const _spanW = _tgtL.distanceTo(_tgtR);
        fitOk = _spanW > 0.16 && Math.abs(_tgtL.y - _tgtR.y) / _spanW < 0.8;
      }

      if (fitOk) {

        // Fit gun size to the hand span (clamped). Recomputed each gripped frame so live
        // tuning applies instantly; reload/death reuse the last value via the else branch.
        const spanLocal = _foreV.distanceTo(_gripV);
        const raw = spanLocal > 1e-4 ? _tgtR.distanceTo(_tgtL) / spanLocal : 1;
        const clamped = Math.min(F.scaleMax, Math.max(F.scaleMin, raw));
        // Smooth toward the target scale so the gun doesn't pulse as the hands
        // move apart/together through the walk cycle.
        bot._gunFitScale = bot._gunFitScale
          ? bot._gunFitScale + (clamped - bot._gunFitScale) * 0.12
          : clamped;

        // Gun-local frame: barrel axis = grip→fore, up = gun up. Inverse = transpose (orthonormal).
        _axisL.copy(_foreV).sub(_gripV).normalize();
        _bx.crossVectors(_GUN_UP_LOCAL, _axisL);
        if (_bx.lengthSq() < 1e-8) _bx.set(1, 0, 0); else _bx.normalize();
        _by.crossVectors(_axisL, _bx).normalize();
        _mLocalInv.makeBasis(_bx, _by, _axisL).transpose();

        // World frame: forward = right→left palm, up = world up (keeps the gun upright).
        _wFwd.copy(_tgtL).sub(_tgtR);
        if (_wFwd.lengthSq() < 1e-8) _wFwd.set(Math.sin(bot._smoothYaw), 0, Math.cos(bot._smoothYaw));
        _wFwd.normalize();
        _wx.crossVectors(_wUp, _wFwd);
        if (_wx.lengthSq() < 1e-8) _wx.set(1, 0, 0); else _wx.normalize();
        _wy.crossVectors(_wFwd, _wx).normalize();
        _mWorld.makeBasis(_wx, _wy, _wFwd);
        _mRot.multiplyMatrices(_mWorld, _mLocalInv);
        _qFit.setFromRotationMatrix(_mRot);
        if (F.roll) _qFit.multiply(_rollQ.setFromAxisAngle(_axisL, F.roll));
        // Remember orientation relative to the right wrist, for reload/death reuse.
        bot._gunGripRel.copy(_qR).invert().multiply(_qFit);
      } else if (bot.weapon === 'pistol' && anim !== 'reload' && anim !== 'death') {
        const faBone = activeData.rightForeArmBone;
        const _twoHand = F.twoHand || ['aimIdle', 'fire'];
        if (faBone && lhBone && _twoHand.includes(anim)) {
          // Extended-arm two-handed poses: the gun lives in the RIGHT PALM and
          // the straighter right arm is the aiming arm; the left hand only
          // supports nearby (we don't seat to it). Anchor on the right hand +
          // right-forearm aim line — NOT the clasp midpoint, which floats the
          // gun out between the two hands. Basis is rebuilt right-handed from
          // cross products (never a negated makeBasis column → no det -1 mirror).
          faBone.getWorldPosition(_faP);
          _wFwd.copy(_hR).sub(_faP);   // right forearm → hand
          // Bots aim by yaw (horizontal), but the PistolAim/Idle clips angle the
          // forearm UP, tilting the gun skyward out of the palm. Flatten the aim
          // toward horizontal: barrelLevel 0 = fully level, 1 = follow the arm.
          _wFwd.y *= (F.barrelLevel ?? 0);
          if (_wFwd.lengthSq() < 1e-8) _wFwd.set(Math.sin(bot._smoothYaw), 0, Math.cos(bot._smoothYaw));
          _wFwd.normalize();
          _axisL.copy(_wFwd).negate(); // basis z (right-handed; gun barrel is -z)
          _wx.crossVectors(_wUp, _axisL);
          if (_wx.lengthSq() < 1e-8) _wx.set(1, 0, 0); else _wx.normalize();
          _wy.crossVectors(_axisL, _wx).normalize();
          _mWorld.makeBasis(_wx, _wy, _axisL);
          _qFit.setFromRotationMatrix(_mWorld);
          // Seat in the right palm: start at the right hand, then a tunable
          // offset in gun space (x right, y up, z backward) to settle the grip.
          _tgtR.copy(_hR);
          const M = F.mid || [0, 0, 0];
          _tgtR.addScaledVector(_wx, M[0]).addScaledVector(_wy, M[1]).addScaledVector(_axisL, M[2]);
        } else {
          // Bent-arm poses (idle/run/kneel/jump): glue to the right hand with the
          // calibrated hand→gun rotation — the hand is animated holding the gun,
          // so the gun tracks it naturally.
          const r = F.rot || [0, 0, 0];
          _qFit.copy(_qR).multiply(_gunRotQ.setFromEuler(_gunRotE.set(r[0], r[1], r[2])));
        }
        if (F.roll) _qFit.multiply(_rollQ.setFromAxisAngle(_axisL.set(0, 0, 1), F.roll));
        bot._gunFitScale = 1;
        bot._gunGripRel.copy(_qR).invert().multiply(_qFit);
      } else {
        // Rifle on degenerate palm-line frames (kneel/idle sway) and reload/death:
        // glue the gun to the right hand via the last good two-hand orientation.
        // The hand keeps holding the rifle through these poses, so following the
        // wrist looks right — aiming down the forearm here pointed the rifle
        // backwards whenever the forearm swung sideways (kneeling).
        if (bot._gunFitScale) {
          _qFit.copy(_qR).multiply(bot._gunGripRel);
        } else {
          const o = window.GUN_OFF;
          _qFit.copy(_qR).multiply(_gunRotQ.setFromEuler(_gunRotE.set(o.rx, o.ry, o.rz)));
        }
      }

      // Smooth the orientation so anim/fit-mode switches (scene swaps pop the
      // pose) can't pop the gun between frames — but track fast within a pose,
      // or the gun visibly lags the arms while the bot whips around to a target.
      if (bot._fitAnim !== anim) { bot._fitAnim = anim; bot._fitBlend = 0.15; }
      if (!bot._qGunSm) { bot._qGunSm = new THREE.Quaternion().copy(_qFit); bot._fitBlend = 0; }
      else {
        const smRate = bot._fitBlend > 0 ? 14 : 40;
        bot._fitBlend -= dt;
        bot._qGunSm.slerp(_qFit, Math.min(1, dt * smRate));
      }

      const scale = bot._gunFitScale || 1;
      bot.gunMesh.scale.setScalar(scale);
      bot.gunMesh.quaternion.copy(bot._qGunSm);
      // Seat the grip contact exactly in the right palm.
      _gunOffVec.copy(_gripV).applyQuaternion(bot._qGunSm).multiplyScalar(scale);
      bot.gunMesh.position.copy(_tgtR).sub(_gunOffVec);
      bot.gunMesh.visible = true;
    } else {
      bot.gunMesh.visible = false;
    }
  }
}

// ── Remote-player puppets — the bot character rig driven by network data ──
let _puppetSeq = 100; // index offset past bot indices (only used for per-clone variation)
function createCharacterPuppet(weapon = 'rifle') {
  if (!characterReady) return null;
  const { scale, footOffset } = _animGltfs['aimIdle'] ? _measureScale(_animGltfs['aimIdle']) : { scale: 0.0105, footOffset: 0 };
  const ent = {
    pos: new THREE.Vector3(), yaw: 0, alive: true, deadY: 0, weapon,
    animScenes: {}, activeAnim: null, footOffset, mesh: null,
  };
  const gltfMap = weapon === 'pistol' ? _animGltfsPistol : _animGltfs;
  for (const [animName, gltf] of Object.entries(gltfMap)) {
    // Not added to the scene here — _setBotAnim attaches only the active rig
    ent.animScenes[animName] = _cloneForAnim(animName, gltf, _puppetSeq, scale);
  }
  _puppetSeq++;
  ent.gunMesh = weapon === 'pistol' ? _makeBotPistol() : _makeBotGun();
  ent.gunMesh.visible = false;
  scene.add(ent.gunMesh);
  return ent;
}
function removeCharacterPuppet(ent) {
  if (!ent) return;
  for (const d of Object.values(ent.animScenes)) scene.remove(d.scene);
  if (ent.gunMesh) scene.remove(ent.gunMesh);
}

// Bots only spawn in Auto Join (bot match) mode — called from startBotMatch()
function spawnBots() {
  _botShootUnlockedAt = Date.now() + 60000;
  for (let i = 0; i < BOT_COUNT; i++) {
    const row = Math.floor(i / 5);
    const col = i % 5;
    const px = CONFIG.prisonPos.x - CONFIG.prisonSize / 2 + 5 + col * ((CONFIG.prisonSize - 10) / 4);
    const pz = CONFIG.prisonPos.z - CONFIG.prisonSize / 2 + 5 + row * ((CONFIG.prisonSize - 10) / 3);
    const bot = createBot(px, pz, BOT_NAMES[i] || 'Bot', i);
    bot.exitDelay = 0;
    // Assign a spread-out first waypoint so bots fan across the map immediately
    const sectorAngle = (i / BOT_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const sectorR = 55 + Math.random() * 55;
    bot.waypoint = { x: Math.cos(sectorAngle) * sectorR, z: Math.sin(sectorAngle) * sectorR };
  }
}

function updateBots(dt) {
  for (const bot of bots) {
    if (!bot.alive) continue;

    // Always record snapshots — even during countdown so kill-cam always has history
    const snapNow = Date.now();
    const lastSnap = bot.snapshots[bot.snapshots.length - 1];
    if (!lastSnap || snapNow - lastSnap.t >= 50) {
      // Pre-compute exact aim angles toward the player for kill-cam replay
      const _sdx = camera.position.x - bot.pos.x;
      const _sdz = camera.position.z - bot.pos.z;
      const _sdist = Math.sqrt(_sdx * _sdx + _sdz * _sdz) || 0.001;
      const _sdy = (camera.position.y - 0.5) - (bot.pos.y + 1.65); // player body-center vs bot eye
      const _sAimYaw = Math.atan2(-_sdx, -_sdz);   // camera convention (same as follow-cam formula)
      const _sAimPitch = -Math.atan2(_sdy, _sdist);
      bot.snapshots.push({ t: snapNow, x: bot.pos.x, y: bot.pos.y, z: bot.pos.z, yaw: bot.yaw,
        aimYaw: _sAimYaw, aimPitch: _sAimPitch });
      const snapCutoff = snapNow - 30000;
      while (bot.snapshots.length > 2 && bot.snapshots[0].t < snapCutoff) bot.snapshots.shift();
    }

    // Phase check — don't move during lobby/countdown
    if (state.phase === 'lobby' || state.phase === 'countdown') continue;

    const bx = bot.pos.x, bz = bot.pos.z;

    // Check if bot is still inside prison
    const inPrison = Math.abs(bx - prison.x) < pw / 2 && Math.abs(bz - prison.z) < pw / 2;

    // If in prison or near gate, head for exit
    if (inPrison || (Math.abs(bx - (prison.x + pw/2)) < 8 && Math.abs(bz - prison.z) < pw/2 && bot.exitDelay <= 0 && !bot.exitedPrison)) {
      bot.exitDelay -= dt;
      if (bot.exitDelay > 0) {
        bot.walkPhase += dt * 1;
        bot.swing = Math.sin(bot.walkPhase) * 0.1;
        continue;
      }
      const wallX = prison.x + pw / 2;
      if (bx < wallX + 3) {
        bot.moveDir.set(1, 0, (prison.z - bz) * 0.3).normalize();
      } else {
        bot.exitedPrison = true;
        const ang = Math.atan2(-prison.z, -prison.x) + (Math.random() - 0.5) * 0.8;
        const rd = 50 + Math.random() * 40;
        bot.waypoint = { x: Math.cos(ang) * rd, z: Math.sin(ang) * rd };
      }
      bot.speed = 8.4;
      const newX = bx + bot.moveDir.x * bot.speed * dt;
      const newZ = bz + bot.moveDir.z * bot.speed * dt;
      bot.pos.x = newX;
      bot.pos.z = newZ;
      const th = getGroundHeight(bot.pos.x, bot.pos.z);
      bot.pos.y += (th - bot.pos.y) * Math.min(1, dt * 18);
      bot.yaw = Math.atan2(bot.moveDir.x, bot.moveDir.z);
      bot.walkPhase += dt * bot.speed * 3;
      bot.swing = Math.sin(bot.walkPhase) * 0.4;
      continue;
    }

    const dx = camera.position.x - bx;
    const dz = camera.position.z - bz;
    const distToPlayer = Math.sqrt(dx * dx + dz * dz);

    // Reload cycle — trigger once per minute, play clip once then rearm
    if (bot.hasAmmo && bot.exitedPrison) {
      bot.reloadTimer -= dt;
      if (bot.reloadTimer <= 0) {
        bot.hasAmmo = false;
        bot.ammoTimer = bot.animScenes?.reload?.clipDur ?? 3.3;
      }
    }
    if (!bot.hasAmmo && bot.exitedPrison) {
      bot.ammoTimer -= dt;
      if (bot.ammoTimer <= 0) {
        bot.hasAmmo = true;
        bot.reloadTimer = 55 + Math.random() * 20;
      }
    }

    // ── TOP PRIORITY: engage player if in range ──
    const engaging = bot.hasAmmo && distToPlayer < bot.aggroRange && !state.playerDead && Date.now() >= _botShootUnlockedAt;
    if (engaging) {
      bot.yaw = Math.atan2(dx, dz);
      _aiEye.set(bx, bot.pos.y + 1.7, bz);
      _aiDir.set(dx, camera.position.y - _aiEye.y, dz).normalize();
      _aiRay.set(_aiEye, _aiDir);
      _aiRay.far = distToPlayer;
      const losHits = _aiRay.intersectObjects(collidables, false);
      let volcanoBlocking = false;
      const stepSize = distToPlayer / 20;
      for (let s = 1; s < 20; s++) {
        const t = s * stepSize;
        const volH = getVolcanoHeight(_aiEye.x + _aiDir.x * t, _aiEye.z + _aiDir.z * t);
        if (volH > 0.8 && _aiEye.y + _aiDir.y * t < volH - 0.1) { volcanoBlocking = true; break; }
      }
      bot.shootCooldown -= dt;
      if (bot.shootCooldown <= 0 && losHits.length === 0 && !volcanoBlocking) {
        bot.shootCooldown = 0.8 + Math.random() * 1.5;
        const fireDur = bot.animScenes?.fire?.clipDur ?? 0.8;
        bot.fireAnimUntil = Date.now() + fireDur * 1000;
        bot.shotTimes.push(Date.now());
        if (bot.shotTimes.length > 200) bot.shotTimes.shift();
        const hitChance = Math.max(0.08, 0.48 - distToPlayer * 0.005 - bot.shootAccuracy);
        if (Math.random() < hitChance) {
          const dmg = 8 + Math.floor(Math.random() * 7);
          const prevHp = state.hp;
          if (state.armor > 0) { state.armor = Math.max(0, state.armor - dmg); }
          else { state.hp = Math.max(0, state.hp - dmg); }
          if (prevHp > 0 && state.hp <= 0) {
            state.killCamBotIndex = bots.indexOf(bot);
            state.killCamShooterId = null;
            window._killCamBot = bot; // direct reference — avoids indexOf returning -1
            // Push a precise snapshot at the exact kill frame so the replay ends aimed perfectly
            const _ksNow = Date.now();
            const _ksdx = camera.position.x - bot.pos.x;
            const _ksdz = camera.position.z - bot.pos.z;
            const _ksdist = Math.sqrt(_ksdx * _ksdx + _ksdz * _ksdz) || 0.001;
            const _ksdy = (camera.position.y - 0.5) - (bot.pos.y + 1.65);
            bot.snapshots.push({
              t: _ksNow, x: bot.pos.x, y: bot.pos.y, z: bot.pos.z, yaw: bot.yaw,
              aimYaw: Math.atan2(-_ksdx, -_ksdz),
              aimPitch: -Math.atan2(_ksdy, _ksdist),
            });
            state.killShotAbsTime = _ksNow;
          }
          updateHUD();
          const dv = document.getElementById('damage-vignette');
          dv.classList.add('show');
          setTimeout(() => dv.classList.remove('show'), 350);
          SFX.hitmarker();
        }
        playNoise(0.06, 0.08 * Math.max(0.2, 1 - distToPlayer / 80), 3000, 'bandpass');
      }
    }

    // ── MOVEMENT: always pick a destination and walk to it ──
    if (state.waterRising) {
      if (!bot.fleeTarget) {
        const botIdx = bots.indexOf(bot);
        const angle = (botIdx / bots.length) * Math.PI * 2;
        const r = 15 + (botIdx % 5) * 5;
        bot.fleeTarget = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
      }
      const arrived = Math.sqrt((bx - bot.fleeTarget.x) ** 2 + (bz - bot.fleeTarget.z) ** 2) < 4;
      if (arrived) {
        const curAngle = Math.atan2(bz, bx);
        const orbitR = Math.sqrt(bx * bx + bz * bz) || 20;
        const nextAngle = curAngle + 0.4;
        bot.fleeTarget = { x: Math.cos(nextAngle) * orbitR, z: Math.sin(nextAngle) * orbitR };
      }
      bot.moveDir.set(bot.fleeTarget.x - bx, 0, bot.fleeTarget.z - bz).normalize();
      bot.speed = 8.4;
      bot.yaw = Math.atan2(bot.moveDir.x, bot.moveDir.z);
    } else {
      if (!bot.waypoint || Math.sqrt((bx - bot.waypoint.x) ** 2 + (bz - bot.waypoint.z) ** 2) < 6) {
        const angle = Math.random() * Math.PI * 2;
        const r = 80 + Math.random() * 90;
        bot.waypoint = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
      }
      bot.moveDir.set(bot.waypoint.x - bx, 0, bot.waypoint.z - bz).normalize();
      bot.speed = engaging ? 3.35 : 5.05;
      if (!engaging) bot.yaw = Math.atan2(bot.moveDir.x, bot.moveDir.z);
    }

    let newX = bx + bot.moveDir.x * bot.speed * dt;
    let newZ = bz + bot.moveDir.z * bot.speed * dt;

    const atBoundary = Math.abs(newX) >= half - 12 || Math.abs(newZ) >= half - 12;
    const atVolcano = getVolcanoHeight(newX, newZ) > (state.waterRising ? 40 : 18);

    // Canal crossing: two walls (inner r≈83.75, outer r≈86.25), padded to ~82.75–84.75 and ~85.25–87.25.
    // Strategy: force radially inward movement while in the canal zone, then bounce-jump until clear.
    const CANAL_MIN = 82.0, CANAL_MAX = 87.5;
    const maxNow = Math.max(Math.abs(bx), Math.abs(bz));
    const inCanalZone = maxNow >= CANAL_MIN && maxNow <= CANAL_MAX;
    const approachingCanal = maxNow > CANAL_MAX && Math.max(Math.abs(newX), Math.abs(newZ)) <= CANAL_MAX;

    if (!inCanalZone) { bot.canalJumpCount = 0; bot.canalLandTimer = 0; }

    // Steer toward waypoint while crossing canal — keeps bots spread at different crossing angles
    if (inCanalZone || approachingCanal) {
      const wpx = bot.waypoint ? bot.waypoint.x : 0, wpz = bot.waypoint ? bot.waypoint.z : 0;
      const wd = Math.sqrt((wpx - bx) ** 2 + (wpz - bz) ** 2) || 1;
      bot.moveDir.set((wpx - bx) / wd, 0, (wpz - bz) / wd);
      newX = bx + bot.moveDir.x * bot.speed * dt;
      newZ = bz + bot.moveDir.z * bot.speed * dt;
      // Lock yaw so character keeps facing its travel direction, not snapping mid-jump
      bot.yaw = Math.atan2(bot.moveDir.x, bot.moveDir.z);
    }

    // Jump on canal entry from outside
    if (approachingCanal && bot.isGrounded) {
      bot.velocityY = 7.2; bot.isGrounded = false; bot.canalJumpCount = 1; bot.canalLandTimer = 0;
    }
    // Bounce-jump: wait 0.1s after landing before next jump so bot travels a bit further
    if (bot.canalJumpCount >= 1 && bot.canalJumpCount < 2 && inCanalZone) {
      if (!bot.isGrounded) {
        bot.canalLandTimer = 0.1;
      } else if (bot.canalLandTimer > 0) {
        bot.canalLandTimer -= dt;
      } else {
        bot.velocityY = 7.2; bot.isGrounded = false; bot.canalJumpCount++;
      }
    }

    const bypassCollision = inCanalZone || bot.canalJumpCount > 0;
    if (!atBoundary && !atVolcano && (bypassCollision || !checkBotCollision(newX, newZ))) {
      bot.pos.x = newX;
      bot.pos.z = newZ;
    } else if (!bypassCollision) {
      const angle = Math.random() * Math.PI * 2;
      const r = 30 + Math.random() * 50;
      bot.waypoint = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
      bot.fleeTarget = null;
    }

    // Jump physics
    bot.velocityY -= 22 * dt;
    bot.pos.y += bot.velocityY * dt;
    const th = getGroundHeight(bot.pos.x, bot.pos.z);
    if (bot.pos.y <= th) {
      bot.pos.y = th;
      bot.velocityY = 0;
      bot.isGrounded = true;
    }

    bot.walkPhase += dt * bot.speed * 3;
    bot.swing = Math.sin(bot.walkPhase) * 0.4;
  }

  // Update bot mesh positions and advance animation mixers
  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i];
    if (!bot.animScenes) continue;

    // Determine target animation
    const isEngaging = bot.alive && bot.hasAmmo && !state.playerDead && Date.now() >= _botShootUnlockedAt &&
      (Math.sqrt((bot.pos.x - camera.position.x) ** 2 + (bot.pos.z - camera.position.z) ** 2) < bot.aggroRange);
    const isFiring = bot.alive && bot.fireAnimUntil && Date.now() < bot.fireAnimUntil;

    // Crouch toggle — some bots randomly crouch when engaging
    if (isEngaging) {
      bot.crouchTimer -= dt;
      if (bot.crouchTimer <= 0) {
        bot.crouching = bot.prefersCrouch && Math.random() < 0.65;
        bot.crouchTimer = 4 + Math.random() * 6;
      }
    } else {
      bot.crouching = false;
      bot.crouchTimer = 0;
    }

    // Is bot moving backward relative to the direction it's facing?
    const _fx = Math.sin(bot.yaw), _fz = Math.cos(bot.yaw);
    const _moveDot = bot.moveDir.x * _fx + bot.moveDir.z * _fz;
    const isMoving = bot.speed > 0.5;
    const movingBack = isEngaging && isMoving && _moveDot < -0.3;

    const inLobby = state.phase === 'lobby' || state.phase === 'countdown';
    let targetAnim;
    if (!bot.alive)                    targetAnim = 'death';
    else if (inLobby)                  targetAnim = 'rifleIdle';
    else if (!bot.isGrounded)          targetAnim = 'jump';
    else if (!bot.hasAmmo && bot.exitedPrison) targetAnim = 'reload';
    else if (isFiring)                 targetAnim = 'fire';
    else if (bot.crouching)            targetAnim = isMoving ? (movingBack ? 'crouchWalkBack' : 'crouchWalk') : 'crouchIdle';
    else if (movingBack)               targetAnim = 'walkBack';
    else if (isEngaging && !isMoving)  targetAnim = 'aimIdle';
    else if (!isEngaging && !isMoving) targetAnim = 'rifleIdle';
    else                               targetAnim = 'walk';

    if (bot._dbgAnim) targetAnim = bot._dbgAnim; // headless test rig: force a pose
    _setBotAnim(bot, targetAnim);
    updateCharacterVisual(bot, dt);

    // Update world-space hitbox positions. Head bone measures 1.78 above the feet
    // on the normalized rig — the old 1.6 put "headshots" at the upper chest.
    if (bot.hitbox) {
      if (bot.alive) {
        bot.hitbox.position.set(bot.pos.x, bot.pos.y + 0.75, bot.pos.z);
        bot.hitboxHead.position.set(bot.pos.x, bot.pos.y + 1.78, bot.pos.z);
      } else {
        // Move dead hitboxes out of the way so they can't be shot
        bot.hitbox.position.set(0, -999, 0);
        bot.hitboxHead.position.set(0, -999, 0);
      }
    }
  }

  // Update kill-cam player dummy mesh
  if (window._playerMeshMixer && window._playerMesh && window._playerMesh.visible) {
    window._playerMeshMixer.update(dt);
    if (window._playerMeshHips) {
      window._playerMeshHips.bone.position.x = window._playerMeshHips.rx;
      window._playerMeshHips.bone.position.y = window._playerMeshHips.ry;
    }
  }
}

function damageBot(bot, dmg, isHead) {
  if (!bot.alive) return;
  bot.hp -= dmg;
  if (bot.hp <= 0) {
    bot.alive = false;
    state.kills++;
    SFX.kill_chaching();
    document.getElementById('kills-val').textContent = state.kills;
    addKillFeedEntry(bot.name, isHead);
    bot.deadY = getGroundHeight(bot.pos.x, bot.pos.z);
  }
}


// Kill feed
const killFeedEntries = [];
function addKillFeedEntry(botName, isHead) {
  const el = document.getElementById('kill-feed');
  killFeedEntries.push({ name: botName, head: isHead, time: Date.now() });
  if (killFeedEntries.length > 5) killFeedEntries.shift();
  el.innerHTML = killFeedEntries.map(e =>
    `<div class="entry">You ${e.head ? '⊕' : '→'} ${e.name}${e.head ? ' (headshot)' : ''}</div>`
  ).join('');
  setTimeout(() => {
    const idx = killFeedEntries.length > 0 ? killFeedEntries.findIndex(e => e.time === killFeedEntries[0].time) : -1;
    if (idx >= 0) killFeedEntries.splice(idx, 1);
    el.innerHTML = killFeedEntries.map(e =>
      `<div class="entry">You ${e.head ? '⊕' : '→'} ${e.name}</div>`
    ).join('');
  }, 5000);
}

// ═══════════════════════════════════════════════════════════
