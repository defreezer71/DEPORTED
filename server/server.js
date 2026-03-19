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
function stepPlayer(p, dt) {
  if (p.dead || !p.lastInput) return;

  const inp = p.lastInput;

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

// ─── Stale connection cleanup (every 10s) ─────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const p of players.values()) {
    if (now - p.lastPing > 60000) {
      console.log(`[timeout] ${p.name} (${p.id}) timed out`);
      p.ws.terminate();
    }
  }
}, 10000);
