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

function makeRoom(code, isAuto) {
  rooms[code] = {
    code, isAuto,
    phase: isAuto ? 'countdown' : 'waiting',
    players: {}, readySet: new Set(), events: [], tick: null
  };
  rooms[code].tick = setInterval(() => tickRoom(code), 50);
  return rooms[code];
}

function tickRoom(code) {
  const room = rooms[code];
  if (!room) return;
  const now = Date.now();
  const snapshot = {
    type: 'world',
    players: Object.values(room.players).map(p => ({
      id: p.id, x: p.x, y: p.y, z: p.z,
      hp: p.hp, armor: p.armor, dead: p.dead, name: p.name,
      yaw: p.yaw || 0, crouch: p.crouch || false
    })),
    events: room.events.splice(0),
    phase: room.phase
  };
  const str = JSON.stringify(snapshot);
  for (const [id, p] of Object.entries(room.players)) {
    if (now - p.lastSeen > 10000) { removePlayer(code, id); continue; }
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(str);
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

function checkMajority(code) {
  const room = rooms[code];
  if (!room || room.phase !== 'waiting') return;
  const total = Object.keys(room.players).length;
  if (total === 0) return;
  if (room.readySet.size >= Math.ceil(total / 2)) {
    room.phase = 'countdown';
    broadcastToRoom(code, { type: 'startMatch', roomCode: code });
    console.log('[room ' + code + '] startMatch triggered');
  }
}

wss.on('connection', ws => {
  let myId = null, myRoom = null;

  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      myId = msg.id || ('p' + Math.random().toString(36).slice(2,7));
      const reqCode = msg.roomCode ? msg.roomCode.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4) : null;
      const isAuto = !reqCode;
      const code = isAuto ? (findAutoRoom() || generateCode()) : reqCode;
      myRoom = code;
      if (!rooms[code]) makeRoom(code, isAuto);
      const room = rooms[code];
      const a = Math.random()*Math.PI*2, r = Math.random()*8;
      room.players[myId] = {
        id: myId, name: msg.name || ('P_'+myId.slice(-4)), ws,
        x: -75+Math.cos(a)*r, y: 0, z: 75+Math.sin(a)*r,
        hp: 100, armor: 0, dead: false, lastSeen: Date.now()
      };
      ws.send(JSON.stringify({ type:'joined', id:myId, roomCode:code, phase:room.phase, isAuto }));
      broadcastLobbyState(code);
      console.log('[room ' + code + '] ' + myId + ' joined, phase=' + room.phase);
      return;
    }

    if (!myId || !myRoom || !rooms[myRoom] || !rooms[myRoom].players[myId]) return;
    const room = rooms[myRoom];
    const player = room.players[myId];
    player.lastSeen = Date.now();

    if (msg.type === 'move' || msg.type === 'input') {
      if (room.phase === 'waiting') return;
      const dx = msg.x - player.x, dz = msg.z - player.z;
      if (Math.sqrt(dx*dx+dz*dz) > 3.5) { console.log('[cheat?]', myId, 'teleport'); return; }
      player.x = msg.x; player.y = msg.y || 0; player.z = msg.z;
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
      const dx = t.x-player.x, dz = t.z-player.z;
      if (Math.sqrt(dx*dx+dz*dz) > 600) return;
      let dmg = Math.min(Number(msg.damage)||0, 200);
      if (t.armor > 0) { const abs = Math.min(t.armor, dmg*0.5); t.armor -= abs; dmg -= abs; }
      t.hp = Math.max(0, t.hp - dmg);
      if (t.hp <= 0) t.dead = true;
      room.events.push({ type:'hit', target:msg.targetId, shooter:myId, damage:dmg,
        hp:t.hp, armor:t.armor, dead:t.dead, headshot:!!msg.headshot });
    }
  });

  if (msg.type === 'chat') {
      const raw = (typeof msg.text === 'string') ? msg.text.trim().slice(0, 120) : '';
      if (raw) broadcastToRoom(myRoom, { type: 'chat', id: myId, text: raw });
      return;
    }

  ws.on('close', () => { if (myId && myRoom) removePlayer(myRoom, myId); });
  ws.on('error', () => { if (myId && myRoom) removePlayer(myRoom, myId); });
});

console.log('DEPORTED WS server running');
