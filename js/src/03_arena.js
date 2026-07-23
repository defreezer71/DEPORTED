// ═══════════════════════════════════════════════════════════
// ARENA — Roman coliseum 1v1 MVP (gray-box blockout)
// Replaces the island world files (03_terrain / 04_world / 05_jungle) in the
// build; see build.sh. Also supersedes the older flat "city plaza" (03_city.js),
// which stays on the shelf. Built from CONFIG.arena (docs/ARENA_BUILD_PARAMS.md).
//
// Honours the same "world contract" as the island files:
//   • const half                    — world-bound safety clamp (12_main, physics)
//   • getTerrainHeight/GroundHeight  — physics floor (flat, y=0)
//   • getVolcanoHeight               — shooting LOS (0 → never blocks)
//   • isInStream/isInCanalWater      — jungle-only no-ops (safety stubs)
//   • pushes solid geometry into `collidables` (movement) AND `targets` (bullet
//     raycast, 11_gameplay) so every wall/container/crate is real cover.
//
// GRAY-BOX ONLY: axis-aligned boxes, flat Lambert colors, no Roman detailing and
// no instancing yet (that is the skinning pass, step 4 of the spec). Perf budget:
// no realtime shadows (disabled below); 1 dir + 1 ambient light from 02_setup.
// ═══════════════════════════════════════════════════════════

const A = CONFIG.arena;

// Safety-net world clamp. The arena is rectangular with tunnels poking past the
// bowl (z ≈ ±38), so `half` is a loose square net that contains everything while
// the bowl-wall collision does the real containment.
const half = 48;

// ── Flat-world contract ──
function getTerrainHeight(x, z) { return 0; }
function getGroundHeight(x, z)  { return 0; }
function getVolcanoHeight(x, z) { return 0; }
function isInStream(x, z)       { return false; }
function isInCanalWater(x, z)   { return false; }

// Duel spawns (server assigns A/B; solo/map-test uses A). Kept aligned with the
// server spawn — movement validation rejects a client/server spawn mismatch.
const ARENA_SPAWNS = A.spawns;

// ── Materials (muted palette so player silhouettes read loudest on screen) ──
// (Floor uses its own vertex-colored merged buffer — see the paving block below.)
const _wallMat      = new THREE.MeshLambertMaterial({ color: A.wallColor });
const _tunnelMat    = new THREE.MeshBasicMaterial({ color: A.tunnel.color }); // unlit flat black — enclosed tunnel; no lighting gradient means no dither/banding
const _monMat       = new THREE.MeshLambertMaterial({ color: A.monument.color });
const _containerMat = (() => {
  // Corrugated shipping-container skin — vertical ridges (highlight+shadow bands)
  // baked into a CanvasTexture over the base blue, plus darker top/bottom rails.
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#' + A.containerColor.toString(16).padStart(6, '0');
  x.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 128; i += 8) {
    x.fillStyle = 'rgba(255,255,255,0.10)'; x.fillRect(i, 0, 3, 64);      // ridge highlight
    x.fillStyle = 'rgba(0,0,0,0.16)';       x.fillRect(i + 4, 0, 3, 64);  // ridge shadow
  }
  x.fillStyle = 'rgba(0,0,0,0.30)'; x.fillRect(0, 0, 128, 6); x.fillRect(0, 58, 128, 6); // rails
  return new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) });
})();
const _crateMat = (() => {
  // Wooden crate skin — vertical planks with grain + gaps, a raised border frame with
  // corner bolts, and a diagonal cross-brace board. One CanvasTexture on all 6 faces.
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#7a5c34'; g.fillRect(0, 0, 128, 128);
  const planks = 5, pw = 128 / planks;
  for (let i = 0; i < planks; i++) {
    g.fillStyle = 'rgba(' + (92 + Math.random() * 30 | 0) + ',' + (70 + Math.random() * 24 | 0) + ',' + (42 + Math.random() * 18 | 0) + ',0.55)';
    g.fillRect(i * pw + 1, 0, pw - 2, 128);
    g.strokeStyle = 'rgba(40,28,14,0.28)'; g.lineWidth = 1;
    for (let k = 0; k < 3; k++) { const gx = i * pw + 3 + Math.random() * (pw - 6); g.beginPath(); g.moveTo(gx, 0); g.lineTo(gx + Math.random() * 4 - 2, 128); g.stroke(); }
    g.fillStyle = 'rgba(18,11,4,0.55)'; g.fillRect(i * pw + pw - 1.5, 0, 1.5, 128);   // plank gap
  }
  g.lineWidth = 15; g.strokeStyle = '#5f4426';                                        // diagonal brace board
  g.beginPath(); g.moveTo(16, 112); g.lineTo(112, 16); g.stroke();
  g.strokeStyle = 'rgba(255,222,170,0.10)'; g.lineWidth = 2; g.beginPath(); g.moveTo(11, 107); g.lineTo(107, 11); g.stroke();
  const fr = 12;                                                                       // border frame rails
  g.fillStyle = '#5a4126';
  g.fillRect(0, 0, 128, fr); g.fillRect(0, 128 - fr, 128, fr); g.fillRect(0, 0, fr, 128); g.fillRect(128 - fr, 0, fr, 128);
  g.fillStyle = 'rgba(255,226,176,0.16)'; g.fillRect(0, 0, 128, 2); g.fillRect(0, 0, 2, 128); g.fillRect(0, fr - 2, 128, 2); g.fillRect(fr - 2, 0, 2, 128);
  g.fillStyle = 'rgba(0,0,0,0.32)';       g.fillRect(0, 126, 128, 2); g.fillRect(126, 0, 2, 128); g.fillRect(0, 128 - fr, 128, 2); g.fillRect(128 - fr, 0, 2, 128);
  g.fillStyle = '#241f18';                                                             // iron bolts at joints
  for (const p of [[6, 6], [122, 6], [6, 122], [122, 122], [64, 6], [64, 122], [6, 64], [122, 64]]) { g.beginPath(); g.arc(p[0], p[1], 2.3, 0, 7); g.fill(); }
  return new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) });
})();

const DEG = Math.PI / 180;

// Solid box — visible, blocks BOTH movement (collidables) and bullets (targets),
// the same contract the prison walls use. updateMatrixWorld(true) so the physics
// Box3.setFromObject() and the raycaster see a correct world transform. For 0°/90°
// rotations the world AABB stays tight (90° just swaps x/z extents), so the AABB
// collider matches the visible box exactly. No shadows (MVP perf budget).
function addArenaBox(w, h, d, x, z, mat, rotYdeg = 0, yCenter = h / 2) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, yCenter, z);
  if (rotYdeg) m.rotation.y = rotYdeg * DEG;
  m.updateMatrixWorld(true);
  scene.add(m);
  collidables.push(m);
  targets.push(m);
  return m;
}

// ── Aged limestone-block material (shared by both barrel-vault tunnels). Baked into
// one CanvasTexture: warm base + running-bond courses with mortar shadow lines, per-
// block tint variation, grime noise and top-down weathering streaks. RepeatWrapping
// so tunnel UVs (arc-length × length, ~1.6 u/block) tile it. DoubleSide so the vault
// shell lights from inside regardless of winding. Zero extra geometry — the block
// look is entirely in the texture. ──
const _stoneTex = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#a99a7d'; g.fillRect(0, 0, 256, 256);           // warm limestone base
  for (let i = 0; i < 1600; i++) {                                // grime speckle
    g.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.06) + ')';
    g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, Math.random() * 2 + 0.4, 0, 7); g.fill();
  }
  const rows = 3, rh = 256 / rows, cols = 3, cw = 256 / cols;     // chunky voussoir-scale blocks
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) ? cw / 2 : 0;                             // running bond
    for (let ci = -1; ci < cols; ci++) {
      const bx = ci * cw + off, by = r * rh;
      g.fillStyle = 'rgba(' + (150 + Math.random() * 40 | 0) + ',' + (135 + Math.random() * 35 | 0) +
                    ',' + (105 + Math.random() * 30 | 0) + ',' + (0.22 + Math.random() * 0.28) + ')';
      g.fillRect(bx + 1.5, by + 1.5, cw - 3, rh - 3);            // per-block tint
      g.strokeStyle = 'rgba(38,30,20,0.60)'; g.lineWidth = 2.5;
      g.strokeRect(bx + 1.5, by + 1.5, cw - 3, rh - 3);          // mortar shadow
      g.strokeStyle = 'rgba(255,246,224,0.14)'; g.lineWidth = 1; // top/left highlight
      g.beginPath(); g.moveTo(bx + 3, by + rh - 3); g.lineTo(bx + 3, by + 3); g.lineTo(bx + cw - 3, by + 3); g.stroke();
    }
  }
  for (let i = 0; i < 9; i++) {                                   // top-down weathering streaks
    const x = Math.random() * 256, grd = g.createLinearGradient(x, 0, x, 256);
    grd.addColorStop(0, 'rgba(18,14,9,0.20)'); grd.addColorStop(1, 'rgba(18,14,9,0)');
    g.fillStyle = grd; g.fillRect(x, 0, 6 + Math.random() * 12, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
})();
// Unlit stone: the block look is all in the texture and depth is baked into vertex
// colors (buildVaultTunnel), so we dodge the scene's green HemisphereLight ground-
// bounce (0x2d7a0a) that would tint the vault's downward-facing inner ceiling.
//   _stoneMat     — vertex-colored, for the vault mesh.
//   _stoneFlatMat — plain (no per-vertex colors), for stone boxes (the tympanum).
const _stoneMat     = new THREE.MeshBasicMaterial({ map: _stoneTex, vertexColors: true, side: THREE.DoubleSide });
const _stoneFlatMat = new THREE.MeshBasicMaterial({ map: _stoneTex, side: THREE.DoubleSide });

// ── Invisible thin collider box — movement only (collidables), NOT drawn and NOT a
// bullet target. Used for the barrel-vault tunnels: an AABB collider can't be a
// concave vault, so the visible vault mesh can't double as the mover-collider; these
// simple boxes define the passable corridor and are occluded behind the vault. ──
function addTunnelCollider(w, h, d, x, z, yCenter = h / 2) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), _tunnelMat);
  m.position.set(x, yCenter, z);
  m.visible = false;
  m.updateMatrixWorld(true);
  scene.add(m);
  collidables.push(m);
  return m;
}

// ── Roman barrel-vault tunnel — ONE merged BufferGeometry (1 draw call). Cross-
// section: vertical side walls up to the springline (yS = H−R), then a semicircle of
// radius R = W/2 over the top; extruded straight from the mouth to the back. Contains
// the arch shell + a paved floor + the back cap (sealing the spawn). Renders + stops
// bullets (pushed to `targets`); movement is handled by addTunnelCollider boxes. ──
function buildVaultTunnel(zMouth, zBack, W, H, gapOuter, wallTop, mat) {
  const R = W / 2, yS = H - R, NA = 12, BLK = 3.6;    // BLK = world units per texture tile
  const prof = [];                                    // inner-surface profile, left→right, with arc-length s
  let s = 0;
  const add = (x, y) => {
    if (prof.length) { const p = prof[prof.length - 1]; s += Math.hypot(x - p.x, y - p.y); }
    prof.push({ x, y, s });
  };
  add(-R, 0); add(-R, yS);                            // left wall
  for (let i = 1; i <= NA; i++) { const a = Math.PI - (i / NA) * Math.PI; add(R * Math.cos(a), yS + R * Math.sin(a)); }
  add(R, 0);                                          // right wall (down to floor)

  const N = prof.length, pos = [], uv = [], col = [], idx = [];
  const warm = (b) => col.push(b, b * 0.98, b * 0.94);  // a hair warm
  // Baked faux-shading: crown darker than floor, and the back (spawn) end much
  // darker than the bright mouth so the corridor falls into shadow toward the
  // player and the arena reads as a lit reveal ahead. Both ends pulled well down
  // for a dim stone vault — a dark frame around the bright arena reveal (mouth
  // 0.62, deep back 0.24).
  const shade = (y, near) => warm((1.0 - 0.42 * (y / H)) * (near ? 0.62 : 0.24));

  // ── Arch shell (two rings: mouth, back) ──
  for (let r = 0; r < 2; r++) {
    const z = r === 0 ? zMouth : zBack;
    for (let i = 0; i < N; i++) { pos.push(prof[i].x, prof[i].y, z); uv.push(prof[i].s / BLK, z / BLK); shade(prof[i].y, r === 0); }
  }
  for (let i = 0; i < N - 1; i++) idx.push(i, N + i, i + 1, i + 1, N + i, N + i + 1);

  // ── Paved floor (just above the concourse) ──
  const fb = pos.length / 3, fY = 0.02;
  pos.push(-R, fY, zMouth, R, fY, zMouth, -R, fY, zBack, R, fY, zBack);
  uv.push(-R / BLK, zMouth / BLK, R / BLK, zMouth / BLK, -R / BLK, zBack / BLK, R / BLK, zBack / BLK);
  shade(0, true); shade(0, true); shade(0, false); shade(0, false);
  idx.push(fb, fb + 2, fb + 1, fb + 1, fb + 2, fb + 3);

  // ── Solid back cap — a flat stone wall sealing the spawn end (uniform dark, no
  // gradient swirl); spans past the arch and is pulled a touch inward so it OCCLUDES
  // the stand structure that used to poke through the old fan cap. ──
  const zCap = zBack + Math.sign(zMouth - zBack) * 0.3, cb = pos.length / 3;
  pos.push(-gapOuter, 0, zCap, gapOuter, 0, zCap, -gapOuter, wallTop, zCap, gapOuter, wallTop, zCap);
  uv.push(-gapOuter / BLK, 0, gapOuter / BLK, 0, -gapOuter / BLK, wallTop / BLK, gapOuter / BLK, wallTop / BLK);
  for (let k = 0; k < 4; k++) warm(0.15);   // dark back wall behind the spawn
  idx.push(cb, cb + 1, cb + 2, cb + 2, cb + 1, cb + 3);

  // ── Mouth facade — fills the bowl-wall gap AROUND the arch (side strips + the band
  // above the arch up to the wall top) so the stands aren't visible through the gap.
  // Leaves the arched doorway itself open. ──
  const face = (x0, x1, y0, y1) => {
    const q = pos.length / 3;
    pos.push(x0, y0, zMouth, x1, y0, zMouth, x0, y1, zMouth, x1, y1, zMouth);
    uv.push(x0 / BLK, y0 / BLK, x1 / BLK, y0 / BLK, x0 / BLK, y1 / BLK, x1 / BLK, y1 / BLK);
    for (let k = 0; k < 4; k++) warm(0.96);
    idx.push(q, q + 1, q + 2, q + 2, q + 1, q + 3);
  };
  face(-gapOuter, -R, 0, wallTop);                    // left strip
  face(R, gapOuter, 0, wallTop);                      // right strip
  const arch = [], top = [];                          // band between the arch curve and the wall top
  for (let i = 0; i <= NA; i++) {
    const a = Math.PI - (i / NA) * Math.PI, x = R * Math.cos(a), y = yS + R * Math.sin(a);
    let q = pos.length / 3; pos.push(x, y, zMouth);       uv.push(x / BLK, y / BLK);       warm(0.96); arch.push(q);
    q = pos.length / 3;     pos.push(x, wallTop, zMouth); uv.push(x / BLK, wallTop / BLK); warm(0.96); top.push(q);
  }
  for (let i = 0; i < NA; i++) idx.push(arch[i], arch[i + 1], top[i], top[i], arch[i + 1], top[i + 1]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, mat);
  m.updateMatrixWorld(true);
  scene.add(m);
  targets.push(m);                                    // bullets stop on the vault; movement uses the boxes
  return m;
}

// ── Arena floor — two-tone large-scale paving with a center medallion (framing
// the dais), a perimeter track frame and long-axis lane guides. Everything is
// merged into ONE vertex-colored BufferGeometry: 1 draw call, a few hundred tris,
// zero textures. Design brief (docs): big low-contrast slabs give strafe motion-
// parallax WITHOUT the high-frequency checkerboard noise that hurts target
// acquisition; medallion/track/lanes are positional callouts. Flat quads a few mm
// apart in y (base < overlays) dodge z-fighting. Purely decorative — not pushed to
// collidables/targets; the physics floor stays flat at y=0. The coliseum skin's
// dark stone concourse (below) fills the tunnels + everything past the bounds. ──
{
  const b = A.bounds, F = A.floor;
  const pos = [], col = [];
  const hex = (h) => [ (h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255 ];
  const cSlabA = hex(F.slabA), cSlabB = hex(F.slabB);
  const cMed   = hex(F.medallion), cInlay = hex(F.inlay), cGroove = hex(F.groove);

  // One top-facing XZ quad at height y in a flat color (winding matches the +y
  // face used elsewhere in this file; normals are forced up so lighting is right).
  function quad(x0, z0, x1, z1, y, c) {
    const v = [ [x0, z1], [x1, z1], [x1, z0],  [x0, z1], [x1, z0], [x0, z0] ];
    for (const [px, pz] of v) { pos.push(px, y, pz); col.push(c[0], c[1], c[2]); }
  }
  // Concentric ring band (annulus) between radii ri..ro as `seg` quads.
  function ring(ri, ro, y, c, seg = 72) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const P = (r, a) => [Math.cos(a) * r, Math.sin(a) * r];
      const [ix0, iz0] = P(ri, a0), [ix1, iz1] = P(ri, a1);
      const [ox0, oz0] = P(ro, a0), [ox1, oz1] = P(ro, a1);
      for (const [px, pz] of [[ix0,iz0],[ox0,oz0],[ox1,oz1], [ix0,iz0],[ox1,oz1],[ix1,iz1]])
        { pos.push(px, y, pz); col.push(c[0], c[1], c[2]); }
    }
  }
  // Rectangular border frame (4 strips) of thickness t, inset `ins` from bounds.
  function frame(ins, t, y, c) {
    const x0 = b.minX + ins, x1 = b.maxX - ins, z0 = b.minZ + ins, z1 = b.maxZ - ins;
    quad(x0, z0, x1, z0 + t, y, c);       // north edge
    quad(x0, z1 - t, x1, z1, y, c);       // south edge
    quad(x0, z0, x0 + t, z1, y, c);       // west edge
    quad(x1 - t, z0, x1, z1, y, c);       // east edge
  }

  // ── Layer 1: two-tone slabs (running-bond ashlar; tone persists in runs so
  // same-color slabs clump into LARGE shapes rather than salt-and-pepper). ──
  const S = F.slab, yBase = 0.012;
  let seed = 0x9e3779b1 >>> 0;            // deterministic per-load layout
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let row = 0;
  for (let z = b.minZ; z < b.maxZ - 1e-3; z += S, row++) {
    const z1 = Math.min(z + S, b.maxZ);
    const off = (row & 1) ? -S / 2 : 0;   // running bond: half-slab row offset
    let tone = rnd() < 0.5 ? cSlabA : cSlabB;
    for (let x = b.minX + off; x < b.maxX - 1e-3; x += S) {
      const x0 = Math.max(x, b.minX), x1 = Math.min(x + S, b.maxX);
      if (x1 - x0 < 0.05) continue;
      if (rnd() < 0.4) tone = (tone === cSlabA) ? cSlabB : cSlabA;  // occasional flip
      quad(x0, z, x1, z1, yBase, tone);
    }
  }

  // ── Layer 2 (overlays, +y so they win the depth test over the slabs) ──
  // Center medallion: a broad ring hugging the dais base (r 7.8), with an inlay
  // border and a dark seam separating it from the field — the mid-control marker.
  ring(7.9, 8.25, 0.020, cGroove);        // inner seam against the dais
  ring(8.25, 10.4, 0.018, cMed);          // medallion field
  ring(10.4, 10.8, 0.022, cInlay);        // outer inlay border
  ring(10.8, 11.1, 0.020, cGroove);       // outer seam

  // Perimeter track frame — the coliseum's field boundary, inset from the walls.
  frame(1.4, 0.35, 0.020, cInlay);        // bright boundary line
  frame(1.75, 0.18, 0.022, cGroove);      // thin groove just inside it

  // Long-axis lane guides — two thin lines down the flank routes (x ≈ ±11.5),
  // reading toward the objective; they duck under the lane containers at z ≈ ±9.
  for (const lx of [-11.5, 11.5]) quad(lx - 0.14, b.minZ + 2, lx + 0.14, b.maxZ - 2, 0.018, cInlay);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
  const N = pos.length / 3, norm = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) norm[i * 3 + 1] = 1;   // all faces point straight up
  geo.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  const floor = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(floor);
}

// ── Bowl walls — ring the playable bounds at A.wallHeight (unjumpable), breached
// only by the two tunnels on the north (−z) and south (+z) short ends. ──
{
  const b = A.bounds, H = A.wallHeight, T = 1;
  const gapHalf = A.tunnel.width / 2;               // 3
  const xL = b.minX - T / 2, xR = b.maxX + T / 2;   // ∓18.5
  const zN = b.minZ - T / 2, zS = b.maxZ + T / 2;   // ∓28.5
  const depth = b.maxZ - b.minZ;                    // 56

  // East / West — solid full-length
  addArenaBox(T, H, depth, xL, 0, _wallMat);
  addArenaBox(T, H, depth, xR, 0, _wallMat);

  // North / South — split into two segments around the tunnel gap. The gap is
  // widened by the wall thickness (T) so the tunnel side walls sit INSIDE it
  // rather than overlapping the podium — that overlap caused the mouth z-fight.
  const innerGap = gapHalf + T;                     // 4
  const segW  = (-innerGap) - xL;                   // 14.5
  const segCx = (xL + (-innerGap)) / 2;             // -11.25
  for (const zc of [zN, zS]) {
    addArenaBox(segW, H, T,  segCx, zc, _wallMat);  // left of gap
    addArenaBox(segW, H, T, -segCx, zc, _wallMat);  // right of gap
  }
}

// ── Tunnels — Roman STONE BARREL VAULTS breaching the N/S walls; the spawn sits at
// the back and the player walks the vaulted corridor out into the bright bowl (the
// "walkout" reveal). Each tunnel is ONE visible mesh (arch shell + floor + back cap,
// buildVaultTunnel) that renders and stops bullets; movement is walled by invisible
// thin boxes (an AABB collider can't be a concave vault). ──
{
  const t = A.tunnel, b = A.bounds, T = 1;
  const gapHalf = t.width / 2;                       // 3
  for (const side of [-1, 1]) {                      // -1 = north (−z), +1 = south (+z)
    const zWall  = side < 0 ? b.minZ : b.maxZ;       // ∓28  (mouth, at the bowl wall)
    const zOuter = zWall + side * t.length;          // ∓42  (back, behind the spawn)
    const zMid   = (zWall + zOuter) / 2;             // ∓35
    // Movement colliders (invisible) — side walls, ceiling, back cap
    addTunnelCollider(T, t.height, t.length, -(gapHalf + T / 2), zMid);
    addTunnelCollider(T, t.height, t.length,  (gapHalf + T / 2), zMid);
    // Back cap: the visible wall sits at zCap (see buildVaultTunnel). Stop the player
    // ~1u IN FRONT of it (arena-side) with a thick box so the camera can never reach
    // the wall plane — previously the collider face sat behind the wall, letting you
    // clip your view through it. Bulk extends away from the arena.
    const zCap = zOuter - side * 0.3;
    const capThick = 2;
    const capInner = zCap - side * 1.0;                       // arena-facing stop plane
    addTunnelCollider(t.width + T, t.height, capThick, 0, capInner + side * (capThick / 2));
    addTunnelCollider(t.width + T, 0.6, t.length, 0, zMid, t.height + 0.3);
    // Visible barrel-vault skin (1 draw call) — mouth at the wall, cap at the back,
    // facade filling the bowl-wall gap (gapHalf+T) up to the wall top
    buildVaultTunnel(zWall, zOuter, t.width, t.height, gapHalf + T, A.wallHeight, _stoneMat);
  }
}

// ── Monument — central CIRCULAR stepped dais (climbable from any side) topped by
// a bronze Atlas hoisting the globe. The dais + the statue's solid core break the
// straight spawn-to-spawn sightline; both are collidable (movement + bullets). ──
{
  const m = A.monument;

  // Merge many transformed geometries into ONE flat-shaded BufferGeometry (bake
  // each part's matrix, drop the index → per-face normals = the arena's faceted
  // look). Lets the whole dais + the whole statue each render in a single call.
  function mergeGeos(geos) {
    let n = 0;
    const nis = geos.map(g => { const ni = g.index ? g.toNonIndexed() : g; n += ni.attributes.position.count; return ni; });
    const pos = new Float32Array(n * 3);
    let o = 0;
    for (const ni of nis) { const a = ni.attributes.position.array; pos.set(a, o); o += a.length; }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.computeVertexNormals();
    return out;
  }
  // Invisible box collider at a world AABB → blocks MOVEMENT only, 0 draw calls
  // (Box3.setFromObject ignores .visible). Bullets are NOT raycast against these: a
  // square AABB around the round dais (corners jut past the steps) and an oversized
  // column around the thin figure would stop shots that visually miss. Bullets hit the
  // visible marble/bronze meshes instead (pushed to `targets` below), so hit-reg
  // matches exactly what's drawn.
  function addCollider(w, h, d, x, y, z) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), _monMat);
    c.visible = false; c.position.set(m.x + x, y, m.z + z);
    c.updateMatrixWorld(true);
    scene.add(c); collidables.push(c);
  }

  // ── Dais — concentric ziggurat steps (wide+short base → narrow summit),
  // climbable from any side. DOUBLED to 10 steps (riser 0.20, half of before) at
  // the SAME radii/circumference. Visuals merge into one marble mesh; each step
  // gets an invisible box collider so the physics still steps up the small risers. ──
  const marble = [];
  const STEPS = Math.max(2, Math.round(m.height / 0.2));   // 10 (riser 0.20) for height 2.0
  const rBottom = 7.8, rTop = 3.3;
  for (let k = 0; k < STEPS; k++) {
    const top = (k + 1) * (m.height / STEPS);
    const r   = rBottom + (rTop - rBottom) * (k / (STEPS - 1));
    const g = new THREE.CylinderGeometry(r, r, top, 24); g.translate(m.x, top / 2, m.z);
    marble.push(g);
    addCollider(2 * r, top, 2 * r, 0, top / 2, 0);         // AABB == the drum's box (climb riser 0.20)
  }

  // ── ATLAS — a bronze titan hoisting the celestial globe. Rebuilt as an
  // anatomical figure: tapered "bone" cylinders strung between joints (organic
  // limbs, a waist-pinched torso, both arms raised to the globe overhead) + a
  // faceted head. All bronze parts MERGE into ONE mesh (1 draw call); a single
  // invisible core collider + the pedestal keep the sightline broken / shots
  // blocked. Built directly in world space (no group), feet on the pedestal top. ──
  const _bronze = new THREE.MeshLambertMaterial({ color: 0x7a5c34, emissive: 0x1c1408 });
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const bronze = [];
  // Tapered cylinder between two joints (r0 at p0, r1 at p1).
  const bone = (p0, p1, r0, r1, seg = 8) => {
    const dir = new THREE.Vector3().subVectors(p1, p0), len = dir.length() || 1e-4;
    const g = new THREE.CylinderGeometry(r1, r0, len, seg);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.clone().normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5), q, V(1, 1, 1)));
    return g;
  };
  const blob = (r, x, y, z, sy = 1) => { const g = new THREE.IcosahedronGeometry(r, 0); if (sy !== 1) g.scale(1, sy, 1); g.translate(m.x + x, y, m.z + z); return g; };
  const box  = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(m.x + x, y, m.z + z); return g; };
  const at   = (p) => new THREE.Vector3(m.x + p.x, p.y, m.z + p.z);   // shift a local joint to world x/z

  const pedH = 1.7, F = m.height + pedH;              // summit (m.height) → feet at F
  marble.push((() => { const g = new THREE.CylinderGeometry(1.55, 1.85, pedH, 22); g.translate(m.x, m.height + pedH / 2, m.z); return g; })());

  for (const s of [-1, 1]) {                          // legs + feet
    const hip = at(V(s * 0.42, F + 2.85, 0)), knee = at(V(s * 0.40, F + 1.45, 0.06)), ankle = at(V(s * 0.42, F + 0.18, 0));
    bronze.push(bone(hip, knee, 0.34, 0.24));         // thigh
    bronze.push(bone(knee, ankle, 0.24, 0.13));       // shin
    bronze.push(box(0.34, 0.20, 0.62, s * 0.42, F + 0.10, 0.16));  // foot
  }
  bronze.push(box(0.98, 0.62, 0.64, 0, F + 3.0, 0));                 // pelvis / hips
  bronze.push(bone(at(V(0, F + 3.15, 0)), at(V(0, F + 4.05, 0)), 0.46, 0.40)); // waist (pinch)
  bronze.push(bone(at(V(0, F + 4.05, 0)), at(V(0, F + 5.15, 0)), 0.42, 0.58)); // chest (broaden)
  bronze.push(bone(at(V(-0.72, F + 5.2, 0)), at(V(0.72, F + 5.2, 0)), 0.26, 0.26)); // clavicle bar
  for (const s of [-1, 1]) bronze.push(blob(0.30, s * 0.72, F + 5.2, 0));          // deltoids
  bronze.push(bone(at(V(0, F + 5.05, 0)), at(V(0, F + 5.7, 0.03)), 0.20, 0.17));   // neck
  bronze.push(blob(0.44, 0, F + 6.1, 0.05, 1.08));                                 // head
  for (const s of [-1, 1]) {                          // arms raised to the globe
    const sh = at(V(s * 0.72, F + 5.2, 0)), el = at(V(s * 0.92, F + 6.25, 0.08)), wr = at(V(s * 0.34, F + 7.65, 0.05));
    bronze.push(bone(sh, el, 0.22, 0.17));            // upper arm
    bronze.push(bone(el, wr, 0.17, 0.12));            // forearm
    bronze.push(blob(0.17, s * 0.34, F + 7.7, 0.05)); // hand
  }
  // Tilted armillary sphere held overhead — open bronze rings + polar axis.
  {
    const R = 3.5, sy = F + 7.1 + R, TILT = 0.4;   // globe 2.5× larger; raised so its bottom still rests on the hands
    const ringAngles = [[Math.PI / 2, 0], [Math.PI / 2, 0.6], [0, 0], [0, Math.PI / 3], [0, (2 * Math.PI) / 3]];
    for (const [rx, ry] of ringAngles) {
      const g = new THREE.TorusGeometry(R, 0.19, 6, 30);
      g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, TILT, 'XYZ')));
      g.translate(m.x, sy, m.z); bronze.push(g);
    }
    const axis = new THREE.CylinderGeometry(0.17, 0.17, R * 2.4, 8);
    axis.applyMatrix4(new THREE.Matrix4().makeRotationZ(TILT)); axis.translate(m.x, sy, m.z);
    bronze.push(axis);
  }

  // Visible meshes carry the bullet hitbox (raycast targets) so shots register on the
  // exact round steps / thin figure the player sees — no phantom corner/column hits.
  const daisMesh = new THREE.Mesh(mergeGeos(marble), _monMat);    // dais + pedestal — 1 draw call
  scene.add(daisMesh);  targets.push(daisMesh);
  // Scale the whole Atlas figure + globe 2× about the feet (F) — a towering statue;
  // pedestal/dais unchanged. Baked into the geometry so the merged mesh stays at
  // identity and the bullet raycast sees the true size.
  {
    const S = 2, sMat = new THREE.Matrix4()
      .makeTranslation(m.x, F, m.z)
      .multiply(new THREE.Matrix4().makeScale(S, S, S))
      .multiply(new THREE.Matrix4().makeTranslation(-m.x, -F, -m.z));
    for (const g of bronze) g.applyMatrix4(sMat);
  }
  const atlasMesh = new THREE.Mesh(mergeGeos(bronze), _bronze);   // whole figure + globe — 1 draw call
  scene.add(atlasMesh); targets.push(atlasMesh);
  // Invisible cores — MOVEMENT only (keep players out of the statue; the tall dais +
  // pedestal meshes above already block the eye-level spawn-to-spawn sightline).
  addCollider(3.4, pedH, 3.4, 0, m.height + pedH / 2, 0);  // pedestal core
  addCollider(2.6, 12.0, 2.0, 0, F + 6.0, 0);              // body core (2× figure)
}

// ── Cover — containers (full standing cover) + crates (crouch cover). Each entry
// in A.cover already carries its 180°-rotational partner. ──
for (const c of A.cover) {
  const isContainer = c.type === 'container';
  const sz  = isContainer ? A.containerSize : A.crateSize;
  const mat = isContainer ? _containerMat : _crateMat;
  // `stack` (crates) piles N boxes vertically — each box is its own collider +
  // bullet target, so a 2-high stack reads as full standing cover.
  const n = c.stack || 1;
  for (let s = 0; s < n; s++) {
    addArenaBox(sz.x, sz.y, sz.z, c.x, c.z, mat, c.rotationY || 0, sz.y * (s + 0.5));
  }
}

// ═══════════════════════════════════════════════════════════
// COLISEUM SKIN — "New Rome": American-Roman coliseum dressing.
// Purely DECORATIVE and NON-COLLIDABLE — none of this is pushed to `collidables`
// or `targets`, so the gameplay blockout above is untouched. It wraps the field:
// tiered arcade stands rising behind the podium, hung US flags, ornate tunnel
// gates, a stone concourse, and "USA" painted on the field. All repeated pieces
// are InstancedMesh (1 draw call each) to hold the frame budget; no shadows.
// Reference: docs/DEPORTED_Arena_MVP_Build_Spec.md + the coliseum concept art.
// ═══════════════════════════════════════════════════════════
{
  const _dummy = new THREE.Object3D();

  // Append one axis-aligned box (12 tris, outward-wound) to a flat position array
  // — the house pattern (see 02_setup clouds): non-indexed buffers + per-face
  // normals give the chunky faceted look. Used to merge many boxes into one mesh.
  function pushBox(arr, w, h, d, cx, cy, cz) {
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const y0 = cy - h / 2, y1 = cy + h / 2;
    const z0 = cz - d / 2, z1 = cz + d / 2;
    const quad = (ax,ay,az, bx,by,bz, cx2,cy2,cz2, dx,dy,dz) =>
      arr.push(ax,ay,az, bx,by,bz, cx2,cy2,cz2,  ax,ay,az, cx2,cy2,cz2, dx,dy,dz);
    quad(x0,y0,z1, x1,y0,z1, x1,y1,z1, x0,y1,z1); // +z
    quad(x1,y0,z0, x0,y0,z0, x0,y1,z0, x1,y1,z0); // -z
    quad(x1,y0,z1, x1,y0,z0, x1,y1,z0, x1,y1,z1); // +x
    quad(x0,y0,z0, x0,y0,z1, x0,y1,z1, x0,y1,z0); // -x
    quad(x0,y1,z1, x1,y1,z1, x1,y1,z0, x0,y1,z0); // +y
    quad(x0,y0,z0, x1,y0,z0, x1,y0,z1, x0,y0,z1); // -y
  }
  function facetedGeo(positions) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals();
    return g;
  }
  function addMerged(positions, mat) {
    const m = new THREE.Mesh(facetedGeo(positions), mat);
    scene.add(m);
    return m;
  }
  // Yaw so a piece's local +Z faces the arena center (0,0).
  const faceCenter = (px, pz) => Math.atan2(-px, -pz);
  // Ramanujan ellipse-perimeter approx (for even bay spacing per tier).
  const ellipseCirc = (rx, rz) => Math.PI * (3*(rx+rz) - Math.sqrt((3*rx+rz)*(rx+3*rz)));

  // ── Materials ──
  const _standMat   = new THREE.MeshLambertMaterial({ color: 0xE0D8C4 }); // warm marble (less sun blowout)
  const _standDark  = new THREE.MeshLambertMaterial({ color: 0xCEC5AE }); // subtle tier contrast
  const _corniceMat = new THREE.MeshLambertMaterial({ color: 0xD6CDB6 });
  const _gateMat    = new THREE.MeshLambertMaterial({ color: 0xE6DECB }); // Capitol marble

  // ── Dusk plain — one huge warm ground disc that fills under the whole arena AND
  // rings the coliseum out to the horizon, so the arena sits in an open landscape
  // instead of on a floating dark square (this replaces the old 170×170 concourse:
  // a round disc leaves no straight edge to catch the eye). A radial vertex gradient
  // holds a dark stone tone under the stands (r<~144u), warms to sunlit dust in the
  // mid-ring, then fades to the fog-horizon tone at the rim; the disc is wide enough
  // (r≈1200) that its edge is fully swallowed by fog. Unlit (Basic) so the low sunset
  // sun can't flatten it to near-black. ──
  {
    const R = 1200, geo = new THREE.CircleGeometry(R, 96);
    const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3);
    const cInner = new THREE.Color(0x39322a);  // dark stone under the stands (was the concourse)
    const cMid   = new THREE.Color(0x7a5c3c);  // warm sunlit dust
    const cRim   = new THREE.Color(0x3a2a22);  // fog-horizon tone (matches the warmed fog)
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i)) / R;   // 0 center → 1 rim
      if (r < 0.12)      tmp.copy(cInner);
      else if (r < 0.5)  tmp.copy(cInner).lerp(cMid, (r - 0.12) / 0.38);
      else               tmp.copy(cMid).lerp(cRim, (r - 0.5) / 0.5);
      cols[i * 3] = tmp.r; cols[i * 3 + 1] = tmp.g; cols[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const plain = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
    plain.rotation.x = -Math.PI / 2;
    plain.position.y = -0.05;    // just beneath the paved arena floor
    plain.renderOrder = -1;
    scene.add(plain);
  }

  // ── Distant city ring — a dark modern skyline encircling the coliseum out near
  // the fog line, so the arena reads as a stadium dropped into a city (DEPORTED's
  // satire). Heavy fog at r≈470-830 means detail is irrelevant — pure silhouettes.
  // One InstancedMesh, built once with a fixed seed (stable skyline): ~1 draw call. ──
  {
    const N = 90, cityGeo = new THREE.BoxGeometry(1, 1, 1);
    const city = new THREE.InstancedMesh(cityGeo, new THREE.MeshBasicMaterial({ color: 0x2b2a33 }), N);
    let seed = 1337; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2 + (rnd() - 0.5) * 0.06;
      const rad = 470 + rnd() * 360;                       // 470–830u out
      const w = 18 + rnd() * 46, d = 18 + rnd() * 46;
      const h = 34 + rnd() * rnd() * 190;                  // mostly low blocks, a few towers
      const px = Math.cos(th) * rad, pz = Math.sin(th) * rad;
      _dummy.position.set(px, h / 2, pz);                  // base on the plain
      _dummy.rotation.set(0, faceCenter(px, pz), 0);
      _dummy.scale.set(w, h, d);
      _dummy.updateMatrix();
      city.setMatrixAt(i, _dummy.matrix);
    }
    city.instanceMatrix.needsUpdate = true;
    scene.add(city);
  }

  // ── Tiered arcade stands — concentric elliptical rings of blocky "arch" bays
  // (2 columns + a lintel) that step UP and OUT, enclosing the field like a
  // coliseum. The ellipse (rx 30 / rz 42) clears the rectangular podium corners. ──
  const TIERS = 10, RX0 = 30, RZ0 = 42, TIER_RUN = 3.5, TIER_RISE = 4.6;
  const BW = 5.4, COL_W = 1.6, BAY_D = 3.2, TH = 7.0, LINTEL = 1.3;

  // One reusable bay geometry (local: base at y=0, front toward +Z).
  const bayPos = [];
  pushBox(bayPos, COL_W, TH, BAY_D, -(BW - COL_W) / 2, TH / 2, 0);
  pushBox(bayPos, COL_W, TH, BAY_D,  (BW - COL_W) / 2, TH / 2, 0);
  pushBox(bayPos, BW,   LINTEL, BAY_D, 0, TH - LINTEL / 2, 0);
  const bayGeo = facetedGeo(bayPos);

  // Cornice cap geometry (thin wide block) for the top rim.
  const corPos = [];
  pushBox(corPos, BW + 0.4, 0.9, BAY_D + 1.4, 0, 0, 0);
  const corGeo = facetedGeo(corPos);

  for (let t = 0; t < TIERS; t++) {
    const rx = RX0 + t * TIER_RUN, rz = RZ0 + t * TIER_RUN;
    const baseY = t * TIER_RISE;
    const count = Math.max(12, Math.round(ellipseCirc(rx, rz) / BW));
    const inst = new THREE.InstancedMesh(bayGeo, t % 2 ? _standDark : _standMat, count);
    for (let i = 0; i < count; i++) {
      const th = (i / count) * Math.PI * 2;
      const px = Math.cos(th) * rx, pz = Math.sin(th) * rz;
      // Skip any bay that falls inside a tunnel's footprint (its inner ring reaches
      // into the now-longer tunnel) — otherwise a white bay pokes into the black
      // corridor. Leaves a clean entrance breach in the stands (like a vomitorium).
      const inTun = Math.abs(px) < (A.tunnel.width / 2 + 2) &&
                    Math.abs(pz) > A.bounds.maxZ - 1 &&
                    Math.abs(pz) < A.bounds.maxZ + A.tunnel.length + 1;
      _dummy.position.set(px, baseY, pz);
      _dummy.rotation.set(0, faceCenter(px, pz), 0);
      _dummy.scale.setScalar(inTun ? 0 : 1);
      _dummy.updateMatrix();
      inst.setMatrixAt(i, _dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);

    // Cornice rim on the outermost tier's top edge.
    if (t === TIERS - 1) {
      const cor = new THREE.InstancedMesh(corGeo, _corniceMat, count);
      for (let i = 0; i < count; i++) {
        const th = (i / count) * Math.PI * 2;
        const px = Math.cos(th) * rx, pz = Math.sin(th) * rz;
        _dummy.position.set(px, baseY + TH, pz);
        _dummy.rotation.set(0, faceCenter(px, pz), 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        cor.setMatrixAt(i, _dummy.matrix);
      }
      cor.instanceMatrix.needsUpdate = true;
      scene.add(cor);
    }
  }

  // ── Roman arcade facade + foundation — the exterior is a proper Colosseum front:
  // two storeys of round-arched bays with engaged piers, a horizontal string course
  // between them and a plain attic on top, all rooted on a wider base plinth so the
  // building sits in the ground instead of floating. Arched bays are ExtrudeGeometry
  // (real round openings, not painted) instanced around the ellipse; the flat courses
  // reuse the box-band ring. A dark backing drum makes the arches read as deep shadow.
  // Everything instanced — a handful of draw calls, no textures. ──
  {
    const RXF = 64, RZF = 76, NB = 44, PW = 2.1, D = 2.4;  // facade radii, bay count, pier width, depth
    const unit = new THREE.BoxGeometry(1, 1, 1);

    // Flat protruding ring (plinth / string course / cornice / attic / backing).
    const band = (rx, rz, yb, yt, thick, mat) => {
      const N = 72, m = new THREE.InstancedMesh(unit, mat, N);
      const w = (ellipseCirc(rx, rz) / N) * 1.2;   // ~20% overlap → seamless ring
      for (let i = 0; i < N; i++) {
        const th = (i / N) * Math.PI * 2, px = Math.cos(th) * rx, pz = Math.sin(th) * rz;
        _dummy.position.set(px, (yb + yt) / 2, pz);
        _dummy.rotation.set(0, faceCenter(px, pz), 0);
        _dummy.scale.set(w, yt - yb, thick);
        _dummy.updateMatrix();
        m.setMatrixAt(i, _dummy.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
      scene.add(m);
    };

    // One arcade bay: a solid stone panel with a round-topped opening cut through it.
    const archBay = (LH, springH) => {
      const chord = ellipseCirc(RXF, RZF) / NB, BW = chord * 1.06, ow = BW - 2 * PW;
      const s = new THREE.Shape();
      s.moveTo(-BW / 2, 0); s.lineTo(BW / 2, 0); s.lineTo(BW / 2, LH);
      s.lineTo(-BW / 2, LH); s.lineTo(-BW / 2, 0);
      const h = new THREE.Path();
      h.moveTo(-ow / 2, 0); h.lineTo(-ow / 2, springH);
      h.absarc(0, springH, ow / 2, Math.PI, 0, true);    // semicircle over the top
      h.lineTo(ow / 2, 0); h.lineTo(-ow / 2, 0);
      s.holes.push(h);
      const g = new THREE.ExtrudeGeometry(s, { depth: D, bevelEnabled: false, curveSegments: 8 });
      g.translate(0, 0, -D / 2);                          // centre depth on the ellipse
      return g;
    };
    // Instance an arcade-bay geometry around the ellipse at a given base height.
    const arcadeRing = (geo, baseY, mat) => {
      const m = new THREE.InstancedMesh(geo, mat, NB);
      for (let i = 0; i < NB; i++) {
        const th = (i / NB) * Math.PI * 2, px = Math.cos(th) * RXF, pz = Math.sin(th) * RZF;
        _dummy.position.set(px, baseY, pz);
        _dummy.rotation.set(0, faceCenter(px, pz), 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        m.setMatrixAt(i, _dummy.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
      scene.add(m);
    };

    const _facadeMat = new THREE.MeshLambertMaterial({ color: 0xC9BE9F }); // weathered marble
    const _plinthMat = new THREE.MeshLambertMaterial({ color: 0x8f836a }); // darker foundation stone
    const _backMat   = new THREE.MeshLambertMaterial({ color: 0x2b2820 }); // deep shadow behind arches

    band(62.4, 74.4,  0,    49,   2.0, _backMat);      // dark backing drum → arches read as shadow
    arcadeRing(archBay(19, 12),  4,  _facadeMat);      // storey 1 arches — y 4–23
    band(65.0, 77.0, 22.5, 25.0, 2.9, _facadeMat);     // string course between the storeys
    arcadeRing(archBay(17, 11), 25, _facadeMat);       // storey 2 arches — y 25–42
    band(65.0, 77.0, 41.5, 44.0, 2.9, _facadeMat);     // upper string course
    band(64.3, 76.3, 44.0, 48.0, 2.5, _facadeMat);     // plain attic storey
    band(66.5, 78.5,  0,    4.2,  3.4, _plinthMat);    // base plinth — wider ledge at the ground
    band(64.6, 76.6, 47.5, 50.5, 3.2, _corniceMat);    // crowning cornice
  }

  // ── Blind arcade on the podium — the walls enclosing the fight get a Roman
  // arch rhythm (pilasters + round arches on the inner face) instead of flat walls. ──
  {
    const b = A.bounds, H = A.wallHeight, gap = A.tunnel.width / 2 + 1;
    const runs = [
      { fixed: b.maxX, dir: -1, axis: 'z', a0: b.minZ, a1: b.maxZ },   // E wall
      { fixed: b.minX, dir:  1, axis: 'z', a0: b.minZ, a1: b.maxZ },   // W wall
    ];
    for (const zf of [b.minZ, b.maxZ]) {                                // N/S wall segments
      const dir = zf < 0 ? 1 : -1;
      runs.push({ fixed: zf, dir, axis: 'x', a0: b.minX, a1: -gap });
      runs.push({ fixed: zf, dir, axis: 'x', a0: gap,    a1: b.maxX });
    }
    const pil = [], arch = [];
    for (const r of runs) {
      const len = r.a1 - r.a0, n = Math.max(1, Math.round(len / 4.2)), step = len / n;
      for (let i = 0; i <= n; i++) {
        const a = r.a0 + i * step;
        pil.push(r.axis === 'z' ? { x: r.fixed + r.dir * 0.35, z: a } : { x: a, z: r.fixed + r.dir * 0.35 });
      }
      for (let i = 0; i < n; i++) {
        const a = r.a0 + (i + 0.5) * step;
        arch.push(r.axis === 'z'
          ? { x: r.fixed + r.dir * 0.35, z: a, ry: Math.PI / 2 }   // arch spans z (E/W walls)
          : { x: a, z: r.fixed + r.dir * 0.35, ry: 0 });           // arch spans x (N/S walls)
      }
    }
    const pilInst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, H - 0.5, 0.55), _standMat, pil.length);
    pil.forEach((p, i) => { _dummy.position.set(p.x, (H - 0.5) / 2, p.z); _dummy.rotation.set(0, 0, 0); _dummy.scale.setScalar(1); _dummy.updateMatrix(); pilInst.setMatrixAt(i, _dummy.matrix); });
    pilInst.instanceMatrix.needsUpdate = true; scene.add(pilInst);
    // Round blind arches (half-torus rainbows) between the pilasters near the top.
    const archInst = new THREE.InstancedMesh(new THREE.TorusGeometry(1.7, 0.22, 6, 14, Math.PI), _standMat, arch.length);
    arch.forEach((p, i) => { _dummy.position.set(p.x, H - 2.3, p.z); _dummy.rotation.set(0, p.ry, 0); _dummy.scale.setScalar(1); _dummy.updateMatrix(); archInst.setMatrixAt(i, _dummy.matrix); });
    archInst.instanceMatrix.needsUpdate = true; scene.add(archInst);
    // Invisible collidable liner at the arcade front, per run, so the projecting
    // pilasters/arches are SOLID (players stop at them instead of walking through
    // to the wall behind). One box per run — 0 draw calls (visible=false).
    for (const r of runs) {
      const off = r.dir * 0.4;
      const w = r.axis === 'z' ? 0.5 : (r.a1 - r.a0);
      const d = r.axis === 'z' ? (r.a1 - r.a0) : 0.5;
      const cx = r.axis === 'z' ? r.fixed + off : (r.a0 + r.a1) / 2;
      const cz = r.axis === 'z' ? (r.a0 + r.a1) / 2 : r.fixed + off;
      const liner = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), _standMat);
      liner.position.set(cx, H / 2, cz);
      liner.visible = false;
      liner.updateMatrixWorld(true);
      scene.add(liner); collidables.push(liner);
    }
  }

  // ── US flag banners hung on the inner face of the stands, facing the field ──
  function usFlagTex() {
    const c = document.createElement('canvas'); c.width = 190; c.height = 100;
    const x = c.getContext('2d');
    const sh = 100 / 13;
    for (let i = 0; i < 13; i++) { x.fillStyle = (i % 2 === 0) ? '#b22234' : '#ffffff'; x.fillRect(0, i * sh, 190, sh + 0.6); }
    x.fillStyle = '#3c3b6e'; x.fillRect(0, 0, 190 * 0.42, sh * 7);
    x.fillStyle = '#fff';
    for (let r = 0; r < 5; r++) for (let s = 0; s < 6; s++) {
      x.beginPath(); x.arc(6 + s * 12 + (r % 2 ? 6 : 0), 6 + r * (sh * 7 / 5), 2, 0, Math.PI * 2); x.fill();
    }
    return new THREE.CanvasTexture(c);
  }
  {
    const flagMat = new THREE.MeshBasicMaterial({ map: usFlagTex(), side: THREE.DoubleSide });
    const FLAGS = 26, fw = 9.0, fh = 5.0;             // bigger so they read from the top rim
    // Hung along the very TOP tier of the arena, floated just inside the rim.
    const FLAG_TIER = TIERS - 1;
    const rx = RX0 + FLAG_TIER * TIER_RUN - 2.5;
    const rz = RZ0 + FLAG_TIER * TIER_RUN - 2.5;
    const fy = FLAG_TIER * TIER_RISE + TH * 0.55;
    const inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(fw, fh), flagMat, FLAGS);
    for (let i = 0; i < FLAGS; i++) {
      const th = (i / FLAGS) * Math.PI * 2 + 0.08;
      const px = Math.cos(th) * rx, pz = Math.sin(th) * rz;
      _dummy.position.set(px, fy, pz);
      _dummy.rotation.set(0, faceCenter(px, pz), 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      inst.setMatrixAt(i, _dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
  }

  // ── Entrance colonnade — Ionic fluted marble columns flanking each tunnel
  // mouth, tied by an entablature beam with a blue-and-gold swag. Built as per-part
  // InstancedMeshes so all four columns cost only a handful of draw calls. Columns
  // sit on the FIELD side of the podium (clear of the podium + tunnel planes → no
  // z-fight, and no stray pillar poking into the tunnel). ──
  const SWAG_W = 384, SWAG_H = 170;                 // texture px; drives the mesh aspect
  function swagTex() {
    // American bunting VALANCE: a blue star rail with DEEP red/white/blue gore-fans
    // draping below it. The fans are drawn as semicircles then vertically stretched
    // (scale) into long elliptical drops, so the bunting hangs low over the tunnel
    // mouth. Transparent below the drape so it reads as scalloped cloth.
    const railH = 22, drop = 122;
    const c = document.createElement('canvas'); c.width = SWAG_W; c.height = SWAG_H;
    const x = c.getContext('2d');
    x.clearRect(0, 0, SWAG_W, SWAG_H);
    x.fillStyle = '#1a2a6c'; x.fillRect(0, 0, SWAG_W, railH);             // star rail
    x.fillStyle = '#fff';
    for (let i = 0; i < 24; i++) { x.beginPath(); x.arc(8 + i * 16, railH / 2, 2.4, 0, Math.PI * 2); x.fill(); }
    const fans = 6, fw = SWAG_W / fans, R = fw / 2, gores = 6;
    const cols = ['#b22234', '#ffffff', '#1a2a6c'];
    x.save();
    x.translate(0, railH);
    x.scale(1, drop / R);                            // stretch each semicircle into a deep drape
    for (let f = 0; f < fans; f++) {
      const cx = f * fw + fw / 2;
      for (let g = 0; g < gores; g++) {
        x.fillStyle = cols[g % 3];
        x.beginPath(); x.moveTo(cx, 0);
        x.arc(cx, 0, R, Math.PI * (g / gores), Math.PI * ((g + 1) / gores)); x.closePath(); x.fill();
      }
    }
    x.restore();
    return new THREE.CanvasTexture(c);
  }
  {
    const COL_H = 11.0, SR = 0.9, CX = 5.2;           // taller, thicker, wider-spread → grand
    const cols = [];
    for (const zEnd of [A.bounds.minZ, A.bounds.maxZ]) {
      const cz = zEnd - Math.sign(zEnd) * 1.8;        // onto the field
      cols.push({ x: -CX, z: cz }, { x: CX, z: cz });
    }
    const N = cols.length;
    // 16-sided faceted shaft reads as fluting; slight entasis taper. Ionic-ish
    // capital = echinus drum + abacus block + two rolled volute scrolls.
    const shaftInst  = new THREE.InstancedMesh(new THREE.CylinderGeometry(SR * 0.86, SR, COL_H, 16), _gateMat, N);
    const plinthInst = new THREE.InstancedMesh(new THREE.BoxGeometry(SR * 2.6, 0.7, SR * 2.6), _gateMat, N);
    const baseInst   = new THREE.InstancedMesh(new THREE.CylinderGeometry(SR * 1.25, SR * 1.4, 0.7, 16), _gateMat, N);
    const echInst    = new THREE.InstancedMesh(new THREE.CylinderGeometry(SR * 1.3, SR * 0.95, 0.55, 16), _gateMat, N);
    const abacusInst = new THREE.InstancedMesh(new THREE.BoxGeometry(SR * 3.0, 0.5, SR * 2.2), _gateMat, N);
    const voluteInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12), _gateMat, N * 2);
    const put = (inst, i, x, y, z, rx = 0, ry = 0, rz = 0) => {
      _dummy.position.set(x, y, z); _dummy.rotation.set(rx, ry, rz); _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix(); inst.setMatrixAt(i, _dummy.matrix);
    };
    const baseTop = 0.7;
    cols.forEach((c, i) => {
      put(plinthInst, i, c.x, 0.35, c.z);
      put(baseInst,   i, c.x, baseTop + 0.35, c.z);
      put(shaftInst,  i, c.x, baseTop + COL_H / 2, c.z);
      put(echInst,    i, c.x, baseTop + COL_H + 0.28, c.z);
      put(abacusInst, i, c.x, baseTop + COL_H + 0.7, c.z);
      for (const s of [-1, 1]) put(voluteInst, i * 2 + (s > 0 ? 1 : 0), c.x + s * SR * 1.05, baseTop + COL_H + 0.45, c.z, 0, 0, Math.PI / 2);
    });
    [plinthInst, baseInst, shaftInst, echInst, abacusInst, voluteInst].forEach(m => { m.instanceMatrix.needsUpdate = true; scene.add(m); });

    // The columns above are decorative InstancedMeshes — give each pillar an
    // INVISIBLE box collider so players can't walk through it (and it stops shots
    // like every other solid). Box faces sit tangent to the shaft (side = 2·SR);
    // Box3.setFromObject (physics) and the bullet raycast both ignore .visible.
    const colH = baseTop + COL_H + 1;
    for (const c of cols) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(SR * 2, colH, SR * 2), _gateMat);
      col.visible = false;
      col.position.set(c.x, colH / 2, c.z);
      col.updateMatrixWorld(true);
      scene.add(col); collidables.push(col); targets.push(col);
    }

    // Grand entablature beam, hanging swag, and a black tympanum filling the gap
    // between the tunnel top and the beam — so the TOP of the black opening is
    // hidden and the entrance reads as a tall, bottomless dark portal.
    const swagMat = new THREE.MeshBasicMaterial({ map: swagTex(), side: THREE.DoubleSide, transparent: true, depthWrite: false });
    const beamY = baseTop + COL_H + 2.0, beamH = 2.6, beamD = 2.5, beamBot = beamY - beamH / 2;
    for (const zEnd of [A.bounds.minZ, A.bounds.maxZ]) {
      const toCenter = -Math.sign(zEnd);
      const cz = zEnd + toCenter * 1.8;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * CX + 3.4, beamH, beamD), _gateMat);
      beam.position.set(0, beamY, cz);
      scene.add(beam);
      const tymH = beamBot - A.tunnel.height;
      if (tymH > 0.3) {
        // White marble back wall for the decorative gallery (pillars added below).
        const tym = new THREE.Mesh(new THREE.BoxGeometry(2 * CX - 0.4, tymH, 0.6), _gateMat);
        tym.position.set(0, A.tunnel.height + tymH / 2, zEnd + toCenter * 0.5);
        scene.add(tym);
      }
      // Large American bunting draped over the entrance — placed in FRONT of the
      // columns (and well ahead of the black tympanum, which was hiding it) so it
      // always reads. Wide enough to span the tunnel top and tall enough that the
      // scalloped fans drape over the TOP HALF of the (tunnel.height-tall) mouth.
      const swagW = 2 * CX + 3, swagH = swagW * (SWAG_H / SWAG_W);   // keep texture aspect
      const swag = new THREE.Mesh(new THREE.PlaneGeometry(swagW, swagH), swagMat);
      // Sits FLUSH against the beam's front face (cz + half-depth toward the field,
      // + a hair) so it never clips into the box; top rail level with the beam top
      // so it drapes down over the beam like a normally-hung banner.
      swag.position.set(0, (beamY + beamH / 2) - swagH / 2, cz + toCenter * (beamD / 2 + 0.12));
      swag.rotation.y = toCenter > 0 ? 0 : Math.PI;
      swag.renderOrder = 2;
      scene.add(swag);
    }

    // ── Decorative entrance gallery — a row of small marble pillars standing in FRONT
    // of the white wall (the tympanum above). Purely ornamental: up at y≈6–12 and
    // unreachable, so no colliders. InstancedMeshes span BOTH mouths (a few calls). ──
    {
      const GN = 6, gR = 0.30;                        // pillars per mouth, shaft radius
      const gBot = A.tunnel.height + 0.15;            // sits just above the arch top
      const gCapY = beamBot - 0.4;                    // capitals tucked under the beam
      const gShaftH = Math.max(1.5, gCapY - gBot - 0.7);
      const gShaftY = gBot + 0.35 + gShaftH / 2;
      const spanX = 2 * CX - 1.8;                     // fit within the white wall's width
      const total = GN * 2;
      const gShaft = new THREE.InstancedMesh(new THREE.CylinderGeometry(gR * 0.9, gR, gShaftH, 12), _gateMat, total);
      const gBase  = new THREE.InstancedMesh(new THREE.BoxGeometry(gR * 2.5, 0.30, gR * 2.5), _gateMat, total);
      const gCap   = new THREE.InstancedMesh(new THREE.BoxGeometry(gR * 2.7, 0.35, gR * 2.7), _gateMat, total);
      let gi = 0;
      for (const zEnd of [A.bounds.minZ, A.bounds.maxZ]) {
        const toCenter = -Math.sign(zEnd);
        const gz = zEnd + toCenter * 1.05;            // in front of the white wall (wall at +0.5)
        for (let k = 0; k < GN; k++) {
          const gx = -spanX / 2 + (k / (GN - 1)) * spanX;
          put(gBase,  gi, gx, gBot + 0.15, gz);
          put(gShaft, gi, gx, gShaftY, gz);
          put(gCap,   gi, gx, gCapY, gz);
          gi++;
        }
        // Cross-beam sill (impost course) the pillars stand on — spans the wall width.
        const sill = new THREE.Mesh(new THREE.BoxGeometry(2 * CX - 0.4, 0.55, 1.3), _gateMat);
        sill.position.set(0, gBot - 0.275, zEnd + toCenter * 0.75);
        scene.add(sill);
      }
      [gShaft, gBase, gCap].forEach(m => { m.instanceMatrix.needsUpdate = true; scene.add(m); });
    }
  }

  // (Ground "USA" removed — flags live only around the outer arena now.)
}

// ── Perf budget: no realtime shadows for the MVP. Keep 02_setup's 1 dir + 1
// ambient light; just stop the sun from casting (kills the shadow pass). ──
renderer.shadowMap.enabled = false;
// ── SUNSET — a low, warm sun tucked behind the tall outer stands, a dusk sky,
// and a dimmer/warmer fill so the whole arena reads as golden hour. ──
const _sunLow = [250, 70, -195];   // ~12° elevation → the disc sits behind the stands
if (typeof sun !== 'undefined' && sun) {
  sun.castShadow = false;
  sun.intensity = 1.35;
  sun.color.setHex(0xffb060);      // warm sunset light
  sun.position.set(_sunLow[0], _sunLow[1], _sunLow[2]);
}
if (typeof sunMesh !== 'undefined' && sunMesh) {
  sunMesh.position.set(_sunLow[0], _sunLow[1], _sunLow[2]);
  if (sunMesh.material) sunMesh.material.color.setHex(0xffcf6a);  // warm disc
}
// Dim + warm the ambient fill for dusk.
const _amb = scene.children.find(o => o.isAmbientLight);
if (_amb) { _amb.intensity = 0.33; _amb.color.setHex(0xffdcc0); }
// Kill the island's grass-green ground-bounce: the HemisphereLight's ground color
// (0x2d7a0a) tints every downward/shadowed face green. The arena floor is stone, so
// re-tint the bounce warm and mute the sky half to a dusk indigo — arena only, so the
// island keeps its grass bounce.
const _hemi = scene.children.find(o => o.isHemisphereLight);
if (_hemi) { _hemi.groundColor.setHex(0x6a5a3e); _hemi.color.setHex(0x3a4a6a); _hemi.intensity = 0.5; }
// Warm the fog from the island's daytime blue to a dusk brown so the ground plain
// dissolves into a golden horizon. Fog only tints scene geometry — the sky dome is
// fog:false, so the carefully-tuned horizon glow is untouched.
if (scene.fog) scene.fog.color.setHex(0x3a2a22);
// Re-tint the sky dome to a sunset gradient (deep indigo zenith → warm horizon glow).
if (window.skyDome && window.skyDome.geometry && window.skyDome.geometry.attributes.color) {
  const sp = window.skyDome.geometry.attributes.position;
  const col = window.skyDome.geometry.attributes.color, sc = col.array;
  // Tall sunset: the warm→plum→purple gradient is stretched high up the dome (was
  // mostly spent by y=360) so the colour reads well above the arena wall. Horizon
  // glow kept as-is — user likes it.
  const stops = [
    [ 880, 0.07, 0.06, 0.22 ],   // zenith — deep indigo
    [ 820, 0.22, 0.11, 0.34 ],   // high dusk — purple pushed higher again (+15%)
    [ 503, 0.48, 0.18, 0.33 ],   // dark-red / plum band (mid-high)
    [ 212, 0.80, 0.34, 0.32 ],   // warm red band
    [   0, 0.98, 0.56, 0.30 ],   // horizon glow
    [-880, 0.60, 0.34, 0.28 ],
  ];
  for (let i = 0; i < sp.count; i++) {
    const y = sp.getY(i);
    let s0 = stops[0], s1 = stops[stops.length - 1];
    for (let k = 0; k < stops.length - 1; k++) {
      if (y >= stops[k + 1][0]) { s0 = stops[k]; s1 = stops[k + 1]; break; }
    }
    const t = Math.max(0, Math.min(1, (s0[0] - y) / (s0[0] - s1[0])));
    sc[i * 3]     = s0[1] + (s1[1] - s0[1]) * t;
    sc[i * 3 + 1] = s0[2] + (s1[2] - s0[2]) * t;
    sc[i * 3 + 2] = s0[3] + (s1[3] - s0[3]) * t;
  }
  col.needsUpdate = true;
}
