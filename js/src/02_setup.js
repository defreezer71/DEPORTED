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

// ── Clouds — instanced cross-billboard quads with procedural canvas texture ──
{
  const cc = document.createElement('canvas');
  cc.width = cc.height = 256;
  const cx = cc.getContext('2d');
  [ [128,115,88], [72,145,58], [178,125,62], [105,80,52], [158,158,68] ]
    .forEach(([bx, by, br]) => {
      const g = cx.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0,   'rgba(255,255,255,0.88)');
      g.addColorStop(0.45,'rgba(235,245,255,0.42)');
      g.addColorStop(1,   'rgba(255,255,255,0)');
      cx.fillStyle = g;
      cx.fillRect(0, 0, 256, 256);
    });
  const cloudTex = new THREE.CanvasTexture(cc);
  const cloudMat = new THREE.MeshBasicMaterial({
    map: cloudTex, transparent: true, opacity: 0.82,
    depthWrite: false, side: THREE.DoubleSide, fog: false
  });

  const CLOUD_COUNT = 30;
  const cloudInst = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1), cloudMat, CLOUD_COUNT * 2
  );
  cloudInst.renderOrder = 1;  // render after sun so clouds layer in front
  const _cd = new THREE.Object3D();
  let ci = 0;
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const angle  = seededRand() * Math.PI * 2;
    const radius = 170 + seededRand() * 280;
    const cx2    = Math.cos(angle) * radius;
    const cz2    = Math.sin(angle) * radius;
    const cy2    = 110 + seededRand() * 140;
    const cw     = 80 + seededRand() * 130;
    const ch     = 20 + seededRand() * 30;
    const yRot   = seededRand() * Math.PI;
    for (const ao of [0, 1]) {
      _cd.position.set(cx2, cy2, cz2);
      _cd.scale.set(cw, ch, 1);
      _cd.rotation.set(0, yRot + ao * Math.PI * 0.5, 0);
      _cd.updateMatrix();
      cloudInst.setMatrixAt(ci++, _cd.matrix);
    }
  }
  cloudInst.instanceMatrix.needsUpdate = true;
  scene.add(cloudInst);
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
