#!/usr/bin/env node
// shot.mjs — headless screenshot of the game, reusing the perf-capture plumbing.
// Boots the real game, FREEZES the RAF loop (so it stops overwriting the camera),
// points a bird's-eye camera at the arena center, renders one frame, and writes a
// PNG. Purely a dev sanity-check tool (does the floor look right?), like perf.sh.
//
//   node tools/shot.mjs [out.png]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'arena-floor.png'));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.css':'text/css', '.png':'image/png', '.glb':'model/gltf-binary' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent(req.url.split('?')[0]);
      if (rel === '/') rel = '/index.html';
      const full = path.join(REPO_ROOT, rel);
      if (!full.startsWith(REPO_ROOT)) { res.writeHead(403).end(); return; }
      fs.readFile(full, (err, data) => {
        if (err) { res.writeHead(404).end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}
function launchChrome(url) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-'));
  const child = spawn(CHROME, ['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--mute-audio','--window-size=1600,1000','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--use-angle=swiftshader',url], { stdio:['ignore','ignore','pipe'] });
  let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
  const portFile = path.join(profile, 'DevToolsActivePort');
  return { child, profile, async wsBrowserUrl() {
    for (let i = 0; i < 100; i++) {
      if (fs.existsSync(portFile)) return `http://127.0.0.1:${fs.readFileSync(portFile,'utf8').split('\n')[0].trim()}`;
      if (child.exitCode !== null) throw new Error(`Chrome exited early:\n${stderr}`);
      await sleep(100);
    }
    throw new Error(`Chrome never opened a debug port:\n${stderr}`);
  }};
}
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } });
  const ready = new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('CDP socket error'))); });
  return { ready, send: (method, params={}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id:mid, method, params })); }), close: () => ws.close() };
}
async function evaluate(client, expression) {
  const r = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval threw');
  return r.result.value;
}

async function main() {
  const { server, port } = await startServer();
  const url = `http://127.0.0.1:${port}/index.html`;
  const chrome = launchChrome(url);
  let client;
  try {
    const base = await chrome.wsBrowserUrl();
    let pageWs = null;
    for (let i = 0; i < 100; i++) {
      const list = await fetch(`${base}/json`).then((r) => r.json()).catch(() => []);
      const page = list.find((t) => t.type === 'page' && t.url.includes(`127.0.0.1:${port}`));
      if (page?.webSocketDebuggerUrl) { pageWs = page.webSocketDebuggerUrl; break; }
      await sleep(100);
    }
    if (!pageWs) throw new Error('never found the game page target');
    client = cdp(pageWs); await client.ready; await client.send('Runtime.enable');
    for (let i = 0; i < 100; i++) { if (await evaluate(client, '!!(window.DBG && DBG.renderer && DBG.scene && DBG.scene.children.length > 5)')) break; await sleep(200); }
    await sleep(600);
    // Neuter the game loop's drawing so it can't overwrite our posed frame: freeze
    // the rAF loop AND stub renderer.render/clear (the loop re-renders the FP camera
    // every frame, which otherwise wins). Keep the real render bound as __real. Also
    // hide the pre-game menu + drone overlay canvas so the MAIN canvas is what shows.
    await evaluate(client, `(() => {
      window.requestAnimationFrame = function(){ return 0; };
      const R = DBG.renderer;
      if (!R.__real) R.__real = R.render.bind(R);
      R.render = function(){}; R.clear = function(){}; R.clearDepth = function(){};
      for (const id of ['overlay','overlay-canvas']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
      return true;
    })()`);
    await sleep(120);
    // Pose the camera and draw one frame with the real renderer.
    const CAM = process.env.SHOT_CAM || '0,66,44, 0,1,-1, 55';   // px,py,pz, tx,ty,tz, fov
    await evaluate(client, `(() => {
      const [px,py,pz,tx,ty,tz,fov] = '${CAM}'.split(',').map(Number);
      const cam = DBG.camera;
      cam.fov = fov; cam.position.set(px,py,pz); cam.up.set(0,1,0);
      cam.lookAt(tx,ty,tz); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      if (window.skyDome) window.skyDome.position.copy(cam.position);
      DBG.renderer.__real(DBG.scene, cam); return true;
    })()`);
    await sleep(120);
    const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT, Buffer.from(data, 'base64'));
    console.error(`[shot] wrote ${OUT}`);
  } finally {
    client?.close(); try { chrome.child.kill('SIGKILL'); } catch {}
    server.close(); fs.rmSync(chrome.profile, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error('[shot] FAILED:', e.message); process.exit(1); });
