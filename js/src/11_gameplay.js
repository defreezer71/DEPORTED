// SHOOTING — First shot accurate, spread accumulates with rapid fire
// ═══════════════════════════════════════════════════════════
const raycaster = new THREE.Raycaster();
let hitmarkerTimeout = null, muzzleTimeout = null, crosshairResetTimeout = null;
let spreadAccum = 0;        // Accumulated spread from rapid fire
let lastShotTime = 0;

function shoot() {
  if (!state.canFire || state.reloading || state.playerDead || state.phase !== 'playing') return;
  const wep = CONFIG.weapons[state.currentWeapon];
  if (state.ammo[state.currentWeapon] <= 0) {
    SFX.empty_click();
    reload();
    return;
  }

  state.ammo[state.currentWeapon]--;
  state.canFire = false;

  const isM4 = state.currentWeapon === 'm4';

  // Gunshot sound
  if (isM4) { SFX.gunshot_m4(); showMuzzleFlash(); }
  else SFX.gunshot_pistol();

  // Spread accumulation: resets if enough time has passed since last shot
  const now = performance.now();
  const timeSinceLast = now - lastShotTime;
  if (timeSinceLast > 400) {
    spreadAccum = 0; // Reset — this shot is a "first shot", perfectly accurate if ADS
  } else {
    spreadAccum = Math.min(spreadAccum + 0.008, 0.04); // Build up spread
  }
  lastShotTime = now;

  // Spread: base weapon spread + accumulated rapid-fire spread — captured BEFORE recoil
  const baseSpread = state.ads ? wep.adsSpread : wep.spread;
  const totalSpread = baseSpread + spreadAccum;
  const dir = new THREE.Vector3(
    (Math.random() - 0.5) * totalSpread,
    (Math.random() - 0.5) * totalSpread,
    -1
  ).normalize();
  dir.applyQuaternion(camera.quaternion); // Use pre-recoil direction
  const shotOrigin = camera.position.clone();

  // Recoil (camera kick) — applied AFTER capturing shot direction
  const recoil = state.ads ? wep.recoilAds : wep.recoilHip;
  state.pitch += recoil * (0.7 + Math.random() * 0.3);
  state.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, state.pitch));
  state.yaw += (Math.random() - 0.5) * recoil * 0.3;

  weaponGroup.position.z += 0.06;
  weaponGroup.rotation.x -= 0.08;

  // Project barrel tip to screen coords for muzzle flash — M4 only
  if (isM4) {
    const localTip = new THREE.Vector3(0.03, -0.01, -0.925);
    const worldTip = localTip.clone().applyMatrix4(weaponGroup.matrixWorld);
    const ndc = worldTip.clone().project(camera);
    const sx = ( ndc.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-ndc.y * 0.5 + 0.5) * window.innerHeight;
    muzzleFlash.style.left = sx + 'px';
    muzzleFlash.style.top  = sy + 'px';
    muzzleFlash.style.transform = `translate(-50%,-50%) rotate(${Math.random()*360}deg)`;
    muzzleFlash.classList.add('flash');
    clearTimeout(muzzleTimeout);
    muzzleTimeout = setTimeout(() => muzzleFlash.classList.remove('flash'), 55);
  }

  crosshair.classList.add('fired');
  clearTimeout(crosshairResetTimeout);
  crosshairResetTimeout = setTimeout(() => crosshair.classList.remove('fired'), 150);

  raycaster.set(shotOrigin, dir);
  raycaster.far = wep.range || 500;

  const intersects = raycaster.intersectObjects(targets, false);

  // Volcano terrain LOS — sample along ray; if ray dips below volcano surface it's blocked
  function shotBlockedByVolcano(origin, direction, maxDist) {
    const steps = 80;
    // Always check full volcano diameter, not just to target — catches bots behind volcano
    const checkDist = Math.max(maxDist, CONFIG.volcanoRadius * 2.2);
    const stepSize = checkDist / steps;
    for (let s = 1; s <= steps; s++) {
      const t = s * stepSize;
      const px = origin.x + direction.x * t;
      const py = origin.y + direction.y * t;
      const pz = origin.z + direction.z * t;
      const volH = getVolcanoHeight(px, pz);
      // Tight tolerance: block if ray travels through any part of volcano body
      if (volH > 0.8 && py < volH - 0.1) return t;
    }
    return null;
  }

  const targetDist = intersects.length > 0 ? intersects[0].distance : (wep.range || 500);
  // Check full range so volcano behind player origin is still caught
  const blockDist = shotBlockedByVolcano(shotOrigin, dir, Math.max(targetDist, CONFIG.volcanoRadius * 2.2));

  if (intersects.length > 0) {
    const hit = intersects[0];
    if (blockDist !== null && blockDist < hit.distance) {
      // Shot stopped by volcano terrain
      spawnImpact(
        new THREE.Vector3(shotOrigin.x + dir.x * blockDist, shotOrigin.y + dir.y * blockDist, shotOrigin.z + dir.z * blockDist),
        new THREE.Vector3(0, 1, 0)
      );
    } else {
      const isHead = hit.object.userData.isHead;
      const dmg = isHead ? wep.headDmg : wep.bodyDmg;

      spawnImpact(hit.point, hit.face ? hit.face.normal : new THREE.Vector3(0, 1, 0));

      const bot = findBotByPart(hit.object);
      if (bot) {
        hitmarker.classList.add('show');
        hitmarker.style.filter = isHead ? 'hue-rotate(200deg) brightness(2)' : 'none';
        clearTimeout(hitmarkerTimeout);
        hitmarkerTimeout = setTimeout(() => hitmarker.classList.remove('show'), 120);

        if (isHead) SFX.headshot();
        else SFX.hitmarker();

        const wasAlive = bot.alive;
        damageBot(bot, dmg, isHead);
        if (wasAlive && !bot.alive) SFX.kill_chaching();
      }
    }
  }

  updateHUD();
  setTimeout(() => { state.canFire = true; }, wep.fireRate);
}

function switchWeapon(toWeapon) {
  state.switching = true;
  state.canFire = false;
  state.switchPhase = 'down';
  SFX.weapon_switch();
  const halfReload = CONFIG.weapons[state.currentWeapon].reloadTime / 2;
  // Weapon goes down
  setTimeout(() => {
    state.currentWeapon = toWeapon;
    createWeaponModel(toWeapon);
    state.switchPhase = 'up';
    updateHUD();
    // Weapon comes back up
    setTimeout(() => {
      state.switching = false;
      state.canFire = true;
      state.switchPhase = null;
    }, halfReload / 2);
  }, halfReload / 2);
}

function reload() {
  if (state.reloading) return;
  const wep = CONFIG.weapons[state.currentWeapon];
  if (state.ammo[state.currentWeapon] >= wep.magSize || state.reserveAmmo[state.currentWeapon] <= 0) return;
  state.reloading = true; state.canFire = false;
  state.reloadPhase = 'down'; // Animation phase
  reloadMsg.classList.add('show');
  SFX.reload();
  setTimeout(() => {
    const needed = wep.magSize - state.ammo[state.currentWeapon];
    const loaded = Math.min(needed, state.reserveAmmo[state.currentWeapon]);
    state.ammo[state.currentWeapon] += loaded;
    state.reserveAmmo[state.currentWeapon] -= loaded;
    state.reloadPhase = 'up'; // Start coming back up
    reloadMsg.classList.remove('show');
    updateHUD();
    setTimeout(() => {
      state.reloading = false; state.canFire = true;
      state.reloadPhase = null;
    }, 300); // Brief delay for weapon to come back up
  }, wep.reloadTime);
}

// ═══════════════════════════════════════════════════════════
// LOOT PICKUP
// ═══════════════════════════════════════════════════════════
function pickupLoot() {
  if (!state.nearbyLoot) return;
  const loot = state.nearbyLoot;
  const type = loot.userData.lootType;

  // Depot crates — repeatable, never consumed
  if (loot.userData.depot) {
    if (type === 'depot_ammo_m4')    { state.reserveAmmo.m4     += 10; SFX.pickup(); }
    if (type === 'depot_ammo_pistol'){ state.reserveAmmo.pistol  += 10; SFX.pickup(); }
    if (type === 'depot_armor')      { state.armor = 100;               SFX.pickup(); }
    if (type === 'depot_health')     { state.health = Math.min(100, state.health + 50); updateHUD(); SFX.pickup(); }
    updateHUD();
    return;
  }

  SFX.pickup();
  if (type === 'health' && state.hp >= 100) return;
  if (type === 'armor'  && state.armor >= 100) return;
  switch (type) {
    case 'ammo_m4':     state.reserveAmmo.m4     += 30; break;
    case 'ammo_pistol': state.reserveAmmo.pistol  += 15; break;
    case 'health':      state.hp = 100; break;
    case 'armor':       state.armor = 100; break;
  }
  // Remove floor loot from scene
  if (loot.isGroup) {
    loot.traverse(function(child) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  } else {
    if (loot.geometry) loot.geometry.dispose();
    if (loot.material) loot.material.dispose();
  }
  scene.remove(loot);
  const idx = lootItems.indexOf(loot);
  if (idx >= 0) lootItems.splice(idx, 1);
  state.nearbyLoot = null;
  pickupPrompt.classList.remove('show');
  updateHUD();
}

// ═══════════════════════════════════════════════════════════
// HUD
// ═══════════════════════════════════════════════════════════
function updateHUD() {
  const wep = CONFIG.weapons[state.currentWeapon];
  document.getElementById('wep-name').textContent = wep.name;
  document.getElementById('ammo-current').textContent = state.ammo[state.currentWeapon];
  document.getElementById('ammo-reserve').textContent = state.reserveAmmo[state.currentWeapon];
  document.getElementById('hp-val').textContent = state.hp;
  document.getElementById('hp-bar').style.width = state.hp + '%';
  document.getElementById('armor-val').textContent = state.armor;
  document.getElementById('armor-bar').style.width = state.armor + '%';
  document.getElementById('reserve-m4').textContent = state.reserveAmmo.m4;
  document.getElementById('reserve-pistol').textContent = state.reserveAmmo.pistol;
}

// ═══════════════════════════════════════════════════════════
// MINIMAP
// ═══════════════════════════════════════════════════════════
const mCtx = document.getElementById('minimap-canvas').getContext('2d');
function drawMinimap() {
  const w = 150, h = 150, scale = w / CONFIG.islandSize, cx = w / 2, cy = h / 2;
  mCtx.fillStyle = '#0a6699'; mCtx.fillRect(0, 0, w, h);
  const iSize = CONFIG.islandSize * scale;
  mCtx.fillStyle = '#3a5a2a';
  mCtx.fillRect(cx - iSize / 2, cy - iSize / 2, iSize, iSize);

  // Volcano
  mCtx.beginPath();
  mCtx.arc(cx, cy, CONFIG.volcanoRadius * scale, 0, Math.PI * 2);
  mCtx.fillStyle = '#5a4a3a'; mCtx.fill();

  // Stream (draw meandering path)
  mCtx.beginPath();
  mCtx.moveTo(cx + streamPoints[0].x * scale, cy + streamPoints[0].z * scale);
  for (let i = 1; i < streamPoints.length; i++) {
    mCtx.lineTo(cx + streamPoints[i].x * scale, cy + streamPoints[i].z * scale);
  }
  mCtx.strokeStyle = '#1199dd'; mCtx.lineWidth = 2; mCtx.stroke();

  // Water flood level — show as blue fill covering submerged areas
  if (state.waterRising && state.waterLevel > 0.5) {
    let floodRadius = CONFIG.volcanoRadius;
    for (let testR = CONFIG.volcanoRadius; testR > 0; testR -= 1) {
      const t = 1 - testR / CONFIG.volcanoRadius;
      const smooth = t * t * t * (t * (t * 6 - 15) + 10);
      if (smooth * CONFIG.volcanoHeight > state.waterLevel) {
        floodRadius = testR;
        break;
      }
    }
    mCtx.fillStyle = 'rgba(15, 100, 180, 0.5)';
    mCtx.fillRect(cx - iSize / 2, cy - iSize / 2, iSize, iSize);
    mCtx.save();
    mCtx.beginPath();
    mCtx.arc(cx, cy, floodRadius * scale, 0, Math.PI * 2);
    mCtx.clip();
    mCtx.fillStyle = '#5a4a3a';
    mCtx.beginPath();
    mCtx.arc(cx, cy, floodRadius * scale, 0, Math.PI * 2);
    mCtx.fill();
    mCtx.restore();
  }

  // Prison
  mCtx.fillStyle = '#808080';
  mCtx.fillRect(cx + prison.x * scale - pw * scale / 2, cy + prison.z * scale - pw * scale / 2, pw * scale, pw * scale);

  // Bots (alive = red dots)
  bots.forEach(b => {
    if (!b.alive) return;
    mCtx.fillStyle = '#ff4444';
    mCtx.beginPath();
    mCtx.arc(cx + b.group.position.x * scale, cy + b.group.position.z * scale, 2, 0, Math.PI * 2);
    mCtx.fill();
  });

  // Loot
  lootItems.forEach(l => {
    mCtx.fillStyle = '#' + l.material.color.getHexString();
    mCtx.fillRect(cx + l.position.x * scale - 1, cy + l.position.z * scale - 1, 2, 2);
  });

  // Player
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const angle = Math.atan2(dir.x, dir.z);
  const px = cx + camera.position.x * scale, pz = cy + camera.position.z * scale;
  mCtx.save(); mCtx.translate(px, pz); mCtx.rotate(-angle);
  mCtx.beginPath(); mCtx.moveTo(0, -5); mCtx.lineTo(-3, 3); mCtx.lineTo(3, 3); mCtx.closePath();
  mCtx.fillStyle = '#fff'; mCtx.fill(); mCtx.restore();
}
