// BOTS — AI with shooting, prison spawn, ammo seeking
// ═══════════════════════════════════════════════════════════
const BOT_NAMES = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Golf','Hotel','India','Juliet',
  'Kilo','Lima','Mike','November','Oscar','Papa','Quebec','Romeo','Sierra','Tango'];

function createBot(x, z, name) {
  const h = getGroundHeight(x, z);
  const group = new THREE.Group();
  group.position.set(x, h, z);

  const bodyColor = [0xCC6622, 0xBB5511, 0xDD7733, 0xC05A18][Math.floor(Math.random() * 4)];
  const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xD2B48C });

  // Torso (slightly shorter to make room for belt)
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.4), bodyMat);
  body.position.y = 1.3; body.castShadow = true; group.add(body);

  // Belt
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.38), new THREE.MeshLambertMaterial({ color: 0x3a3020 }));
  belt.position.y = 0.88; group.add(belt);

  // Neck
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.16), skinMat);
  neck.position.y = 1.72; group.add(neck);

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), skinMat);
  head.position.y = 1.9; head.castShadow = true;
  head.userData.isHead = true; group.add(head);

  // Helmet
  const helmet = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.16, 8), new THREE.MeshLambertMaterial({ color: 0x555555 }));
  helmet.position.y = 2.06; helmet.userData.isHead = true; group.add(helmet);

  // Legs with boots (combined into 2 pieces per leg)
  for (const s of [-0.15, 0.15]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.22), new THREE.MeshLambertMaterial({ color: 0xBB6622 }));
    leg.position.set(s, 0.5, 0); leg.castShadow = true; group.add(leg);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.28), new THREE.MeshLambertMaterial({ color: 0x2a2218 }));
    boot.position.set(s, 0.09, 0.02); group.add(boot);
  }

  // Arms
  for (const s of [-0.45, 0.45]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.2), bodyMat);
    arm.position.set(s, 1.15, 0); arm.castShadow = true; group.add(arm);
  }

  // Weapon with stock
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.5), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
  gun.position.set(0.45, 1.1, -0.3); group.add(gun);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.14), new THREE.MeshLambertMaterial({ color: 0x3d2812 }));
  stock.position.set(0.45, 1.1, -0.02); group.add(stock);

  scene.add(group);
  group.children.forEach(c => targets.push(c));

  const bot = {
    group, name,
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
    waypoint: null,
    fleeTarget: null,
    snapshots: [],  // position history for kill-cam
    parts: { body, head, legs: group.children.filter((_, i) => i >= 3 && i <= 4), arms: group.children.filter((_, i) => i >= 5) },
  };
  bots.push(bot);
  return bot;
}

// Bots only spawn in Auto Join (bot match) mode — called from startBotMatch()
function spawnBots() {
  for (let i = 0; i < 20; i++) {
    const row = Math.floor(i / 5);
    const col = i % 5;
    const px = CONFIG.prisonPos.x - CONFIG.prisonSize / 2 + 5 + col * ((CONFIG.prisonSize - 10) / 4);
    const pz = CONFIG.prisonPos.z - CONFIG.prisonSize / 2 + 5 + row * ((CONFIG.prisonSize - 10) / 3);
    const bot = createBot(px, pz, BOT_NAMES[i] || 'Bot');
    bot.exitDelay = i * 0.4;
  }
}

function updateBots(dt) {
  for (const bot of bots) {
    if (!bot.alive) continue;

    // Phase check — don't move during lobby/countdown
    if (state.phase === 'lobby' || state.phase === 'countdown') continue;

    const bx = bot.group.position.x, bz = bot.group.position.z;

    // Check if bot is still inside prison
    const inPrison = Math.abs(bx - prison.x) < pw / 2 && Math.abs(bz - prison.z) < pw / 2;

    // If in prison or near gate, head for exit
    if (inPrison || (Math.abs(bx - (prison.x + pw/2)) < 8 && Math.abs(bz - prison.z) < pw/2 && bot.exitDelay <= 0 && !bot.exitedPrison)) {
      bot.exitDelay -= dt;
      if (bot.exitDelay > 0) {
        bot.walkPhase += dt * 1;
        const swing = Math.sin(bot.walkPhase) * 0.1;
        if (bot.parts.legs[0]) bot.parts.legs[0].rotation.x = swing;
        if (bot.parts.legs[1]) bot.parts.legs[1].rotation.x = -swing;
        continue;
      }
      // Target: gate center first (prison.z), then once past the wall, mark as exited
      const wallX = prison.x + pw / 2;
      if (bx < wallX + 3) {
        // Still inside or at the gate — aim straight through center
        bot.moveDir.set(1, 0, (prison.z - bz) * 0.3).normalize();
      } else {
        // Past the wall — scatter outward
        bot.exitedPrison = true;
      }
      bot.speed = 4.5;
      const newX = bx + bot.moveDir.x * bot.speed * dt;
      const newZ = bz + bot.moveDir.z * bot.speed * dt;
      bot.group.position.x = newX;
      bot.group.position.z = newZ;
      const th = getGroundHeight(bot.group.position.x, bot.group.position.z);
      bot.group.position.y += (th - bot.group.position.y) * Math.min(1, dt * 18);
      bot.group.rotation.y = Math.atan2(bot.moveDir.x, bot.moveDir.z);
      bot.walkPhase += dt * bot.speed * 3;
      const swing = Math.sin(bot.walkPhase) * 0.4;
      if (bot.parts.legs[0]) bot.parts.legs[0].rotation.x = swing;
      if (bot.parts.legs[1]) bot.parts.legs[1].rotation.x = -swing;
      if (bot.parts.arms[0]) bot.parts.arms[0].rotation.x = -swing * 0.6;
      if (bot.parts.arms[1]) bot.parts.arms[1].rotation.x = swing * 0.6;
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
      bot.group.rotation.y = Math.atan2(dx, dz);
      const botEye = new THREE.Vector3(bx, bot.group.position.y + 1.7, bz);
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
        const hitChance = Math.max(0.08, 0.48 - distToPlayer * 0.005 - bot.shootAccuracy);
        if (Math.random() < hitChance) {
          const dmg = 8 + Math.floor(Math.random() * 7);
          const prevHp = state.hp;
          if (state.armor > 0) { state.armor = Math.max(0, state.armor - dmg); }
          else { state.hp = Math.max(0, state.hp - dmg); }
          if (prevHp > 0 && state.hp <= 0) {
            state.killCamBotIndex = bots.indexOf(bot);
            state.killCamShooterId = null;
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
      // Each bot gets a unique slice of the volcano slope (by index)
      if (!bot.fleeTarget) {
        const botIdx = bots.indexOf(bot);
        const angle = (botIdx / bots.length) * Math.PI * 2;
        const r = 15 + (botIdx % 5) * 5; // 15-35, 5 distinct rings
        bot.fleeTarget = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
      }
      const arrived = Math.sqrt((bx - bot.fleeTarget.x) ** 2 + (bz - bot.fleeTarget.z) ** 2) < 4;
      if (arrived) {
        // Orbit around volcano at current radius once arrived
        const curAngle = Math.atan2(bz, bx);
        const orbitR = Math.sqrt(bx * bx + bz * bz) || 20;
        const nextAngle = curAngle + 0.4;
        bot.fleeTarget = { x: Math.cos(nextAngle) * orbitR, z: Math.sin(nextAngle) * orbitR };
      }
      bot.moveDir.set(bot.fleeTarget.x - bx, 0, bot.fleeTarget.z - bz).normalize();
      bot.speed = 5;
      bot.group.rotation.y = Math.atan2(bot.moveDir.x, bot.moveDir.z);
    } else {
      // Normal wander — always have a waypoint, never stall
      if (!bot.waypoint || Math.sqrt((bx - bot.waypoint.x) ** 2 + (bz - bot.waypoint.z) ** 2) < 6) {
        const angle = Math.random() * Math.PI * 2;
        const r = 40 + Math.random() * 75;
        bot.waypoint = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
      }
      bot.moveDir.set(bot.waypoint.x - bx, 0, bot.waypoint.z - bz).normalize();
      bot.speed = engaging ? 2.0 : 3.0;
      if (!engaging) bot.group.rotation.y = Math.atan2(bot.moveDir.x, bot.moveDir.z);
    }

    const newX = bx + bot.moveDir.x * bot.speed * dt;
    const newZ = bz + bot.moveDir.z * bot.speed * dt;

    const atBoundary = Math.abs(newX) >= half - 12 || Math.abs(newZ) >= half - 12;
    const atVolcano = getVolcanoHeight(newX, newZ) > (state.waterRising ? 40 : 18);

    // Detect canal wall crossing geometrically (square canal at r≈85)
    const CANAL_INNER = 83.5, CANAL_OUTER = 86.5;
    const maxNow = Math.max(Math.abs(bx), Math.abs(bz));
    const maxNext = Math.max(Math.abs(newX), Math.abs(newZ));
    if ((maxNow < CANAL_INNER && maxNext >= CANAL_INNER) ||
        (maxNow > CANAL_OUTER && maxNext <= CANAL_OUTER)) {
      if (bot.isGrounded) { bot.velocityY = 9; bot.isGrounded = false; }
    }

    if (!atBoundary && !atVolcano) {
      bot.group.position.x = newX;
      bot.group.position.z = newZ;
    } else {
      // Blocked — immediately pick a new waypoint so bot never stalls
      const angle = Math.random() * Math.PI * 2;
      const r = 30 + Math.random() * 50;
      bot.waypoint = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
      bot.fleeTarget = null;
    }

    // Jump physics — gravity each frame
    bot.velocityY -= 22 * dt;
    bot.group.position.y += bot.velocityY * dt;
    const th = getGroundHeight(bot.group.position.x, bot.group.position.z);
    if (bot.group.position.y <= th) {
      bot.group.position.y = th;
      bot.velocityY = 0;
      bot.isGrounded = true;
    }

    bot.walkPhase += dt * bot.speed * 3;
    const swing = Math.sin(bot.walkPhase) * 0.4;
    if (bot.parts.legs[0]) bot.parts.legs[0].rotation.x = swing;
    if (bot.parts.legs[1]) bot.parts.legs[1].rotation.x = -swing;
    if (bot.parts.arms[0]) bot.parts.arms[0].rotation.x = -swing * 0.6;
    if (bot.parts.arms[1]) bot.parts.arms[1].rotation.x = swing * 0.6;

    // Record position snapshot for kill-cam (20Hz, keep last 4s)
    const snapNow = Date.now();
    const lastSnap = bot.snapshots[bot.snapshots.length - 1];
    if (!lastSnap || snapNow - lastSnap.t >= 50) {
      bot.snapshots.push({ t: snapNow, x: bot.group.position.x, y: bot.group.position.y, z: bot.group.position.z, yaw: bot.group.rotation.y });
      const snapCutoff = snapNow - 4000;
      while (bot.snapshots.length > 2 && bot.snapshots[0].t < snapCutoff) bot.snapshots.shift();
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

    // Death: tip over
    bot.group.rotation.x = Math.PI / 2;
    bot.group.position.y = getGroundHeight(bot.group.position.x, bot.group.position.z) + 0.3;

    // Remove from targets after brief delay
    setTimeout(() => {
      bot.group.children.forEach(c => {
        const idx = targets.indexOf(c);
        if (idx >= 0) targets.splice(idx, 1);
      });
    }, 200);


  }
}

function findBotByPart(mesh) {
  for (const bot of bots) {
    if (!bot.alive) continue;
    if (bot.group.children.includes(mesh)) return bot;
  }
  return null;
}

// Kill feed
const killFeedEntries = [];
function addKillFeedEntry(botName, isHead) {
  const el = document.getElementById('kill-feed');
  killFeedEntries.push({ name: botName, head: isHead, time: Date.now() });
  // Keep last 5
  if (killFeedEntries.length > 5) killFeedEntries.shift();
  el.innerHTML = killFeedEntries.map(e =>
    `<div class="entry">You ${e.head ? '⊕' : '→'} ${e.name}${e.head ? ' (headshot)' : ''}</div>`
  ).join('');
  // Auto-clear old entries
  setTimeout(() => {
    const idx = killFeedEntries.length > 0 ? killFeedEntries.findIndex(e => e.time === killFeedEntries[0].time) : -1;
    if (idx >= 0) killFeedEntries.splice(idx, 1);
    el.innerHTML = killFeedEntries.map(e =>
      `<div class="entry">You ${e.head ? '⊕' : '→'} ${e.name}</div>`
    ).join('');
  }, 5000);
}

// ═══════════════════════════════════════════════════════════
