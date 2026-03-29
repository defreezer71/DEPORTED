/**
 * DEPORTED — WebSocket Game Server
 * Rooms build: each room is an isolated match (players + events + tick).
 * Auto-assigns to open room or creates new one. Named rooms via join.room code.
 */
"use strict";

const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

const PORT             = process.env.PORT || 3000;
const TICK_RATE_HZ     = 20;
const TICK_MS          = 1000 / TICK_RATE_HZ;
const PHYS_RATE_HZ     = 64;
const PHYS_MS          = 1000 / PHYS_RATE_HZ;
const MAX_PER_ROOM     = 21;

const PLAYER_SPEED     = 8.0;
const PLAYER_SPRINT    = 12.0;
const JUMP_VEL         = 8.0;
const GRAVITY          = -20.0;
const PLAYER_HEIGHT    = 1.7;
const GROUND_Y         = 0;
const MAX_SPEED        = 14.0;
const MAX_DIST_PER_MSG = MAX_SPEED * 0.25;

const PRISON_X = -75;
const PRISON_Z =  75;

// ─── Rooms ────────────────────────────────────────────────────────────────────
const rooms = new Map(); // code → Room

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1
  let code, attempts = 0;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    attempts++;
  } while (rooms.has(code) && attempts < 1000);
  return code;
}

function createRoom(code) {
  const room = { code, players: new Map(), events: [], tick: 0 };
  rooms.set(code, room);
  console.log("[room] Created room " + code);
  return room;
}

function findOrCreateRoom(requestedCode) {
  if (requestedCode) {
    const code = requestedCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    if (code.length === 4) {
      if (rooms.has(code)) return rooms.get(code);
      return createRoom(code);
    }
  }
  // Auto-assign: find first room with space
  for (const room of rooms.values()) {
    if (room.players.size < MAX_PER_ROOM) return room;
  }
  return createRoom(generateRoomCode());
}

// ─── Player factory ──────────────────────────────────────────────────────────
function createPlayer(ws, name, room) {
  const angle = Math.random() * Math.PI * 2;
  const r     = Math.random() * 8;
  return {
    id:    uuidv4().slice(0, 8),
    name:  name || "Player",
    ws, room,
    x: PRISON_X + Math.cos(angle) * r,
    y: PLAYER_HEIGHT / 2,
    z: PRISON_Z + Math.sin(angle) * r,
    vy: 0, yaw: 0, pitch: 0,
    hp: 100, armor: 0, dead: false,
    lastInput: null, lastSeq: -1,
    lastPing: Date.now(),
  };
}

// ─── Physics ──────────────────────────────────────────────────────────────────
function stepPlayer(p, dt) {
  if (p.dead || !p.lastInput) return;
  const inp = p.lastInput;
  if (inp.x !== undefined) {
    const dx = inp.x - p.x, dz = inp.z - p.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= MAX_DIST_PER_MSG) {
      p.x = inp.x; p.z = inp.z; p.y = inp.y;
    } else {
      console.warn("[cheat?] " + p.name + " moved " + dist.toFixed(2) + "m in one msg");
    }
    p.yaw = inp.yaw; p.pitch = inp.pitch;
    return;
  }
  const fwd    = inp.keys.w ? 1 : inp.keys.s ? -1 : 0;
  const strafe = inp.keys.d ? 1 : inp.keys.a ? -1 : 0;
  const spd    = inp.keys.shift ? PLAYER_SPRINT : PLAYER_SPEED;
  const sinY   = Math.sin(inp.yaw), cosY = Math.cos(inp.yaw);
  p.x += (fwd * sinY + strafe * cosY) * spd * dt;
  p.z += (fwd * cosY - strafe * sinY) * spd * dt;
  const onGround = p.y <= GROUND_Y + 0.01;
  if (inp.keys.jump && onGround) p.vy = JUMP_VEL;
  p.vy += GRAVITY * dt;
  p.y  += p.vy * dt;
  if (p.y < GROUND_Y) { p.y = GROUND_Y; p.vy = 0; }
  p.yaw = inp.yaw; p.pitch = inp.pitch;
}

// ─── Broadcast helpers ────────────────────────────────────────────────────────
function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function broadcastRoom(room, obj) {
  const msg = JSON.stringify(obj);
  for (const p of room.players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(msg);
  }
}

function buildWorldSnapshot(room) {
  const playerList = [];
  for (const p of room.players.values()) {
    playerList.push({
      id:    p.id, name: p.name,
      x:     +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3),
      yaw:   +p.yaw.toFixed(4), pitch: +p.pitch.toFixed(4),
      hp:    p.hp, armor: p.armor, dead: p.dead,
    });
  }
  return {
    type:        "world",
    tick:        room.tick,
    roomCode:    room.code,
    playerCount: room.players.size,
    players:     playerList,
    events:      room.events.splice(0),
  };
}

// ─── Message handler ──────────────────────────────────────────────────────────
function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  switch (msg.type) {

    case "join": {
      const room = findOrCreateRoom(msg.room);
      if (room.players.size >= MAX_PER_ROOM) {
        send(ws, { type: "error", reason: "Room full" });
        ws.close();
        return;
      }
      const p = createPlayer(ws, msg.name, room);
      ws._playerId = p.id;
      ws._roomCode = room.code;
      room.players.set(p.id, p);
      console.log("[+] " + p.name + " (" + p.id + ") joined room " + room.code + " (" + room.players.size + " players)");

      // Welcome this player
      send(ws, {
        type: "welcome", id: p.id, tick: room.tick,
        roomCode:    room.code,
        playerCount: room.players.size,
        spawnX: p.x, spawnY: p.y, spawnZ: p.z,
      });

      // Send existing players in room to newcomer
      const others = [];
      for (const other of room.players.values()) {
        if (other.id === p.id) continue;
        others.push({ id: other.id, name: other.name,
          x: other.x, y: other.y, z: other.z,
          yaw: other.yaw, hp: other.hp, dead: other.dead });
      }
      if (others.length) send(ws, { type: "existingPlayers", players: others });

      // Tell everyone else in room about newcomer
      for (const other of room.players.values()) {
        if (other.id === p.id) continue;
        send(other.ws, { type: "playerJoined", id: p.id, name: p.name,
          x: p.x, y: p.y, z: p.z });
      }

      // Notify whole room of updated player count
      broadcastRoom(room, { type: "roomUpdate", playerCount: room.players.size, roomCode: room.code });
      break;
    }

    case "input": {
      const room = rooms.get(ws._roomCode);
      if (!room) return;
      const p = room.players.get(ws._playerId);
      if (!p || p.dead) return;
      if (msg.seq <= p.lastSeq) return;
      p.lastSeq   = msg.seq;
      p.lastInput = msg;
      p.lastPing  = Date.now();
      break;
    }

    case "shoot": {
      const room = rooms.get(ws._roomCode);
      if (!room) return;
      const shooter = room.players.get(ws._playerId);
      if (!shooter || shooter.dead) return;
      const target = room.players.get(msg.targetId);
      if (!target || target.dead) return;
      const dx = target.x - shooter.x, dz = target.z - shooter.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 600) {
        console.warn("[cheat?] " + shooter.name + " shot " + dist.toFixed(1) + "m");
        return;
      }
      const damage  = Math.min(Math.max(Number(msg.damage) || 0, 0), 200);
      const headshot = !!msg.headshot;
      if (target.armor > 0) {
        const absorbed = Math.min(target.armor, damage);
        target.armor -= absorbed;
        target.hp = Math.max(0, target.hp - (damage - absorbed));
      } else {
        target.hp = Math.max(0, target.hp - damage);
      }
      if (target.hp <= 0) {
        target.dead = true;
        console.log("[kill] " + shooter.name + " killed " + target.name + " (hs:" + headshot + ") in room " + room.code);
      }
      room.events.push({
        type: "hit", shooter: shooter.id, target: target.id,
        damage, headshot,
        targetHp: target.hp, targetArmor: target.armor, targetDead: target.dead,
      });
      break;
    }

    default: break;
  }
}

// ─── Connection handler ───────────────────────────────────────────────────────
const wss = new WebSocket.Server({ port: PORT });

wss.on("connection", (ws) => {
  ws._playerId = null;
  ws._roomCode = null;
  ws.on("message", (raw) => handleMessage(ws, raw));

  ws.on("close", () => {
    const id       = ws._playerId;
    const roomCode = ws._roomCode;
    if (!id || !roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    const p = room.players.get(id);
    if (!p) return;
    console.log("[-] " + p.name + " (" + id + ") left room " + roomCode + " (" + (room.players.size - 1) + " remaining)");
    room.players.delete(id);
    broadcastRoom(room, { type: "playerLeft",   id });
    broadcastRoom(room, { type: "roomUpdate", playerCount: room.players.size, roomCode });
    if (room.players.size === 0) {
      rooms.delete(roomCode);
      console.log("[room] Room " + roomCode + " empty — deleted");
    }
  });

  ws.on("pong", () => {
    const room = rooms.get(ws._roomCode);
    if (!room) return;
    const p = room.players.get(ws._playerId);
    if (p) p.lastPing = Date.now();
  });

  ws.on("error", (err) => console.error("WS error:", err.message));
});

console.log("DEPORTED server running on ws://localhost:" + PORT);

// ─── Physics loop (64 Hz) ─────────────────────────────────────────────────────
const PHYS_DT = 1 / PHYS_RATE_HZ;
setInterval(() => {
  for (const room of rooms.values())
    for (const p of room.players.values())
      stepPlayer(p, PHYS_DT);
}, PHYS_MS);

// ─── Broadcast loop (20 Hz) ───────────────────────────────────────────────────
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.players.size === 0) continue;
    room.tick++;
    broadcastRoom(room, buildWorldSnapshot(room));
  }
}, TICK_MS);

// ─── Keepalive ping (15s) ─────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const p of room.players.values()) {
      if (p.ws.readyState === WebSocket.OPEN) p.ws.ping();
      if (now - p.lastPing > 10000) {
        console.log("[timeout] " + p.name + " timed out in room " + room.code);
        p.ws.terminate();
      }
    }
  }
}, 15000);
