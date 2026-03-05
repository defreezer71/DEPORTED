import * as THREE from 'three';

// ═══════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  islandSize: 253,
  volcanoRadius: 55,
  volcanoHeight: 22,       // Lower, more gradual
  cliffHeight: 35,
  cliffThickness: 10,
  waterBaseLevel: 0.05,

  prisonPos: { x: -75, z: 75 },
  prisonSize: 23,           // 15% larger
  prisonWallHeight: 10,

  moveSpeed: 11.97,         // 5% slower
  adsSpeedMult: 0.65,
  jumpForce: 9,
  gravity: 25,
  mouseSens: 0.0018,
  adsSens: 0.00108,
  adsFov: 55,
  normalFov: 75,
  playerHeight: 1.7,
  playerRadius: 0.4,
  moveSmoothing: 0.15,      // Strafe smoothing factor (lower = smoother)
  crouchHeight: 1.0,        // Camera height when crouched
  crouchSpeedMult: 0.5,     // 50% speed when crouched

  weapons: {
    m4: {
      name: 'M4', magSize: 30, fireRate: 100,
      bodyDmg: 15, headDmg: 100,
      recoilHip: 0.025, recoilAds: 0.012,
      reloadTime: 2200, spread: 0.015, adsSpread: 0.0,
      range: 500,
    },
    pistol: {
      name: '1911', magSize: 15, fireRate: 180,
      bodyDmg: 15, headDmg: 100,
      recoilHip: 0.035, recoilAds: 0.018,
      reloadTime: 1500, spread: 0.025, adsSpread: 0.0,
      range: 400,
    }
  }
};

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
const state = {
  locked: false,
  moveForward: false, moveBack: false, moveLeft: false, moveRight: false,
  velocityY: 0, isGrounded: true,
  ads: false, crouching: false, smoothCameraHeight: 1.7,
  currentWeapon: 'm4',
  ammo: { m4: 0, pistol: 0 },
  reserveAmmo: { m4: 0, pistol: 0 },
  hp: 100, armor: 0,
  canFire: true, reloading: false, reloadPhase: null, switching: false, switchPhase: null,
  nearbyLoot: null,
  kills: 0,
  // Match state
  matchTime: 0,           // Elapsed seconds
  sprintTimer: 0,         // Counts down from 15 once gate fully opens
  waterRising: false,
  waterLevel: 0.05,
  waterRiseStart: 150,    // Water starts rising at 2:30
  matchDuration: 600,     // 10 minute match
  waterDmgTimer: 0,
  // Game phase: 'lobby' → 'countdown' → 'playing' → 'gameover' | 'victory'
  phase: 'lobby',
  countdownTime: 10,
  playerDead: false,
  spectateIndex: 0,
  erupted: false,
};

