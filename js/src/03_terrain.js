// TERRAIN
// ═══════════════════════════════════════════════════════════
const half = CONFIG.islandSize / 2;


// Used by jungle placement to keep trees out of the canal zone
const _CANAL_R = 85, _CANAL_W = 1.25;
function isInStream(x, z) {
  const w = _CANAL_W + 6; // extra buffer keeps trees/bushes clear of canal edges
  if (Math.abs(z + _CANAL_R) < w && Math.abs(x) <= _CANAL_R + w) return true; // North
  if (Math.abs(x - _CANAL_R) < w && Math.abs(z) <= _CANAL_R + w) return true; // East
  if (Math.abs(z - _CANAL_R) < w && Math.abs(x) <= _CANAL_R + w) return true; // South
  if (Math.abs(x + _CANAL_R) < w && Math.abs(z) <= _CANAL_R + w) return true; // West
  return false;
}
// Tight version — only excludes the actual water channel (for grass placement)
function isInCanalWater(x, z) {
  const w = _CANAL_W + 0.2;
  if (Math.abs(z + _CANAL_R) < w && Math.abs(x) <= _CANAL_R + w) return true;
  if (Math.abs(x - _CANAL_R) < w && Math.abs(z) <= _CANAL_R + w) return true;
  if (Math.abs(z - _CANAL_R) < w && Math.abs(x) <= _CANAL_R + w) return true;
  if (Math.abs(x + _CANAL_R) < w && Math.abs(z) <= _CANAL_R + w) return true;
  return false;
}

function getVolcanoHeight(x, z) {
  const dist = Math.sqrt(x * x + z * z);
  if (dist > CONFIG.volcanoRadius) return 0;
  const t = 1 - dist / CONFIG.volcanoRadius;
  const smooth = t * t * t * (t * (t * 6 - 15) + 10);
  let h = smooth * CONFIG.volcanoHeight;
  if (dist < CONFIG.volcanoRadius * 0.18) {
    const flatT = dist / (CONFIG.volcanoRadius * 0.18);
    h = CONFIG.volcanoHeight - (1 - flatT * flatT) * 1.2;
  }
  return Math.max(0, h);
}

function getTerrainHeight(x, z) {
  if (Math.abs(x) > half || Math.abs(z) > half) return -5;
  const vh = getVolcanoHeight(x, z);

  const raw = Math.sin(x * 0.15) * Math.cos(z * 0.15) * 0.3;

  // Flatten terrain within 10 units of each canal side so the canal walls
  // never float above or sink into a terrain ridge/valley.
  const R = _CANAL_R, buf = 10;
  const dS = (Math.abs(x) <= R + buf) ? Math.abs(z + R) : 999;
  const dN = (Math.abs(x) <= R + buf) ? Math.abs(z - R) : 999;
  const dE = (Math.abs(z) <= R + buf) ? Math.abs(x - R) : 999;
  const dW = (Math.abs(z) <= R + buf) ? Math.abs(x + R) : 999;
  const dist = Math.min(dS, dN, dE, dW);
  const flatRaw = dist >= buf ? raw : raw * (dist / buf) * (dist / buf) * (3 - 2 * (dist / buf));

  // Smoothly blend flat terrain into volcano over a 0→1.5 unit transition zone.
  // The old hard threshold (vh > 0.5 → return vh) caused a visible floor jump.
  if (vh <= 0)   return flatRaw;
  if (vh >= 1.5) return vh;
  const bt = vh / 1.5;
  const st = bt * bt * (3 - 2 * bt);   // smoothstep
  return flatRaw + (vh - flatRaw) * st;
}

// ═══════════════════════════════════════════════════════════
// BUILD GROUND MESH
// ═══════════════════════════════════════════════════════════
const groundSeg = 180;
const groundGeo = new THREE.PlaneGeometry(CONFIG.islandSize, CONFIG.islandSize, groundSeg, groundSeg);
const gPosAttr = groundGeo.attributes.position;

for (let i = 0; i < gPosAttr.count; i++) {
  const x = gPosAttr.getX(i);
  const y = gPosAttr.getY(i);
  gPosAttr.setZ(i, getTerrainHeight(x, y));
}
groundGeo.computeVertexNormals();

const groundColors = new Float32Array(gPosAttr.count * 3);
for (let i = 0; i < gPosAttr.count; i++) {
  const x = gPosAttr.getX(i);
  const y = gPosAttr.getY(i);
  const h = getTerrainHeight(x, y);
  let r, g, b;
  // Use distance from center to determine volcano zone (not height) — prevents green bleed at base
  const vDist = Math.sqrt(x * x + y * y);
  const onVolcano = vDist < CONFIG.volcanoRadius * 0.98 && getVolcanoHeight(x, y) > 0.2;
  if (onVolcano) {
    const t = Math.min(h / CONFIG.volcanoHeight, 1);
    // Polar coords — radial channels run down from summit like real lava flows
    const angle  = Math.atan2(y, x);
    const normR  = Math.sqrt(x*x + y*y) / CONFIG.volcanoRadius;
    // Primary flow channels — 9 main ridges radiating from crater
    const flowA  = Math.sin(angle * 9  + normR * 4.5) * 0.085;
    // Secondary channels between primaries
    const flowB  = Math.sin(angle * 17 + normR * 3.2 + 0.8) * 0.045;
    // Slow large-scale undulation — breaks regularity without adding pattern
    const flowC  = Math.sin(angle * 4  - normR * 2.1 + 1.3) * 0.035;
    // Fine surface roughness — mixed irrational frequencies to avoid grid
    const rough  = Math.sin(x * 8.3 + y * 11.7) * 0.016 + Math.cos(x * 19.1 - y * 13.4) * 0.010;
    // Subtle height strata (geological layering)
    const strata = Math.sin(h * 2.2) * 0.028 + Math.sin(h * 5.5) * 0.013;
    // Combined surface noise
    const surf = flowA + flowB + flowC + rough + strata;
    // Occasional brown scatter — clamped so it only shows in patches, not uniformly
    const brownNoise = Math.sin(x * 3.7 + y * 5.1) * Math.cos(x * 7.3 - y * 2.9);
    const brown = Math.max(0, brownNoise - 0.45) * 0.18;  // only fires where noise peaks, sparse
    // Zone blends — sharper transitions for visible banding
    const rustBlend = Math.max(0, Math.min(1, (t - 0.20) / 0.25));
    const ashBlend  = Math.max(0, Math.min(1, (t - 0.58) / 0.22));
    const rimBlend  = Math.max(0, (t - 0.84) / 0.16);
    // Colors: dark charcoal basalt → medium grey slope → lighter grey → dark red crater rim
    const basaltR = 0.17 + surf * 0.55 + brown * 1.0;
    const basaltG = 0.17 + surf * 0.54 + brown * 0.5;
    const basaltB = 0.16 + surf * 0.52;
    // Mid-slope: slightly lighter grey, flow channels still prominent
    const rustR   = 0.25 + surf * 0.60 + brown * 1.0;
    const rustG   = 0.24 + surf * 0.58 + brown * 0.5;
    const rustB   = 0.23 + surf * 0.56;
    // Upper slope: cool grey, subtle strata
    const ashR    = 0.31 + rough * 0.18 + strata * 0.10 + brown * 0.7;
    const ashG    = 0.30 + rough * 0.17 + strata * 0.09 + brown * 0.35;
    const ashB    = 0.29 + rough * 0.16 + strata * 0.08;
    // Crater rim: dark volcanic red — keep the red summit (15% darker)
    const rimR    = 0.255 + rough * 0.238;
    const rimG    = 0.043 + rough * 0.051;
    const rimB    = 0.026 + rough * 0.034;
    r = basaltR + (rustR - basaltR) * rustBlend + (ashR - rustR) * ashBlend + (rimR - ashR) * rimBlend;
    g = basaltG + (rustG - basaltG) * rustBlend + (ashG - rustG) * ashBlend + (rimG - ashG) * rimBlend;
    b = basaltB + (rustB - basaltB) * rustBlend + (ashB - rustB) * ashBlend + (rimB - ashB) * rimBlend;
    r = Math.max(0, Math.min(1, r));
    g = Math.max(0, Math.min(1, g));
    b = Math.max(0, Math.min(1, b));
  } else {
    // Multi-octave noise for rich micro-variation
    const n1 = Math.sin(x * 0.48 + 0.3) * Math.cos(y * 0.71 + 0.1) * 0.11;
    const n2 = Math.sin(x * 2.31 + y * 1.72) * 0.055;
    const n3 = Math.sin(x * 0.11 - 0.2) * Math.cos(y * 0.094 + 0.5) * 0.08;
    const n4 = Math.sin(x * 5.7 + y * 4.3) * 0.028;
    const n5 = Math.cos(x * 9.1 - y * 7.8) * 0.016;
    const n6 = Math.sin(x * 18.3 + y * 22.7) * 0.008; // fine detail
    const grass = n1 + n2 + n3 + n4 + n5 + n6;
    const warmth = Math.sin(x * 0.07 + y * 0.05) * 0.03;
    // Moisture map — damp dark green near canal, dry olive elsewhere
    const dS = Math.abs(y + _CANAL_R), dN = Math.abs(y - _CANAL_R);
    const dE = Math.abs(x - _CANAL_R), dW = Math.abs(x + _CANAL_R);
    const nearCanal = Math.max(0, 1 - Math.min(dS, dN, dE, dW) / 22);
    const moisture = nearCanal * 0.06;
    // Subtle dirt-path variation along diagonals
    const dirtPatch = Math.max(0, Math.sin(x * 0.22 + y * 0.19) * Math.cos(x * 0.15 - y * 0.28) - 0.55) * 0.18;
    const baseG = 0.28 + grass + moisture;
    r = Math.max(0, (0.07 + grass * 0.7 + warmth + seededRand() * 0.022 + dirtPatch * 1.1) * 0.60);
    g = Math.max(0, (baseG   + seededRand() * 0.038 - dirtPatch * 0.3) * 0.62);
    b = Math.max(0, (0.04 + grass * 0.35 - warmth * 0.6 + moisture * 0.4) * 0.60);
  }
  groundColors[i * 3] = r;
  groundColors[i * 3 + 1] = g;
  groundColors[i * 3 + 2] = b;
}
groundGeo.setAttribute('color', new THREE.BufferAttribute(groundColors, 3));

const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ── Raised canal — square corners, axis-aligned sides ──
{
  const CANAL_R    = 85;
  const canalH     = 0.847; // +10%
  const canalOuter = 1.25;
  const wallThick  = 0.29;
  const canalInner = canalOuter - wallThick;
  const _s = 2.5;

  const _waterMat = new THREE.MeshLambertMaterial({
    color: 0x1a8ed8, transparent: true, opacity: 0.84, side: THREE.DoubleSide,
  });

  // Brick texture for canal walls
  const _brickCanvas = document.createElement('canvas'); _brickCanvas.width = 256; _brickCanvas.height = 128;
  const _bctx = _brickCanvas.getContext('2d');
  _bctx.fillStyle = '#291a11'; _bctx.fillRect(0, 0, 256, 128);
  const bW = 64, bH = 28;
  for (let row = 0; row < 6; row++) {
    const offsetX = (row % 2) * bW * 0.5;
    for (let col = -1; col < 5; col++) {
      const bx = col * bW + offsetX, by = row * bH;
      const shade = 0.88 + Math.random() * 0.24;
      _bctx.fillStyle = `rgba(${Math.floor(50*shade)},${Math.floor(28*shade)},${Math.floor(16*shade)},1)`;
      _bctx.fillRect(bx + 2, by + 2, bW - 4, bH - 4);
      for (let gi = 0; gi < 5; gi++) {
        _bctx.fillStyle = `rgba(0,0,0,${0.04 + Math.random()*0.06})`;
        _bctx.fillRect(bx + 2 + Math.random()*(bW-8), by + 2 + Math.random()*(bH-6), bW*0.3, 1);
      }
    }
  }
  _bctx.fillStyle = 'rgba(18,11,8,0.92)';
  for (let row = 0; row <= 6; row++) { _bctx.fillRect(0, row * bH, 256, 2); }
  for (let row = 0; row < 6; row++) {
    const offsetX = (row % 2) * bW * 0.5;
    for (let col = -1; col < 5; col++) { _bctx.fillRect(col*bW+offsetX, row*bH, 2, bH); }
  }
  const _brickTex = new THREE.CanvasTexture(_brickCanvas);
  _brickTex.wrapS = _brickTex.wrapT = THREE.RepeatWrapping;

  const _wallMat = new THREE.MeshLambertMaterial({ map: _brickTex, side: THREE.DoubleSide });

  // addQuad with UV: uvArr receives UVs computed from quad horizontal/vertical spans
  const addQuad = (arr, uvArr, idx, x0,y0,z0, x1,y1,z1, x2,y2,z2, x3,y3,z3) => {
    const b = arr.length / 3;
    arr.push(x0,y0,z0, x1,y1,z1, x2,y2,z2, x3,y3,z3);
    if (uvArr) {
      const sc = 0.55;
      const dx=x1-x0,dz=z1-z0; const hL=Math.sqrt(dx*dx+dz*dz)*sc;
      const dx2=x2-x0,dy2=y2-y0,dz2=z2-z0; const vL=Math.sqrt(dx2*dx2+dy2*dy2+dz2*dz2)*sc;
      uvArr.push(0,0, hL,0, 0,vL, hL,vL);
    }
    idx.push(b, b+1, b+2, b+1, b+3, b+2);
  };

  function mkPts(x0,z0,x1,z1) {
    const dx=x1-x0, dz=z1-z0, dist=Math.sqrt(dx*dx+dz*dz);
    const n = Math.max(2, Math.ceil(dist/_s)+1);
    return Array.from({length:n},(_,i)=>({x:x0+dx*i/(n-1), z:z0+dz*i/(n-1)}));
  }

  function segNorm(seg) {
    const dx=seg[seg.length-1].x-seg[0].x, dz=seg[seg.length-1].z-seg[0].z;
    const l=Math.sqrt(dx*dx+dz*dz)||1;
    return {nx:-dz/l, nz:dx/l};
  }

  // Miter between two normals — bisects the joint and scales to keep wall width consistent
  function miter(n1, n2) {
    const mx=n1.nx+n2.nx, mz=n1.nz+n2.nz;
    const ml=Math.sqrt(mx*mx+mz*mz);
    if (ml<0.001) return n1;
    const dot=(mx/ml)*n1.nx+(mz/ml)*n1.nz;
    const s=Math.min(1/Math.max(dot,0.25),4);
    return {nx:(mx/ml)*s, nz:(mz/ml)*s};
  }

  const C=CANAL_R;
  const segments = [
    mkPts(-C,-C,  C,-C),
    mkPts( C,-C,  C, C),
    mkPts( C, C, -C, C),
    mkPts(-C, C, -C,-C),
  ];

  const NS = segments.length;
  const norms = segments.map(segNorm);
  // At each junction, use a miter that correctly bridges the two adjacent segments
  const startM = segments.map((_,i) => miter(norms[(i-1+NS)%NS], norms[i]));
  const endM   = segments.map((_,i) => miter(norms[i], norms[(i+1)%NS]));

  const allWaterV=[], allWaterI=[];

  for (let si=0; si<NS; si++) {
    const seg=segments[si], sn=norms[si];
    const wv=[], wuv=[], wi=[];

    for (let i=0; i<seg.length-1; i++) {
      const p=seg[i], q=seg[i+1];
      // Junction endpoints use miter; interior points use straight segment normal
      const mp = (i===0)            ? startM[si] : sn;
      const mq = (i===seg.length-2) ? endM[si]   : sn;
      const yB=-1.0, yT=canalH, fY=0.08;

      // Island-side wall (inner face of canal)
      addQuad(wv,wuv,wi, p.x+mp.nx*canalOuter,yB,p.z+mp.nz*canalOuter, q.x+mq.nx*canalOuter,yB,q.z+mq.nz*canalOuter,
                     p.x+mp.nx*canalOuter,yT,p.z+mp.nz*canalOuter, q.x+mq.nx*canalOuter,yT,q.z+mq.nz*canalOuter);
      addQuad(wv,wuv,wi, p.x+mp.nx*canalInner,yB,p.z+mp.nz*canalInner, q.x+mq.nx*canalInner,yB,q.z+mq.nz*canalInner,
                     p.x+mp.nx*canalInner,yT,p.z+mp.nz*canalInner, q.x+mq.nx*canalInner,yT,q.z+mq.nz*canalInner);
      addQuad(wv,wuv,wi, p.x+mp.nx*canalInner,yT,p.z+mp.nz*canalInner, q.x+mq.nx*canalInner,yT,q.z+mq.nz*canalInner,
                     p.x+mp.nx*canalOuter,yT,p.z+mp.nz*canalOuter, q.x+mq.nx*canalOuter,yT,q.z+mq.nz*canalOuter);

      // Exterior wall
      addQuad(wv,wuv,wi, p.x-mp.nx*canalOuter,yB,p.z-mp.nz*canalOuter, q.x-mq.nx*canalOuter,yB,q.z-mq.nz*canalOuter,
                     p.x-mp.nx*canalOuter,yT,p.z-mp.nz*canalOuter, q.x-mq.nx*canalOuter,yT,q.z-mq.nz*canalOuter);
      addQuad(wv,wuv,wi, p.x-mp.nx*canalInner,yB,p.z-mp.nz*canalInner, q.x-mq.nx*canalInner,yB,q.z-mq.nz*canalInner,
                     p.x-mp.nx*canalInner,yT,p.z-mp.nz*canalInner, q.x-mq.nx*canalInner,yT,q.z-mq.nz*canalInner);
      addQuad(wv,wuv,wi, p.x-mp.nx*canalInner,yT,p.z-mp.nz*canalInner, q.x-mq.nx*canalInner,yT,q.z-mq.nz*canalInner,
                     p.x-mp.nx*canalOuter,yT,p.z-mp.nz*canalOuter, q.x-mq.nx*canalOuter,yT,q.z-mq.nz*canalOuter);

      // Concrete floor
      addQuad(wv,wuv,wi, p.x-mp.nx*canalInner,fY,p.z-mp.nz*canalInner, q.x-mq.nx*canalInner,fY,q.z-mq.nz*canalInner,
                     p.x+mp.nx*canalInner,fY,p.z+mp.nz*canalInner, q.x+mq.nx*canalInner,fY,q.z+mq.nz*canalInner);

      // Water
      const ww=canalInner-0.05, yw=canalH*0.75;
      addQuad(allWaterV,null,allWaterI, p.x-mp.nx*ww,yw,p.z-mp.nz*ww, q.x-mq.nx*ww,yw,q.z-mq.nz*ww,
                                   p.x+mp.nx*ww,yw,p.z+mp.nz*ww, q.x+mq.nx*ww,yw,q.z+mq.nz*ww);
    }

    const g=new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wv),3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(wuv),2));
    g.setIndex(wi);
    g.computeVertexNormals();
    // Visual only — collision handled by axis-aligned strips below
    scene.add(new THREE.Mesh(g,_wallMat));
  }

  // Collision — two thin walls per side (inner + outer) with an open gap between.
  // Players walk up to the inner wall (must jump over, top at 0.77 > STEP_HEIGHT 0.45).
  // Once airborne and past the inner wall, they land in the gap where getTerrainHeight
  // returns -0.8, sinking to the canal floor. Outer wall prevents escaping off-island.
  const cHgt = 1.0 + canalH;            // original wall height
  const cY   = cHgt / 2 - 1.0;         // box top at canalH (0.77) above ground
  const cInn = C - canalOuter;          // 83.75 — inner face radius
  const cOut = C + canalOuter;          // 86.25 — outer face radius
  const wC   = 0.5;                     // collision wall thickness (wider than visual for safety)
  const iLen = cInn * 2;               // inner walls stop at adjacent canal zone — no corner overlap
  const oLen = cOut * 2 + wC;          // outer walls span full perimeter including corners
  [
    // South inner / outer
    [0,          -(cInn + wC/2), iLen,  wC  ],
    [0,          -(cOut - wC/2), oLen,  wC  ],
    // East inner / outer
    [cInn + wC/2,  0,            wC,   iLen ],
    [cOut - wC/2,  0,            wC,   oLen ],
    // North inner / outer
    [0,           cInn + wC/2,   iLen,  wC  ],
    [0,           cOut - wC/2,   oLen,  wC  ],
    // West inner / outer
    [-(cInn + wC/2), 0,          wC,   iLen ],
    [-(cOut - wC/2), 0,          wC,   oLen ],
  ].forEach(([x, z, w, d]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, cHgt, d), new THREE.MeshBasicMaterial());
    m.position.set(x, cY, z);
    m.visible = false;
    scene.add(m);
    collidables.push(m);
  });

  const waterGeo=new THREE.BufferGeometry();
  waterGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(allWaterV),3));
  waterGeo.setIndex(allWaterI);
  waterGeo.computeVertexNormals();
  window.streamWater=new THREE.Mesh(waterGeo,_waterMat);
  scene.add(window.streamWater);
}

// Crater marking
const crater = new THREE.Mesh(
  new THREE.CircleGeometry(8, 20),
  new THREE.MeshLambertMaterial({ color: 0x3a2a1a })
);
crater.rotation.x = -Math.PI / 2;
crater.position.set(0, CONFIG.volcanoHeight - 0.8, 0);
scene.add(crater);

// ── Instanced Smoke — 1 draw call for all volcano smoke puffs ──
const SMOKE_COUNT = 18;
const smokeGeo = new THREE.SphereGeometry(1, 7, 6); // unit sphere, scaled per instance
const smokeMat = new THREE.MeshBasicMaterial({ color: 0x6b4a28, transparent: true, opacity: 0.30 });
const smokeInst = new THREE.InstancedMesh(smokeGeo, smokeMat, SMOKE_COUNT);
smokeInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(smokeInst);

// Store per-instance smoke data (replaces smokeParticles array of meshes)
const smokeParticles = [];
const _smokeDummy = new THREE.Object3D();
for (let i = 0; i < SMOKE_COUNT; i++) {
  const size = 1.0 + seededRand() * 2.5;
  const baseY = CONFIG.volcanoHeight + 1 + seededRand() * 16;
  smokeParticles.push({
    baseY,
    phase: seededRand() * 6.28,
    speed: 0.4 + seededRand() * 0.8,
    size,
    ox: (seededRand() - 0.5) * 6,
    oz: (seededRand() - 0.5) * 6,
    index: i
  });
  // Set initial matrix so nothing is at origin on frame 0
  _smokeDummy.position.set((seededRand() - 0.5) * 6, baseY, (seededRand() - 0.5) * 6);
  _smokeDummy.scale.setScalar(size);
  _smokeDummy.updateMatrix();
  smokeInst.setMatrixAt(i, _smokeDummy.matrix);
}
smokeInst.instanceMatrix.needsUpdate = true;

// ═══════════════════════════════════════════════════════════
// WATER PLANE — Hidden until water starts rising
// ═══════════════════════════════════════════════════════════
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(CONFIG.islandSize + 60, CONFIG.islandSize + 60, 30, 30),
  new THREE.MeshLambertMaterial({ color: 0x0c4878, transparent: true, opacity: 0.6 })
);
water.rotation.x = -Math.PI / 2;
water.position.y = -5;
water.visible = false;
scene.add(water);

// ── Rising bubble particles along perimeter — single instanced mesh ──
const BUBBLE_COUNT = 40;
const bubbleMat  = new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.35 });
const bubbleInst = new THREE.InstancedMesh(
  new THREE.SphereGeometry(1, 5, 4),   // unit sphere — scaled per instance
  bubbleMat,
  BUBBLE_COUNT
);
bubbleInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
const _bubbleData = [];   // { bx, bz, baseY, speed, phase, size }
const _bubbleDummy = new THREE.Object3D();
let _bubbleCount = 0;
for (let i = 0; i < BUBBLE_COUNT; i++) {
  const angle = seededRand() * Math.PI * 2;
  const dist  = half - 4 - seededRand() * 12;
  const bx    = Math.cos(angle) * dist;
  const bz    = Math.sin(angle) * dist;
  if (Math.abs(bx - CONFIG.prisonPos.x) < CONFIG.prisonSize / 2 + 5 &&
      Math.abs(bz - CONFIG.prisonPos.z) < CONFIG.prisonSize / 2 + 5) {
    // Park off-screen so the slot doesn't flicker
    _bubbleDummy.position.set(0, -9999, 0); _bubbleDummy.scale.setScalar(0.01);
    _bubbleDummy.updateMatrix(); bubbleInst.setMatrixAt(i, _bubbleDummy.matrix);
    _bubbleData.push(null);
    continue;
  }
  const size  = 0.4 + seededRand() * 0.7;
  const baseY = -1 + seededRand() * 2;
  const speed = 0.4 + seededRand() * 0.8;
  const phase = seededRand() * 6.28;
  _bubbleData.push({ bx, bz, baseY, speed, phase, size, y: baseY });
  _bubbleDummy.position.set(bx, baseY, bz);
  _bubbleDummy.scale.setScalar(size);
  _bubbleDummy.updateMatrix();
  bubbleInst.setMatrixAt(i, _bubbleDummy.matrix);
  _bubbleCount++;
}
bubbleInst.instanceMatrix.needsUpdate = true;
// Expose for update loop
window._bubbleInst = bubbleInst;
window._bubbleData = _bubbleData;
window._bubbleDummy2 = _bubbleDummy;
scene.add(bubbleInst);

// ═══════════════════════════════════════════════════════════
// CLIFF WALLS — Single color, smooth height variation
// ═══════════════════════════════════════════════════════════
function createCliffSection(x, z, w, d, h) {
  const cliffH = h || CONFIG.cliffHeight;
  const extendedH = cliffH + 3;
  const segsW = Math.max(1, Math.round(w / 8));
  const segsH = 4;
  const segsD = Math.max(1, Math.round(d / 8));
  const geo = new THREE.BoxGeometry(w, extendedH, d, segsW, segsH, segsD);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i) + x;
    const vy = pos.getY(i) + (extendedH / 2 - 3);
    const t = (vy + 5) / (extendedH + 5);
    const band = Math.sin(vy * 1.8) * 0.06 + Math.sin(vy * 4.3) * 0.03;
    const nx = Math.sin(vx * 0.41 + z * 0.17) * 0.05 + Math.cos(vx * 1.2) * 0.03;
    const base = 0.36 + t * 0.12 + band + nx;
    colors[i*3]   = Math.min(1, base + 0.08);
    colors[i*3+1] = Math.min(1, base * 0.88);
    colors[i*3+2] = Math.min(1, base * 0.72);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, extendedH / 2 - 3, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  collidables.push(mesh);
  return mesh;
}

const ct = CONFIG.cliffThickness;
const segCount = 20;
const segLen = (CONFIG.islandSize + ct * 2) / segCount;
const wallLen = CONFIG.islandSize + ct * 2;
const avgH = CONFIG.cliffHeight + 4;

[
  { px: 0, pz: -half - ct/2, w: wallLen, d: ct },
  { px: 0, pz:  half + ct/2, w: wallLen, d: ct },
  { px:  half + ct/2, pz: 0, w: ct, d: CONFIG.islandSize },
  { px: -half - ct/2, pz: 0, w: ct, d: CONFIG.islandSize },
].forEach(({ px, pz, w, d }) => {
  const geo = new THREE.BoxGeometry(w, avgH, d, Math.max(1,Math.round(w/8)), 4, Math.max(1,Math.round(d/8)));
  const pos2 = geo.attributes.position;
  const cols2 = new Float32Array(pos2.count * 3);
  for (let i = 0; i < pos2.count; i++) {
    const vy = pos2.getY(i) + (avgH / 2 - 3);
    const vx = pos2.getX(i) + px;
    const depthT = Math.max(0, Math.min(1, (vy + 2) / avgH));
    const waveB  = Math.sin(vy * 2.1 + vx * 0.08) * 0.035 + Math.sin(vy * 5.3) * 0.015;
    const foamT  = Math.max(0, (depthT - 0.80) / 0.20);
    const oceanR = 0.01 + depthT * 0.09 + waveB * 0.5 + foamT * 0.72;
    const oceanG = 0.07 + depthT * 0.33 + waveB * 1.2 + foamT * 0.85;
    const oceanB = 0.20 + depthT * 0.46 + waveB       + foamT * 0.76;
    cols2[i*3]   = Math.min(1, oceanR);
    cols2[i*3+1] = Math.min(1, oceanG);
    cols2[i*3+2] = Math.min(1, oceanB);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols2, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
  mesh.position.set(px, avgH / 2 - 3, pz);
  scene.add(mesh);
  collidables.push(mesh);
});

// ── Ocean foam caps — cresting white wave tops on each perimeter wall ──
window._oceanFoam = [];
const foamMat = new THREE.MeshBasicMaterial({ color: 0xe8f8ff, transparent: true, opacity: 0.82 });
const foamY   = avgH - 3 + 0.38;
[
  { px: 0,            pz: -half - ct/2, w: wallLen + ct, d: ct + 0.5 },
  { px: 0,            pz:  half + ct/2, w: wallLen + ct, d: ct + 0.5 },
  { px:  half + ct/2, pz: 0,            w: ct + 0.5,     d: CONFIG.islandSize },
  { px: -half - ct/2, pz: 0,            w: ct + 0.5,     d: CONFIG.islandSize },
].forEach(({ px, pz, w, d }, i) => {
  const foam = new THREE.Mesh(new THREE.BoxGeometry(w, 0.55, d), foamMat);
  foam.position.set(px, foamY, pz);
  foam.userData.baseY = foamY;
  scene.add(foam);
  window._oceanFoam.push(foam);
});
