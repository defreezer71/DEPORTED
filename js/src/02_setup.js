// ═══════════════════════════════════════════════════════════
// THREE.JS SETUP
// ═══════════════════════════════════════════════════════════
const scene = new THREE.Scene();
scene.background = null;
scene.fog = new THREE.FogExp2(0x4a9fe8, 0.0018);

// ── Sky dome — gradient sphere viewed from inside ──
{
  const skyGeo = new THREE.SphereGeometry(880, 32, 20);
  const sp = skyGeo.attributes.position;
  const sc = new Float32Array(sp.count * 3);
  // [y threshold, r, g, b] — sampled top-down
  const stops = [
    [ 880,  0.075, 0.210, 0.520 ],  // zenith — deep blue (not black)
    [ 440,  0.072, 0.260, 0.640 ],  // upper sky
    [   0,  0.095, 0.400, 0.840 ],  // mid sky at horizon level
    [-880,  0.180, 0.580, 0.960 ],  // nadir — pale (underground, irrelevant)
  ];
  for (let i = 0; i < sp.count; i++) {
    const y = sp.getY(i);
    let s0 = stops[0], s1 = stops[stops.length - 1];
    for (let k = 0; k < stops.length - 1; k++) {
      if (y >= stops[k + 1][0]) { s0 = stops[k]; s1 = stops[k + 1]; break; }
    }
    const t = Math.max(0, Math.min(1, (s0[0] - y) / (s0[0] - s1[0])));
    sc[i*3]   = s0[1] + (s1[1] - s0[1]) * t;
    sc[i*3+1] = s0[2] + (s1[2] - s0[2]) * t;
    sc[i*3+2] = s0[3] + (s1[3] - s0[3]) * t;
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  window.skyDome = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false
  }));
  window.skyDome.renderOrder = -1;
  scene.add(window.skyDome);
}

// ── Clouds — low-poly faceted cumulus + straight jet contrails ──
{
  const _cd = new THREE.Object3D();

  // Faceted cloud geometry: a few flattened, jittered icosahedron lobes merged into
  // one non-indexed buffer (matches the polygon-art trees). Bottom is clamped flat.
  const cloudGeo = (() => {
    const lobes = [
      [ 0.0, 0.00,  0.0, 1.00],
      [ 1.15, 0.05,  0.20, 0.72],
      [-1.05, 0.02, -0.15, 0.66],
      [ 0.45, 0.38, -0.28, 0.58],
      [-0.45, 0.32,  0.25, 0.52],
    ];
    const pos = [];
    const v = new THREE.Vector3();
    for (const [lx, ly, lz, s] of lobes) {
      const g = new THREE.IcosahedronGeometry(1, 0);
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const n = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719 + s * 91.7) * 43758.5453;
        v.multiplyScalar(0.85 + (n - Math.floor(n)) * 0.30);
        // squash vertically, offset, flatten the underside
        const wy = Math.max(v.y * 0.55 * s + ly, -0.30);
        pos.push(v.x * s + lx, wy, v.z * 0.80 * s + lz);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.computeVertexNormals(); // non-indexed → per-face normals = facets
    return g;
  })();
  // Lambert + soft emissive: sunlit facets go white, undersides a gentle blue-grey
  const cloudMat = new THREE.MeshLambertMaterial({
    color: 0xdde6ee, emissive: 0x4d5866, fog: false
  });

  const PUFF_COUNT = 12;
  const puffInst = new THREE.InstancedMesh(cloudGeo, cloudMat, PUFF_COUNT);
  for (let i = 0; i < PUFF_COUNT; i++) {
    const angle  = (i / PUFF_COUNT) * Math.PI * 2 + seededRand() * 0.5; // evenly spaced
    const radius = 60 + seededRand() * 560;
    const s      = 22 + seededRand() * 26;
    _cd.position.set(Math.cos(angle) * radius, 130 + seededRand() * 110, Math.sin(angle) * radius);
    _cd.scale.set(s, s * (0.8 + seededRand() * 0.4), s);
    _cd.rotation.set(0, seededRand() * Math.PI * 2, 0);
    _cd.updateMatrix();
    puffInst.setMatrixAt(i, _cd.matrix);
  }
  puffInst.instanceMatrix.needsUpdate = true;
  scene.add(puffInst);

  // ── Jet contrails — long straight lines crossing the whole sky ──
  // 256×16 canvas: crisp head (right) dissolving into a wider faint tail (left)
  const tc = document.createElement('canvas');
  tc.width = 256; tc.height = 16;
  const tx = tc.getContext('2d');
  for (let px = 0; px < 256; px++) {
    const t = px / 255;                       // 0 = tail, 1 = head
    const spread = 6.5 - t * 3.0;             // tail wider (dispersed), head tighter
    // Envelope rises from nothing at the tail, peaks near the head, then dissolves —
    // both ends fade out so a trail never visibly "stops" mid-sky.
    const env = Math.sin(Math.min(1, t / 0.85) * Math.PI * 0.5) * (t > 0.92 ? (1 - t) / 0.08 : 1);
    const alpha = 0.90 * env;
    const grad = tx.createLinearGradient(0, 8 - spread, 0, 8 + spread);
    grad.addColorStop(0,   'rgba(255,255,255,0)');
    grad.addColorStop(0.5, `rgba(255,255,255,${alpha.toFixed(2)})`);
    grad.addColorStop(1,   'rgba(255,255,255,0)');
    tx.fillStyle = grad;
    tx.fillRect(px, 0, 1, 16);
  }
  const trailTex = new THREE.CanvasTexture(tc);
  const trailMat = new THREE.MeshBasicMaterial({
    map: trailTex, transparent: true, opacity: 0.85,
    depthWrite: false, side: THREE.DoubleSide, fog: false
  });

  // Each contrail: its own compass heading, offset sideways from the island centre
  // so the set crisscrosses the sky instead of converging overhead.
  const TRAIL_COUNT = 6;
  const trailInst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), trailMat, TRAIL_COUNT);
  trailInst.renderOrder = 1;
  for (let i = 0; i < TRAIL_COUNT; i++) {
    const heading = (i / TRAIL_COUNT) * Math.PI + seededRand() * 0.45; // spread headings
    const offset  = (seededRand() - 0.5) * 700;                       // sideways from centre
    const along   = (seededRand() - 0.5) * 300;                       // shift along the line
    const px2 = Math.cos(heading + Math.PI / 2) * offset + Math.cos(heading) * along;
    const pz2 = Math.sin(heading + Math.PI / 2) * offset + Math.sin(heading) * along;
    _cd.position.set(px2, 330 + seededRand() * 90, pz2);
    _cd.scale.set(2100 + seededRand() * 400, 26 + seededRand() * 18, 1);  // span the sky, soft-fading ends
    _cd.rotation.set(-Math.PI / 2, 0, -heading);
    _cd.updateMatrix();
    trailInst.setMatrixAt(i, _cd.matrix);
  }
  trailInst.instanceMatrix.needsUpdate = true;
  scene.add(trailInst);
}

// Sun
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(32, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xFFEE88, fog: false })
);
sunMesh.position.set(210, 367, -157);
sunMesh.renderOrder = 0;
scene.add(sunMesh);

const camera = new THREE.PerspectiveCamera(CONFIG.normalFov, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(CONFIG.prisonPos.x, CONFIG.playerHeight, CONFIG.prisonPos.z);
const weaponScene = new THREE.Scene();
const weaponAmbient = new THREE.AmbientLight(0xffffff, 0.8);
weaponScene.add(weaponAmbient);
const weaponSun = new THREE.DirectionalLight(0xffffff, 0.6);
weaponSun.position.set(1, 2, 1);
weaponScene.add(weaponSun);
const weaponCamera = new THREE.PerspectiveCamera(CONFIG.normalFov, window.innerWidth / window.innerHeight, 0.01, 10);
weaponCamera.position.set(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
// Adaptive resolution. The render scale (pixel ratio) is the dominant GPU fill
// cost — at 1.5× on a laptop GPU, screen-filling moments (clustered bodies, the
// full-screen damage vignette, shadows) blow the pixel budget and drop frames.
// Normal play stays at the full 1.5× (no visible change); the game loop
// (_adaptResolution) only lowers it toward 0.7 while frames are actually heavy and
// raises it straight back when they clear — so 60fps holds through the heavy spots
// and you only ever lose sharpness mid-action, where it's invisible.
window._maxPR = Math.min(window.devicePixelRatio, 1.5);
window._minPR = 0.7;
window._curPR = window._maxPR;
renderer.setPixelRatio(window._curPR);
renderer.setClearColor(0x1a4d8a, 1);
renderer.shadowMap.enabled = true;
renderer.autoClear = false;
// The world is static — only characters move — so we don't regenerate the shadow
// map every frame. autoUpdate off; the loop sets needsUpdate at ~30Hz (12_main.js).
renderer.shadowMap.autoUpdate = false;
// PCF (not PCFSoft): soft shadows multiply the per-pixel tap count across the
// whole frame — too costly at this resolution for a barely visible difference.
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.domElement.style.position = 'fixed';
renderer.domElement.style.inset = '0';
renderer.domElement.style.zIndex = '0';
document.body.appendChild(renderer.domElement);

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const collidables = [];
const targets = [];
const lootItems = [];
const bots = [];

// Debug hooks — game.js is an ES module, so expose key objects for console tuning.
window.DBG = { state, scene, camera, bots, THREE, renderer };

// Draw-call probe — run DBG.perfProbe() in the console anywhere (e.g. standing in
// the prison or at the canal) to see exactly where the draw calls go: total scene
// meshes, how many cast shadows, and the split between the main pass and the
// shadow pass. Renders twice (with/without shadows) to measure the shadow cost.
window.DBG.perfProbe = function () {
  let meshes = 0, visible = 0, casters = 0, instanced = 0;
  scene.traverse(o => {
    if (!o.isMesh) return;
    meshes++;
    if (o.visible) visible++;
    if (o.castShadow) casters++;
    if (o.isInstancedMesh) instanced++;
  });
  const wasEnabled = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  const withShadow = renderer.info.render.calls, tris = renderer.info.render.triangles;
  renderer.shadowMap.enabled = false;
  renderer.render(scene, camera);
  const mainOnly = renderer.info.render.calls;
  renderer.shadowMap.enabled = wasEnabled;
  console.log(`[probe] scene meshes ${meshes} | visible ${visible} | shadow-casters ${casters} | instanced ${instanced}`);
  console.log(`[probe] draw calls — total ${withShadow} = main ${mainOnly} + shadow ${withShadow - mainOnly} | tris ${(tris/1000)|0}k`);
};

// ═══════════════════════════════════════════════════════════
// LIGHTING
// ═══════════════════════════════════════════════════════════
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const sun = new THREE.DirectionalLight(0xfffbe8, 2.2);
sun.position.set(210, 367, -157);
sun.castShadow = true;
// 1024² (was 2048²): quarters the shadow fill/regeneration cost. The faceted,
// low-poly art hides the lower resolution well.
sun.shadow.mapSize.set(1024, 1024);
// The shadow frustum used to be 340×340 — the WHOLE island — so every shadow
// update re-rendered every tree, prison mesh and column on the map, a huge fixed
// draw-call cost. Now it's a small box that FOLLOWS the player (updated each frame
// in the game loop), so the shadow pass only draws casters near you. Bonus: 1024²
// over a 140×140 area is far sharper than over 340×340.
sun.shadow.camera.near = 1; sun.shadow.camera.far = 360;
sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
sun.shadow.bias = -0.0004; // tighter texels — small negative bias avoids acne
scene.add(sun);
scene.add(sun.target); // directional light + target follow the player each frame
// Light travel direction (sun → origin), kept constant so the SHADING direction
// never changes even as we slide the light to keep the player centered.
window._sunDir = sun.position.clone().normalize().negate();
window._sunDist = 170; // how far up-light the sun sits from the player
scene.add(new THREE.HemisphereLight(0x4488ff, 0x2d7a0a, 0.7));

// ═══════════════════════════════════════════════════════════
