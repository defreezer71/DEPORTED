// ═══════════════════════════════════════════════════════════
// GAME LOOP
// ═══════════════════════════════════════════════════════════
const clock = new THREE.Clock();
const moveVec = new THREE.Vector3();
const smoothedMove = new THREE.Vector3(); // Smoothed movement for weapon bob / footsteps
const fwd = new THREE.Vector3();
const rgt = new THREE.Vector3();
let minimapTimer = 0;
let perfFrames = 0, perfLastTime = 0;

// ── Fixed timestep physics ──
// Physics always steps at exactly 64Hz regardless of render framerate.
// This makes player position 100% predictable from inputs alone —
// required for server-side reconciliation in multiplayer.
const FIXED_DT = 1 / 64;
let physicsAccumulator = 0;

// ── Instanced Ash Cloud Pool — 1 draw call for ALL ash particles ──
const ASH_POOL_SIZE = 300;
const ashGeo = new THREE.SphereGeometry(1, 5, 4);
const ashMat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.7, color: 0x444444 });
const ashMesh = new THREE.InstancedMesh(ashGeo, ashMat, ASH_POOL_SIZE);
ashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(ashMesh);

const ashActive    = new Array(ASH_POOL_SIZE).fill(false);
const ashPos       = Array.from({ length: ASH_POOL_SIZE }, () => new THREE.Vector3());
const ashVel       = Array.from({ length: ASH_POOL_SIZE }, () => new THREE.Vector3());
const ashSize      = new Float32Array(ASH_POOL_SIZE);
const ashGrowRate  = new Float32Array(ASH_POOL_SIZE);
const ashLife      = new Float32Array(ASH_POOL_SIZE);
const ashMaxLife   = new Float32Array(ASH_POOL_SIZE);
const ashOpacity   = new Float32Array(ASH_POOL_SIZE);
const ashColors    = [0x333333, 0x444444, 0x555555, 0x3a3020, 0x4a4a4a];
const ashColorObjs = ashColors.map(c => new THREE.Color(c));

ashMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ASH_POOL_SIZE * 3), 3);

const _ashDummy = new THREE.Object3D();

function spawnAshCloud(size, upVel, life) {
  for (let i = 0; i < ASH_POOL_SIZE; i++) {
    if (ashActive[i]) continue;
    ashActive[i]   = true;
    ashSize[i]     = size;
    ashGrowRate[i] = 0.3 + Math.random() * 0.8;
    ashLife[i]     = life;
    ashMaxLife[i]  = life + 5;
    ashPos[i].set(
      (Math.random() - 0.5) * 12,
      CONFIG.volcanoHeight + Math.random() * 3,
      (Math.random() - 0.5) * 12
    );
    ashVel[i].set(
      (Math.random() - 0.5) * 2,
      upVel,
      (Math.random() - 0.5) * 2
    );
    const col = ashColorObjs[Math.floor(Math.random() * ashColorObjs.length)];
    ashMesh.instanceColor.setXYZ(i, col.r, col.g, col.b);
    return;
  }
}

function updateAshClouds(dt) {
  for (let i = 0; i < ASH_POOL_SIZE; i++) {
    if (!ashActive[i]) {
      _ashDummy.position.set(0, -9999, 0);
      _ashDummy.scale.set(0, 0, 0);
      _ashDummy.updateMatrix();
      ashMesh.setMatrixAt(i, _ashDummy.matrix);
      continue;
    }

    ashVel[i].y *= 0.998;
    ashVel[i].x *= 0.99;
    ashVel[i].z *= 0.99;
    ashPos[i].addScaledVector(ashVel[i], dt);
    ashSize[i] += ashGrowRate[i] * dt;
    ashLife[i] -= dt;

    const opacity = Math.max(0, (ashLife[i] / ashMaxLife[i]) * 0.6);
    ashOpacity[i] = opacity;

    if (ashLife[i] <= 0) {
      ashActive[i] = false;
      _ashDummy.position.set(0, -9999, 0);
      _ashDummy.scale.set(0, 0, 0);
      _ashDummy.updateMatrix();
      ashMesh.setMatrixAt(i, _ashDummy.matrix);
      continue;
    }

    const s = ashSize[i];
    _ashDummy.position.copy(ashPos[i]);
    _ashDummy.scale.set(s, s * 0.6, s);
    _ashDummy.updateMatrix();
    ashMesh.setMatrixAt(i, _ashDummy.matrix);
  }

  ashMesh.instanceMatrix.needsUpdate = true;
  ashMesh.instanceColor.needsUpdate = true;
  ashMat.opacity = 0.65;
}

// ═══════════════════════════════════════════════════════════
// PHYSICS STEP — runs at exactly FIXED_DT (1/64 s) per tick.
//
// Rules for this function:
//   • Only uses fixedDt — never reads clock or Date.now()
//   • Reads state.yaw / state.pitch as the canonical look angles
//   • Reads input booleans (state.moveForward etc.) set by event handlers
//   • Writes camera.position and camera.quaternion
//   • Must produce identical output for identical (state, inputs) — always
// ═══════════════════════════════════════════════════════════
function physicsStep(fixedDt) {
  if (state.playerDead) return;

  // Reconstruct camera orientation from canonical yaw/pitch.
  // YXZ order: yaw (Y) applied first, then pitch (X). No roll.
  euler.set(state.pitch, state.yaw, 0, 'YXZ');
  camera.quaternion.setFromEuler(euler);

  // Build world-space move vector from camera facing + input booleans
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  rgt.crossVectors(fwd, new THREE.Vector3(0, -1, 0)).normalize();
  moveVec.set(0, 0, 0);
  if (state.moveForward) moveVec.add(fwd);
  if (state.moveBack)    moveVec.sub(fwd);
  if (state.moveLeft)    moveVec.add(rgt);
  if (state.moveRight)   moveVec.sub(rgt);
  if (moveVec.lengthSq() > 0) moveVec.normalize();

  // Smoothed move vector — fixedDt is constant so smoothFactor is constant.
  // This means the lerp rate is perfectly frame-rate independent.
  const smoothFactor = 1 - Math.pow(CONFIG.moveSmoothing, fixedDt * 60);
  smoothedMove.lerp(moveVec, smoothFactor);

  // Advance deterministic physics clock
  state.physicsTime += fixedDt;

  // Speed modifiers
  const sprintActive = state.sprintTimer > 0;
  if (sprintActive) state.sprintTimer = Math.max(0, state.sprintTimer - fixedDt);

  // Compute water level from physicsTime — deterministic, framerate-independent
  let physicsWaterLevel = -0.3;
  if (state.waterRising) {
    const timeSinceRise = state.physicsTime - state.waterRiseStart;
    if (timeSinceRise > 0) {
      let riseProgress;
      if (timeSinceRise < 10) {
        riseProgress = (timeSinceRise / 10) * 0.02;
      } else {
        const normalProgress = (timeSinceRise - 10) / (state.matchDuration - state.waterRiseStart - 10);
        riseProgress = 0.02 + Math.pow(Math.max(0, Math.min(1, normalProgress)), 0.70) * 0.98;
      }
      physicsWaterLevel = -0.3 + riseProgress * (CONFIG.volcanoHeight * 0.85 + 0.3);
    }
  }
  const isSwimming = state.waterRising && physicsWaterLevel > getTerrainHeight(camera.position.x, camera.position.z) + 0.8;
  let speed = state.ads ? CONFIG.moveSpeed * CONFIG.adsSpeedMult : CONFIG.moveSpeed;
  if (isSwimming)      speed *= 0.55;
  if (sprintActive)    speed *= 1.5;
  if (state.crouching) speed *= CONFIG.crouchSpeedMult;

  if (CONFIG.newPhysics) {
    // ═══════════════════════════════════════════════════
    // NEW PHYSICS — capsule sweep-and-slide (08b_physics.js)
    // ═══════════════════════════════════════════════════
    physicsUpdate(fixedDt, moveVec, speed);

  } else {
    // ═══════════════════════════════════════════════════
    // LEGACY PHYSICS — circle-vs-AABB (08_weapons.js)
    // ═══════════════════════════════════════════════════
    const targetHeight = state.crouching ? CONFIG.crouchHeight : CONFIG.playerHeight;
    const lerpRate = state.crouching ? 14 : 7;
    state.smoothCameraHeight += (targetHeight - state.smoothCameraHeight) * Math.min(1, fixedDt * lerpRate);

    if (smoothedMove.lengthSq() > 0.001) {
      const frame = smoothedMove.clone().multiplyScalar(speed * fixedDt);

      const testPosX = camera.position.clone();
      testPosX.x += frame.x;
      const collX = checkCollisionAndStep(testPosX);
      if (!collX.blocked) {
        camera.position.x = testPosX.x;
        if (collX.stepUpY > camera.position.y) {
          camera.position.y = collX.stepUpY;
          state.velocityY = 0; state.isGrounded = true;
        }
      }

      const testPosZ = camera.position.clone();
      testPosZ.z += frame.z;
      const collZ = checkCollisionAndStep(testPosZ);
      if (!collZ.blocked) {
        camera.position.z = testPosZ.z;
        if (collZ.stepUpY > camera.position.y) {
          camera.position.y = collZ.stepUpY;
          state.velocityY = 0; state.isGrounded = true;
        }
      }
    }

    // Gravity
    if (!state.isGrounded || state.velocityY > 0) {
      state.velocityY -= CONFIG.gravity * fixedDt;
      camera.position.y += state.velocityY * fixedDt;
    }

    // Floor height — terrain + top of any collider the player is standing on
    let floorH = getTerrainHeight(camera.position.x, camera.position.z);
    const r = CONFIG.playerRadius;
    for (const entry of collidableCache) {
      const objBB = entry.bb;
      if (camera.position.x > objBB.min.x - r && camera.position.x < objBB.max.x + r &&
          camera.position.z > objBB.min.z - r && camera.position.z < objBB.max.z + r) {
        const objTop = objBB.max.y;
        const feetCrouch = camera.position.y - CONFIG.crouchHeight;
        const feetStand  = camera.position.y - CONFIG.playerHeight;
        const nearTop = (feetCrouch >= objTop - 0.6 && feetCrouch <= objTop + 1.2) ||
                        (feetStand  >= objTop - 0.6 && feetStand  <= objTop + 1.2);
        if (nearTop) floorH = Math.max(floorH, objTop);
      }
    }

    const standY = floorH + state.smoothCameraHeight;
    const hardStandY = floorH + targetHeight;
    if (camera.position.y <= standY) {
      camera.position.y = standY; state.velocityY = 0; state.isGrounded = true;
    } else if (camera.position.y > hardStandY + 0.15) {
      state.isGrounded = false;
    }

    // Float on water
    const floatLevel = state.waterLevel + 1.2;
    if (state.waterRising && camera.position.y < floatLevel && state.waterLevel > floorH + 0.8) {
      camera.position.y = floatLevel; state.velocityY = 0; state.isGrounded = true;
    }

    // Smooth crouch camera transition
    if (state.isGrounded) {
      camera.position.y += (standY - camera.position.y) * fixedDt * 20;
    }

    // World boundary clamp
    const bound = half - 1;
    camera.position.x = Math.max(-bound, Math.min(bound, camera.position.x));
    camera.position.z = Math.max(-bound, Math.min(bound, camera.position.z));
  } // end legacy physics

  // Footstep sounds — driven by fixed timestep so cadence is frame-rate independent
  if (smoothedMove.lengthSq() > 0.01 && state.isGrounded && !isSwimming) {
    let stepSpeed = state.crouching ? 2.5 : 4.5;
    if (state.ads) stepSpeed *= 0.6;
    footstepTimer += fixedDt * stepSpeed;
    if (footstepTimer >= 1) { footstepTimer = 0; SFX.footstep(); }
  }
}

// ═══════════════════════════════════════════════════════════
// RENDER / GAME LOOP
// Runs every animation frame. Physics is ticked separately via
// the fixed-timestep accumulator above. Everything here uses
// renderDt — visual smoothing, UI, bots, particles, rendering.
// ═══════════════════════════════════════════════════════════
function update() {
  requestAnimationFrame(update);
  const renderDt = Math.min(clock.getDelta(), 0.05);

  refreshDynamicColliders();

  // ── Fixed-timestep physics accumulator ──
  // Catches up all missed 64Hz ticks since last render frame.
  // Player position is only ever advanced in steps of exactly FIXED_DT.
  physicsAccumulator += renderDt;
  while (physicsAccumulator >= FIXED_DT) {
    physicsStep(FIXED_DT);
    physicsAccumulator -= FIXED_DT;
  }

  // Sprint HUD
  if (state.phase === 'playing' || state.phase === 'countdown') {
    const _sa = state.sprintTimer > 0;
    if (streamBoostEl) streamBoostEl.style.display = _sa ? "block" : "none";
    if (sprintCdEl && _sa) sprintCdEl.textContent = Math.ceil(state.sprintTimer);
  }

  if (!state.locked) {
    if (state.phase === 'lobby') {
      updateDroneCamera(renderDt);
      droneRenderer.render(scene, droneCamera);
    }
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(weaponScene, weaponCamera); return;
  }

  // ── Game phase management ──
  if (state.phase === 'lobby') {
    state.phase = 'countdown';
    state.countdownTime = 10;
  }

  if (state.phase === 'countdown') {
    state.countdownTime -= renderDt;
    const num = Math.ceil(state.countdownTime);
    const cdEl = document.getElementById('countdown-num');
    if (num > 0 && num <= 10) {
      cdEl.textContent = num;
      cdEl.classList.add('show');
    }
    const music = document.getElementById('menu-music');
    if (music && !music.paused && state.countdownTime <= 5) {
      music.volume = Math.max(0, (state.countdownTime / 5) * 0.75);
      if (state.countdownTime <= 0) { music.pause(); music.currentTime = 0; }
    }
    if (state.countdownTime <= 0) {
      state.phase = 'playing';
      cdEl.classList.remove('show');
      state.gateOpening = true;
      SFX.gate_creak();
      const idx1 = collidables.indexOf(gateDoorL);
      if (idx1 >= 0) collidables.splice(idx1, 1);
      const idx2 = collidables.indexOf(gateDoorR);
      if (idx2 >= 0) collidables.splice(idx2, 1);
    }
  }

  // Check player death
  if (state.phase === 'playing' && state.hp <= 0 && !state.playerDead) {
    state.playerDead = true;
    state.phase = 'gameover';
    const goScreen = document.getElementById('game-over-screen');
    document.getElementById('go-kills').textContent = state.kills;
    const m = Math.floor(state.matchTime / 60);
    const s = Math.floor(state.matchTime % 60);
    document.getElementById('go-time').textContent = m + ':' + String(s).padStart(2, '0');
    setTimeout(() => goScreen.classList.add('show'), 500);
    document.getElementById('spectate-banner').classList.add('show');
  }

  // Check victory
  if (state.phase === 'playing' && !state.playerDead) {
    const aliveBotsCount = bots.filter(b => b.alive).length;
    if (aliveBotsCount === 0) {
      state.phase = 'victory';
      const winScreen = document.getElementById('victory-screen');
      document.getElementById('win-kills').textContent = state.kills;
      const m = Math.floor(state.matchTime / 60);
      const s = Math.floor(state.matchTime % 60);
      document.getElementById('win-time').textContent = m + ':' + String(s).padStart(2, '0');
      setTimeout(() => {
        winScreen.classList.add('show');
        const music = document.getElementById('menu-music');
        if (music) { music.currentTime = 47; music.volume = 0.85; music.play(); }
      }, 500);
    }
  }

  // Spectate mode
  if (state.playerDead) {
    const aliveBots = bots.filter(b => b.alive);
    if (aliveBots.length > 0) {
      const specBot = aliveBots[state.spectateIndex % aliveBots.length];
      const specPos = specBot.group.position;
      camera.position.lerp(new THREE.Vector3(specPos.x - 5, specPos.y + 4, specPos.z - 5), renderDt * 3);
      camera.lookAt(specPos.x, specPos.y + 1.5, specPos.z);
    }
    updateBots(renderDt);
  }

  const sprintActive = state.sprintTimer > 0;
  if (streamBoostEl) streamBoostEl.style.display = sprintActive ? "block" : "none";
  if (sprintCdEl && sprintActive) sprintCdEl.textContent = Math.ceil(state.sprintTimer);

  // Gate swing animation
  if (state.gateOpening && gateOpenProgress < 1) {
    gateOpenProgress += renderDt * 0.5;
    if (gateOpenProgress > 1) {
      gateOpenProgress = 1;
      if (state.sprintTimer === 0) state.sprintTimer = 15;
    }
    const angle = gateOpenProgress * Math.PI * 0.45;
    gatePivotL.rotation.y = angle;
    gatePivotR.rotation.y = -angle;
  }

  if (!state.playerDead) updateBots(renderDt);

  // Interpolate remote player meshes toward server-reported positions
  for (const id in state.remotePlayers) {
    const rp = state.remotePlayers[id];
    if (rp.targetX === undefined) continue;
    rp.mesh.position.x += (rp.targetX - rp.mesh.position.x) * Math.min(1, renderDt * 15);
    rp.mesh.position.y += (rp.targetY - rp.mesh.position.y) * Math.min(1, renderDt * 15);
    rp.mesh.position.z += (rp.targetZ - rp.mesh.position.z) * Math.min(1, renderDt * 15);
  }

  // Debug overlay - remote player distances


  // ── Match timer & water rise ──
  state.matchTime += renderDt;
  const remaining = Math.max(0, state.matchDuration - state.matchTime);
  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);
  document.getElementById('match-timer').textContent =
    String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');

  const aliveCount = bots.filter(b => b.alive).length + (state.playerDead ? 0 : 1);
  document.getElementById('alive-val').textContent = aliveCount;

  // Volcano eruption
  const eruptionTime = state.waterRiseStart - 15;
  if (state.matchTime >= eruptionTime && !state.erupted) {
    state.erupted = true;
    waterWarning.textContent = '⚠ VOLCANO ERUPTING — WATER RISING IN 15 SECONDS ⚠';
    waterWarning.style.fontSize = '28px';
    waterWarning.classList.add('show');
    setTimeout(() => waterWarning.classList.remove('show'), 5000);
    for (let i = 0; i < 152; i++) spawnAshCloud(3 + Math.random() * 6, 14 + Math.random() * 28, 12 + Math.random() * 15);
    {
      const ctx = ensureAudio();
      const t0 = ctx.currentTime;
      const fullDur = 15;
      const taperStart = 10;

      const boomBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.8), ctx.sampleRate);
      const bbd = boomBuf.getChannelData(0);
      for (let i = 0; i < bbd.length; i++) {
        const env = i < 200 ? i / 200 : Math.pow(1 - i / bbd.length, 1.1);
        bbd[i] = (Math.random() * 2 - 1) * env;
      }
      const boomSrc = ctx.createBufferSource(); boomSrc.buffer = boomBuf;
      const boomLp = ctx.createBiquadFilter(); boomLp.type = 'lowpass'; boomLp.frequency.value = 90;
      const boomGain = ctx.createGain(); boomGain.gain.value = 1.61;
      boomSrc.connect(boomLp).connect(boomGain).connect(getMaster());
      boomSrc.start(t0);

      for (let layer = 0; layer < 3; layer++) {
        const offset = layer * 0.21;
        const dur = fullDur - offset;
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) {
          const t = i / d.length;
          const fadeIn = Math.min(1, t / 0.05);
          const fadeOut = t > taperStart / dur ? Math.pow(1 - (t - taperStart/dur) / (1 - taperStart/dur), 0.5) : 1;
          d[i] = (Math.random() * 2 - 1) * fadeIn * fadeOut;
        }
        const src = ctx.createBufferSource(); src.buffer = buf;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 75 + layer * 20;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 15;
        const g = ctx.createGain(); g.gain.value = [0.598, 0.403, 0.276][layer];
        src.connect(hp).connect(lp).connect(g).connect(getMaster());
        src.start(t0 + offset);
      }

      const subBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * fullDur), ctx.sampleRate);
      const sbd = subBuf.getChannelData(0);
      for (let i = 0; i < sbd.length; i++) {
        const t = i / sbd.length;
        const fadeIn = Math.min(1, t / 0.08);
        const fadeOut = t > taperStart / fullDur ? Math.pow(1 - (t - taperStart/fullDur) / (1 - taperStart/fullDur), 0.4) : 1;
        sbd[i] = (Math.random() * 2 - 1) * fadeIn * fadeOut;
      }
      const subSrc = ctx.createBufferSource(); subSrc.buffer = subBuf;
      const subLp1 = ctx.createBiquadFilter(); subLp1.type = 'lowpass'; subLp1.frequency.value = 45;
      const subLp2 = ctx.createBiquadFilter(); subLp2.type = 'lowpass'; subLp2.frequency.value = 45;
      const subG = ctx.createGain(); subG.gain.value = 0.92;
      subSrc.connect(subLp1).connect(subLp2).connect(subG).connect(getMaster());
      subSrc.start(t0);

      [950, 2600, 4350, 6100, 7800, 9500].forEach(ms => {
        setTimeout(() => {
          playNoise(0.322, 0.38, 70, 'lowpass');
          playNoise(0.207, 0.22, 110, 'lowpass');
        }, ms);
      });
    }
    const hazeGeo = new THREE.PlaneGeometry(CONFIG.islandSize * 1.5, CONFIG.islandSize * 1.5);
    const hazeMat = new THREE.MeshBasicMaterial({ color: 0x777777, transparent: true, opacity: 0, side: THREE.DoubleSide });
    const haze = new THREE.Mesh(hazeGeo, hazeMat);
    haze.rotation.x = -Math.PI / 2; haze.position.y = 45;
    scene.add(haze);
    state.hazePlane = haze;
  }

  if (state.erupted) {
    state.ashTimer = (state.ashTimer || 0) + renderDt;
    if (state.ashTimer > 0.07) {
      state.ashTimer = 0;
      spawnAshCloud(2.5 + Math.random() * 5, 8 + Math.random() * 18, 10 + Math.random() * 14);
    }
  }

  updateAshClouds(renderDt);

  if (state.hazePlane) {
    const timeSinceEruption = Math.max(0, state.matchTime - eruptionTime);
    const targetOpacity = Math.min(0.35, timeSinceEruption * 0.003);
    state.hazePlane.material.opacity += (targetOpacity - state.hazePlane.material.opacity) * renderDt * 0.5;
    const dimFactor = Math.max(0.35, 1 - timeSinceEruption * 0.004);
    sun.intensity = 1.6 * dimFactor;
    sunMesh.material.color.setHex(dimFactor > 0.6 ? 0xFFEE00 : 0xCC8800);
  }

  if (state.erupted && state.matchTime < eruptionTime + 5 && !state.playerDead) {
    const shakeIntensity = 0.12 * (1 - (state.matchTime - eruptionTime) / 5);
    state.shakeOffset.set(
      (Math.random() - 0.5) * shakeIntensity,
      (Math.random() - 0.5) * shakeIntensity * 0.5,
      (Math.random() - 0.5) * shakeIntensity * 0.25
    );
  } else {
    state.shakeOffset.set(0, 0, 0);
  }

  if (state.matchTime >= state.waterRiseStart) {
    if (!state.waterRising) {
      state.waterRising = true;
      water.visible = true;
    }

    const timeSinceRise = state.matchTime - state.waterRiseStart;
    let riseProgress;
    if (timeSinceRise < 10) {
      riseProgress = (timeSinceRise / 10) * 0.02;
    } else {
      const normalProgress = (timeSinceRise - 10) / (state.matchDuration - state.waterRiseStart - 10);
      riseProgress = 0.02 + Math.pow(normalProgress, 0.70) * 0.98;
    }
    state.waterLevel = -0.3 + riseProgress * (CONFIG.volcanoHeight * 0.85 + 0.3);
    water.position.y = state.waterLevel;

    const waterPosAttr = water.geometry.attributes.position;
    for (let i = 0; i < waterPosAttr.count; i++) {
      const wx = waterPosAttr.getX(i);
      const wy = waterPosAttr.getY(i);
      const wave = Math.sin(wx * 0.3 + clock.elapsedTime * 1.5) * Math.cos(wy * 0.3 + clock.elapsedTime) * 0.15;
      waterPosAttr.setZ(i, wave);
    }
    waterPosAttr.needsUpdate = true;

    const playerCurrentH = state.crouching ? CONFIG.crouchHeight : CONFIG.playerHeight;
    const playerFeetY = camera.position.y - playerCurrentH;
    const kneeY = playerFeetY + 0.4;
    if (state.waterLevel > kneeY) {
      state.waterDmgTimer += renderDt;
      if (state.waterDmgTimer >= 1) {
        state.waterDmgTimer -= 1;
        if (state.armor > 0) {
          state.armor = Math.max(0, state.armor - 5);
        } else {
          state.hp = Math.max(0, state.hp - 5);
        }
        updateHUD();
        SFX.water_damage();
        const dv = document.getElementById('damage-vignette');
        dv.classList.add('show');
        setTimeout(() => dv.classList.remove('show'), 350);
      }
    } else {
      state.waterDmgTimer = 0;
    }

    for (const bot of bots) {
      if (!bot.alive) continue;
      const botFeetY = bot.group.position.y;
      if (state.waterLevel > botFeetY + 0.4) {
        bot.hp -= renderDt * 5;
        if (bot.hp <= 0) {
          bot.alive = false;
          bot.group.rotation.x = Math.PI / 2;
          bot.group.position.y = state.waterLevel;
          setTimeout(() => {
            bot.group.children.forEach(c => {
              const idx = targets.indexOf(c);
              if (idx >= 0) targets.splice(idx, 1);
            });
          }, 200);
        }
      }
    }
  }

  // Ambient jungle sounds
  ambientTimer -= renderDt;
  if (ambientTimer <= 0 && state.phase === 'playing') {
    const roll = Math.random();
    if (roll < 0.4) SFX.bird();
    else if (roll < 0.7) SFX.insect();
    else SFX.wind();
    ambientTimer = 4 + Math.random() * 8;
  }

  // Loot proximity
  state.nearbyLoot = null;
  let closestDist = 2.5;
  const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const allLootSources = [...lootItems, ...depotCrates];
  for (const loot of allLootSources) {
    const dx = loot.position.x - camera.position.x;
    const dz = loot.position.z - camera.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > closestDist) continue;
    if (loot.userData.depot) {
      const { shedX, shedZ, shedHW, shedHD } = loot.userData;
      if (Math.abs(camera.position.x - shedX) > shedHW ||
          Math.abs(camera.position.z - shedZ) > shedHD) continue;
    }
    const toLoot = new THREE.Vector3(dx, 0, dz).normalize();
    const dot = lookDir.x * toLoot.x + lookDir.z * toLoot.z;
    if (dot > 0.7 && dist < closestDist) { closestDist = dist; state.nearbyLoot = loot; }
  }
  pickupPrompt.textContent = state.nearbyLoot ? `[F] ${state.nearbyLoot.userData.label}` : '';
  state.nearbyLoot ? pickupPrompt.classList.add('show') : pickupPrompt.classList.remove('show');

  // Loot bob + float with water
  for (const loot of lootItems) {
    const groundY = loot.userData.baseY;
    const floatY = state.waterLevel + 0.1;
    const effectiveY = Math.max(groundY, floatY);
    loot.position.y = effectiveY + Math.sin(clock.elapsedTime * 2 + loot.position.x) * 0.08;
    loot.rotation.y += renderDt * 1.5;
  }

  // Smoke
  for (const s of smokeParticles) {
    _smokeDummy.position.set(
      s.ox + Math.sin(clock.elapsedTime * 0.3 + s.phase) * 2.5,
      s.baseY + Math.sin(clock.elapsedTime * s.speed + s.phase) * 2,
      s.oz + Math.cos(clock.elapsedTime * 0.2 + s.phase) * 2.5
    );
    _smokeDummy.scale.setScalar(s.size);
    _smokeDummy.updateMatrix();
    smokeInst.setMatrixAt(s.index, _smokeDummy.matrix);
  }
  smokeInst.instanceMatrix.needsUpdate = true;

  // Water vignette
  if (state.waterRising) {
    const maxWater = CONFIG.volcanoHeight * 0.85;
    const progress = Math.min(1, Math.max(0, state.waterLevel / maxWater));
    waterVignette.style.opacity = (progress * 0.9).toFixed(2);
  } else {
    waterVignette.style.opacity = 0;
  }

  // Bubble animation
  if (!state.waterRising) {
    bubbleGroup.visible = true;
    bubbleGroup.children.forEach(b => {
      b.position.y += b.userData.speed * renderDt;
      b.material.opacity = 0.2 + Math.sin(clock.elapsedTime * 1.5 + b.userData.phase) * 0.15;
      if (b.position.y > 3) b.position.y = -2 - Math.random() * 2;
    });
  } else {
    bubbleGroup.visible = false;
  }

  // Weapon bob + reload animation
  const isMoving = smoothedMove.lengthSq() > 0.01;
  weaponBobPhase += renderDt * (isMoving ? 10 : 1.5);
  const restPos = state.currentWeapon === 'm4' ? new THREE.Vector3(0.25, -0.22, -0.38) : new THREE.Vector3(0.2, -0.2, -0.3);
  let targetPos;

  if (state.reloadPhase === 'down' || state.switchPhase === 'down') {
    targetPos = restPos.clone();
    targetPos.y = -0.7;
    targetPos.x += 0.05;
    weaponGroup.rotation.x = -0.3;
  } else if (state.reloadPhase === 'up' || state.switchPhase === 'up') {
    targetPos = restPos.clone();
  } else if (state.ads) {
    targetPos = new THREE.Vector3(0, -0.15, restPos.z - 0.05);
  } else {
    targetPos = restPos.clone();
    if (isMoving) {
      targetPos.x += Math.sin(weaponBobPhase) * 0.008;
      targetPos.y += Math.abs(Math.cos(weaponBobPhase)) * 0.008 - 0.004;
    } else {
      targetPos.x += Math.sin(weaponBobPhase * 0.5) * 0.002;
      targetPos.y += Math.sin(weaponBobPhase * 0.3) * 0.002;
    }
  }
  const lerpSpeed = state.reloadPhase ? 6 : 12;
  weaponGroup.position.lerp(targetPos, renderDt * lerpSpeed);
  if (!state.reloadPhase) {
    weaponGroup.rotation.x += (0 - weaponGroup.rotation.x) * renderDt * 10;
  } else {
    weaponGroup.rotation.x += (-0.3 - weaponGroup.rotation.x) * renderDt * 6;
  }
  weaponGroup.rotation.y += (0 - weaponGroup.rotation.y) * renderDt * 10;
  updateMuzzleFlash(renderDt);

  // FOV
  camera.fov += ((state.ads ? CONFIG.adsFov : CONFIG.normalFov) - camera.fov) * renderDt * 10;
  camera.updateProjectionMatrix();
  // Sync weapon camera to main camera
  weaponCamera.position.copy(camera.position);
  weaponCamera.quaternion.copy(camera.quaternion);
  weaponCamera.fov = camera.fov;
  weaponCamera.updateProjectionMatrix();

  // Impact particles
  for (let i = impactParticles.length - 1; i >= 0; i--) {
    const p = impactParticles[i];
    p.userData.vel.y -= 9.8 * renderDt;
    p.position.addScaledVector(p.userData.vel, renderDt);
    p.userData.life -= renderDt;
    if (p.userData.life <= 0) { scene.remove(p); p.geometry.dispose(); p.material.dispose(); impactParticles.splice(i, 1); }
  }

  // Performance stats
  perfFrames++;
  if (clock.elapsedTime - perfLastTime >= 1) {
    const fps = perfFrames;
    perfFrames = 0;
    perfLastTime = clock.elapsedTime;
    const info = renderer.info;
    const tris = info.render.triangles;
    const calls = info.render.calls;
    document.getElementById('perf-stats').textContent =
      `FPS: ${fps} | Tris: ${(tris/1000).toFixed(1)}k | Calls: ${calls}`;
  }

  camera.position.add(state.shakeOffset);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(weaponScene, weaponCamera);
  camera.position.sub(state.shakeOffset);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  droneCamera.aspect = window.innerWidth / window.innerHeight;
  droneCamera.updateProjectionMatrix();
  weaponCamera.aspect = window.innerWidth / window.innerHeight;
  weaponCamera.updateProjectionMatrix();
  droneRenderer.setSize(window.innerWidth, window.innerHeight);
  overlayCanvas.width = window.innerWidth;
  overlayCanvas.height = window.innerHeight;
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) overlayCanvas.style.display = 'none';
});

updateHUD();
buildCollisionCache();
if (CONFIG.newPhysics) physInit();  // Seed capsule from camera position
window._state = state;
try { connectToServer(); } catch(e) { console.error("connectToServer failed:", e); }
update();

document.getElementById('go-restart').addEventListener('click', () => location.reload());
document.getElementById('win-restart').addEventListener('click', () => location.reload());

document.addEventListener('click', () => {
  if (state.playerDead) state.spectateIndex++;
});

// ─────────────────────────────────────────────────────────────────────────────
// MULTIPLAYER — WebSocket client
// ─────────────────────────────────────────────────────────────────────────────

var WS_URL = 'wss://deported.onrender.com';

// Simple capsule mesh to represent a remote player
function createRemotePlayerMesh(id) {
  const group = new THREE.Group();

  // Body
  const bodyGeo  = new THREE.CylinderGeometry(0.35, 0.35, 1.4, 8);
  const bodyMat  = new THREE.MeshLambertMaterial({ color: 0xe05a2b });
  const body     = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.7;
  group.add(body);

  // Head
  const headGeo  = new THREE.SphereGeometry(0.3, 8, 8);
  const headMat  = new THREE.MeshLambertMaterial({ color: 0xf0c080 });
  const head     = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.65;
  group.add(head);

  group.userData.id = id;
  scene.add(group);
  return group;
}

function removeRemotePlayer(id) {
  const rp = state.remotePlayers[id];
  if (!rp) return;
  scene.remove(rp.mesh);
  delete state.remotePlayers[id];
  console.log('Player left:', id);
}

function updateRemotePlayers(playerList) {
  const seen = new Set();

  for (const p of playerList) {
    if (p.id === state.myId) continue;   // skip self
    seen.add(p.id);

    if (!state.remotePlayers[p.id]) {
      // New player — create mesh and snap immediately to real position
      const newMesh = createRemotePlayerMesh(p.id);
      newMesh.position.set(p.x, p.y, p.z);
      state.remotePlayers[p.id] = {
        mesh: newMesh,
        hp:   p.hp,
        dead: p.dead,
        targetX: p.x,
        targetY: p.y,
        targetZ: p.z,
      };
    }

    const rp = state.remotePlayers[p.id];
    rp.targetX = p.x; rp.targetY = p.y; rp.targetZ = p.z;
    rp.mesh.rotation.y = p.yaw;
    rp.hp   = p.hp;
    rp.dead = p.dead;
    rp.mesh.visible = !p.dead;
  }

  // Remove players no longer in snapshot
  for (const id of Object.keys(state.remotePlayers)) {
    if (!seen.has(id)) removeRemotePlayer(id);
  }
}

function connectToServer() {
  console.log('Connecting to wss://deported.onrender.com');
  state.ws = new WebSocket('wss://deported.onrender.com');

  state.ws.onopen = () => {
    console.log('WS connected');
    state.ws.send(JSON.stringify({
      type: 'join',
      name: 'Player' + Math.floor(Math.random() * 1000),
    }));
  };

  state.ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    switch (msg.type) {

      case 'welcome':
        state.myId = msg.id;
        console.log('My ID:', state.myId);
        if (msg.seed !== undefined) { _seed = msg.seed; console.log('World seed:', _seed); }
        // Optionally snap to server spawn position
        // camera.position.set(msg.spawnX, msg.spawnY + CONFIG.playerHeight, msg.spawnZ);
        break;

      case 'world':
        state.lastServerTick = msg.tick;
        updateRemotePlayers(msg.players);
        if (msg.events && msg.events.length) {
          for (const evt of msg.events) {
            if (evt.type === 'hit') applyHitEvent(evt);
          }
        }
        break;

      case 'existingPlayers':
        updateRemotePlayers(msg.players);
        break;

      case 'playerLeft':
        removeRemotePlayer(msg.id);
        break;

      case 'error':
        console.warn('Server error:', msg.reason);
        break;
    }
  };

  state.ws.onclose = () => {
    console.log('WS disconnected — reconnecting in 3s');
    state.myId = null;
    setTimeout(connectToServer, 3000);
  };

  state.ws.onerror = (err) => {
    console.error('WS error', err);
  };
}

// Send input snapshot to server every physics tick
function sendInputToServer() {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.myId) return;
  state.inputSeq++;
  state.ws.send(JSON.stringify({
    type:     'input',
    seq:      state.inputSeq,
    yaw:      state.yaw,
    pitch:    state.pitch,
    x:        camera.position.x,
    y:        camera.position.y,
    z:        camera.position.z,
    keys: {
      w:     state.moveForward  ? 1 : 0,
      s:     state.moveBack     ? 1 : 0,
      a:     state.moveLeft     ? 1 : 0,
      d:     state.moveRight    ? 1 : 0,
      shift: state.crouching    ? 1 : 0,
      jump:  0,
    },
    shooting: state.shooting || false,
  }));
}

// Heartbeat — keeps connection alive when tab is backgrounded
setInterval(sendInputToServer, 50);

setInterval(() => {
  if (state.ws && state.ws.readyState === WebSocket.OPEN && state.myId) {
    state.ws.send(JSON.stringify({ type: "input", seq: state.inputSeq, yaw: state.yaw || 0, pitch: state.pitch || 0, keys: { w:0,s:0,a:0,d:0,shift:0,jump:0 }, shooting: false }));
  }
}, 5000);
