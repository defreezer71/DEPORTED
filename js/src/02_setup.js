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
    _cd.scale.set(2100 + seededRand() * 400, 13 + seededRand() * 9, 1);  // span the sky, soft-fading ends
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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x1a4d8a, 1);
renderer.shadowMap.enabled = true;
renderer.autoClear = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

// ═══════════════════════════════════════════════════════════
// LIGHTING
// ═══════════════════════════════════════════════════════════
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const sun = new THREE.DirectionalLight(0xfffbe8, 2.2);
sun.position.set(210, 367, -157);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 600;
sun.shadow.camera.left = -170; sun.shadow.camera.right = 170;
sun.shadow.camera.top = 170; sun.shadow.camera.bottom = -170;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x4488ff, 0x2d7a0a, 0.7));

// ═══════════════════════════════════════════════════════════
