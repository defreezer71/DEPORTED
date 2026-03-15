// ═══════════════════════════════════════════════════════════
// PHYSICS — Capsule sweep-and-slide, fixed timestep
// Toggled by CONFIG.newPhysics in 01_config.js
// ═══════════════════════════════════════════════════════════

const PHYS = {
  FIXED_STEP:  1 / 60,   // 60 Hz fixed timestep — deterministic, same result every run
  STEP_HEIGHT: 0.45,     // Max ledge auto-step (curbs, terrain lips)
  SKIN_WIDTH:  0.015,    // Stop just before surface to prevent tunneling
  MAX_ITER:    4,        // Max slide iterations per step (handles corners)
};

let _physAccum = 0;     // Leftover time between fixed steps

// Capsule state.
//   pos = FEET position in world space (not eye/camera)
//   vel = world velocity (XYZ)
//   grounded = true when standing on something
const phys = {
  pos:      new THREE.Vector3(),
  vel:      new THREE.Vector3(),
  grounded: false,
};

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
}

// ── Horizontal sweep-and-slide ──
// Moves pos.x/z by (deltaX, deltaZ), bouncing/sliding off colliders up to MAX_ITER times.
// Returns the Y of any ledge we should step up onto (0 = no step needed).
function _moveHorizontal(pos, deltaX, deltaZ, radius, height, stepHeight) {
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

  // Horizontal movement
  const stepUpY = _moveHorizontal(
    phys.pos,
    inputDir.x * speed * fixedDt,
    inputDir.z * speed * fixedDt,
    radius, height, PHYS.STEP_HEIGHT
  );

  // Vertical movement
  phys.pos.y += phys.vel.y * fixedDt;

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

  // Water float
  if (state.waterRising) {
    const waterAboveKnee = state.waterLevel > floorY + 0.8;
    const floatFeetY     = state.waterLevel + 1.2 - height;
    if (waterAboveKnee && phys.pos.y < floatFeetY) {
      phys.pos.y    = floatFeetY;
      phys.vel.y    = 0;
      phys.grounded = true;
    }
  }

  // World bounds
  const bound = CONFIG.islandSize * 0.5 - 1;
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

  // Smooth camera height for crouch transition
  const targetHeight = state.crouching ? CONFIG.crouchHeight : CONFIG.playerHeight;
  const lerpRate = state.crouching ? 14 : 7;
  state.smoothCameraHeight += (targetHeight - state.smoothCameraHeight) * Math.min(1, dt * lerpRate);

  // Sync camera to capsule (eye = feet + smooth height)
  camera.position.set(phys.pos.x, phys.pos.y + state.smoothCameraHeight, phys.pos.z);

  // Sync shared state so input.js / gameplay / HUD stay consistent
  state.isGrounded = phys.grounded;
  state.velocityY  = phys.vel.y;
}
