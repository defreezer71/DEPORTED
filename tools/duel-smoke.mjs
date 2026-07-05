// Headless duel netcode smoke test — drives the server with two WebSocket
// clients (no browser/WebGL) and asserts the full 1v1 loop:
//   join -> distinct A/B spawns -> ready -> startMatch -> playing
//   -> lethal shot -> kill event -> respawn event -> second kill -> duelOver
//
// Run:  node server/server.js  (in one shell)
//       node tools/duel-smoke.mjs
// Uses the ws module from server/node_modules.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const WebSocket = require('../server/node_modules/ws');

const URL = process.env.WS || 'ws://localhost:8081';
const log = (...a) => console.log(...a);
const fail = (m) => { console.error('✗ FAIL:', m); process.exit(1); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function mkClient(name) {
  const ws = new WebSocket(URL);
  const c = { name, ws, id: null, spawn: null, msgs: [], kills: [], respawns: [], duelOver: null, started: false };
  ws.binaryType = 'arraybuffer';
  ws.on('message', (data, isBinary) => {
    if (isBinary) return; // ignore world snapshots
    let m; try { m = JSON.parse(data); } catch { return; }
    c.msgs.push(m);
    if (m.type === 'joined') { c.id = m.id; c.spawn = m.spawn; }
    if (m.type === 'startMatch') c.started = true;
    if (m.type === 'events') for (const e of m.events) {
      if (e.type === 'kill') c.kills.push(e);
      if (e.type === 'respawn') c.respawns.push(e);
    }
    if (m.type === 'duelOver') c.duelOver = m;
  });
  return c;
}
const open = (c) => new Promise((res, rej) => { c.ws.on('open', res); c.ws.on('error', rej); });
const send = (c, o) => c.ws.send(JSON.stringify(o));

(async () => {
  const A = mkClient('A'), B = mkClient('B');
  await Promise.all([open(A), open(B)]);
  log('both sockets open');

  // Join as PvP (waiting room, ready-vote start). Join sequentially so slot
  // assignment is deterministic (A first -> spawn A, B second -> spawn B).
  send(A, { type: 'join', id: 'AAAA', name: 'A', gameMode: 'pvp' });
  await sleep(150);
  send(B, { type: 'join', id: 'BBBB', name: 'B', gameMode: 'pvp' });
  await sleep(300);

  if (!A.spawn || !B.spawn) fail('missing spawn in joined message');
  if (A.spawn.id === B.spawn.id) fail(`both got same spawn ${A.spawn.id} (A/B assignment broken)`);
  log(`✓ spawns assigned: A=${A.spawn.id}(${A.spawn.x},${A.spawn.z})  B=${B.spawn.id}(${B.spawn.x},${B.spawn.z})`);

  // Both ready up -> majority -> startMatch.
  send(A, { type: 'ready' });
  send(B, { type: 'ready' });
  await sleep(400);
  if (!A.started || !B.started) fail('startMatch not received after both ready');
  log('✓ startMatch received by both');

  // Phase flips to 'playing' 5s after startMatch — wait it out.
  log('waiting for playing phase (5s)…');
  await sleep(5600);

  // A kills B (dmg 200 beats 100hp+100armor in one shot). Include a position so
  // the range check passes; both are ~85u apart, well under 600.
  send(A, { type: 'shoot', targetId: 'BBBB', damage: 200, at: 0 });
  await sleep(400);
  if (!A.kills.length) fail('no kill event after lethal shot');
  const k1 = A.kills[A.kills.length - 1];
  if (k1.shooter !== 'AAAA' || k1.victim !== 'BBBB') fail('kill event wrong participants');
  if (k1.shooterKills !== 1) fail(`expected shooterKills=1, got ${k1.shooterKills}`);
  log(`✓ kill #1 registered (score ${k1.shooterKills})`);

  // B should respawn ~3s later.
  log('waiting for respawn (3s)…');
  await sleep(3400);
  const rsp = B.respawns.find(r => r.id === 'BBBB');
  if (!rsp) fail('no respawn event for B');
  log(`✓ B respawned at (${rsp.x.toFixed(1)}, ${rsp.z.toFixed(1)})`);

  // Second kill -> should end the duel (first to 2).
  send(A, { type: 'shoot', targetId: 'BBBB', damage: 200, at: 0 });
  await sleep(500);
  if (!A.duelOver && !B.duelOver) fail('no duelOver after 2nd kill');
  const over = A.duelOver || B.duelOver;
  if (over.winner !== 'AAAA') fail(`expected winner AAAA, got ${over.winner}`);
  log(`✓ duelOver — winner ${over.winner}, scores ${JSON.stringify(over.scores)}`);

  log('\n✅ ALL DUEL NETCODE CHECKS PASSED');
  A.ws.close(); B.ws.close();
  process.exit(0);
})().catch(e => fail(e.message || e));
