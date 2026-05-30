// BOTS — AI with shooting, prison spawn, ammo seeking
// Rendering: 24 InstancedMesh objects (one per body part) = 24 draw calls for all 20 bots
// ═══════════════════════════════════════════════════════════
const BOT_NAMES = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Golf','Hotel','India','Juliet',
  'Kilo','Lima','Mike','November','Oscar','Papa','Quebec','Romeo','Sierra','Tango'];

const BOT_COUNT = 20;
// One unique shirt color per bot slot (20 total) — used for identification in kill cam
const BOT_SHIRT_COLORS = [
  0xCC2222, 0x2244CC, 0x22AA33, 0xCCCC22, 0xCC6622,
  0x993399, 0x22BBBB, 0xCC2288, 0x88CC22, 0xCC4444,
  0x2299CC, 0xCC8822, 0x4422CC, 0xCC5533, 0x22CC88,
  0xCC2266, 0x55AACC, 0xAAAA22, 0xCC44AA, 0x44CCAA,
];
const BOT_HELMET_COLORS = [
  0x333333, 0x553322, 0x223355, 0x225533, 0x443355,
  0x554433, 0x334433, 0x553344, 0x224455, 0x445522,
  0x332244, 0x553333, 0x225544, 0x444422, 0x553355,
  0x334455, 0x442233, 0x224433, 0x553322, 0x335544,
];

// ── InstancedMesh declarations ──
let botTorsoInst, botBeltInst, botTextFrontInst, botTextBackInst;
// Paper bag head
let botBagBodyInst, botBagEyeLInst, botBagEyeRInst;
let botShoulderLInst, botShoulderRInst;
let botUpperArmLInst, botUpperArmRInst;
let botForearmLInst, botForearmRInst;
let botHandLInst, botHandRInst;
let botThighLInst, botThighRInst;
let botShinLInst, botShinRInst;
let botBootLInst, botBootRInst;
let botGunBarrelInst, botGunBodyInst, botStockInst, botGunMagInst, botHandguardInst, botGripInst;
let botInstMeshes = [];  // all 31 — used in raycast
let botHeadMeshes = [];  // head + helmet parts — headshot detection

// Reusable matrices — avoids per-frame heap allocation
const _bRootMat  = new THREE.Matrix4();
const _bLocalMat = new THREE.Matrix4();
const _bWorldMat = new THREE.Matrix4();

// Canvas fabric texture — white base with subtle crosshatch weave; per-instance color multiplies through
function _makeBotFabricTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 64, 64);
  x.strokeStyle = 'rgba(0,0,0,0.11)'; x.lineWidth = 0.8;
  for (let i = 0; i < 64; i += 4) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 64); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(64, i); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 4); return t;
}

// Skin texture — carries the skin tone color directly (material color set to white)
function _makeBotSkinTex() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const x = c.getContext('2d');
  x.fillStyle = '#D4A87A'; x.fillRect(0, 0, 32, 32);
  for (let i = 0; i < 80; i++) {
    x.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.05})`;
    x.beginPath(); x.arc(Math.random()*32, Math.random()*32, 0.4+Math.random()*0.8, 0, Math.PI*2); x.fill();
  }
  return new THREE.CanvasTexture(c);
}
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
function initBotInstances() {
  const fabricTex = _makeBotFabricTex();
  const skinTex   = _makeBotSkinTex();

  // ── Geometries ──
  const torsoGeo     = new THREE.CylinderGeometry(0.30, 0.24, 0.62, 8);
  const beltGeo      = new THREE.BoxGeometry(0.52, 0.09, 0.27);
  const textGeo      = new THREE.BoxGeometry(0.32, 0.13, 0.002);
  // Paper bag head
  const bagBodyGeo   = new THREE.BoxGeometry(0.42, 0.48, 0.37);
  const bagEyeGeo    = new THREE.BoxGeometry(0.10, 0.056, 0.01);
  const shoulderGeo  = new THREE.CylinderGeometry(0.10, 0.13, 0.14, 8);
  const upperArmGeo  = new THREE.BoxGeometry(0.17, 0.34, 0.17);
  const forearmGeo   = new THREE.BoxGeometry(0.14, 0.28, 0.14);
  const handGeo      = new THREE.BoxGeometry(0.14, 0.12, 0.18);
  const thighGeo     = new THREE.BoxGeometry(0.22, 0.38, 0.22);
  const shinGeo      = new THREE.BoxGeometry(0.17, 0.34, 0.19);
  const bootGeo      = new THREE.BoxGeometry(0.20, 0.18, 0.30);
  const gunBarrelGeo   = new THREE.CylinderGeometry(0.028, 0.028, 0.44, 8);
  const gunBodyGeo     = new THREE.BoxGeometry(0.08, 0.10, 0.22);  // upper+lower receiver
  const stockGeo       = new THREE.BoxGeometry(0.06, 0.08, 0.16);
  const gunMagGeo      = new THREE.BoxGeometry(0.055, 0.14, 0.062);
  const handguardGeo   = new THREE.BoxGeometry(0.065, 0.038, 0.18);
  const gripGeo        = new THREE.BoxGeometry(0.042, 0.088, 0.046);

  // ── Materials ──
  // Jumpsuit: prison orange covering all body parts except hands and boots
  const jumpsuitMat  = new THREE.MeshPhongMaterial({ color: 0xE06820, map: fabricTex, shininess: 5 });
  const beltMat      = new THREE.MeshPhongMaterial({ color: 0x28180a, shininess: 12 });
  const skinMat      = new THREE.MeshPhongMaterial({ color: 0xffffff, map: skinTex, shininess: 12 });
  const bagMat       = new THREE.MeshPhongMaterial({ color: 0xC89040, map: _makeBagTex(), shininess: 4 });
  const bagEyeMat    = new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 5 });
  const bootMat      = new THREE.MeshPhongMaterial({ color: 0x18120a, shininess: 24 });
  const gunMat       = new THREE.MeshPhongMaterial({ color: 0x1e1e1e, shininess: 60, specular: new THREE.Color(0x444444) });
  const stockMat     = new THREE.MeshPhongMaterial({ color: 0x3d2812, shininess: 8 });
  const woodMat      = new THREE.MeshPhongMaterial({ color: 0x7a4a1a, shininess: 15 });
  const textMat      = new THREE.MeshPhongMaterial({ map: _makeICETex(), shininess: 2 });

  // ── InstancedMesh creation ──
  botTorsoInst      = new THREE.InstancedMesh(torsoGeo,     jumpsuitMat,  BOT_COUNT);
  botBeltInst       = new THREE.InstancedMesh(beltGeo,      beltMat,      BOT_COUNT);
  botTextFrontInst  = new THREE.InstancedMesh(textGeo,      textMat,      BOT_COUNT);
  botTextBackInst   = new THREE.InstancedMesh(textGeo,      textMat,      BOT_COUNT);
  botBagBodyInst     = new THREE.InstancedMesh(bagBodyGeo,    bagMat,        BOT_COUNT);
  botBagEyeLInst     = new THREE.InstancedMesh(bagEyeGeo,     bagEyeMat,     BOT_COUNT);
  botBagEyeRInst     = new THREE.InstancedMesh(bagEyeGeo,     bagEyeMat,     BOT_COUNT);
  botShoulderLInst  = new THREE.InstancedMesh(shoulderGeo,  jumpsuitMat,  BOT_COUNT);
  botShoulderRInst  = new THREE.InstancedMesh(shoulderGeo,  jumpsuitMat,  BOT_COUNT);
  botUpperArmLInst  = new THREE.InstancedMesh(upperArmGeo,  jumpsuitMat,  BOT_COUNT);
  botUpperArmRInst  = new THREE.InstancedMesh(upperArmGeo,  jumpsuitMat,  BOT_COUNT);
  botForearmLInst   = new THREE.InstancedMesh(forearmGeo,   jumpsuitMat,  BOT_COUNT);
  botForearmRInst   = new THREE.InstancedMesh(forearmGeo,   jumpsuitMat,  BOT_COUNT);
  botHandLInst      = new THREE.InstancedMesh(handGeo,      skinMat,      BOT_COUNT);
  botHandRInst      = new THREE.InstancedMesh(handGeo,      skinMat,      BOT_COUNT);
  botThighLInst     = new THREE.InstancedMesh(thighGeo,     jumpsuitMat,     BOT_COUNT);
  botThighRInst     = new THREE.InstancedMesh(thighGeo,     jumpsuitMat,     BOT_COUNT);
  botShinLInst      = new THREE.InstancedMesh(shinGeo,      jumpsuitMat,     BOT_COUNT);
  botShinRInst      = new THREE.InstancedMesh(shinGeo,      jumpsuitMat,     BOT_COUNT);
  botBootLInst      = new THREE.InstancedMesh(bootGeo,      bootMat,      BOT_COUNT);
  botBootRInst      = new THREE.InstancedMesh(bootGeo,      bootMat,      BOT_COUNT);
  botGunBarrelInst  = new THREE.InstancedMesh(gunBarrelGeo,  gunMat,   BOT_COUNT);
  botGunBodyInst    = new THREE.InstancedMesh(gunBodyGeo,    gunMat,   BOT_COUNT);
  botStockInst      = new THREE.InstancedMesh(stockGeo,      stockMat, BOT_COUNT);
  botGunMagInst     = new THREE.InstancedMesh(gunMagGeo,     gunMat,   BOT_COUNT);
  botHandguardInst  = new THREE.InstancedMesh(handguardGeo,  woodMat,  BOT_COUNT);
  botGripInst       = new THREE.InstancedMesh(gripGeo,       woodMat,  BOT_COUNT);

  botInstMeshes = [
    botTorsoInst, botBeltInst, botTextFrontInst, botTextBackInst,
    botBagBodyInst, botBagEyeLInst, botBagEyeRInst,
    botShoulderLInst, botShoulderRInst,
    botUpperArmLInst, botUpperArmRInst,
    botForearmLInst, botForearmRInst,
    botHandLInst, botHandRInst,
    botThighLInst, botThighRInst,
    botShinLInst, botShinRInst,
    botBootLInst, botBootRInst,
    botGunBarrelInst, botGunBodyInst, botStockInst, botGunMagInst, botHandguardInst, botGripInst,
  ];
  botHeadMeshes = [botBagBodyInst, botBagEyeLInst, botBagEyeRInst];

  // All colors are fixed — no per-instance color variation.

  // Park all instances underground until bots spawn
  const hiddenMat = new THREE.Matrix4().makeTranslation(0, -10000, 0);
  for (const inst of botInstMeshes) {
    inst.frustumCulled = false; // bounding sphere not meaningful for scattered instances
    for (let i = 0; i < BOT_COUNT; i++) inst.setMatrixAt(i, hiddenMat);
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
  }
}

initBotInstances();

// ── Write one part's world matrix into an InstancedMesh ──
// rootMat encodes the bot's world position + orientation.
// lRotX: local rotation around X (walk animation) — 0 means no rotation.
const _bEuler = new THREE.Euler();
const _bQ     = new THREE.Quaternion();
function _setBotPart(inst, i, rootMat, lx, ly, lz, lRotX, lRotZ) {
  if (lRotX || lRotZ) {
    _bEuler.set(lRotX || 0, 0, lRotZ || 0, 'XYZ');
    _bQ.setFromEuler(_bEuler);
    _bLocalMat.makeRotationFromQuaternion(_bQ);
    _bLocalMat.setPosition(lx, ly, lz);
  } else {
    _bLocalMat.makeTranslation(lx, ly, lz);
  }
  _bWorldMat.multiplyMatrices(rootMat, _bLocalMat);
  inst.setMatrixAt(i, _bWorldMat);
}

function updateBotMatrices() {
  const PI2 = Math.PI / 2;
  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i];
    if (bot.alive) {
      _bRootMat.makeRotationY(bot.yaw);
      _bRootMat.setPosition(bot.pos.x, bot.pos.y, bot.pos.z);
    } else {
      _bRootMat.makeRotationX(Math.PI / 2);
      _bRootMat.setPosition(bot.pos.x, bot.deadY, bot.pos.z);
    }
    const sw = bot.swing;
    // Shin z-offset approximates tracking the thigh bottom for natural stride
    const shinZ = -sw * 0.18;

    // ── Core body ──
    _setBotPart(botTorsoInst,      i, _bRootMat,  0,       1.27,   0,       0);
    _setBotPart(botBeltInst,       i, _bRootMat,  0,       0.95,   0,       0);
    _setBotPart(botTextFrontInst,  i, _bRootMat,  0,       1.42,   0.29,    0);
    _setBotPart(botTextBackInst,   i, _bRootMat,  0,       1.42,  -0.29,    0);

    // ── Roman Galea helmet (IS the head — no skin sphere or neck beneath it) ──
    // Dome r=0.31 sits at y=1.76; bottom at y=1.45 overlaps torso shoulders naturally
    // ── Paper bag head ──
    _setBotPart(botBagBodyInst,  i, _bRootMat,  0,       1.76,   0,      0);
    _setBotPart(botBagEyeLInst,  i, _bRootMat, -0.09,    1.82,   0.186,  0);
    _setBotPart(botBagEyeRInst,  i, _bRootMat,  0.09,    1.82,   0.186,  0);

    // ── Shoulders ──
    _setBotPart(botShoulderLInst,  i, _bRootMat, -0.30,    1.55,   0,       0);
    _setBotPart(botShoulderRInst,  i, _bRootMat,  0.30,    1.55,   0,       0);

    // ── Arms — two-handed rifle carry pose; right grips trigger, left reaches handguard
    // lRotX > 0 swings the hand forward (+Z). Small sw oscillation keeps walk natural.
    // Right arm — trigger grip side; hangs from shoulder, forearm swings forward
    _setBotPart(botUpperArmRInst,  i, _bRootMat,  0.41,    1.41,   0.04,    0.36 + sw * 0.06);
    _setBotPart(botForearmRInst,   i, _bRootMat,  0.38,    1.20,   0.13,    0.66 + sw * 0.04);
    _setBotPart(botHandRInst,      i, _bRootMat,  0.24,    1.05,   0.18 + sw * 0.04, 0);
    // Left arm — foregrip side; leans further forward to reach the handguard
    _setBotPart(botUpperArmLInst,  i, _bRootMat, -0.41,    1.41,   0.04,    0.60 - sw * 0.06);
    _setBotPart(botForearmLInst,   i, _bRootMat, -0.30,    1.23,   0.22,    0.98 - sw * 0.04);
    _setBotPart(botHandLInst,      i, _bRootMat,  0.04,    1.07,   0.34 - sw * 0.04, 0);

    // ── Legs ──
    _setBotPart(botThighLInst,     i, _bRootMat, -0.155,   0.73,   0,       sw);
    _setBotPart(botThighRInst,     i, _bRootMat,  0.155,   0.73,   0,      -sw);
    _setBotPart(botShinLInst,      i, _bRootMat, -0.155,   0.37,   shinZ,   sw * 0.35);
    _setBotPart(botShinRInst,      i, _bRootMat,  0.155,   0.37,  -shinZ,  -sw * 0.35);
    _setBotPart(botBootLInst,      i, _bRootMat, -0.155,   0.09,   0.04,    0);
    _setBotPart(botBootRInst,      i, _bRootMat,  0.155,   0.09,   0.04,    0);

    // ── Gun — AK-style; barrel forward, wood handguard + grip, angled mag ──
    _setBotPart(botGunBarrelInst,  i, _bRootMat,  0.06,    1.10,   0.40,    PI2);
    _setBotPart(botGunBodyInst,    i, _bRootMat,  0.10,    1.11,   0.14,    0);
    _setBotPart(botHandguardInst,  i, _bRootMat,  0.07,    1.09,   0.33,    0);
    _setBotPart(botGunMagInst,     i, _bRootMat,  0.10,    0.98,   0.16,    0.18);
    _setBotPart(botGripInst,       i, _bRootMat,  0.12,    1.01,   0.08,   -0.30);
    _setBotPart(botStockInst,      i, _bRootMat,  0.18,    1.12,  -0.04,    0);
  }
  for (const inst of botInstMeshes) inst.instanceMatrix.needsUpdate = true;
}

function createBot(x, z, name, index) {
  const h = getGroundHeight(x, z);
  const bot = {
    pos: new THREE.Vector3(x, h, z),
    yaw: 0,
    swing: 0,
    deadY: h + 0.3,
    name,
    hp: 100,
    alive: true,
    hasAmmo: false,
    moveDir: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
    moveTimer: 2 + Math.random() * 4,
    speed: 1.5 + Math.random() * 1.5,
    walkPhase: Math.random() * 6.28,
    shootCooldown: 0,
    shootAccuracy: 0.12 + Math.random() * 0.16,
    aggroRange: 30 + Math.random() * 20,
    ammoTimer: 30,  // arm after 30s then begin shooting
    exitDelay: 0,
    exitedPrison: false,
    velocityY: 0,
    isGrounded: true,
    canalJumpCount: 0,
    canalLandTimer: 0,
    waypoint: null,
    fleeTarget: null,
    snapshots: [],
    shotTimes: [],
  };
  bots.push(bot);
  return bot;
}

// Bots only spawn in Auto Join (bot match) mode — called from startBotMatch()
function spawnBots() {
  for (let i = 0; i < BOT_COUNT; i++) {
    const row = Math.floor(i / 5);
    const col = i % 5;
    const px = CONFIG.prisonPos.x - CONFIG.prisonSize / 2 + 5 + col * ((CONFIG.prisonSize - 10) / 4);
    const pz = CONFIG.prisonPos.z - CONFIG.prisonSize / 2 + 5 + row * ((CONFIG.prisonSize - 10) / 3);
    const bot = createBot(px, pz, BOT_NAMES[i] || 'Bot', i);
    bot.exitDelay = i * 0.4;
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
      bot.speed = 4.5;
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

    // Arm timer
    if (!bot.hasAmmo) {
      bot.ammoTimer -= dt;
      for (const d of depotCorners) {
        if (Math.sqrt((bx - d.x) ** 2 + (bz - d.z) ** 2) < 14) { bot.ammoTimer = 0; break; }
      }
      if (bot.ammoTimer <= 0) bot.hasAmmo = true;
    }

    // ── TOP PRIORITY: engage player if in range ──
    const engaging = bot.hasAmmo && distToPlayer < bot.aggroRange && !state.playerDead;
    if (engaging) {
      bot.yaw = Math.atan2(dx, dz);
      const botEye = new THREE.Vector3(bx, bot.pos.y + 1.7, bz);
      const toPlayer = new THREE.Vector3(dx, camera.position.y - botEye.y, dz).normalize();
      const losRay = new THREE.Raycaster(botEye, toPlayer, 0, distToPlayer);
      const losHits = losRay.intersectObjects(collidables, false);
      let volcanoBlocking = false;
      const stepSize = distToPlayer / 20;
      for (let s = 1; s < 20; s++) {
        const t = s * stepSize;
        const volH = getVolcanoHeight(botEye.x + toPlayer.x * t, botEye.z + toPlayer.z * t);
        if (volH > 0.8 && botEye.y + toPlayer.y * t < volH - 0.1) { volcanoBlocking = true; break; }
      }
      bot.shootCooldown -= dt;
      if (bot.shootCooldown <= 0 && losHits.length === 0 && !volcanoBlocking) {
        bot.shootCooldown = 0.8 + Math.random() * 1.5;
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
      bot.speed = 5;
      bot.yaw = Math.atan2(bot.moveDir.x, bot.moveDir.z);
    } else {
      if (!bot.waypoint || Math.sqrt((bx - bot.waypoint.x) ** 2 + (bz - bot.waypoint.z) ** 2) < 6) {
        const angle = Math.random() * Math.PI * 2;
        const r = 40 + Math.random() * 75;
        bot.waypoint = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
      }
      bot.moveDir.set(bot.waypoint.x - bx, 0, bot.waypoint.z - bz).normalize();
      bot.speed = engaging ? 2.0 : 3.0;
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

    // Force directly inward when approaching or inside canal zone so bot crosses perpendicular
    if (inCanalZone || approachingCanal) {
      bot.moveDir.set(-bx, 0, -bz).normalize();
      newX = bx + bot.moveDir.x * bot.speed * dt;
      newZ = bz + bot.moveDir.z * bot.speed * dt;
    }

    // Jump on canal entry from outside
    if (approachingCanal && bot.isGrounded) {
      bot.velocityY = 10; bot.isGrounded = false; bot.canalJumpCount = 1; bot.canalLandTimer = 0;
    }
    // Bounce-jump: wait 0.1s after landing before next jump so bot travels a bit further
    if (bot.canalJumpCount >= 1 && bot.canalJumpCount < 8 && inCanalZone) {
      if (!bot.isGrounded) {
        bot.canalLandTimer = 0.1;
      } else if (bot.canalLandTimer > 0) {
        bot.canalLandTimer -= dt;
      } else {
        bot.velocityY = 10; bot.isGrounded = false; bot.canalJumpCount++;
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

  updateBotMatrices();
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
    bot.deadY = getGroundHeight(bot.pos.x, bot.pos.z) + 0.3;
  }
}

function findBotByInstance(instMesh, instanceId) {
  if (!botInstMeshes.includes(instMesh)) return null;
  const bot = bots[instanceId];
  return (bot && bot.alive) ? bot : null;
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
