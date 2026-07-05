// ═══════════════════════════════════════════════════════════
// PHYSICS — Capsule sweep-and-slide, fixed timestep
// Velocity-based movement: ground accel/friction, air control, slide
// Toggled by CONFIG.newPhysics in 01_config.js
// ═══════════════════════════════════════════════════════════

const PHYS = {
  FIXED_STEP:  1 / 60,   // 60 Hz fixed timestep — deterministic, same result every run
  STEP_HEIGHT: 0.45,     // Max ledge auto-step (curbs, terrain lips)
  SKIN_WIDTH:  0.015,    // Stop just before surface to prevent tunneling
  MAX_ITER:    4,        // Max slide iterations per step (handles corners)
  STEP_SMOOTH: 12.0,     // Camera-Y catch-up rate on stairs (higher = snappier, lower = floatier)

  // ── Movement feel (Quake-family model) ──
  GROUND_FRICTION:   9.0,   // Higher = stops faster. ~3 steps to stop
  GROUND_ACCEL:      11.0,  // Higher = reaches max speed faster. ~4 steps to full
  AIR_ACCEL:         1.4,   // Weak mid-air steering — momentum carries through jumps
  SLIDE_BOOST:       1.35,  // Velocity multiplier on slide trigger
  SLIDE_FRICTION:    0.22,  // Friction multiplier while sliding (low = long slide)
  SLIDE_MIN_TRIGGER: 0.85,  // Must be moving at >= this fraction of moveSpeed to slide
  SLIDE_COOLDOWN:    1.0,   // Seconds before another slide can trigger
};

let _physAccum = 0;     // Leftover time between fixed steps
let _prevCrouch = false; // Edge-detect crouch press for slide trigger

// Capsule state.
//   pos = FEET position in world space (not eye/camera)
//   vel = world velocity (XYZ) — horizontal components now persistent
//   grounded = true when standing on something
const phys = {
  pos:      new THREE.Vector3(),
  vel:      new THREE.Vector3(),
  grounded: false,
};
if (window.DBG) window.DBG.phys = phys;

// Call once after buildCollisionCache() to seed phys from camera
function physInit() {
  phys.pos.set(
    camera.position.x,
    camera.position.y - CONFIG.playerHeight,
    camera.position.z
  );
  phys.vel.set(0, 0, 0);
  phys.grounded = true;
  _physAccum = 0;
  _prevCrouch = false;
  state.sliding = false;
  state.slideCooldown = 0;
  state.camFeetY = phys.pos.y;
}

// ── Sweep a 2D point (px,pz) moving by (dx,dz) against axis-aligned rect [x0,x1]x[z0,z1]
// Returns { t, nx, nz } on contact, null if no contact in [0,1).
// nx/nz is the outward face normal of the rect at contact.
function _sweep2D(px, pz, dx, dz, x0, x1, z0, z1) {
  let tEnter = 0, tExit = 1;
  let nx = 0, nz = 0;

  // X slab
  if (Math.abs(dx) < 1e-9) {
    if (px <= x0 || px >= x1) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (x0 - px) * inv;
    let t2 = (x1 - px) * inv;
    let n  = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; n = 1; }
    if (t1 > tEnter) { tEnter = t1; nx = n; nz = 0; }
    tExit = Math.min(tExit, t2);
  }

  // Z slab
  if (Math.abs(dz) < 1e-9) {
    if (pz <= z0 || pz >= z1) return null;
  } else {
    const inv = 1 / dz;
    let t1 = (z0 - pz) * inv;
    let t2 = (z1 - pz) * inv;
    let n  = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; n = 1; }
    if (t1 > tEnter) { tEnter = t1; nx = 0; nz = n; }
    tExit = Math.min(tExit, t2);
  }

  if (tEnter >= tExit || tEnter >= 1 || tExit <= 0) return null;
  // Started overlapping — depenetration handles this separately
  if (tEnter < 0) return null;

  return { t: tEnter, nx, nz };
}

// ── Push player out of any colliders they're currently inside ──
// Called as a safety pass after each fixed step.
function _depenetrate(pos, radius, height) {
  for (const entry of collidableCache) {
    const bb = entry.bb;
    if (bb.max.y <= pos.y || bb.min.y >= pos.y + height) continue;

    const cx = (bb.min.x + bb.max.x) * 0.5;
    const cz = (bb.min.z + bb.max.z) * 0.5;
    const hx = (bb.max.x - bb.min.x) * 0.5 + radius;
    const hz = (bb.max.z - bb.min.z) * 0.5 + radius;

    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const ox = hx - Math.abs(dx);
    const oz = hz - Math.abs(dz);

    if (ox <= 0 || oz <= 0) continue;

    if (ox < oz) {
      pos.x += ox * Math.sign(dx || 1);
    } else {
      pos.z += oz * Math.sign(dz || 1);
    }
  }

  // OBB depenetration — local center stored in shed-local space; Three.js inverse used.
  // Three.js Y-rotation: world = shed + R*local  where R=[[cosR,sinR],[-sinR,cosR]]
  // Inverse:            local = R^T*(world-shed) = [[cosR,-sinR],[sinR,cosR]]*(world-shed)
  for (const obb of obbCollidables) {
    if (obb.maxY <= pos.y || obb.minY >= pos.y + height) continue;
    const dx = pos.x - obb.shedX;
    const dz = pos.z - obb.shedZ;
    const lx = (dx * obb.cosR - dz * obb.sinR) - obb.lcx;
    const lz = (dx * obb.sinR + dz * obb.cosR) - obb.lcz;
    const ox = obb.hx + radius - Math.abs(lx);
    const oz = obb.hz + radius - Math.abs(lz);
    if (ox <= 0 || oz <= 0) continue;
    let pushLX = 0, pushLZ = 0;
    if (ox < oz) { pushLX = ox * Math.sign(lx || 1); }
    else          { pushLZ = oz * Math.sign(lz || 1); }
    // R * push_local: world_x += cosR*pushLX + sinR*pushLZ
    pos.x += pushLX * obb.cosR + pushLZ * obb.sinR;
    pos.z += -pushLX * obb.sinR + pushLZ * obb.cosR;
  }
}

// ── Horizontal sweep-and-slide ──
// Moves pos.x/z by (deltaX, deltaZ), bouncing/sliding off colliders up to MAX_ITER times.
// If `vel` is provided, the stored velocity is clipped against each wall normal hit —
// this prevents pressure buildup against walls that would release as a lurch.
// Returns the Y of any ledge we should step up onto (0 = no step needed).
function _moveHorizontal(pos, deltaX, deltaZ, radius, height, stepHeight, vel) {
  let rx = deltaX, rz = deltaZ;
  let stepUpY = 0;

  for (let iter = 0; iter < PHYS.MAX_ITER; iter++) {
    const len = Math.sqrt(rx * rx + rz * rz);
    if (len < 1e-7) break;

    let tMin = 1.0, hitNX = 0, hitNZ = 0, isStep = false;

    for (const entry of collidableCache) {
      const bb = entry.bb;
      const bbTop = bb.max.y;
      const bbBot = bb.min.y;
      const playerTop = pos.y + height;

      // Step-up: box top is above feet AND within step height
      const heightAboveFeet = bbTop - pos.y;
      const couldStep = heightAboveFeet > 0 && heightAboveFeet <= stepHeight;
      // Full body block: box Y range overlaps player Y range (and is not a step)
      const yOverlap = !couldStep && bbTop > pos.y + 0.01 && bbBot < playerTop - 0.01;

      if (!yOverlap && !couldStep) continue;

      // Expand BB by capsule radius (Minkowski sum in XZ plane)
      const hit = _sweep2D(
        pos.x, pos.z, rx, rz,
        bb.min.x - radius, bb.max.x + radius,
        bb.min.z - radius, bb.max.z + radius
      );
      if (!hit || hit.t >= tMin) continue;

      tMin   = hit.t;
      isStep = couldStep;
      hitNX  = isStep ? 0 : hit.nx;
      hitNZ  = isStep ? 0 : hit.nz;
      if (isStep) stepUpY = Math.max(stepUpY, bbTop);
    }

    // OBB sweep — local center in shed space; Three.js inverse used (same as depenetrate)
    for (const obb of obbCollidables) {
      const bbTop = obb.maxY, bbBot = obb.minY;
      const heightAboveFeet = bbTop - pos.y;
      const couldStepO = heightAboveFeet > 0 && heightAboveFeet <= stepHeight;
      const yOverlapO = !couldStepO && bbTop > pos.y + 0.01 && bbBot < pos.y + height - 0.01;
      if (!yOverlapO && !couldStepO) continue;
      const dx = pos.x - obb.shedX;
      const dz = pos.z - obb.shedZ;
      const lx  = (dx * obb.cosR - dz * obb.sinR) - obb.lcx;
      const lz  = (dx * obb.sinR + dz * obb.cosR) - obb.lcz;
      const ldx = rx * obb.cosR - rz * obb.sinR;
      const ldz = rx * obb.sinR + rz * obb.cosR;
      const hit = _sweep2D(lx, lz, ldx, ldz, -obb.hx, obb.hx, -obb.hz, obb.hz);
      if (!hit || hit.t >= tMin) continue;
      tMin = hit.t;
      isStep = couldStepO;
      if (isStep) {
        hitNX = 0; hitNZ = 0;
        stepUpY = Math.max(stepUpY, bbTop);
      } else {
        // R * local_normal: world_x = cosR*nx + sinR*nz
        hitNX = hit.nx * obb.cosR + hit.nz * obb.sinR;
        hitNZ = -hit.nx * obb.sinR + hit.nz * obb.cosR;
      }
    }

    // Advance to contact point, pulled back by SKIN_WIDTH to avoid flush contact
    const moveFrac = Math.max(0, tMin - PHYS.SKIN_WIDTH / Math.max(len, 0.001));
    pos.x += rx * moveFrac;
    pos.z += rz * moveFrac;

    if (tMin >= 1.0) break;   // No collision — fully resolved
    if (isStep)     break;   // Step-up — Y is handled below in main tick

    // Slide: scale remaining delta by (1-t), then strip wall-normal component
    const remainFrac = 1.0 - tMin;
    rx *= remainFrac;
    rz *= remainFrac;
    const dot = rx * hitNX + rz * hitNZ;
    rx -= dot * hitNX;
    rz -= dot * hitNZ;

    // Clip stored velocity against the wall too — kills pressure buildup
    if (vel) {
      const vdot = vel.x * hitNX + vel.z * hitNZ;
      if (vdot < 0) {
        vel.x -= vdot * hitNX;
        vel.z -= vdot * hitNZ;
      }
    }
  }

  return stepUpY;
}

// ── One fixed-timestep physics tick ──
function _physStep(fixedDt, inputDir, speed) {
  const radius = CONFIG.playerRadius;
  const height = state.crouching ? CONFIG.crouchHeight : CONFIG.playerHeight;

  // Gravity
  if (!phys.grounded || phys.vel.y > 0) {
    phys.vel.y -= CONFIG.gravity * fixedDt;
  }

  // ── Slide state machine ──
  if (state.slideCooldown > 0) state.slideCooldown -= fixedDt;
  const hSpeedNow = Math.sqrt(phys.vel.x * phys.vel.x + phys.vel.z * phys.vel.z);
  if (!state.sliding) {
    const crouchJustPressed = state.crouching && !_prevCrouch;
    if (crouchJustPressed && phys.grounded && state.slideCooldown <= 0 &&
        hSpeedNow >= CONFIG.moveSpeed * PHYS.SLIDE_MIN_TRIGGER) {
      state.sliding = true;
      phys.vel.x *= PHYS.SLIDE_BOOST;
      phys.vel.z *= PHYS.SLIDE_BOOST;
    }
  } else {
    const slideEnd = !state.crouching ||
                     (phys.grounded && hSpeedNow < CONFIG.moveSpeed * CONFIG.crouchSpeedMult);
    if (slideEnd) {
      state.sliding = false;
      state.slideCooldown = PHYS.SLIDE_COOLDOWN;
    }
  }
  _prevCrouch = state.crouching;

  // ── Horizontal velocity: friction then acceleration (Quake-family) ──
  if (phys.grounded) {
    const fric = PHYS.GROUND_FRICTION * (state.sliding ? PHYS.SLIDE_FRICTION : 1);
    const hSpeed = Math.sqrt(phys.vel.x * phys.vel.x + phys.vel.z * phys.vel.z);
    if (hSpeed > 1e-4) {
      const drop  = hSpeed * fric * fixedDt;
      const scale = Math.max(0, hSpeed - drop) / hSpeed;
      phys.vel.x *= scale;
      phys.vel.z *= scale;
    } else {
      phys.vel.x = 0;
      phys.vel.z = 0;
    }
  }

  const wishLen = Math.sqrt(inputDir.x * inputDir.x + inputDir.z * inputDir.z);
  if (wishLen > 1e-6) {
    const wdx = inputDir.x / wishLen;
    const wdz = inputDir.z / wishLen;
    const wishSpeed = speed * Math.min(1, wishLen);
    // No steering during a grounded slide — the slide is a commitment
    const accel = phys.grounded
      ? (state.sliding ? 0 : PHYS.GROUND_ACCEL)
      : PHYS.AIR_ACCEL;
    if (accel > 0) {
      const cur = phys.vel.x * wdx + phys.vel.z * wdz;
      const add = wishSpeed - cur;
      if (add > 0) {
        const a = Math.min(accel * wishSpeed * fixedDt, add);
        phys.vel.x += wdx * a;
        phys.vel.z += wdz * a;
      }
    }
  }

  // Horizontal movement — displacement now comes from velocity, not input
  const stepUpY = _moveHorizontal(
    phys.pos,
    phys.vel.x * fixedDt,
    phys.vel.z * fixedDt,
    radius, height, PHYS.STEP_HEIGHT, phys.vel
  );

  // Vertical movement
  phys.pos.y += phys.vel.y * fixedDt;

  // Ceiling — eject player down if head overlaps any collider from below.
  // Runs unconditionally (not just vel.y>0) so slope-walking into a canopy is caught too.
  {
    const headY = phys.pos.y + height;
    for (const entry of collidableCache) {
      const bb = entry.bb;
      if (headY > bb.min.y && phys.pos.y < bb.min.y &&
          phys.pos.x > bb.min.x - radius && phys.pos.x < bb.max.x + radius &&
          phys.pos.z > bb.min.z - radius && phys.pos.z < bb.max.z + radius) {
        phys.pos.y = bb.min.y - height;
        if (phys.vel.y > 0) phys.vel.y = 0;
        break;
      }
    }
  }

  // Floor: terrain + any object top we might be standing on
  let floorY = getTerrainHeight(phys.pos.x, phys.pos.z);
  for (const entry of collidableCache) {
    const bb = entry.bb;
    if (phys.pos.x > bb.min.x - radius && phys.pos.x < bb.max.x + radius &&
        phys.pos.z > bb.min.z - radius && phys.pos.z < bb.max.z + radius) {
      const feetH = phys.pos.y;
      if (feetH >= bb.max.y - 0.6 && feetH <= bb.max.y + 1.2) {
        floorY = Math.max(floorY, bb.max.y);
      }
    }
  }

  // OBB floor check — shed podium steps (rotation-aware)
  // No lower-Y guard: use Math.max so terrain always wins if higher than podium
  for (const fl of obbFloors) {
    const fdx = phys.pos.x - fl.shedX;
    const fdz = phys.pos.z - fl.shedZ;
    const flx = fdx * fl.cosR - fdz * fl.sinR;
    const flz = fdx * fl.sinR + fdz * fl.cosR;
    if (Math.abs(flx) <= fl.hw && Math.abs(flz) <= fl.hd) {
      floorY = Math.max(floorY, fl.topY);
    }
  }

  // Promote step-up ledge to floor so we land on it
  if (stepUpY > 0) floorY = Math.max(floorY, stepUpY);

  // Land on floor
  if (phys.pos.y <= floorY) {
    phys.pos.y    = floorY;
    phys.vel.y    = 0;
    phys.grounded = true;
  } else if (phys.pos.y > floorY + 0.15) {
    phys.grounded = false;
  }

  // Water float — keep eyes 0.5 above surface (chest-deep look)
  state.isSwimming = false;
  if (state.waterRising) {
    const waterAboveKnee = state.waterLevel > floorY + 0.8;
    const floatFeetY     = state.waterLevel + 0.5 - height;
    if (waterAboveKnee && phys.pos.y < floatFeetY) {
      phys.pos.y       = floatFeetY;
      phys.vel.y       = 0;
      phys.grounded    = true;
      state.isSwimming = true;
    }
  }

  // World bounds — track the active map (island 253 / city 120) via `half`.
  const bound = half - 1;
  phys.pos.x = Math.max(-bound, Math.min(bound, phys.pos.x));
  phys.pos.z = Math.max(-bound, Math.min(bound, phys.pos.z));

  // Safety depenetration (catches any residual overlap)
  _depenetrate(phys.pos, radius, height);
}

// ── Main entry — called from game loop each frame ──
// inputDir : normalized THREE.Vector3 (XZ desired direction, y is ignored)
// speed    : movement speed already adjusted for ADS / sprint / crouch / swim
function physicsUpdate(dt, inputDir, speed) {
  // Pick up any jump triggered by input.js via state.velocityY
  if (state.velocityY > phys.vel.y) {
    phys.vel.y    = state.velocityY;
    phys.grounded = false;
  }

  // Step at fixed 60Hz — spiral-of-death guard (max 5 steps per frame)
  _physAccum += dt;
  let steps = 0;
  while (_physAccum >= PHYS.FIXED_STEP && steps < 5) {
    _physStep(PHYS.FIXED_STEP, inputDir, speed);
    _physAccum -= PHYS.FIXED_STEP;
    steps++;
  }

  // Smooth camera height for crouch transition — extra-fast drop while sliding
  const targetHeight = state.crouching ? CONFIG.crouchHeight : CONFIG.playerHeight;
  const lerpRate = state.sliding ? 18 : (state.crouching ? 14 : 7);
  state.smoothCameraHeight += (targetHeight - state.smoothCameraHeight) * Math.min(1, dt * lerpRate);

  // Step smoothing — the physics feet position snaps up/down a full step in a single
  // tick, which pops the camera on stairs. Lag a rendered feet-Y behind the true feet-Y
  // so the camera glides. Airborne motion and anything bigger than a step (jumps, falls,
  // teleports) are tracked exactly, so there's no input lag on real vertical movement.
  if (state.camFeetY === undefined) state.camFeetY = phys.pos.y;
  const feetDelta = phys.pos.y - state.camFeetY;
  if (!phys.grounded || Math.abs(feetDelta) > PHYS.STEP_HEIGHT + 0.3) {
    state.camFeetY = phys.pos.y;                                       // snap — real vertical motion
  } else {
    state.camFeetY += feetDelta * Math.min(1, dt * PHYS.STEP_SMOOTH);  // glide — step smoothing
  }

  // Sync camera to capsule (eye = smoothed feet + smooth crouch height)
  camera.position.set(phys.pos.x, state.camFeetY + state.smoothCameraHeight, phys.pos.z);

  // Sync shared state so input.js / gameplay / HUD stay consistent
  state.isGrounded = phys.grounded;
  state.velocityY  = phys.vel.y;
}
