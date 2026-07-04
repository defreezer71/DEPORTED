#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// perf-capture.mjs — headless render-workload capture for the game.
//
// Boots the actual game in headless Chrome, waits for the world to build, calls
// window.DBG.perfProbe(), and prints/records the result. Zero-install: uses only
// Node built-ins (http, fs, child_process, and the Node 21+ global WebSocket to
// speak the Chrome DevTools Protocol) plus the Chrome that ships on this machine.
//
//   node tools/perf-capture.mjs            # capture, print, append to history
//   node tools/perf-capture.mjs --json     # print only the raw JSON (for piping)
//   node tools/perf-capture.mjs --no-log   # don't append to the history file
//
// WHAT IT MEASURES: draw calls, triangles, and the scene census — these counts are
// GPU-independent and EXACT even though headless Chrome renders WebGL in software.
// It does NOT measure frame time / fps (that needs a real on-device GPU); for that,
// run DBG.perfProbe() in a real browser tab. Counts are the "how much room" metric.
// ─────────────────────────────────────────────────────────────────────────────

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const HISTORY = path.join(__dirname, 'perf-history.jsonl');

const args = new Set(process.argv.slice(2));
const JSON_ONLY = args.has('--json');
const NO_LOG = args.has('--no-log');
const log = (...a) => { if (!JSON_ONLY) console.error(...a); }; // human output → stderr

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// ── 1. Tiny static file server rooted at the repo (Three.js still loads from CDN) ──
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent(req.url.split('?')[0]);
      if (rel === '/') rel = '/index.html';
      const full = path.join(REPO_ROOT, rel);
      if (!full.startsWith(REPO_ROOT)) { res.writeHead(403).end(); return; } // no traversal
      fs.readFile(full, (err, data) => {
        if (err) { res.writeHead(404).end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ── 2. Launch headless Chrome; recover the DevTools port from DevToolsActivePort ──
function launchChrome(url) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'perfcap-'));
  const child = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--mute-audio', '--window-size=1600,1000',
    // Allow WebGL under software rendering in headless (counts stay exact).
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-angle=swiftshader',
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const portFile = path.join(profile, 'DevToolsActivePort');
  return { child, profile, async wsBrowserUrl() {
    for (let i = 0; i < 100; i++) {                       // ≤10s for Chrome to write the port
      if (fs.existsSync(portFile)) {
        const [port] = fs.readFileSync(portFile, 'utf8').split('\n');
        return `http://127.0.0.1:${port.trim()}`;
      }
      if (child.exitCode !== null) throw new Error(`Chrome exited early:\n${stderr}`);
      await sleep(100);
    }
    throw new Error(`Chrome never opened a debug port:\n${stderr}`);
  }};
}

// ── 3. Minimal Chrome DevTools Protocol client over the built-in global WebSocket ──
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('CDP socket error')));
  });
  return {
    ready,
    send: (method, params = {}) => new Promise((res, rej) => {
      const mid = ++id; pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    }),
    close: () => ws.close(),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(client, expression, returnByValue = true) {
  const r = await client.send('Runtime.evaluate', { expression, returnByValue, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval threw');
  return r.result.value;
}

async function main() {
  const { server, port } = await startServer();
  const url = `http://127.0.0.1:${port}/index.html`;
  log(`[perf] serving ${REPO_ROOT} → ${url}`);
  const chrome = launchChrome(url);
  let client;
  try {
    // Find the page target and attach.
    const base = await chrome.wsBrowserUrl();
    let pageWs = null;
    for (let i = 0; i < 100; i++) {
      const list = await fetch(`${base}/json`).then((r) => r.json()).catch(() => []);
      const page = list.find((t) => t.type === 'page' && t.url.includes(`127.0.0.1:${port}`));
      if (page?.webSocketDebuggerUrl) { pageWs = page.webSocketDebuggerUrl; break; }
      await sleep(100);
    }
    if (!pageWs) throw new Error('never found the game page target');
    client = cdp(pageWs);
    await client.ready;
    await client.send('Runtime.enable');

    // Wait for the world to build (DBG + probe present) and WebGL to be alive.
    log('[perf] waiting for the world to build…');
    let ok = false;
    for (let i = 0; i < 100; i++) {                        // ≤20s
      ok = await evaluate(client, '!!(window.DBG && DBG.perfProbe && DBG.renderer && DBG.scene && DBG.scene.children.length > 5)');
      if (ok) break;
      await sleep(200);
    }
    if (!ok) throw new Error('world/renderer never became ready (WebGL may have failed to init)');
    await sleep(600);                                      // let a frame + CanvasTextures settle

    const result = await evaluate(client, 'JSON.stringify(DBG.perfProbe())');
    const data = JSON.parse(result);

    if (JSON_ONLY) { process.stdout.write(JSON.stringify(data) + '\n'); }
    else { printSummary(data); }

    if (!NO_LOG) {
      fs.appendFileSync(HISTORY, JSON.stringify(data) + '\n');
      log(`[perf] appended to ${path.relative(REPO_ROOT, HISTORY)}`);
    }
  } finally {
    client?.close();
    try { chrome.child.kill('SIGKILL'); } catch {}
    server.close();
    fs.rmSync(chrome.profile, { recursive: true, force: true });
  }
}

function printSummary(d) {
  const k = (n) => `${Math.round(n / 1000)}k`;
  const s = d.scene, v = d.view, w = d.sweep;
  log('');
  log(`  ┌─ PERF CAPTURE — world:${d.world}  mode:${d.mode}   ${d.ts}`);
  log(`  │  scene    meshes ${s.meshes} (visible ${s.visible}) · skinned ${s.skinned} · instanced ${s.instanced}`);
  log(`  │           shadow-casters ${s.shadowCasters} · geometries ${s.geometries} · textures ${s.textures} · programs ${s.programs}`);
  log(`  │  view     draw calls ${v.calls} (main ${v.mainCalls} + shadow ${v.shadowCalls}) · tris ${k(v.tris)}`);
  log(`  │  360°     calls ${w.minCalls} (@${w.minCallsYaw}°) … ${w.maxCalls} (@${w.maxCallsYaw}°) · tris ${k(w.minTris)} … ${k(w.maxTris)}`);
  log(`  └─ (counts are exact & GPU-independent; frame time is NOT measured headless)`);
  log('');
}

main().catch((e) => { console.error('[perf] FAILED:', e.message); process.exit(1); });
