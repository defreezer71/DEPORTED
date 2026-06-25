const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: process.env.PORT || 8081 });

const rooms = {};

function generateCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({length:4},()=>c[Math.floor(Math.random()*c.length)]).join(''); }
  while (rooms[code]);
  return code;
}

function findAutoRoom() {
  for (const [code, room] of Object.entries(rooms)) {
    if (room.isAuto && Object.keys(room.players).length < 20) return code;
  }
  return null;
}

function findPvpRoom() {
  for (const [code, room] of Object.entries(rooms)) {
    if (!room.isAuto && room.phase === 'waiting' && Object.keys(room.players).length < 21) return code;
  }
  return null;
}
function makeRoom(code, isAuto) {
  rooms[code] = {
    code, isAuto,
    phase: isAuto ? 'countdown' : 'waiting',
    players: {}, readySet: new Set(), events: [], tick: null
  };
  rooms[code].tick = setInterval(() => tickRoom(code), 16); // 60Hz
  // Auto rooms count down client-side (~10s) — enable strict movement after that
  if (isAuto) setTimeout(() => { if (rooms[code]) rooms[code].phase = 'playing'; }, 15000);
  return rooms[code];
}

// Server clock in a uint32 domain (wraps every ~49 days; only used for relative math)
function svNow() { return Date.now() % 0x100000000; }

// Movement validation. Outside 'playing' the game legitimately teleports players
// (match-start spawn, warmup), so accept freely. During play, allow a speed budget
// per elapsed time instead of a fixed per-message distance (input rate varies).
// Persistent rejection self-heals: after 10 strikes, resync to the claimed position
// — otherwise a single missed teleport wedges the player forever.
function tryMove(room, player, x, y, z) {
  const now = svNow();
  if (room.phase === 'playing') {
    const dt = Math.min(500, now - (player.lastMoveAt || now));
    const maxDist = Math.max(2, 0.05 * dt); // 50 u/s budget
    const dx = x - player.x, dz = z - player.z;
    if (Math.sqrt(dx*dx + dz*dz) > maxDist) {
      player.tpStrikes = (player.tpStrikes || 0) + 1;
      if (player.tpStrikes <= 10) {
        if (player.tpStrikes === 1) console.log('[cheat?]', player.id, 'teleport');
        return false;
      }
      console.log('[resync]', player.id, 'accepting position after', player.tpStrikes, 'strikes');
    }
  }
  player.tpStrikes = 0;
  player.lastMoveAt = now;
  player.x = x; player.y = y; player.z = z;
  pushHist(player);
  return true;
}

// Record a player's position history for lag compensation (~1.2s window)
function pushHist(player) {
  if (!player.hist) player.hist = [];
  player.hist.push({ t: svNow(), x: player.x, y: player.y, z: player.z });
  const cutoff = svNow() - 1200;
  while (player.hist.length > 2 && player.hist[0].t < cutoff) player.hist.shift();
}

// ── Binary world snapshot ──
// Format: [0x01][count][uint32 serverTimeMs] then per player:
//   6-byte id | flags | hp | armor | uint16 yaw | int16 x,y,z (×100, 1cm precision)
// Total: 6 + N*17 bytes. The server timestamp lets clients interpolate on the
// server's smooth clock instead of jittery TCP arrival times.
const POS_SCALE = 100;
function packWorldSnapshot(room) {
  const players = Object.values(room.players);
  const buf = Buffer.allocUnsafe(6 + players.length * 17);
  buf[0] = 0x01;
  buf[1] = players.length;
  buf.writeUInt32LE(svNow(), 2);
  let off = 6;
  for (const p of players) {
    const id = (p.id || '').slice(0, 6);
    for (let i = 0; i < 6; i++) buf[off + i] = i < id.length ? id.charCodeAt(i) : 0;
    off += 6;
    buf[off++] = (p.dead ? 1 : 0) | (p.crouch ? 2 : 0) | (p.pistol ? 4 : 0) | (p.shooting ? 8 : 0);
    buf[off++] = Math.max(0, Math.min(255, p.hp | 0));
    buf[off++] = Math.max(0, Math.min(255, (p.armor || 0) | 0));
    const yawNorm = ((p.yaw || 0) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    buf.writeUInt16LE(Math.round(yawNorm / (Math.PI * 2) * 65535), off); off += 2;
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((p.x || 0) * POS_SCALE))), off); off += 2;
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((p.y || 0) * POS_SCALE))), off); off += 2;
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((p.z || 0) * POS_SCALE))), off); off += 2;
  }
  return buf;
}

function tickRoom(code) {
  const room = rooms[code];
  if (!room) return;
  const now = Date.now();
  const events = room.events.splice(0);
  const worldBuf = packWorldSnapshot(room);
  const eventsStr = events.length ? JSON.stringify({ type: 'events', events }) : null;
  for (const [id, p] of Object.entries(room.players)) {
    if (now - p.lastSeen > 10000) { removePlayer(code, id); continue; }
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(worldBuf);
      if (eventsStr) p.ws.send(eventsStr);
    }
  }
}

function removePlayer(code, id) {
  const room = rooms[code];
  if (!room || !room.players[id]) return;
  delete room.players[id];
  room.readySet.delete(id);
  if (Object.keys(room.players).length === 0) {
    clearInterval(room.tick);
    delete rooms[code];
    return;
  }
  broadcastLobbyState(code);
}

function broadcastToRoom(code, msg) {
  const room = rooms[code];
  if (!room) return;
  const str = JSON.stringify(msg);
  for (const p of Object.values(room.players)) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(str);
  }
}

function broadcastLobbyState(code) {
  const room = rooms[code];
  if (!room) return;
  const playerList = Object.values(room.players).map(p => ({
    id: p.id, name: p.name, ready: room.readySet.has(p.id)
  }));
  broadcastToRoom(code, {
    type: 'lobbyState',
    roomCode: code,
    players: playerList,
    botCount: Math.max(0, 21 - playerList.length),
    phase: room.phase
  });
}

// Begin a match: countdown now, strict movement validation once clients are
// actually playing (their match-start teleport happens on startMatch receipt).
function startRoomMatch(code) {
  const room = rooms[code];
  if (!room || room.phase !== 'waiting') return;
  room.phase = 'countdown';
  const startAt = Date.now() + 2500;
  broadcastToRoom(code, { type: 'startMatch', roomCode: code, startAt });
  setTimeout(() => { if (rooms[code]) rooms[code].phase = 'playing'; }, 5000);
}

function checkMajority(code) {
  const room = rooms[code];
  if (!room || room.phase !== 'waiting') return;
  const total = Object.keys(room.players).length;
  if (total < 2) return;
  if (room.readySet.size >= Math.ceil(total * 0.51)) {
    startRoomMatch(code);
    console.log('[room ' + code + '] startMatch triggered (players: ' + total + ')');
  }
}

wss.on('connection', ws => {
  let myId = null, myRoom = null;

  ws.on('message', (raw, isBinary) => {
    // ── Binary input packet (type 0x02, 24 bytes) ──
    if (isBinary) {
      if (!myId || !myRoom || !rooms[myRoom] || !rooms[myRoom].players[myId]) return;
      const buf = raw;
      if (buf[0] !== 0x02 || buf.length < 24) return;
      const player = rooms[myRoom].players[myId];
      player.lastSeen = Date.now();
      const x = buf.readFloatLE(3);
      const y = buf.readFloatLE(7);
      const z = buf.readFloatLE(11);
      if (!tryMove(rooms[myRoom], player, x, y, z)) return;
      player.yaw = buf.readFloatLE(15);
      const keys = buf[23];
      player.crouch = !!(keys & 16);
      player.pistol = !!(keys & 32);
      player.shooting = !!(keys & 64);
      return;
    }

    let msg; try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      myId = msg.id || ('p' + Math.random().toString(36).slice(2,7));
      const reqCode = msg.roomCode ? msg.roomCode.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4) : null;
      const isPvp = (msg.gameMode === 'pvp');
      const isAuto = !reqCode && !isPvp;
      let code;
      if (reqCode) {
        code = reqCode;
      } else if (isAuto) {
        code = findAutoRoom() || generateCode();
      } else {
        // PvP — find or create a waiting room
        code = findPvpRoom() || generateCode();
      }
      myRoom = code;
      if (!rooms[code]) makeRoom(code, isAuto);
      const room = rooms[code];
      // Spawn inside the prison — must match the client's CONFIG.prisonPos
      // (-105, 105) or movement validation starts from a desynced position.
      const a = Math.random()*Math.PI*2, r = Math.random()*8;
      room.players[myId] = {
        id: myId, name: msg.name || ('P_'+myId.slice(-4)), ws,
        x: -105+Math.cos(a)*r, y: 0, z: 105+Math.sin(a)*r,
        hp: 100, armor: 0, dead: false, pistol: false, shooting: false, lastSeen: Date.now()
      };
      // Start 3-min fill timer when first player joins a waiting room
      if (room.phase === 'waiting' && !room.fillTimer && Object.keys(room.players).length === 1) {
        room.fillEndsAt = Date.now() + 3 * 60 * 1000;
        room.fillTimer = setTimeout(() => {
          if (rooms[code] && rooms[code].phase === 'waiting') {
            startRoomMatch(code);
            console.log('[room ' + code + '] 3-min fill timer fired — auto-starting');
          }
        }, 3 * 60 * 1000);
        console.log('[room ' + code + '] fill timer started');
      }
      ws.send(JSON.stringify({ type:'joined', id:myId, roomCode:code, phase:room.phase, isAuto, fillEndsAt: room.fillEndsAt || null }));
      broadcastLobbyState(code);
      console.log('[room ' + code + '] ' + myId + ' joined, phase=' + room.phase);
      return;
    }

    if (!myId || !myRoom || !rooms[myRoom] || !rooms[myRoom].players[myId]) return;
    const room = rooms[myRoom];
    const player = room.players[myId];
    player.lastSeen = Date.now();

    if (msg.type === 'move' || msg.type === 'input') {
      if (!tryMove(room, player, msg.x, msg.y || 0, msg.z)) return;
      player.yaw = msg.yaw || 0;
      player.crouch = !!(msg.keys && msg.keys.shift);
    }

    if (msg.type === 'ready') {
      if (room.phase !== 'waiting') return;
      room.readySet.has(myId) ? room.readySet.delete(myId) : room.readySet.add(myId);
      broadcastLobbyState(myRoom);
      checkMajority(myRoom);
      return;
    }

    if (msg.type === 'shoot') {
      if (player.dead) return;
      const t = room.players[msg.targetId];
      if (!t || t.dead) return;

      // Fire-rate cap: sliding 1s window (tolerates TCP burst delivery, unlike a
      // min-gap check — queued packets can legitimately arrive 0ms apart)
      const now = svNow();
      if (!player.shotTimes) player.shotTimes = [];
      while (player.shotTimes.length && now - player.shotTimes[0] > 1000) player.shotTimes.shift();
      if (player.shotTimes.length >= 15) return;
      player.shotTimes.push(now);

      // Lag compensation: validate range against where the target was at the
      // shooter's render time (msg.at, server-clock ms), rewinding up to 800ms.
      let tx = t.x, tz = t.z;
      const at = Number(msg.at);
      if (Number.isFinite(at) && t.hist && t.hist.length) {
        const targetT = now - Math.min(Math.max(now - at, 0), 800);
        let best = t.hist[t.hist.length - 1];
        for (let i = t.hist.length - 1; i >= 0; i--) {
          best = t.hist[i];
          if (t.hist[i].t <= targetT) break;
        }
        tx = best.x; tz = best.z;
      }
      const dx = tx-player.x, dz = tz-player.z;
      if (Math.sqrt(dx*dx+dz*dz) > 600) return;
      let dmg = Math.min(Number(msg.damage)||0, 200);
      if (t.armor > 0) { const abs = Math.min(t.armor, dmg*0.5); t.armor -= abs; dmg -= abs; }
      t.hp = Math.max(0, t.hp - dmg);
      if (t.hp <= 0) t.dead = true;
      room.events.push({ type:'hit', target:msg.targetId, shooter:myId, damage:dmg,
        hp:t.hp, armor:t.armor, dead:t.dead, headshot:!!msg.headshot });
    }
      if (msg.type === 'chat') {
        const raw = (typeof msg.text === 'string') ? msg.text.trim().slice(0, 120) : '';
        if (raw) {
          const str = JSON.stringify({ type: 'chat', id: myId, text: raw });
          for (const p of Object.values(room.players)) {
            if (p.id !== myId && p.ws.readyState === 1) p.ws.send(str);
          }
        }
        return;
      }
  });

  ws.on('close', () => { if (myId && myRoom) removePlayer(myRoom, myId); });
  ws.on('error', () => { if (myId && myRoom) removePlayer(myRoom, myId); });
});

console.log('DEPORTED WS server running');
