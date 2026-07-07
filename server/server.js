const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: process.env.PORT || 8081 });

const rooms = {};

// ── Duel config ───────────────────────────────────────────────────────────
// The shipping build is the Arena 1v1 duel. To bring the island Battle Royale
// back later, flip DUEL to false — the room-capacity, spawn and win-condition
// branches below fall back to the legacy 20-player behaviour, and the island
// prison spawn is restored. (Client side is swapped in build.sh via $WORLD.)
const DUEL = true;
const DUEL_CAP = 2;          // players per duel room (1v1)
const DUEL_WIN_KILLS = 2;    // first to this many kills wins
const DUEL_RESPAWN_MS = 3000; // delay before a downed player respawns
// Must mirror the client's CONFIG.arena.spawns (A = north tunnel, B = south).
const DUEL_SPAWNS = [
  { id: 'A', x: 0, z: -42.5, facing:  1 },
  { id: 'B', x: 0, z:  42.5, facing: -1 },
];
// Legacy island BR spawn (must match client CONFIG.prisonPos when DUEL=false).
const BR_SPAWN = { x: -105, z: 105 };

// First free spawn slot in a duel room (0=A, 1=B), by which slots are taken.
function freeDuelSlot(room) {
  const taken = new Set(Object.values(room.players).map(p => p.slot));
  for (let i = 0; i < DUEL_SPAWNS.length; i++) if (!taken.has(i)) return i;
  return null; // room full
}

function generateCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({length:4},()=>c[Math.floor(Math.random()*c.length)]).join(''); }
  while (rooms[code]);
  return code;
}

function findAutoRoom() {
  const cap = DUEL ? DUEL_CAP : 20;
  for (const [code, room] of Object.entries(rooms)) {
    if (room.isAuto && Object.keys(room.players).length < cap) return code;
  }
  return null;
}

function findPvpRoom() {
  const cap = DUEL ? DUEL_CAP : 21;
  for (const [code, room] of Object.entries(rooms)) {
    if (!room.isAuto && room.phase === 'waiting' && Object.keys(room.players).length < cap) return code;
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
  // Respawn/teleport grace — the server just relocated this player to their
  // spawn, so accept whatever the client sends for a moment while it catches up
  // (otherwise the client's respawn teleport reads as a speed violation).
  const inGrace = player.moveGraceUntil && now < player.moveGraceUntil;
  if (room.phase === 'playing' && !inGrace) {
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
  // Reset every combatant to a clean match state at their home spawn. Grace
  // spans the countdown so the client's own start-of-match teleport is accepted.
  for (const p of Object.values(room.players)) {
    const sp = p.spawn || (DUEL ? DUEL_SPAWNS[p.slot || 0] : BR_SPAWN);
    const a = Math.random() * Math.PI * 2, r = Math.random() * 1.0;
    p.x = sp.x + Math.cos(a) * r; p.y = 0; p.z = sp.z + Math.sin(a) * r;
    p.hp = 100; p.armor = DUEL ? 100 : 0; p.kills = 0; p.dead = false;
    p.lastMoveAt = svNow(); p.tpStrikes = 0; p.hist = [];
    p.moveGraceUntil = svNow() + 6000;
  }
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

// ── Duel scoring / respawn / win ───────────────────────────────────────────
// Called from the shoot handler when a hit drops the target to 0 HP.
function handleKill(room, shooter, victim, headshot) {
  victim.dead = true;
  victim.hp = 0;
  if (!DUEL) return; // BR: elimination is permanent — no scoring/respawn loop
  shooter.kills = (shooter.kills || 0) + 1;
  room.events.push({ type: 'kill', shooter: shooter.id, victim: victim.id,
    shooterKills: shooter.kills, victimKills: victim.kills || 0, headshot: !!headshot });
  console.log('[room ' + room.code + '] ' + shooter.id + ' killed ' + victim.id +
    ' (' + shooter.kills + '/' + DUEL_WIN_KILLS + ')');
  if (shooter.kills >= DUEL_WIN_KILLS) endDuel(room, shooter, victim);
  else scheduleRespawn(room, victim);
}

function scheduleRespawn(room, victim) {
  const code = room.code;
  victim.respawnAt = Date.now() + DUEL_RESPAWN_MS;
  setTimeout(() => {
    const r = rooms[code];
    if (!r || r.phase !== 'playing') return;   // room gone or match ended
    const p = r.players[victim.id];
    if (!p) return;                             // player left
    const sp = p.spawn || DUEL_SPAWNS[p.slot || 0];
    const a = Math.random() * Math.PI * 2, rr = Math.random() * 1.0;
    p.x = sp.x + Math.cos(a) * rr; p.y = 0; p.z = sp.z + Math.sin(a) * rr;
    p.hp = 100; p.armor = 100; p.dead = false; p.respawnAt = 0;
    // Reset the movement-validation baseline + open a grace window so the
    // client's respawn teleport back to spawn isn't flagged as speed-hacking.
    p.lastMoveAt = svNow(); p.tpStrikes = 0; p.hist = [];
    p.moveGraceUntil = svNow() + 1500;
    r.events.push({ type: 'respawn', id: p.id, x: p.x, z: p.z, hp: p.hp, armor: p.armor });
  }, DUEL_RESPAWN_MS);
}

function endDuel(room, winner, loser) {
  room.phase = 'ended';
  const scores = {};
  for (const p of Object.values(room.players)) scores[p.id] = p.kills || 0;
  broadcastToRoom(room.code, { type: 'duelOver', winner: winner.id, loser: loser.id, scores });
  console.log('[room ' + room.code + '] duel over — winner ' + winner.id);
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
      // Assign the spawn end. Duel: first joiner → A (north tunnel), second → B
      // (south) — this end is the player's home for the whole match (respawns
      // return here). The x/z MUST match the client's resolved spawn or movement
      // validation starts from a desynced position. Jitter kept small so the
      // spawn stays clear of the tunnel back wall.
      let slot = DUEL ? freeDuelSlot(room) : null;
      if (slot === null) slot = 0; // race fallback (room filled mid-join)
      const spawn = DUEL ? DUEL_SPAWNS[slot] : BR_SPAWN;
      const a = Math.random()*Math.PI*2, r = Math.random()*1.0;
      room.players[myId] = {
        id: myId, name: msg.name || ('P_'+myId.slice(-4)), ws,
        slot, spawn,
        x: spawn.x+Math.cos(a)*r, y: 0, z: spawn.z+Math.sin(a)*r,
        hp: 100, armor: DUEL ? 100 : 0, kills: 0, dead: false,
        pistol: false, shooting: false, lastSeen: Date.now()
      };
      // Start 3-min fill timer when first player joins a waiting room
      if (room.phase === 'waiting' && !room.fillTimer && Object.keys(room.players).length === 1) {
        const armFillTimer = () => {
          room.fillEndsAt = Date.now() + 3 * 60 * 1000;
          room.fillTimer = setTimeout(() => {
            const r = rooms[code];
            if (!r || r.phase !== 'waiting') return;
            if (Object.keys(r.players).length >= 2) {
              startRoomMatch(code);
              console.log('[room ' + code + '] 3-min fill timer fired — auto-starting');
            } else {
              // Never start an unwinnable solo duel — re-arm and keep waiting.
              console.log('[room ' + code + '] fill timer fired with 1 player — re-arming');
              armFillTimer();
              broadcastLobbyState(code);
            }
          }, 3 * 60 * 1000);
        };
        armFillTimer();
        console.log('[room ' + code + '] fill timer started');
      }
      ws.send(JSON.stringify({ type:'joined', id:myId, roomCode:code, phase:room.phase, isAuto,
        fillEndsAt: room.fillEndsAt || null, spawn: room.players[myId].spawn, duel: DUEL,
        winKills: DUEL_WIN_KILLS, respawnMs: DUEL_RESPAWN_MS }));
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
      if (DUEL && room.phase !== 'playing') return; // no pre-/post-match kills
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
      const lethal = t.hp <= 0;
      room.events.push({ type:'hit', target:msg.targetId, shooter:myId, damage:dmg,
        hp:t.hp, armor:t.armor, dead:lethal, headshot:!!msg.headshot });
      if (lethal) handleKill(room, player, t, msg.headshot);
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
