// BOTS — AI with shooting, prison spawn, ammo seeking
// Rendering: 13 InstancedMesh objects (one per body part) = 13 draw calls for all 20 bots
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
let botBodyInst, botBeltInst, botNeckInst, botHeadInst, botHelmetInst;
let botLegLInst, botLegRInst, botBootLInst, botBootRInst;
let botArmLInst, botArmRInst, botGunInst, botStockInst;
let botInstMeshes = [];  // all 13 — used in raycast
let botHeadMeshes = [];  // head + helmet — headshot detection

// Reusable matrices — avoids per-frame heap allocation
const _bRootMat  = new THREE.Matrix4();
const _bLocalMat = new THREE.Matrix4();
const _bWorldMat = new THREE.Matrix4();

function initBotInstances() {
  const bodyGeo    = new THREE.BoxGeometry(0.7, 0.8, 0.4);
  const beltGeo    = new THREE.BoxGeometry(0.62, 0.12, 0.38);
  const neckGeo    = new THREE.BoxGeometry(0.16, 0.1, 0.16);
  const headGeo    = new THREE.SphereGeometry(0.24, 8, 6);
  const helmetGeo  = new THREE.CylinderGeometry(0.22, 0.25, 0.16, 8);
  const legGeo     = new THREE.BoxGeometry(0.2, 0.55, 0.22);
  const bootGeo    = new THREE.BoxGeometry(0.2, 0.18, 0.28);
  const armGeo     = new THREE.BoxGeometry(0.18, 0.7, 0.2);
  const gunGeo     = new THREE.BoxGeometry(0.06, 0.06, 0.5);
  const stockGeo   = new THREE.BoxGeometry(0.05, 0.05, 0.14);

  // Body/arm use white so setColorAt produces the exact per-bot color
  const bodyMat   = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const beltMat   = new THREE.MeshLambertMaterial({ color: 0x3a3020 });
  const skinMat   = new THREE.MeshLambertMaterial({ color: 0xD2B48C });
  const helmetMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const legMat    = new THREE.MeshLambertMaterial({ color: 0xBB6622 });
  const bootMat   = new THREE.MeshLambertMaterial({ color: 0x2a2218 });
  const gunMat    = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const stockMat  = new THREE.MeshLambertMaterial({ color: 0x3d2812 });

  botBodyInst   = new THREE.InstancedMesh(bodyGeo,   bodyMat,   BOT_COUNT);
  botBeltInst   = new THREE.InstancedMesh(beltGeo,   beltMat,   BOT_COUNT);
  botNeckInst   = new THREE.InstancedMesh(neckGeo,   skinMat,   BOT_COUNT);
  botHeadInst   = new THREE.InstancedMesh(headGeo,   skinMat,   BOT_COUNT);
  botHelmetInst = new THREE.InstancedMesh(helmetGeo, helmetMat, BOT_COUNT);
  botLegLInst   = new THREE.InstancedMesh(legGeo,    legMat,    BOT_COUNT);
  botLegRInst   = new THREE.InstancedMesh(legGeo,    legMat,    BOT_COUNT);
  botBootLInst  = new THREE.InstancedMesh(bootGeo,   bootMat,   BOT_COUNT);
  botBootRInst  = new THREE.InstancedMesh(bootGeo,   bootMat,   BOT_COUNT);
  botArmLInst   = new THREE.InstancedMesh(armGeo,    bodyMat,   BOT_COUNT);
  botArmRInst   = new THREE.InstancedMesh(armGeo,    bodyMat,   BOT_COUNT);
  botGunInst    = new THREE.InstancedMesh(gunGeo,    gunMat,    BOT_COUNT);
  botStockInst  = new THREE.InstancedMesh(stockGeo,  stockMat,  BOT_COUNT);

  botInstMeshes = [
    botBodyInst, botBeltInst, botNeckInst, botHeadInst, botHelmetInst,
    botLegLInst, botLegRInst, botBootLInst, botBootRInst,
    botArmLInst, botArmRInst, botGunInst, botStockInst,
  ];
  botHeadMeshes = [botHeadInst, botHelmetInst];

  // Pre-initialize instanceColor on body/arm meshes so the shader compiles with
  // USE_INSTANCING_COLOR from the start — without this, setColorAt() called later
  // has no effect because the shader was already compiled without color instancing.
  const _white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < BOT_COUNT; i++) {
    botBodyInst.setColorAt(i, _white);
    botArmLInst.setColorAt(i, _white);
    botArmRInst.setColorAt(i, _white);
    botHelmetInst.setColorAt(i, _white);
  }
  botBodyInst.instanceColor.needsUpdate = true;
  botArmLInst.instanceColor.needsUpdate = true;
  botArmRInst.instanceColor.needsUpdate = true;
  botHelmetInst.instanceColor.needsUpdate = true;

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
function _setBotPart(inst, i, rootMat, lx, ly, lz, lRotX) {
  if (lRotX) {
    _bLocalMat.makeRotationX(lRotX);
    _bLocalMat.setPosition(lx, ly, lz);
  } else {
    _bLocalMat.makeTranslation(lx, ly, lz);
  }
  _bWorldMat.multiplyMatrices(rootMat, _bLocalMat);
  inst.setMatrixAt(i, _bWorldMat);
}

function updateBotMatrices() {
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
    _setBotPart(botBodyInst,   i, _bRootMat,  0,      1.30,  0,     0        );
    _setBotPart(botBeltInst,   i, _bRootMat,  0,      0.88,  0,     0        );
    _setBotPart(botNeckInst,   i, _bRootMat,  0,      1.72,  0,     0        );
    _setBotPart(botHeadInst,   i, _bRootMat,  0,      1.90,  0,     0        );
    _setBotPart(botHelmetInst, i, _bRootMat,  0,      2.06,  0,     0        );
    _setBotPart(botLegLInst,   i, _bRootMat, -0.15,   0.50,  0,     sw       );
    _setBotPart(botLegRInst,   i, _bRootMat,  0.15,   0.50,  0,    -sw       );
    _setBotPart(botBootLInst,  i, _bRootMat, -0.15,   0.09,  0.02,  0        );
    _setBotPart(botBootRInst,  i, _bRootMat,  0.15,   0.09,  0.02,  0        );
    _setBotPart(botArmLInst,   i, _bRootMat, -0.45,   1.15,  0,    -sw * 0.6 );
    _setBotPart(botArmRInst,   i, _bRootMat,  0.45,   1.15,  0,     sw * 0.6 );
    _setBotPart(botGunInst,    i, _bRootMat,  0.45,   1.10,  0.30,  0        );
    _setBotPart(botStockInst,  i, _bRootMat,  0.45,   1.10,  0.02,  0        );
  }
  for (const inst of botInstMeshes) inst.instanceMatrix.needsUpdate = true;
}

function createBot(x, z, name, index) {
  const h = getGroundHeight(x, z);
  const shirtCol = new THREE.Color(BOT_SHIRT_COLORS[index % BOT_SHIRT_COLORS.length]);
  botBodyInst.setColorAt(index, shirtCol);
  botArmLInst.setColorAt(index, shirtCol);
  botArmRInst.setColorAt(index, shirtCol);
  botBodyInst.instanceColor.needsUpdate = true;
  botArmLInst.instanceColor.needsUpdate = true;
  botArmRInst.instanceColor.needsUpdate = true;
  const helmetCol = new THREE.Color(BOT_HELMET_COLORS[index % BOT_HELMET_COLORS.length]);
  botHelmetInst.setColorAt(index, helmetCol);
  botHelmetInst.instanceColor.needsUpdate = true;

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
    ammoTimer: 0,
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
