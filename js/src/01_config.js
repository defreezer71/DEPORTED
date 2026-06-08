// Seeded RNG
var _seed = 123456;
function seededRand() {
  _seed ^= _seed << 13; _seed ^= _seed >> 17; _seed ^= _seed << 5;
  return ((_seed >>> 0) / 4294967296);
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js';

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

  prisonPos: { x: -105, z: 105 },
  prisonSize: 23,           // 15% larger
  prisonWallHeight: 10,

  moveSpeed: 11.97,         // 5% slower
  adsSpeedMult: 0.65,
  strafeSpeedMult: 0.80,    // Lateral (A/D) input scaled to 80% of forward speed
  jumpForce: 9,
  gravity: 25,
  mouseSens: 0.0018,
  adsSens: 0.00108,
  adsFov: 55,
  normalFov: 75,
  playerHeight: 1.7,
  playerRadius: 0.25,
  moveSmoothing: 0.78,      // Acceleration smoothing — higher = smoother (~10 ticks to 90%)
  crouchHeight: 1.0,        // Camera height when crouched
  crouchSpeedMult: 0.5,     // 50% speed when crouched

  // ── Physics toggle ──
  // true  = new capsule sweep-and-slide (08b_physics.js) — sliding walls, fixed timestep, deterministic
  // false = legacy AABB system (checkCollisionAndStep) — original behaviour
  newPhysics: true,

  weapons: {
    m4: {
      name: 'M4', magSize: 30, fireRate: 100,
      bodyDmg: 15, headDmg: 150,
      recoilHip: 0.025, recoilAds: 0.012,
      reloadTime: 2200, spread: 0.015, adsSpread: 0.0,
      range: 500,
    },
    pistol: {
      name: '1911', magSize: 15, fireRate: 180,
      bodyDmg: 15, headDmg: 150,
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
  // Multiplayer
  ws: null,
  myId: null,
  inLobby: false,
  inputSeq: 0,
  remotePlayers: {},
  lastServerTick: 0,

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
  matchTime: 0,
  sprintTimer: 0,
  waterRising: false,
  waterLevel: 0.05,
  waterRiseStart: 146,
  matchDuration: 600,
  waterDmgTimer: 0,
  // Game phase: 'lobby' → 'countdown' → 'playing' → 'gameover' | 'victory'
  phase: 'lobby',
  countdownTime: 10,
  playerDead: false,
  spectateIndex: 0,
  spectateMode: null,      // null | '1st' | '3rd'
  spectateYaw: 0,
  erupted: false,
  // Kill-cam
  killCamActive: false,
  killCamMode: 'follow',      // 'follow' = 3rd-person live behind killer | 'pov' = snapshot replay
  killCamShooterId: null,
  killCamBotIndex: -1,
  killCamBuffer: [],          // killer's snapshot replay data
  killCamPlayerBuffer: [],    // player's snapshot replay data (aligned to killer buffer)
  killCamShotTimes: [],       // relT values of killer's shots during the replay window
  killCamReplayDuration: 5.0,
  killCamPlayTime: 0,
  killCamDuration: 3.0,
  killCamVictimPos: null,
  playerSnapshots: [],        // rolling 30s of player position history
  // Stat tracking
  shotsFired: 0,
  shotsHit: 0,
};
