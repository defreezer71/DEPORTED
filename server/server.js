/**
 * DEPORTED — WebSocket Game Server
 * Node.js + ws library
 * Run: node server.js
 * Default port: 3000
 *
 * Protocol (all messages are JSON):
 *
 * CLIENT → SERVER:
 *   { type: "join", name: "Player1" }
 *   { type: "input", seq: 1042, yaw: 1.23, pitch: -0.1,
 *     keys: { w:1, s:0, a:0, d:0, shift:0, jump:0 },
 *     shooting: false }
 *
 * SERVER → CLIENT:
 *   { type: "welcome", id: "abc123", tick: 0 }
 *   { type: "world", tick: 842,
 *     players: [ { id, name, x, y, z, yaw, pitch, hp, armor, dead } ],
 *     events: [ { type:"hit", shooter, target, damage, headshot } ] }
 *   { type: "playerLeft", id: "abc123" }
 */

"use strict";

const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT           = process.env.PORT || 3000;
const TICK_RATE_HZ   = 20;          // server broadcast rate
const PHYS_RATE_HZ   = 64;          // server physics rate
const TICK_MS        = 1000 / TICK_RATE_HZ;
const PHYS_MS        = 1000 / PHYS_RATE_HZ;
const MAX_PLAYERS    = 21;
const SPAWN_RADIUS   = 40;          // metres from map centre
const MAP_CENTRE     = { x: 0, y: 0, z: 0 };

// Player physics constants (must match client 01_config.js)
const PLAYER_SPEED   = 8.0;
const PLAYER_SPRINT  = 12.0;
const JUMP_VEL       = 8.0;
const GRAVITY        = -20.0;
const PLAYER_HEIGHT  = 1.7;
const GROUND_Y       = 0;           // simplified — no terrain on server yet

// ─── State ────────────────────────────────────────────────────────────────────
const players  = new Map();  // id → PlayerState
const events   = [];         // hit events queued this tick, flushed each broadcast
let   serverTick = 0;

// ─── Player factory ──────────────────────────────────────────────────────────
function createPlayer(ws, name) {
  const angle = Math.random() * Math.PI * 2;
  const r     = 10 + Math.random() * SPAWN_RADIUS;
  return {
    id:     uuidv4().slice(0, 8),
    name:   name || "Player",
    ws,
    // position
    x: MAP_CENTRE.x + Math.cos(angle) * r,
    y: PLAYER_HEIGHT / 2,
    z: MAP_CENTRE.z + Math.sin(angle) * r,
    vy: 0,        // vertical velocity
    // orientation
    yaw:   0,
    pitch: 0,
    // state
    hp:    100,
    armor: 0,
    dead:  false,
    // last input received
    lastInput: null,
    lastSeq:   -1,
    // connection health
    lastPing:  Date.now(),
  };
}

// ─── Physics (server-authoritative, simplified) ───────────────────────────────
const MAX_SPEED       = 14.0;   // m/s — sprint (12) + generous lag buffer
const MAX_DIST_PER_MSG = MAX_SPEED * 0.25; // 250ms of max movement = ~3.5m

function stepPlayer(p, dt) {
  if (p.dead || !p.lastInput) return;

  const inp = p.lastInput;

  // Validate client-reported position against server position.
  // Accept if within plausible range, reject (use server pos) if teleport detected.
  if (inp.x !== undefined) {
    const dx = inp.x - p.x;
    const dz = inp.z - p.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= MAX_DIST_PER_MSG) {
      // Plausible — accept client XZ and Y (client has terrain, server doesn't yet)
      p.x = inp.x;
      p.z = inp.z;
      p.y = inp.y;
    } else {
      // Teleport detected — log and hold server position
      console.warn(`[cheat?] ${p.name} (${p.id}) moved ${dist.toFixed(2)}m in one msg (max ${MAX_DIST_PER_MSG.toFixed(2)}m)`);
    }
    p.yaw   = inp.yaw;
    p.pitch = inp.pitch;
    return;
  }

  // Horizontal movement from input keys
  const forward = inp.keys.w ? 1 : inp.keys.s ? -1 : 0;
  const strafe  = inp.keys.d ? 1 : inp.keys.a ? -1 : 0;
  const sprint  = inp.keys.shift ? PLAYER_SPRINT : PLAYER_SPEED;

  // Convert yaw to move direction (same convention as client)
  const sinY = Math.sin(inp.yaw);
  const cosY = Math.cos(inp.yaw);

  const moveX = (forward * sinY + strafe * cosY) * sprint;
  const moveZ = (forward * cosY - strafe * sinY) * sprint;

  p.x += moveX * dt;
  p.z += moveZ * dt;

  // Gravity + jump
  const onGround = p.y <= GROUND_Y + 0.01;
  if (inp.keys.jump && onGround) {
    p.vy = JUMP_VEL;
  }
  p.vy += GRAVITY * dt;
  p.y  += p.vy * dt;

  // Ground clamp
  if (p.y < GROUND_Y) {
    p.y  = GROUND_Y;
    p.vy = 0;
  }

  // Sync orientation from client input
  p.yaw   = inp.yaw;
  p.pitch = inp.pitch;
}

// ─── Broadcast helpers ────────────────────────────────────────────────────────
function buildWorldSnapshot() {
  const playerList = [];
  for (const p of players.values()) {
    playerList.push({
      id:    p.id,
      name:  p.name,
      x:     +p.x.toFixed(3),
      y:     +p.y.toFixed(3),
      z:     +p.z.toFixed(3),
      yaw:   +p.yaw.toFixed(4),
      pitch: +p.pitch.toFixed(4),
      hp:    p.hp,
      armor: p.armor,
      dead:  p.dead,
    });
  }
  return {
    type:    "world",
    tick:    serverTick,
    players: playerList,
    events:  events.splice(0),   // drain queue
  };
}

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const p of players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(msg);
    }
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────
function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  switch (msg.type) {

    case "join": {
      if (players.size >= MAX_PLAYERS) {
        send(ws, { type: "error", reason: "Server full" });
        ws.close();
        return;
      }
      const p = createPlayer(ws, msg.name);
      ws._playerId = p.id;
      players.set(p.id, p);

      console.log(`[+] ${p.name} (${p.id}) joined. Players: ${players.size}`);

      // Tell this client their ID and current tick
      send(ws, { type: "welcome", id: p.id, tick: serverTick,
                 spawnX: p.x, spawnY: p.y, spawnZ: p.z });

      // Send existing players to the newcomer
      const others = [];
      for (const other of players.values()) {
        if (other.id !== p.id) others.push({
          id: other.id, name: other.name,
          x: other.x, y: other.y, z: other.z,
          yaw: other.yaw, hp: other.hp, dead: other.dead,
        });
      }
      if (others.length) send(ws, { type: "existingPlayers", players: others });

      // Tell everyone else about the newcomer
      broadcast({ type: "playerJoined",
                  id: p.id, name: p.name,
                  x: p.x, y: p.y, z: p.z });
      break;
    }

    case "input": {
      const p = players.get(ws._playerId);
      if (!p || p.dead) return;
      // Only accept inputs in sequence order
      if (msg.seq <= p.lastSeq) return;
      p.lastSeq   = msg.seq;
      p.lastInput = msg;
      p.lastPing  = Date.now();
      break;
    }

    case "shoot": {
      const shooter = players.get(ws._playerId);
      if (!shooter || shooter.dead) return;

      const target = players.get(msg.targetId);
      if (!target || target.dead) return;

      // Range validation — server positions are authoritative
      const dx = target.x - shooter.x;
      const dz = target.z - shooter.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 600) {
        console.warn("[cheat?] " + shooter.name + " shot " + dist.toFixed(1) + "m away");
        return;
      }

      // Clamp damage to max possible weapon value (150 headshot + buffer)
      const damage = Math.min(Math.max(Number(msg.damage) || 0, 0), 200);
      const headshot = !!msg.headshot;

      // Armor absorbs damage first; overflow goes to hp
      if (target.armor > 0) {
        const absorbed = Math.min(target.armor, damage);
        target.armor -= absorbed;
        target.hp = Math.max(0, target.hp - (damage - absorbed));
      } else {
        target.hp = Math.max(0, target.hp - damage);
      }

      if (target.hp <= 0) {
        target.dead = true;
        console.log("[kill] " + shooter.name + " killed " + target.name + " (hs:" + headshot + ")");
      }

      events.push({
        type:        "hit",
        shooter:     shooter.id,
        target:      target.id,
        damage,
        headshot,
        targetHp:    target.hp,
        targetArmor: target.armor,
        targetDead:  target.dead,
      });
      break;
    }

    default:
      // Unknown message — ignore
      break;
  }
}

// ─── Connection handler ───────────────────────────────────────────────────────
const wss = new WebSocket.Server({ port: PORT });

wss.on("connection", (ws) => {
  ws._playerId = null;

  ws.on("message", (raw) => handleMessage(ws, raw));

  ws.on("close", () => {
    const id = ws._playerId;
    if (!id) return;
    const p = players.get(id);
    if (p) {
      console.log(`[-] ${p.name} (${id}) left. Players: ${players.size - 1}`);
      players.delete(id);
      broadcast({ type: "playerLeft", id });
    }
  });

  ws.on("pong", () => {
    const p = players.get(ws._playerId);
    if (p) p.lastPing = Date.now();
  });
  ws.on("error", (err) => {
    console.error("WS error:", err.message);
  });
});

console.log(`DEPORTED server running on ws://localhost:${PORT}`);

// ─── Physics loop (64 Hz) ─────────────────────────────────────────────────────
const PHYS_DT = 1 / PHYS_RATE_HZ;
setInterval(() => {
  for (const p of players.values()) {
    stepPlayer(p, PHYS_DT);
  }
}, PHYS_MS);

// ─── Broadcast loop (20 Hz) ───────────────────────────────────────────────────
setInterval(() => {
  if (players.size === 0) return;
  serverTick++;
  broadcast(buildWorldSnapshot());
}, TICK_MS);

// ─── WebSocket ping/pong keepalive (every 15s) ───────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const p of players.values()) {
    if (p.ws.readyState === p.ws.OPEN) {
      p.ws.ping();
    }
    if (now - p.lastPing > 10000) {
      console.log(`[timeout] ${p.name} (${p.id}) timed out`);
      p.ws.terminate();
    }
  }
}, 15000);
