
// ── CHAT ─────────────────────────────────────────────────────────────
window._chatActive = false;

var _chatColors = ['#7ecfff','#ffcc55','#88ff88','#ff9966','#cc88ff','#ff6688','#55ddcc','#ffdd88'];
function _chatColor(id) {
  var h = 0;
  for (var i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return _chatColors[Math.abs(h) % _chatColors.length];
}

function addChatMessage(senderId, text) {
  var now = new Date();
  var ts = '[' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0') + '] ';
  var log = document.getElementById('chat-log');
  if (!log) return;
  var msg = document.createElement('div');
  msg.className = 'chat-msg';
  var tsSpan = document.createElement('span');
  tsSpan.style.color = 'rgba(255,255,255,0.4)';
  tsSpan.textContent = ts;
  var name = document.createElement('span');
  name.className = 'chat-name';
  name.style.color = _chatColor(senderId);
  name.textContent = senderId.slice(0, 12) + ': ';
  msg.appendChild(tsSpan);
  msg.appendChild(name);
  var textSpan = document.createElement('span');
  textSpan.style.color = '#cccccc';
  textSpan.textContent = text;
  msg.appendChild(textSpan);
  log.appendChild(msg);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 8) log.removeChild(log.firstChild);

}

function sendChat(text) {
  if (!text || !text.trim()) return;
  var trimmed = text.trim().slice(0, 120);
  addChatMessage(state.myId || 'You', trimmed);
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'chat', text: trimmed }));
  }
}

function setupChat() {
  var input     = document.getElementById('chat-input');
  var inputRow  = document.getElementById('chat-input-row');
  var container = document.getElementById('chat-container');
  var minBtn    = document.getElementById('chat-minimize');
  var sendBtn   = document.getElementById('chat-send');
  if (!input) return;

  // Always show
  if (inputRow)  inputRow.style.display  = 'flex';

  // Minimize / restore
  var minimized = false;
  var chatBody = document.getElementById('chat-body');
  if (minBtn) {
    minBtn.innerHTML = '&#8722;';
    minBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      minimized = !minimized;
      if (chatBody) chatBody.style.display = minimized ? 'none' : 'flex';
      minBtn.innerHTML = minimized ? '&#43;' : '&#8722;';
    });
  }

  // Click input -> exit pointer lock so player can type
  input.addEventListener('mousedown', function(e) {
    e.stopPropagation();
    window._chatActive = true;
    if (document.pointerLockElement) document.exitPointerLock();
  });

  // Enter sends, Escape clears, all other keys blocked from game
  input.addEventListener('keydown', function(e) {
    if (e.code === 'Enter') {
      sendChat(input.value);
      input.value = '';
      input.blur();
      window._chatActive = false;
      e.preventDefault();
      e.stopPropagation();
    } else if (e.code === 'Escape') {
      input.value = '';
      input.blur();
      window._chatActive = false;
      e.preventDefault();
      e.stopPropagation();
    } else {
      e.stopPropagation();
    }
  }, true);

  // Send button
  if (sendBtn) {
    sendBtn.addEventListener('click', function() {
      sendChat(input.value);
      input.value = '';
      input.blur();
      window._chatActive = false;
    });
  }

  // Track focus
  input.addEventListener('focus', function() { window._chatActive = true; });
  input.addEventListener('blur',  function() { window._chatActive = false; });
}
// ── END CHAT ──────────────────────────────────────────────────────────

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
let headBobPhase = 0;
let landingBobY = 0, landingBobVel = 0;
let wasGrounded = true;
let landingCooldown = 0;
let weaponJumpY = 0, weaponJumpVel = 0;

// ── Fixed timestep physics ──
// Physics always steps at exactly 64Hz regardless of render framerate.
// This makes player position 100% predictable from inputs alone —
// required for server-side reconciliation in multiplayer.
const FIXED_DT = 1 / 64;
let physicsAccumulator = 0;

// ── Instanced Ash Cloud Pool — 1 draw call for ALL ash particles ──
const ASH_POOL_SIZE = 300;
const ashGeo = new THREE.SphereGeometry(1, 5, 4);
const ashMat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.7, color: 0x686868, depthWrite: false });
const ashMesh = new THREE.InstancedMesh(ashGeo, ashMat, ASH_POOL_SIZE);
ashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
ashMesh.frustumCulled = false;
ashMesh.renderOrder = 2;
ashMesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 150, 0), 800);

// ── Eruption plume — organic camera-facing smoke ──

// Build N organic blob textures (spline-outlined, not circular)
function _makePlumeTexture(variant) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d'), cx = 128, cy = 128;
  // Generate control points around an irregular closed curve
  const N = 8 + (variant % 3);
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + variant * 0.8;
    const baseR = 72 + 22 * Math.sin(variant * 2.3 + i * 1.9);
    const r = baseR + ((i * 7 + variant * 13) % 28) - 14;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  // Smooth closed catmull-rom path
  ctx.beginPath();
  const L = pts.length;
  for (let i = 0; i < L; i++) {
    const p0 = pts[(i - 1 + L) % L], p1 = pts[i];
    const p2 = pts[(i + 1) % L],     p3 = pts[(i + 2) % L];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6, cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6, cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    if (i === 0) ctx.moveTo(p1[0], p1[1]);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
  }
  ctx.closePath();
  const dark = 38 + (variant % 3) * 8;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 95);
  g.addColorStop(0,    `rgba(${dark+22},${dark+22},${dark+22},0.90)`);
  g.addColorStop(0.45, `rgba(${dark+10},${dark+10},${dark+10},0.78)`);
  g.addColorStop(0.78, `rgba(${dark},${dark},${dark},0.40)`);
  g.addColorStop(1,    'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fill();
  // Add a couple of offset sub-blobs to break circularity further
  for (let b = 0; b < 3; b++) {
    const ba = variant * 1.1 + b * 2.1, br = 28 + b * 9;
    const bx = cx + Math.cos(ba) * 38, by = cy + Math.sin(ba) * 32;
    const bg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    bg.addColorStop(0,   `rgba(${dark+15},${dark+15},${dark+15},0.55)`);
    bg.addColorStop(0.6, `rgba(${dark},${dark},${dark},0.25)`);
    bg.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI*2); ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}
const _plumeTex = Array.from({ length: 6 }, (_, i) => _makePlumeTexture(i));

const PLUME_COUNT = 140;
const PLUME_MAX_Y = 165;
const _plumeGroup = new THREE.Group();
_plumeGroup.position.set(0, CONFIG.volcanoHeight, 0);
_plumeGroup.visible = false;
_plumeGroup.renderOrder = 2;
scene.add(_plumeGroup);

const _plumeData = [];
const _plumeQuat = new THREE.Quaternion();
const _spinAxis  = new THREE.Vector3(0, 0, 1);
const _spinQ     = new THREE.Quaternion();
let _plumeFadeT  = 0;

for (let i = 0; i < PLUME_COUNT; i++) {
  const mat = new THREE.MeshBasicMaterial({
    map: _plumeTex[i % 6], transparent: true, opacity: 0,
    depthWrite: false, side: THREE.DoubleSide, fog: false
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = 2; mesh.frustumCulled = false;
  _plumeGroup.add(mesh);
  _plumeData.push({
    mesh, mat,
    y:          (i / PLUME_COUNT) * PLUME_MAX_Y,   // evenly staggered — no gaps
    speed:      11 + Math.random() * 10,
    angle:      Math.random() * Math.PI * 2,
    radMult:    0.5 + Math.random() * 1.0,
    baseSize:   9 + Math.random() * 10,
    scaleRatio: 0.75 + Math.random() * 0.55,        // oval asymmetry
    wobbleAmp:  0.6 + Math.random() * 1.0,
    wobbleFreq: 0.6 + Math.random() * 1.2,
    wobbleOff:  Math.random() * Math.PI * 2,
    spinAngle:  Math.random() * Math.PI * 2,
    spinRate:   (Math.random() - 0.5) * 0.8,        // slow screen-space spin
  });
}

function updatePlume(dt) {
  _plumeGroup.visible = true;
  _plumeFadeT = Math.min(1, _plumeFadeT + dt * 0.5);
  _plumeQuat.copy(camera.quaternion);

  const tSinceErupt = state.matchTime - state.eruptionStartTime;
  // Violent phase lasts 9s, then smoothly eases to normal over 4s
  const violentFrac = 1 - Math.min(1, Math.max(0, (tSinceErupt - 9) / 4));
  const speedMult = 1.0 + violentFrac * 1.0;   // 2.0 → 1.0 smooth

  for (const p of _plumeData) {
    p.y += p.speed * speedMult * dt;
    if (p.y > PLUME_MAX_Y) p.y -= PLUME_MAX_Y;   // seamless wrap

    const f   = p.y / PLUME_MAX_Y;               // 0 = mouth, 1 = top
    const rad = 1.5 + Math.pow(f, 1.5) * 62 * p.radMult;

    // Pure radial spread — no spiral, just outward in fixed angle + small wobble
    p.wobbleOff += p.wobbleFreq * dt;
    const wx = Math.sin(p.wobbleOff) * p.wobbleAmp * 1.8;
    const wz = Math.cos(p.wobbleOff * 0.7 + 1.3) * p.wobbleAmp * 1.8;
    p.mesh.position.set(Math.cos(p.angle) * rad + wx, p.y, Math.sin(p.angle) * rad + wz);

    // Camera-facing + per-sprite screen-space spin for organic variety
    p.spinAngle += p.spinRate * dt;
    _spinQ.setFromAxisAngle(_spinAxis, p.spinAngle);
    p.mesh.quaternion.multiplyQuaternions(_plumeQuat, _spinQ);

    // Oval scale (x/y ratio varies per sprite)
    const s = (p.baseSize + f * 28) * (1.0 + violentFrac * 0.35);
    p.mesh.scale.set(s, s * p.scaleRatio, 1);

    // Fade in from mouth, full opacity mid-column, fade out at very top
    const fadeIn  = Math.min(1, p.y / 8) * _plumeFadeT;
    const fadeOut = 1 - Math.max(0, (f - 0.82) / 0.18);
    p.mat.opacity = 0.80 * fadeIn * fadeOut;
  }
}

// Stubs expected by eruption-start / legacy code
const ERUPT_COUNT = 1;
const eruptPhase = new Float32Array(1);
const eruptSpeed = new Float32Array(1);
const eruptPos   = new Float32Array(3);
const ERUPT_MAX_H = 165;


scene.add(ashMesh);

const ashActive    = new Array(ASH_POOL_SIZE).fill(false);
const ashPos       = Array.from({ length: ASH_POOL_SIZE }, () => new THREE.Vector3());
const ashVel       = Array.from({ length: ASH_POOL_SIZE }, () => new THREE.Vector3());
const ashSize      = new Float32Array(ASH_POOL_SIZE);
const ashGrowRate  = new Float32Array(ASH_POOL_SIZE);
const ashLife      = new Float32Array(ASH_POOL_SIZE);
const ashMaxLife   = new Float32Array(ASH_POOL_SIZE);
const ashOpacity   = new Float32Array(ASH_POOL_SIZE);
const ashColors    = [0x606060, 0x707070, 0x787878, 0x686860, 0x686868];
const ashColorObjs = ashColors.map(c => new THREE.Color(c));

ashMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ASH_POOL_SIZE * 3), 3);

const _ashDummy = new THREE.Object3D();

function spawnAshCloud(size, upVel, life) {
  for (let i = 0; i < ASH_POOL_SIZE; i++) {
    if (ashActive[i]) continue;
    ashActive[i]   = true;
    ashSize[i]     = size * 1.2;
    ashGrowRate[i] = 0.3 + Math.random() * 0.5;
    ashLife[i]     = life;
    ashMaxLife[i]  = life + 5;
    const heightFrac = Math.random();
    const spawnAngle = Math.random() * Math.PI * 2;
    const spawnRadius = (4 + heightFrac * 22) * Math.random();
    ashPos[i].set(
      Math.cos(spawnAngle) * spawnRadius,
      CONFIG.volcanoHeight + 12 + heightFrac * 68,
      Math.sin(spawnAngle) * spawnRadius
    );
    ashVel[i].set(
      (Math.random() - 0.5) * 4,
      upVel * (1 - heightFrac * 0.7),
      (Math.random() - 0.5) * 4
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

    ashVel[i].y *= Math.pow(0.96, dt);
    ashVel[i].x *= Math.pow(0.65, dt);
    ashVel[i].z *= Math.pow(0.65, dt);
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
  ashMat.opacity = 0.18;
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

  // Build world-space move vector from camera facing + input booleans.
  // Strafe (A/D) is scaled by strafeSpeedMult so lateral movement is slightly slower
  // than forward movement, matching CS/Krunker feel. Diagonal speed is capped at 1.
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  rgt.crossVectors(fwd, new THREE.Vector3(0, -1, 0)).normalize();
  const fwdInput  = (state.moveForward ? 1 : 0) - (state.moveBack  ? 1 : 0);
  const sideInput = (state.moveLeft    ? 1 : 0) - (state.moveRight ? 1 : 0);
  moveVec.set(0, 0, 0);
  moveVec.addScaledVector(fwd, fwdInput);
  moveVec.addScaledVector(rgt, sideInput * CONFIG.strafeSpeedMult);
  const mLen = moveVec.length();
  if (mLen > 1) moveVec.divideScalar(mLen);

  // Smoothed move vector — fixedDt is constant so smoothFactor is constant.
  // This means the lerp rate is perfectly frame-rate independent.
  const smoothFactor = 1 - Math.pow(CONFIG.moveSmoothing, fixedDt * 60);
  smoothedMove.lerp(moveVec, smoothFactor);

  // Advance deterministic physics clock
  state.physicsTime += fixedDt;

  // Speed modifiers
  const sprintActive = false;

  // Compute water level from matchTime — same time domain as waterRiseStart
  let physicsWaterLevel = -0.3;
  if (state.waterRising) {
    const timeSinceRise = state.matchTime - state.waterRiseStart;
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
  const _playerFeetY = CONFIG.newPhysics ? phys.pos.y : (camera.position.y - state.smoothCameraHeight);
  const isSwimming = !!state.isSwimming;
  // _cW must be < 0.96 (inner wall radius) so standing on the wall top doesn't count
  const _cp = camera.position, _cR = 85, _cW = 0.80;
  const _feetY = CONFIG.newPhysics ? phys.pos.y : (_cp.y - state.smoothCameraHeight);
  const inCanalXZ = (Math.abs(_cp.z + _cR) < _cW && Math.abs(_cp.x) < _cR + _cW) ||
                    (Math.abs(_cp.z - _cR) < _cW && Math.abs(_cp.x) < _cR + _cW) ||
                    (Math.abs(_cp.x - _cR) < _cW && Math.abs(_cp.z) < _cR + _cW) ||
                    (Math.abs(_cp.x + _cR) < _cW && Math.abs(_cp.z) < _cR + _cW);
  // _feetY < 0.60 excludes players standing on top of the canal walls (wall top = 0.77)
  const inCanal = inCanalXZ && _feetY < 0.60;
  state.inCanal = inCanal;
  let speed = state.ads ? CONFIG.moveSpeed * CONFIG.adsSpeedMult : CONFIG.moveSpeed;
  if (isSwimming)      speed *= 0.55;
  if (inCanal)         speed *= 1.5;
  if (state.crouching) speed *= CONFIG.crouchSpeedMult;

  if (CONFIG.newPhysics) {
    // ═══════════════════════════════════════════════════
    // NEW PHYSICS — capsule sweep-and-slide (08b_physics.js)
    // ═══════════════════════════════════════════════════
    physicsUpdate(fixedDt, smoothedMove, speed);

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

  // Canal boost HUD
  if (streamBoostEl) streamBoostEl.style.display = state.inCanal ? "block" : "none";

  if (!state.locked && !state.playerDead) {
    updateDroneCamera(renderDt);
    if (window.skyDome) window.skyDome.position.copy(droneCamera.position);
    droneRenderer.render(scene, droneCamera);
    renderer.clear();
    if (window.skyDome) window.skyDome.position.copy(camera.position);
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(weaponScene, weaponCamera); return;
  }

  // ── Game phase management ──
  if (state.phase === 'lobby') {
    if (!state.joinSent) sendJoin();
    if (state.myId && !state.inLobby && state.phase !== 'countdown') {
      // phase is set server-side via startMatch, nothing to do here
    }
  }

  if (state.phase === 'countdown') {
    state.countdownTime = state.matchStartAt
      ? 1 - (Date.now() - state.matchStartAt) / 1000
      : state.countdownTime - renderDt;
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
    state.killCamVictimPos = camera.position.clone();
    if (document.pointerLockElement) document.exitPointerLock();
    startKillCam();
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

  // Kill-cam playback
  if (state.killCamActive) {
    state.killCamPlayTime += renderDt * 0.8;
    const t = Math.min(state.killCamPlayTime, state.killCamDuration);
    const buf = state.killCamBuffer;
    if (buf && buf.length >= 1) {
      let s0 = buf[0], s1 = buf[buf.length - 1];
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i].relT <= t && buf[i + 1].relT > t) { s0 = buf[i]; s1 = buf[i + 1]; break; }
      }
      const alpha = (s1.relT === s0.relT) ? 1 : Math.max(0, Math.min(1, (t - s0.relT) / (s1.relT - s0.relT)));
      const kx = s0.x + (s1.x - s0.x) * alpha;
      const ky = s0.y + (s1.y - s0.y) * alpha;
      const kz = s0.z + (s1.z - s0.z) * alpha;
      let dyaw = s1.yaw - s0.yaw;
      while (dyaw >  Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      state.yaw = s0.yaw + dyaw * alpha;
      // Pitch: aim toward victim death position
      const vp = state.killCamVictimPos;
      if (vp) {
        const dx = vp.x - kx, dy = (vp.y - 0.85) - (ky + 1.6), dz = vp.z - kz;
        state.pitch = -Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
        state.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, state.pitch));
      }
      camera.position.set(kx, ky + 1.6, kz);
    }
    if (state.killCamPlayTime >= state.killCamDuration + 0.5) {
      state.killCamActive = false;
      document.getElementById('killcam-overlay').classList.remove('show');
      showPostDeathMenu();
    }
    updateBots(renderDt);

  // Spectate mode
  } else if (state.playerDead && state.spectateMode) {
    const aliveBots = bots.filter(b => b.alive);
    const aliveRemote = Object.values(state.remotePlayers).filter(rp => !rp.dead);
    const allTargets = [
      ...aliveBots.map(b => ({ type: 'bot', obj: b })),
      ...aliveRemote.map(rp => ({ type: 'player', obj: rp })),
    ];
    if (allTargets.length > 0) {
      const tgt = allTargets[state.spectateIndex % allTargets.length];
      let specPos, specYaw;
      if (tgt.type === 'bot') {
        specPos = tgt.obj.group.position;
        specYaw = tgt.obj.group.rotation.y || 0;
      } else {
        specPos = tgt.obj.mesh.position;
        const snaps = tgt.obj.snapshots;
        specYaw = snaps.length > 0 ? snaps[snaps.length - 1].yaw : 0;
      }
      if (state.spectateMode === '1st') {
        camera.position.lerp(new THREE.Vector3(specPos.x, specPos.y + 1.6, specPos.z), renderDt * 12);
        let dy = specYaw - state.spectateYaw;
        while (dy >  Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        state.spectateYaw += dy * Math.min(1, renderDt * 12);
        state.yaw = state.spectateYaw;
        state.pitch = 0;
      } else {
        const behind = new THREE.Vector3(
          specPos.x - Math.sin(specYaw) * 5,
          specPos.y + 4,
          specPos.z - Math.cos(specYaw) * 5
        );
        camera.position.lerp(behind, renderDt * 4);
        camera.lookAt(specPos.x, specPos.y + 1.5, specPos.z);
      }
      const nameEl = document.getElementById('spec-name');
      if (nameEl) nameEl.textContent = tgt.type === 'bot' ? 'BOT' : ('Player ' + tgt.obj.mesh.userData.id);
    }
    updateBots(renderDt);
  }

  if (streamBoostEl) streamBoostEl.style.display = state.inCanal ? "block" : "none";

  // Gate swing animation
  if (state.gateOpening && gateOpenProgress < 1) {
    gateOpenProgress += renderDt * 0.5;
    if (gateOpenProgress > 1) {
      gateOpenProgress = 1;
    }
    const angle = gateOpenProgress * Math.PI * 0.45;
    gatePivotL.rotation.y = angle;
    gatePivotR.rotation.y = -angle;
  }

  if (!state.playerDead && !state.killCamActive) updateBots(renderDt);

  // Snapshot interpolation — render each remote player at (now - INTERP_DELAY),
  // smoothly interpolating between two real received snapshots. No rubber-banding.
  const INTERP_DELAY = 100; // ms behind real-time
  const renderTime = Date.now() - INTERP_DELAY;

  for (const id in state.remotePlayers) {
    const rp = state.remotePlayers[id];
    const snaps = rp.snapshots;
    if (!snaps || snaps.length === 0) continue;

    // Find the two snapshots that bracket renderTime
    let s0 = snaps[0], s1 = snaps[snaps.length - 1];
    for (let si = 0; si < snaps.length - 1; si++) {
      if (snaps[si].t <= renderTime && snaps[si + 1].t >= renderTime) {
        s0 = snaps[si]; s1 = snaps[si + 1]; break;
      }
    }

    const alpha = (s1.t === s0.t) ? 1 : Math.max(0, Math.min(1, (renderTime - s0.t) / (s1.t - s0.t)));
    rp.mesh.position.x = s0.x + (s1.x - s0.x) * alpha;
    rp.mesh.position.y = s0.y + (s1.y - s0.y) * alpha;
    rp.mesh.position.z = s0.z + (s1.z - s0.z) * alpha;

    // Shortest-path yaw interpolation between snapshots
    if (s0.yaw !== undefined && s1.yaw !== undefined) {
      let dySnap = s1.yaw - s0.yaw;
      while (dySnap >  Math.PI) dySnap -= Math.PI * 2;
      while (dySnap < -Math.PI) dySnap += Math.PI * 2;
      const targetYaw = s0.yaw + dySnap * alpha;
      let dy = targetYaw - rp.mesh.rotation.y;
      while (dy >  Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      rp.mesh.rotation.y += dy * Math.min(1, renderDt * 20);
    }

    // Crouch — smoothly lower the whole group when opponent is crouching
    const crouchTarget = rp.crouching ? -0.5 : 0;
    rp.crouchY += (crouchTarget - rp.crouchY) * Math.min(1, renderDt * 10);
    rp.mesh.position.y += rp.crouchY;
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
    state.eruptionStartTime = state.matchTime;
    // Reset plume — evenly stagger so no wave gap on startup
    _plumeFadeT = 0;
    for (let i = 0; i < _plumeData.length; i++) {
      _plumeData[i].y = (i / _plumeData.length) * PLUME_MAX_Y;
      _plumeData[i].mat.opacity = 0;
    }
    waterWarning.textContent = '⚠ VOLCANO ERUPTING — WATER RISING IN 15 SECONDS ⚠';
    waterWarning.style.fontSize = '28px';
    waterWarning.classList.add('show');
    setTimeout(() => waterWarning.classList.remove('show'), 5000);
    // ash cloud spawning disabled — eruptPoints handles the column visuals
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
    const hazeMat = new THREE.MeshBasicMaterial({ color: 0x777777, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    const haze = new THREE.Mesh(hazeGeo, hazeMat);
    haze.rotation.x = -Math.PI / 2; haze.position.y = 45;
    scene.add(haze);
    state.hazePlane = haze;
  }

  if (state.erupted) updatePlume(renderDt);

  updateAshClouds(renderDt);

  if (state.hazePlane) {
    const timeSinceEruption = Math.max(0, state.matchTime - eruptionTime);
    const targetOpacity = Math.min(0.35, timeSinceEruption * 0.003);
    state.hazePlane.material.opacity += (targetOpacity - state.hazePlane.material.opacity) * renderDt * 0.5;
    const dimFactor = Math.max(0.35, 1 - timeSinceEruption * 0.004);
    sun.intensity = 1.6 * dimFactor;
    sunMesh.material.color.setHex(dimFactor > 0.6 ? 0xFFEE00 : 0xCC8800);
  }

  if (state.erupted && state.matchTime < eruptionTime + 3 && !state.playerDead) {
    const shakeIntensity = 0.234 * (1 - (state.matchTime - eruptionTime) / 3);
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
    if (timeSinceRise < 20) {
      // Slow grace period — crawls up for 20s to give distant players time to reach volcano
      riseProgress = (timeSinceRise / 20) * 0.015;
    } else {
      // After 20s — accelerated rise, shrinks playable volcano area quickly
      const normalProgress = (timeSinceRise - 20) / (state.matchDuration - state.waterRiseStart - 20);
      riseProgress = 0.015 + Math.pow(normalProgress, 0.55) * 0.985;
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

    // Damage is terrain-based — jumping on water doesn't let you escape damage
    const groundUnderPlayer = getTerrainHeight(camera.position.x, camera.position.z);
    if (state.waterLevel > groundUnderPlayer + 0.4) {
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
  const _lootWP = new THREE.Vector3();
  const allLootSources = [...lootItems, ...depotCrates];
  for (const loot of allLootSources) {
    loot.getWorldPosition(_lootWP);
    const dx = _lootWP.x - camera.position.x;
    const dz = _lootWP.z - camera.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > closestDist) continue;
    if (loot.userData.depot) {
      const { shedX, shedZ } = loot.userData;
      const sdx = camera.position.x - shedX, sdz = camera.position.z - shedZ;
      if (Math.sqrt(sdx * sdx + sdz * sdz) > 12) continue;
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
  smokeInst.visible = !state.erupted;
  ashMesh.visible = !state.erupted;
  if (!state.erupted) _plumeGroup.visible = false;
  for (const s of smokeParticles) {
    const riseT = ((clock.elapsedTime * s.speed * 5 + s.phase * 15) % 65);
    const spread = 1 + riseT * 0.07;
    _smokeDummy.position.set(
      s.ox * spread + Math.sin(clock.elapsedTime * 0.3 + s.phase) * 1.5,
      CONFIG.volcanoHeight + 2 + riseT,
      s.oz * spread + Math.cos(clock.elapsedTime * 0.2 + s.phase) * 1.5
    );
    _smokeDummy.scale.setScalar(s.size * (1 + riseT * 0.035));
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

  // Bubble animation — single instanced mesh
  if (window._bubbleInst) {
    const bi = window._bubbleInst, bd = window._bubbleData, bdm = window._bubbleDummy2;
    bi.visible = !state.waterRising;
    if (!state.waterRising) {
      const opac = 0.2 + Math.sin(clock.elapsedTime * 1.5) * 0.12;
      bi.material.opacity = opac;
      for (let i = 0; i < bd.length; i++) {
        const b = bd[i]; if (!b) continue;
        b.y += b.speed * renderDt;
        if (b.y > 3) b.y = -2 - Math.random() * 2;
        bdm.position.set(b.bx, b.y, b.bz);
        bdm.scale.setScalar(b.size);
        bdm.updateMatrix();
        bi.setMatrixAt(i, bdm.matrix);
      }
      bi.instanceMatrix.needsUpdate = true;
    }
  }

  // ── Stream water shimmer ──
  if (window.streamWater) {
    const st = clock.elapsedTime;
    const shimmer = Math.sin(st * 1.3) * 0.04 + Math.sin(st * 3.1) * 0.02 + Math.sin(st * 0.7) * 0.015;
    window.streamWater.material.color.setRGB(
      0.08 + shimmer * 0.35,
      0.50 + shimmer * 0.85,
      0.82 + shimmer * 0.45
    );
    window.streamWater.material.opacity = 0.74 + Math.sin(st * 0.9) * 0.10;
  }

  // ── Head bob ──
  const isMoving = smoothedMove.lengthSq() > 0.01;
  if (state.isGrounded && isMoving && !state.ads) {
    headBobPhase += renderDt * 8;
  } else {
    headBobPhase += renderDt * 1.5;
  }
  const headBobY = (state.isGrounded && isMoving && !state.ads)
    ? Math.sin(headBobPhase) * 0.015
    : 0;

  // ── Jump / landing pitch kick (spring) ──
  const justLeftGround = !state.isGrounded && wasGrounded;
  const justLanded     = state.isGrounded  && !wasGrounded;
  wasGrounded = state.isGrounded;
  landingCooldown = Math.max(0, landingCooldown - renderDt);
  if (justLeftGround && landingCooldown === 0) {
    landingBobVel  = -0.5;    // slight upward pitch tug on takeoff
    weaponJumpVel  = -0.05;   // weapon lags behind — dips down on takeoff
    landingCooldown = 0.4;
  }
  if (justLanded && landingCooldown === 0) {
    landingBobVel  = 0.361;   // forward pitch kick on landing
    weaponJumpVel  = -0.07;   // weapon bounces down on landing
    landingCooldown = 0.4;
  }
  landingBobY += landingBobVel * renderDt;
  landingBobVel += (-landingBobY * 200 - landingBobVel * 18) * renderDt;
  weaponJumpY += weaponJumpVel * renderDt;
  weaponJumpVel += (-weaponJumpY * 80 - weaponJumpVel * 12) * renderDt;

  // Weapon bob + reload animation
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
    const adsX = state.currentWeapon === 'm4' ? 0 : -0.15;
    targetPos = new THREE.Vector3(adsX, -0.04, restPos.z + 0.06);
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
  targetPos.y += weaponJumpY;
  const lerpSpeed = state.reloadPhase ? 6 : 12;
  weaponGroup.position.lerp(targetPos, renderDt * lerpSpeed);
  if (!state.reloadPhase) {
    weaponGroup.rotation.x += (0 - weaponGroup.rotation.x) * renderDt * 10;
  } else {
    weaponGroup.rotation.x += (-0.3 - weaponGroup.rotation.x) * renderDt * 6;
  }
  weaponGroup.rotation.y += (0 - weaponGroup.rotation.y) * renderDt * 10;
  // Strafe sway — weapon tilts into the direction of lateral movement
  const strafeAmt = state.moveLeft ? 1 : state.moveRight ? -1 : 0;
  const targetSwayZ = state.ads ? 0 : strafeAmt * 0.069;
  weaponGroup.rotation.z += (targetSwayZ - weaponGroup.rotation.z) * renderDt * 7;
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

  // Apply head bob (position) + landing pitch kick (rotation) for this frame only
  camera.position.add(state.shakeOffset);
  camera.position.y += headBobY;
  euler.set(state.pitch + landingBobY, state.yaw, 0, 'YXZ');
  camera.quaternion.setFromEuler(euler);
  if (window.skyDome) window.skyDome.position.copy(camera.position);
  renderer.clear();
  renderer.render(scene, camera);
  if (!state.killCamActive && !state.playerDead) {
    renderer.clearDepth();
    renderer.render(weaponScene, weaponCamera);
  }
  camera.position.y -= headBobY;
  camera.position.sub(state.shakeOffset);
  // Restore physics quaternion
  euler.set(state.pitch, state.yaw, 0, 'YXZ');
  camera.quaternion.setFromEuler(euler);
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
// Server connection only started when player picks Real Players mode
window.startBotMatch = function() {
  state.gameMode = "bot";
  const ov = document.getElementById("overlay");
  if (ov) ov.classList.add("hidden");
  if (typeof spawnBots === 'function') spawnBots();
  state.phase = "countdown";
  state.matchStartAt = Date.now();
  renderer.domElement.requestPointerLock();
};
window.showPvPOptions = function() {
  const el = document.getElementById("pvp-options");
  if (!el) return;
  el.style.display = (el.style.display === "flex") ? "none" : "flex";
};
window.startPvPMatch = function() {
  state.gameMode = "pvp";
  const ov = document.getElementById("overlay");
  if (ov) ov.classList.add("hidden");
  const lobbyEl = document.getElementById("lobbyScreen");
  if (lobbyEl) lobbyEl.classList.add("visible");
  const modeEl = document.getElementById("lobbyModeLabel");
  if (modeEl) modeEl.textContent = "WAITING FOR PLAYERS...";
  const statusEl = document.getElementById("lobbyStatus");
  if (statusEl) statusEl.textContent = "Connecting...";
  renderer.domElement.requestPointerLock();
  state.phase = "lobby";
  state.inLobby = true;
  camera.position.set(
    CONFIG.prisonPos.x + (Math.random() - 0.5) * 8,
    CONFIG.playerHeight,
    CONFIG.prisonPos.z + (Math.random() - 0.5) * 8
  );
  state.ammo.m4 = 30; state.ammo.pistol = 15;
  state.reserveAmmo.m4 = 90; state.reserveAmmo.pistol = 45;
  try { connectToServer(); } catch(e) { console.error("connectToServer failed:", e); }
};
update();

document.getElementById('go-restart').addEventListener('click', () => location.reload());
document.getElementById('win-restart').addEventListener('click', () => location.reload());

document.addEventListener('click', () => {
  if (state.playerDead && state.spectateMode) state.spectateIndex++;
});

// ── Kill-cam: build replay buffer from killer's snapshot history ──
function startKillCam() {
  state.killCamPlayTime = 0;
  state.killCamActive = true;
  state.killCamBuffer = [];
  const now = Date.now();
  const cutoff = now - 3000;

  let snaps = null;
  if (state.killCamShooterId && state.remotePlayers[state.killCamShooterId]) {
    snaps = state.remotePlayers[state.killCamShooterId].snapshots.filter(s => s.t >= cutoff);
  }

  if (snaps && snaps.length > 0) {
    const baseT = snaps[0].t;
    state.killCamBuffer = snaps.map(s => ({
      relT: (s.t - baseT) / 1000,
      x: s.x, y: s.y, z: s.z, yaw: s.yaw,
    }));
    state.killCamDuration = (snaps[snaps.length - 1].t - baseT) / 1000;
  } else if (state.killCamBotIndex >= 0 && bots[state.killCamBotIndex]) {
    const bot = bots[state.killCamBotIndex];
    const vp = state.killCamVictimPos || camera.position;
    const rawSnaps = bot.snapshots.filter(s => s.t >= cutoff);
    if (rawSnaps.length > 0) {
      const baseT = rawSnaps[0].t;
      state.killCamBuffer = rawSnaps.map(s => ({
        relT: (s.t - baseT) / 1000,
        x: s.x, y: s.y, z: s.z,
        yaw: Math.atan2(vp.x - s.x, vp.z - s.z), // always aimed at player
      }));
      state.killCamDuration = (rawSnaps[rawSnaps.length - 1].t - baseT) / 1000;
    } else {
      // No history — static frame from bot's current position
      const bp = bot.group.position;
      const byaw = Math.atan2(vp.x - bp.x, vp.z - bp.z);
      state.killCamBuffer = [
        { relT: 0, x: bp.x, y: bp.y, z: bp.z, yaw: byaw },
        { relT: 3, x: bp.x, y: bp.y, z: bp.z, yaw: byaw },
      ];
      state.killCamDuration = 3.0;
    }
  } else {
    // Unknown killer — place cam near death position
    const vp = state.killCamVictimPos || camera.position;
    state.killCamBuffer = [
      { relT: 0, x: vp.x - 4, y: vp.y - 1.0, z: vp.z, yaw: 0 },
      { relT: 3, x: vp.x - 4, y: vp.y - 1.0, z: vp.z, yaw: 0 },
    ];
    state.killCamDuration = 3.0;
  }

  document.getElementById('killcam-overlay').classList.add('show');
  const crosshairEl = document.getElementById('crosshair');
  if (crosshairEl) crosshairEl.style.display = 'none';
}

// ── Show post-death stat card + spectate choice menu ──
function showPostDeathMenu() {
  const goScreen = document.getElementById('game-over-screen');
  document.getElementById('go-kills').textContent = state.kills;
  const m = Math.floor(state.matchTime / 60);
  const s = Math.floor(state.matchTime % 60);
  document.getElementById('go-time').textContent = m + ':' + String(s).padStart(2, '0');
  const acc = state.shotsFired > 0 ? Math.round(state.shotsHit / state.shotsFired * 100) : 0;
  document.getElementById('go-shots').textContent = state.shotsFired;
  document.getElementById('go-accuracy').textContent = acc + '%';
  setTimeout(() => goScreen.classList.add('show'), 300);
}

window.startSpectate = function(mode) {
  state.spectateMode = mode;
  state.spectateIndex = 0;
  document.getElementById('game-over-screen').classList.remove('show');
  document.getElementById('spectate-banner').classList.add('show');
};

// ─────────────────────────────────────────────────────────────────────────────
// MULTIPLAYER — WebSocket client
// ─────────────────────────────────────────────────────────────────────────────

var WS_URL = 'wss://deported.onrender.com';

// ── Merge an array of part descriptors into a single BufferGeometry with vertex colors.
// Each part: { geo, color (hex int), pos [x,y,z], rot [x,y,z] (optional) }
// Vertex colors make this forward-compatible with texture-atlas skins — just overlay a UV map later.
const _mergeDummy = new THREE.Object3D();
function _buildMergedGeo(partDefs) {
  let totalVerts = 0;
  const processed = [];
  for (const p of partDefs) {
    const g = p.geo.clone().toNonIndexed();
    _mergeDummy.position.set(p.pos[0], p.pos[1], p.pos[2]);
    _mergeDummy.rotation.set(p.rot ? p.rot[0] : 0, p.rot ? p.rot[1] : 0, p.rot ? p.rot[2] : 0);
    _mergeDummy.scale.set(1, 1, 1);
    _mergeDummy.updateMatrix();
    g.applyMatrix4(_mergeDummy.matrix); // bakes position+rotation into vertex positions & normals
    totalVerts += g.attributes.position.count;
    processed.push({ g, c: new THREE.Color(p.color) });
  }
  const posArr = new Float32Array(totalVerts * 3);
  const norArr = new Float32Array(totalVerts * 3);
  const colArr = new Float32Array(totalVerts * 3);
  let off = 0;
  for (const { g, c } of processed) {
    const n = g.attributes.position.count;
    posArr.set(g.attributes.position.array, off * 3);
    norArr.set(g.attributes.normal.array,   off * 3);
    for (let i = 0; i < n; i++) {
      colArr[(off + i) * 3]     = c.r;
      colArr[(off + i) * 3 + 1] = c.g;
      colArr[(off + i) * 3 + 2] = c.b;
    }
    off += n;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(norArr, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colArr, 3));
  return geo;
}

// Shared single material for all remote players — vertex colors carry per-player/part tinting.
const _remotePlayerMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const _remoteHitboxMat = new THREE.MeshBasicMaterial({ colorWrite: false });

// Humanoid remote player — 2 draw calls per player (1 merged visual + 1 invisible hitbox).
// Group origin = camera eye height; all geometry offsets downward so feet meet world ground.
function createRemotePlayerMesh(id) {
  const group = new THREE.Group();
  const hue = (parseInt(id.slice(-4), 16) || 0) % 360;

  const bodyHex   = new THREE.Color('hsl(' + hue + ',60%,40%)').getHex();
  const helmetHex = new THREE.Color('hsl(' + hue + ',40%,25%)').getHex();

  const mergedGeo = _buildMergedGeo([
    // Head
    { geo: new THREE.SphereGeometry(0.17, 8, 6),              color: 0xf0c080, pos: [0,     -0.10,  0]              },
    // Helmet dome
    { geo: new THREE.CylinderGeometry(0.20, 0.21, 0.15, 8),   color: helmetHex, pos: [0,     0.03,   0]             },
    // Visor
    { geo: new THREE.BoxGeometry(0.30, 0.05, 0.09),            color: 0x111111, pos: [0,     -0.05, -0.21]           },
    // Neck
    { geo: new THREE.CylinderGeometry(0.07, 0.08, 0.12, 6),   color: 0xf0c080, pos: [0,     -0.33,  0]              },
    // Torso
    { geo: new THREE.BoxGeometry(0.42, 0.52, 0.22),            color: bodyHex,  pos: [0,     -0.65,  0]              },
    // Left arm
    { geo: new THREE.CylinderGeometry(0.065, 0.055, 0.48, 6), color: bodyHex,  pos: [-0.28, -0.68,  0], rot: [0, 0,  0.15] },
    // Right arm
    { geo: new THREE.CylinderGeometry(0.065, 0.055, 0.48, 6), color: bodyHex,  pos: [0.28,  -0.68,  0], rot: [0, 0, -0.15] },
    // Gun body
    { geo: new THREE.BoxGeometry(0.06, 0.08, 0.52),            color: 0x222222, pos: [0.36,  -0.72, -0.17]           },
    // Gun stock
    { geo: new THREE.BoxGeometry(0.05, 0.13, 0.17),            color: 0x3a2a1a, pos: [0.36,  -0.76,  0.15]           },
    // Balaclava front
    { geo: new THREE.BoxGeometry(0.26, 0.15, 0.05),            color: 0x1a1a1a, pos: [0,     -0.20, -0.14]           },
    // Balaclava side L
    { geo: new THREE.BoxGeometry(0.05, 0.15, 0.10),            color: 0x1a1a1a, pos: [-0.13, -0.20, -0.08]           },
    // Balaclava side R
    { geo: new THREE.BoxGeometry(0.05, 0.15, 0.10),            color: 0x1a1a1a, pos: [0.13,  -0.20, -0.08]           },
    // Left leg
    { geo: new THREE.CylinderGeometry(0.09, 0.08, 0.65, 6),   color: 0x1a2a44, pos: [-0.11, -1.15,  0]              },
    // Right leg
    { geo: new THREE.CylinderGeometry(0.09, 0.08, 0.65, 6),   color: 0x1a2a44, pos: [0.11,  -1.15,  0]              },
    // Left boot
    { geo: new THREE.BoxGeometry(0.13, 0.12, 0.20),            color: 0x111111, pos: [-0.11, -1.57,  0.03]           },
    // Right boot
    { geo: new THREE.BoxGeometry(0.13, 0.12, 0.20),            color: 0x111111, pos: [0.11,  -1.57,  0.03]           },
  ]);

  group.add(new THREE.Mesh(mergedGeo, _remotePlayerMat));

  // Invisible hitbox — separate so it stays at the fixed head position for raycasting
  const hitbox = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4), _remoteHitboxMat);
  hitbox.position.y = -0.10;
  hitbox.userData.isHead = true;
  group.add(hitbox);

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
  const now = Date.now();

  for (const p of playerList) {
    if (p.id === state.myId) continue;
    seen.add(p.id);

    if (!state.remotePlayers[p.id]) {
      const newMesh = createRemotePlayerMesh(p.id);
      newMesh.position.set(p.x, p.y, p.z);
      state.remotePlayers[p.id] = { mesh: newMesh, hp: p.hp, dead: p.dead, snapshots: [], crouchY: 0 };
    }

    const rp = state.remotePlayers[p.id];
    rp.hp = p.hp;
    rp.dead = p.dead;
    rp.crouching = p.crouch || false;
    rp.mesh.visible = !p.dead;

    rp.snapshots.push({ t: now, x: p.x, y: p.y, z: p.z, yaw: p.yaw, crouch: p.crouch });
    // Keep 4s of history for kill-cam; interpolation only needs 2 at a time
    const cutoff = now - 4000;
    while (rp.snapshots.length > 2 && rp.snapshots[0].t < cutoff) rp.snapshots.shift();
  }

  for (const id of Object.keys(state.remotePlayers)) {
    if (!seen.has(id)) removeRemotePlayer(id);
  }
}


// ── LOBBY SCREEN HELPERS ────────────────────────────────────
function showLobbyScreen(code) {
  const el = document.getElementById('lobbyScreen');
  const codeEl = document.getElementById('lobbyCode');
  if (el) el.classList.add('visible');
  if (codeEl) codeEl.textContent = code || '----';
  const showCode = !!state.joinedWithCode;
  const codeLabelEl = document.querySelector('.lobby-code-label');
  const codeHintEl  = document.querySelector('.lobby-code-hint');
  const d = showCode ? '' : 'none';
  if (codeEl)       codeEl.style.display       = d;
  if (codeLabelEl)  codeLabelEl.style.display   = d;
  if (codeHintEl)   codeHintEl.style.display    = d;
}

function hideLobbyScreen() {
  const el = document.getElementById('lobbyScreen');
  if (el) el.classList.remove('visible');
}

function updateLobbyUI(msg) {
  const listEl   = document.getElementById('lobbyPlayerList');
  const statusEl = document.getElementById('lobbyStatus');
  const btn      = document.getElementById('lobbyReadyBtn');
  const TOTAL_SLOTS = 21;
  const players = msg.players || [];
  state.lobbyPlayerCount = players.length;

  if (listEl) {
    let html = '';
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      if (i < players.length) {
        const p = players[i];
        const isMe = (p.id === state.myId);
        const rc = p.ready ? 'is-ready' : '';
        html += '<div class="lobby-slot">' +
          '<div class="slot-dot ' + rc + '"></div>' +
          '<div class="slot-name ' + (isMe ? 'is-me' : 'is-player') + '">' +
            (p.name || p.id) + (isMe ? ' (you)' : '') +
          '</div>' +
          '<div class="slot-status ' + rc + '">' + (p.ready ? 'READY' : 'waiting') + '</div>' +
        '</div>';
      } else {
        html += '<div class="lobby-slot lobby-slot-empty">' +
          '<div class="slot-dot slot-dot-empty"></div>' +
          '<div class="slot-name slot-name-empty">— open —</div>' +
          '<div class="slot-status"></div>' +
        '</div>';
      }
    }
    listEl.innerHTML = html;
  }

  if (statusEl) {
    const readyCount = players.filter(p => p.ready).length;
    const total = players.length;
    const need  = Math.ceil(total * 0.51);
    statusEl.textContent = readyCount + ' / ' + total + ' ready — need ' + need + ' to start';
  }

  if (btn) {
    const me = players.find(p => p.id === state.myId);
    if (me && me.ready) {
      btn.textContent = 'UNREADY';
      btn.classList.add('is-ready');
    } else {
      btn.textContent = 'READY UP';
      btn.classList.remove('is-ready');
    }
  }
}

window.toggleReady = function() {
  console.log('[ready] ws:', state.ws && state.ws.readyState, '| myId:', state.myId, '| joinSent:', state.joinSent);
  if (!state.myId) { console.warn('[ready] not joined yet'); return; }
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'ready' }));
    console.log('[ready] sent');
  }
};

function sendJoin() {
  if (state.joinSent) return;
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  const roomInput = document.getElementById('room-input');
  const requestedRoom = roomInput ? roomInput.value.trim().toUpperCase() : '';
  state.ws.send(JSON.stringify({
    type: 'join',
    name: 'Player' + Math.floor(Math.random() * 1000),
    roomCode: requestedRoom || undefined,
    gameMode: state.gameMode || 'bot',
  }));
  state.joinSent = true;
  state.joinedWithCode = !!requestedRoom;
  console.log('Join sent — room:', requestedRoom || '(auto)');
}

function adjustBotsForPlayerCount(playerCount) {
  const toRemove = Math.min(Math.max(0, playerCount - 1), bots.length);
  let removed = 0;
  for (let i = 0; i < bots.length && removed < toRemove; i++) {
    const bot = bots[i];
    if (!bot.alive) continue;
    bot.alive = false;
    bot.hp = 0;
    scene.remove(bot.group);
    bot.group.children.forEach(c => {
      const idx = targets.indexOf(c);
      if (idx >= 0) targets.splice(idx, 1);
    });
    removed++;
  }
  if (removed > 0) console.log('[room] Removed ' + removed + ' bots — ' + bots.filter(b=>b.alive).length + ' bots + ' + playerCount + ' players = 21 total');
}

function showRoomCode(code) {
  if (!code) return;
  const el = document.getElementById('room-code-badge');
  if (!el) return;
  el.textContent = 'Room: ' + code;
  el.style.display = 'block';
}

// ── Unpack binary world snapshot from server ──
// Format: [0x01][count] then per player: 6-byte id | flags | hp | armor | uint16 yaw | int16 x,y,z (×100)
const _UNPACK_SCALE = 1 / 100;
function unpackWorld(ab) {
  const dv = new DataView(ab);
  const count = dv.getUint8(1);
  const players = [];
  let off = 2;
  for (let i = 0; i < count; i++) {
    let id = '';
    for (let b = 0; b < 6; b++) { const c = dv.getUint8(off + b); if (c) id += String.fromCharCode(c); }
    off += 6;
    const flags = dv.getUint8(off++);
    const hp    = dv.getUint8(off++);
    const armor = dv.getUint8(off++);
    const yaw   = dv.getUint16(off, true) / 65535 * Math.PI * 2; off += 2;
    const x     = dv.getInt16(off, true) * _UNPACK_SCALE; off += 2;
    const y     = dv.getInt16(off, true) * _UNPACK_SCALE; off += 2;
    const z     = dv.getInt16(off, true) * _UNPACK_SCALE; off += 2;
    players.push({ id, hp, armor, yaw, x, y, z, dead: !!(flags & 1), crouch: !!(flags & 2) });
  }
  return players;
}

function connectToServer() {
  console.log('Connecting to wss://deported.onrender.com');
  state.ws = new WebSocket('wss://deported.onrender.com');
  state.ws.binaryType = 'arraybuffer';

  state.ws.onopen = () => {
    console.log('WS connected — waiting for player to click play');
    state.wsReady = true;
    // In pvp mode, send join immediately on connect
    if (state.gameMode === 'pvp') sendJoin();
  };

  state.ws.onmessage = (event) => {
    // Binary world snapshot
    if (event.data instanceof ArrayBuffer) {
      const dv = new DataView(event.data);
      if (dv.getUint8(0) === 0x01) {
        state.lastWorldAt = Date.now();
        updateRemotePlayers(unpackWorld(event.data));
      }
      return;
    }

    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    switch (msg.type) {

      case 'welcome':
        state.myId = msg.id;
        state.roomCode = msg.roomCode;
        state.roomPlayerCount = msg.playerCount || 1;
        console.log('My ID:', state.myId, '| Room:', state.roomCode, '| Players:', state.roomPlayerCount);
        if (msg.seed !== undefined) { _seed = msg.seed; console.log('World seed:', _seed); }
        adjustBotsForPlayerCount(state.roomPlayerCount);
        showRoomCode(state.roomCode);
        break;

      case 'joined':
        state.myId = msg.id;
        state.roomCode = msg.roomCode;
        state.fillEndsAt = msg.fillEndsAt || null;
        showRoomCode(msg.roomCode);
        if (msg.phase === 'waiting') {
          state.inLobby = true;
          showLobbyScreen(msg.roomCode);
          const chatW = document.getElementById('chat-container');
          if (chatW) chatW.style.setProperty('display', 'flex', 'important');
          // Start fill countdown display
          if (state.fillEndsAt) {
            clearInterval(state._fillInterval);
            state.lobbyPlayerCount = state.lobbyPlayerCount || 1;
            state._fillInterval = setInterval(function() {
              const statusEl = document.getElementById('lobbyStatus');
              if (!statusEl || !state.inLobby) return;
              if ((state.lobbyPlayerCount || 1) < 2) {
                statusEl.textContent = 'Waiting for players to join...';
                return;
              }
              const rem = Math.max(0, Math.ceil((state.fillEndsAt - Date.now()) / 1000));
              const m = Math.floor(rem / 60), s = rem % 60;
              statusEl.textContent = 'Match starts in ' + m + ':' + String(s).padStart(2,'0') + (rem === 0 ? ' — Starting!' : '');
              if (rem === 0) clearInterval(state._fillInterval);
            }, 500);
          }
        } else {
          state.inLobby = false;
          const chat = document.getElementById('chat-container');
          if (chat) chat.style.setProperty('display', 'flex', 'important');
        }
        break;
      case 'lobbyState':
        updateLobbyUI(msg);
        break;
      case 'startMatch':
        state.matchStartAt = msg.startAt || (Date.now() + 2500);
        state.phase = 'countdown';
        state.countdownTime = 10;
        (function() {
          var flash = document.createElement('div');
          flash.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;z-index:9999;pointer-events:none;';
          var txt = document.createElement('div');
          txt.style.cssText = 'color:#ffd700;font-size:64px;font-weight:900;letter-spacing:8px;text-shadow:0 0 40px #ffd700,0 0 80px #ffd700;font-family:monospace;';
          txt.textContent = 'GAME STARTING';
          flash.appendChild(txt);
          document.body.appendChild(flash);
          setTimeout(function() { if (flash.parentNode) flash.parentNode.removeChild(flash); }, 2500);
        })();
        state.inLobby = false;
        hideLobbyScreen();
        // Reset player to clean match start — no warmup gear carries over
        state.hp = 100;
        state.armor = 0;
        state.ammo = { m4: 0, pistol: 0 };
        state.reserveAmmo = { m4: 0, pistol: 0 };
        if (typeof updateHUD === 'function') updateHUD();
        state.velocityY = 0;
        camera.position.set(
          CONFIG.prisonPos.x + (Math.random() - 0.5) * 10,
          CONFIG.playerHeight,
          CONFIG.prisonPos.z + (Math.random() - 0.5) * 10
        );
        { const chatEl = document.getElementById('chat-container');
          if (chatEl) chatEl.style.setProperty('display', 'flex', 'important'); }
        // Can't call requestPointerLock from WS handler (not a user gesture) — flag it
        // and catch on next canvas click. Show prompt so player knows to click.
        state.pendingLock = true;
        { const pl = document.getElementById('click-to-play');
          if (pl) pl.style.setProperty('display', 'flex', 'important'); }
        break;
      case 'chat':
        addChatMessage(msg.id || 'unknown', msg.text || '');
        break;
      case 'events':
        for (const evt of msg.events) {
          if (evt.type === 'hit') applyHitEvent(evt);
        }
        break;

      case 'existingPlayers':
        updateRemotePlayers(msg.players);
        break;

      case 'roomUpdate':
        state.roomPlayerCount = msg.playerCount || state.roomPlayerCount;
        adjustBotsForPlayerCount(state.roomPlayerCount);
        showRoomCode(msg.roomCode || state.roomCode);
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

// ── Send binary input packet to server ──
// Format: [0x02][seq uint16][x,y,z,yaw,pitch float32][keys uint8] = 24 bytes
const _inputBuf = new ArrayBuffer(24);
const _inputDV  = new DataView(_inputBuf);
_inputDV.setUint8(0, 0x02);

function sendInputToServer() {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.myId) return;
  state.inputSeq = (state.inputSeq + 1) & 0xffff;
  _inputDV.setUint16(1,  state.inputSeq,       true);
  _inputDV.setFloat32(3, camera.position.x,    true);
  _inputDV.setFloat32(7, camera.position.y,    true);
  _inputDV.setFloat32(11, camera.position.z,   true);
  _inputDV.setFloat32(15, state.yaw   || 0,    true);
  _inputDV.setFloat32(19, state.pitch || 0,    true);
  const keys =
    (state.moveForward ? 1  : 0) |
    (state.moveBack    ? 2  : 0) |
    (state.moveLeft    ? 4  : 0) |
    (state.moveRight   ? 8  : 0) |
    (state.crouching   ? 16 : 0) |
    (state.shooting    ? 64 : 0);
  _inputDV.setUint8(23, keys);
  state.ws.send(_inputBuf);
}

// Heartbeat — keeps connection alive when tab is backgrounded
setInterval(sendInputToServer, 50);

// Stale connection watchdog — Render's proxy can silently drop WS connections
// without firing onclose. If no world snapshot arrives in 5s, force reconnect.
setInterval(() => {
  if (!state.myId) return;
  const age = Date.now() - (state.lastWorldAt || Date.now());
  if (age > 5000) {
    console.warn('[watchdog] No world snapshot for ' + (age/1000).toFixed(1) + 's — reconnecting');
    if (state.ws) state.ws.close();
    state.lastWorldAt = Date.now();
  }
}, 2000);

window.addEventListener('DOMContentLoaded', function() { setupChat(); });
