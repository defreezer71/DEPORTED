// BOTS — AI with shooting, prison spawn, ammo seeking
// ═══════════════════════════════════════════════════════════
const BOT_NAMES = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Golf','Hotel','India','Juliet',
  'Kilo','Lima','Mike','November','Oscar','Papa','Quebec','Romeo','Sierra','Tango'];

function createBot(x, z, name) {
  const h = getTerrainHeight(x, z);
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
    shootAccuracy: 0.12 + Math.random() * 0.16, // 20% better (was 0.15+0.20)
    aggroRange: 30 + Math.random() * 20,
    exitDelay: 0,
    exitedPrison: false,
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
      const th = getTerrainHeight(bot.group.position.x, bot.group.position.z);
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

    // Flee rising water — head uphill toward volcano
    if (state.waterRising && state.waterLevel > getTerrainHeight(bx, bz) - 1) {
      bot.moveDir.set(-bx, 0, -bz).normalize(); // Move toward center (volcano)
      bot.speed = 3;
    }
    // If has ammo and player is in range — engage (with LOS check)
    else if (bot.hasAmmo && distToPlayer < bot.aggroRange && !state.playerDead) {
      // Line of sight check — can bot see player?
      const botEye = new THREE.Vector3(bx, bot.group.position.y + 1.7, bz);
      const toPlayer = new THREE.Vector3(dx, camera.position.y - botEye.y, dz).normalize();
      const losRay = new THREE.Raycaster(botEye, toPlayer, 0, distToPlayer);
      const losHits = losRay.intersectObjects(collidables, false); // raycaster handles its own BB

      // Also check if shot path passes through volcano terrain
      let volcanoBlocking = false;
      {
        const steps = 20;
        const stepSize = distToPlayer / steps;
        for (let s = 1; s < steps; s++) {
          const t = s * stepSize;
          const px = botEye.x + toPlayer.x * t;
          const py = botEye.y + toPlayer.y * t;
          const pz = botEye.z + toPlayer.z * t;
          const volH = getVolcanoHeight(px, pz);
          if (volH > 0.8 && py < volH - 0.1) { volcanoBlocking = true; break; }
        }
      }

      const hasLOS = losHits.length === 0 && !volcanoBlocking;

      // Face player
      bot.group.rotation.y = Math.atan2(dx, dz);

      // Strafe slightly while shooting
      const strafeDir = new THREE.Vector3(-dz, 0, dx).normalize();
      bot.moveDir.copy(strafeDir).multiplyScalar(Math.sin(bot.walkPhase) > 0 ? 1 : -1);
      bot.speed = 1.5;

      // Shoot at player (only if LOS clear)
      bot.shootCooldown -= dt;
      if (bot.shootCooldown <= 0 && hasLOS) {
        bot.shootCooldown = 0.8 + Math.random() * 1.5; // Fire every 0.8-2.3 seconds
        // Accuracy check — distance affects accuracy
        const hitChance = Math.max(0.08, 0.48 - distToPlayer * 0.005 - bot.shootAccuracy); // 20% better
        if (Math.random() < hitChance) {
          // Hit player
          const dmg = 8 + Math.floor(Math.random() * 7); // 8-14 damage
          if (state.armor > 0) {
            state.armor = Math.max(0, state.armor - dmg);
          } else {
            state.hp = Math.max(0, state.hp - dmg);
          }
          updateHUD();
          // Flash red vignette
          const dv = document.getElementById('damage-vignette');
          dv.classList.add('show');
          setTimeout(() => dv.classList.remove('show'), 350);
          SFX.hitmarker();
        }
        // Bot gunshot sound (quieter, distant)
        playNoise(0.06, 0.08 * Math.max(0.2, 1 - distToPlayer / 80), 3000, 'bandpass');
      }
    }
    // No ammo — seek loot
    else if (!bot.hasAmmo) {
      let nearestLoot = null, nearestDist = Infinity;
      for (const loot of lootItems) {
        if (loot.userData.lootType !== 'ammo_m4' && loot.userData.lootType !== 'ammo_pistol') continue;
        const ld = Math.sqrt((bx - loot.position.x) ** 2 + (bz - loot.position.z) ** 2);
        if (ld < nearestDist) { nearestDist = ld; nearestLoot = loot; }
      }
      if (nearestLoot && nearestDist > 2) {
        bot.moveDir.set(nearestLoot.position.x - bx, 0, nearestLoot.position.z - bz).normalize();
        bot.speed = 2.5;
      } else if (nearestLoot && nearestDist <= 2) {
        // Pick up ammo
        bot.hasAmmo = true;
        scene.remove(nearestLoot); nearestLoot.geometry.dispose(); nearestLoot.material.dispose();
        const idx = lootItems.indexOf(nearestLoot);
        if (idx >= 0) lootItems.splice(idx, 1);
      } else {
        // Wander randomly
        bot.moveTimer -= dt;
        if (bot.moveTimer <= 0) {
          bot.moveDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
          bot.moveTimer = 2 + Math.random() * 5;
        }
        bot.speed = 2;
      }
    }
    // Has ammo but player out of range — wander
    else {
      bot.moveTimer -= dt;
      if (bot.moveTimer <= 0) {
        bot.moveDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
        bot.moveTimer = 2 + Math.random() * 5;
        bot.speed = 1.5 + Math.random() * 1.5;
      }
    }

    const newX = bx + bot.moveDir.x * bot.speed * dt;
    const newZ = bz + bot.moveDir.z * bot.speed * dt;

    let canMove = true;
    if (Math.abs(newX) >= half - 12 || Math.abs(newZ) >= half - 12) canMove = false;
    if (canMove && getVolcanoHeight(newX, newZ) > 18) canMove = false;
    if (canMove && checkBotCollision(newX, newZ, bot)) canMove = false;

    if (canMove) {
      bot.group.position.x = newX;
      bot.group.position.z = newZ;
    } else {
      bot.moveDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      bot.moveTimer = 1 + Math.random() * 2;
    }

    const th = getTerrainHeight(bot.group.position.x, bot.group.position.z);
    bot.group.position.y += (th - bot.group.position.y) * Math.min(1, dt * 18);
    if (!bot.hasAmmo || distToPlayer >= bot.aggroRange || state.playerDead) {
      bot.group.rotation.y = Math.atan2(bot.moveDir.x, bot.moveDir.z);
    }

    bot.walkPhase += dt * bot.speed * 3;
    const swing = Math.sin(bot.walkPhase) * 0.4;
    if (bot.parts.legs[0]) bot.parts.legs[0].rotation.x = swing;
    if (bot.parts.legs[1]) bot.parts.legs[1].rotation.x = -swing;
    if (bot.parts.arms[0]) bot.parts.arms[0].rotation.x = -swing * 0.6;
    if (bot.parts.arms[1]) bot.parts.arms[1].rotation.x = swing * 0.6;
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
    bot.group.position.y = getTerrainHeight(bot.group.position.x, bot.group.position.z) + 0.3;

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
