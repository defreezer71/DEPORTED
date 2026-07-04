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
const _groundMat    = new THREE.MeshLambertMaterial({ color: A.floorColor });
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
const _crateMat     = new THREE.MeshLambertMaterial({ color: A.crateColor });

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

// ── Ground plane (green field) — sized to the play area + a small margin. The
// coliseum skin's stone concourse (below) fills the surround and the tunnels. ──
{
  const b = A.bounds;
  const g = new THREE.Mesh(
    new THREE.PlaneGeometry((b.maxX - b.minX) + 6, (b.maxZ - b.minZ) + 6), _groundMat);
  g.rotation.x = -Math.PI / 2;
  g.position.y = 0.01;
  scene.add(g);
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

// ── Tunnels — ENCLOSED black corridors (walls + ceiling) breaching the N/S
// walls; the spawn sits at the back and the player walks the dark corridor out
// into the bright bowl (the "walkout" reveal). ──
{
  const t = A.tunnel, b = A.bounds, T = 1;
  const gapHalf = t.width / 2;                       // 3
  for (const side of [-1, 1]) {                      // -1 = north (−z), +1 = south (+z)
    const zWall  = side < 0 ? b.minZ : b.maxZ;       // ∓28
    const zOuter = zWall + side * t.length;          // ∓42
    const zMid   = (zWall + zOuter) / 2;             // ∓35
    // Corridor side walls
    addArenaBox(T, t.height, t.length, -(gapHalf + T / 2), zMid, _tunnelMat);
    addArenaBox(T, t.height, t.length,  (gapHalf + T / 2), zMid, _tunnelMat);
    // Back wall (end cap) sealing the tunnel behind the spawn
    addArenaBox(t.width + T, t.height, T, 0, zOuter + side * (T / 2), _tunnelMat);
    // Ceiling slab — encloses the corridor into a dark box
    addArenaBox(t.width + T, 0.6, t.length, 0, zMid, _tunnelMat, 0, t.height + 0.3);
  }
}

// ── Monument — central CIRCULAR stepped dais (climbable from any side) topped by
// a bronze Atlas hoisting the globe. The dais + the statue's solid core break the
// straight spawn-to-spawn sightline; both are collidable (movement + bullets). ──
{
  const m = A.monument;
  // Dais cylinder → collidables + targets. NOT scaled by the statue group below,
  // so the step risers stay ≤ physics STEP_HEIGHT (0.45) and remain climbable.
  const addCyl = (r, h, yc, mat, seg = 24) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
    c.position.set(m.x, yc, m.z);
    c.updateMatrixWorld(true);
    scene.add(c); collidables.push(c); targets.push(c);
    return c;
  };
  // Concentric ziggurat steps: wide+short base → narrow summit; climbable from any
  // direction. +15% wider than before (more cover).
  const STEPS = Math.ceil(m.height / 0.4);            // 5 (riser 0.40) for height 2.0
  const rBottom = 7.8, rTop = 3.3;
  for (let k = 0; k < STEPS; k++) {
    const top = (k + 1) * (m.height / STEPS);
    const r   = rBottom + (rTop - rBottom) * (k / (STEPS - 1));
    addCyl(r, top, top / 2, _monMat);
  }

  // ── ATLAS — humanoid bronze titan built into a GROUP so the whole statue
  // (visible figure + collidable core + pedestal) scales +15% in one shot. The
  // group sits at the summit; parts are positioned relative to it (feet at y=0). ──
  const yTop = m.height;                              // 2.0 (summit)
  const _bronze = new THREE.MeshLambertMaterial({ color: 0x7a5c34, emissive: 0x1c1408 });
  const atlas = new THREE.Group();
  atlas.position.set(m.x, yTop, m.z);
  scene.add(atlas);
  const addPart = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, collide = false) => {
    const o = new THREE.Mesh(geo, mat);
    o.position.set(x, y, z); o.rotation.set(rx, ry, rz);
    atlas.add(o);
    if (collide) { collidables.push(o); targets.push(o); }
    return o;
  };
  const bx = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  addPart(new THREE.CylinderGeometry(1.6, 1.8, 1.5, 22), _monMat, 0, 0.75, 0, 0, 0, 0, true); // pedestal y0→1.5
  const f = 1.5;                                      // feet at the pedestal top
  addPart(new THREE.CylinderGeometry(0.55, 0.62, 3.6, 12), _bronze, 0, f + 1.8, 0, 0, 0, 0, true); // collidable torso core
  addPart(bx(0.60, 3.0, 0.75), _bronze, -0.52, f + 1.5,  0.05, 0, 0,  0.03);  // left leg
  addPart(bx(0.58, 2.9, 0.72), _bronze,  0.55, f + 1.45, -0.05, 0, 0, -0.05); // right leg
  addPart(bx(1.4, 0.8, 0.85), _bronze, 0, f + 3.0, 0);                        // pelvis
  addPart(bx(1.15, 1.0, 0.8), _bronze, 0, f + 3.8, 0);                        // waist
  addPart(bx(1.7, 1.5, 1.0), _bronze, 0, f + 4.9, 0);                         // chest
  addPart(bx(2.4, 0.8, 1.05), _bronze, 0, f + 5.8, 0);                        // shoulders
  addPart(bx(0.42, 0.5, 0.42), _bronze, 0, f + 6.25, 0);                      // neck
  addPart(new THREE.IcosahedronGeometry(0.52, 0), _bronze, 0, f + 6.75, 0.05); // head
  for (const s of [-1, 1]) {
    addPart(bx(0.44, 1.7, 0.44), _bronze, s * 1.15, f + 6.35, 0, 0, 0, s *  0.6); // upper arm
    addPart(bx(0.40, 1.6, 0.40), _bronze, s * 1.55, f + 7.6,  0, 0, 0, s * -0.5); // forearm
  }
  // Tilted armillary sphere — open bronze rings + polar axis.
  {
    const sy = f + 9.0, R = 2.0, TILT = 0.42;
    const ringGeo = new THREE.TorusGeometry(R, 0.09, 8, 44);
    for (const [rx, ry] of [[Math.PI / 2, 0], [Math.PI / 2, 0.6], [0, 0], [0, Math.PI / 3], [0, (2 * Math.PI) / 3]])
      addPart(ringGeo, _bronze, 0, sy, 0, rx, ry, TILT);
    addPart(new THREE.CylinderGeometry(0.08, 0.08, R * 2.5, 8), _bronze, 0, sy, 0, 0, 0, TILT);
  }
  atlas.scale.setScalar(1.15);                       // +15% larger
  atlas.updateMatrixWorld(true);                     // collidable core/pedestal AABBs pick up the scale
}

// ── Cover — containers (full standing cover) + crates (crouch cover). Each entry
// in A.cover already carries its 180°-rotational partner. ──
for (const c of A.cover) {
  const isContainer = c.type === 'container';
  const sz  = isContainer ? A.containerSize : A.crateSize;
  const mat = isContainer ? _containerMat : _crateMat;
  addArenaBox(sz.x, sz.y, sz.z, c.x, c.z, mat, c.rotationY || 0);
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
  const _concMat    = new THREE.MeshLambertMaterial({ color: 0x3a3934 }); // dark stone concourse

  // ── Stone concourse under everything (fills behind the podium + tunnels) ──
  {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(170, 170), _concMat);
    c.rotation.x = -Math.PI / 2;
    c.position.y = -0.04;
    scene.add(c);
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
  function swagTex() {
    // American bunting: a blue star rail with red/white/blue radial-gore fans
    // hanging below it. Transparent elsewhere so it reads as scalloped drapes.
    const c = document.createElement('canvas'); c.width = 320; c.height = 80;
    const x = c.getContext('2d');
    x.clearRect(0, 0, 320, 80);
    x.fillStyle = '#1a2a6c'; x.fillRect(0, 0, 320, 16);                   // star rail
    x.fillStyle = '#fff';
    for (let i = 0; i < 20; i++) { x.beginPath(); x.arc(8 + i * 16, 8, 2.2, 0, Math.PI * 2); x.fill(); }
    const fans = 5, fw = 320 / fans, R = 44, gores = 7;
    const cols = ['#b22234', '#ffffff', '#1a2a6c'];
    for (let f = 0; f < fans; f++) {
      const cx = f * fw + fw / 2;
      for (let g = 0; g < gores; g++) {
        x.fillStyle = cols[g % 3];
        x.beginPath(); x.moveTo(cx, 16);
        x.arc(cx, 16, R, Math.PI * (g / gores), Math.PI * ((g + 1) / gores)); x.closePath(); x.fill();
      }
    }
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

    // Grand entablature beam, hanging swag, and a black tympanum filling the gap
    // between the tunnel top and the beam — so the TOP of the black opening is
    // hidden and the entrance reads as a tall, bottomless dark portal.
    const swagMat = new THREE.MeshBasicMaterial({ map: swagTex(), side: THREE.DoubleSide, transparent: true, depthWrite: false });
    const beamY = baseTop + COL_H + 2.0, beamH = 2.6, beamBot = beamY - beamH / 2;
    for (const zEnd of [A.bounds.minZ, A.bounds.maxZ]) {
      const toCenter = -Math.sign(zEnd);
      const cz = zEnd + toCenter * 1.8;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * CX + 3.4, beamH, 2.5), _gateMat);
      beam.position.set(0, beamY, cz);
      scene.add(beam);
      const tymH = beamBot - A.tunnel.height;
      if (tymH > 0.3) {
        const tym = new THREE.Mesh(new THREE.BoxGeometry(2 * CX - 0.4, tymH, 0.6), _tunnelMat);
        tym.position.set(0, A.tunnel.height + tymH / 2, zEnd + toCenter * 0.5);
        scene.add(tym);
      }
      // Large American bunting draped over the entrance — placed in FRONT of the
      // columns (and well ahead of the black tympanum, which was hiding it) so it
      // always reads, drooping toward the mouth.
      const swag = new THREE.Mesh(new THREE.PlaneGeometry(2 * CX + 2, 4.0), swagMat);
      swag.position.set(0, A.tunnel.height + 1.5, zEnd + toCenter * 2.8);
      swag.rotation.y = toCenter > 0 ? 0 : Math.PI;
      swag.renderOrder = 2;
      scene.add(swag);
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
// Re-tint the sky dome to a sunset gradient (deep indigo zenith → warm horizon glow).
if (window.skyDome && window.skyDome.geometry && window.skyDome.geometry.attributes.color) {
  const sp = window.skyDome.geometry.attributes.position;
  const col = window.skyDome.geometry.attributes.color, sc = col.array;
  const stops = [
    [ 880, 0.05, 0.07, 0.24 ],   // zenith — deep indigo
    [ 360, 0.16, 0.13, 0.34 ],   // upper dusk
    [ 120, 0.72, 0.36, 0.34 ],   // warm band
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
