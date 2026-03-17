// INPUT
// ═══════════════════════════════════════════════════════════
const overlay = document.getElementById('overlay');
const crosshair = document.getElementById('crosshair');
const hitmarker = document.getElementById('hitmarker');
const muzzleFlash = document.getElementById('muzzle-flash');
const waterWarning = document.getElementById('water-warning');
const streamBoostEl = document.getElementById('sb');
const sprintCdEl = document.getElementById('sprint-cd');
const adsVignette = document.getElementById('ads-vignette');
const waterVignette = document.getElementById('water-vignette');
const reloadMsg = document.getElementById('reload-msg');
const pickupPrompt = document.getElementById('pickup-prompt');

// ── Canonical look state — yaw and pitch are the source of truth.
//    physicsStep reads these and sets camera.quaternion each tick.
//    Never mutate camera.quaternion directly from mouse input.
state.yaw   = 0;
state.pitch = 0;

// ── Drone camera for menu background ──
const droneCamera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 1, 800);
const droneClock = { angle: 0, height: 95, radius: 155 };
const overlayCanvas = document.getElementById('overlay-canvas');
overlayCanvas.width = window.innerWidth;
overlayCanvas.height = window.innerHeight;
overlayCanvas.style.position = 'absolute';
overlayCanvas.style.inset = '0';
// Use a second renderer for drone view
const droneRenderer = new THREE.WebGLRenderer({ canvas: overlayCanvas, antialias: false });
droneRenderer.setSize(window.innerWidth, window.innerHeight);
droneRenderer.setPixelRatio(1); // Keep perf light
droneRenderer.shadowMap.enabled = false;
function updateDroneCamera(dt) {
  droneClock.angle += dt * 0.04; // Very slow orbit
  const cx = Math.cos(droneClock.angle) * droneClock.radius;
  const cz = Math.sin(droneClock.angle) * droneClock.radius;
  // Gentle altitude drift
  droneClock.height = 88 + Math.sin(droneClock.angle * 0.7) * 12;
  droneCamera.position.set(cx, droneClock.height, cz);
  // Look toward island center at a lower angle — more cinematic horizon view
  droneCamera.lookAt(
    Math.sin(droneClock.angle * 1.3) * 20,
    14,
    Math.cos(droneClock.angle * 0.9) * 20
  );
}

// Music toggle — separate from game start
window.toggleMenuMusic = function toggleMenuMusic() {
  const music = document.getElementById('menu-music');
  const btn = document.getElementById('music-toggle-btn');
  if (!music || !btn) return;
  if (music.paused) {
    music.volume = 0.75;
    music.play().catch(() => {});
    btn.textContent = '■  Stop Theme Song';
    btn.classList.add('playing');
  } else {
    music.pause();
    // Removed: music.currentTime = 0  — so resume picks up where it left off
    btn.textContent = '♪  Play Theme Song';
    btn.classList.remove('playing');
  }
}

overlay.addEventListener('click', (e) => {
  // Don't start game if they clicked the music button
  if (e.target.id === 'music-toggle-btn' || e.target.closest('#music-toggle-btn')) return;
  renderer.domElement.requestPointerLock();
});
renderer.domElement.addEventListener('click', () => {
  if (!document.pointerLockElement && state.phase !== 'lobby') {
    renderer.domElement.requestPointerLock();
  }
});
document.addEventListener('pointerlockchange', () => {
  state.locked = !!document.pointerLockElement;
  if (state.phase === 'lobby' && !state.locked) {
    overlay.classList.remove('hidden');
  } else if (state.locked) {
    overlay.classList.add('hidden');
  }
});

// ── Mouse look — accumulate into state.yaw / state.pitch only.
//    Camera quaternion is reconstructed from these each physics tick.
//    This makes look state serializable and fully deterministic.
document.addEventListener('mousemove', (e) => {
  if (!state.locked) return;
  const sens = state.ads ? CONFIG.adsSens : CONFIG.mouseSens;
  state.yaw   -= e.movementX * sens;
  state.pitch -= e.movementY * sens;
  state.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, state.pitch));
});

document.addEventListener('keydown', (e) => {
  if (!state.locked) return;
  switch (e.code) {
    case 'KeyW': state.moveForward = true; break;
    case 'KeyS': state.moveBack = true; break;
    case 'KeyA': state.moveLeft = true; break;
    case 'KeyD': state.moveRight = true; break;
    case 'Space':
      if (state.isGrounded) { state.velocityY = CONFIG.jumpForce; state.isGrounded = false; }
      break;
    case 'Digit1':
      if (state.currentWeapon !== 'm4' && !state.reloading && !state.switching) { switchWeapon('m4'); }
      break;
    case 'Digit2':
      if (state.currentWeapon !== 'pistol' && !state.reloading && !state.switching) { switchWeapon('pistol'); }
      break;
    case 'KeyR': reload(); break;
    case 'KeyF': pickupLoot(); break;
    case 'Tab': break; // Don't capture tab
    case 'ShiftLeft': case 'ShiftRight': state.crouching = true; break;
  }
});

document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': state.moveForward = false; break;
    case 'KeyS': state.moveBack = false; break;
    case 'KeyA': state.moveLeft = false; break;
    case 'KeyD': state.moveRight = false; break;
    case 'ShiftLeft': case 'ShiftRight': state.crouching = false; break;
  }
});

document.addEventListener('mousedown', (e) => {
  if (!state.locked) return;
  if (e.button === 0) shoot();
  if (e.button === 2) { state.ads = true; crosshair.classList.add('ads'); adsVignette.classList.add('active'); }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 2) { state.ads = false; crosshair.classList.remove('ads'); adsVignette.classList.remove('active'); }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ═══════════════════════════════════════════════════════════
