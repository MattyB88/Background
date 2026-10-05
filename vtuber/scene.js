import * as THREE from 'three';

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

// Room layout (meters). Character faces +z when rotation.y = 0; camera looks from +x/+z.
export const SPOTS = {
  chair:  { x: 0.0,  z: -1.15, face: 0 },
  center: { x: 0.6,  z: 1.1 },
  window: { x: 1.5,  z: -1.8 },
  shelf:  { x: -2.1, z: 0.9 },
  front:  { x: 0.2,  z: 1.5 },
};
export const THROW_AREA = { minX: -1.8, maxX: 2.2, minZ: 0.6, maxZ: 1.6 };
export const PLUSH_DESK_POS = new THREE.Vector3(-0.55, 0.69, -0.72);

export function createStage(container, { transparent }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x15121c, transparent ? 0 : 1);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(4.3, 3.0, 5.0);
  camera.lookAt(0.0, 0.8, -0.4);

  scene.add(new THREE.HemisphereLight(0xfff2f8, 0x403850, 1.1));
  const sun = new THREE.DirectionalLight(0xfff0e0, 1.6);
  sun.position.set(3, 6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
  scene.add(sun);
  const ledGlow = new THREE.PointLight(0xc04dff, 3, 6);
  ledGlow.position.set(-1.5, 2.6, -2);
  scene.add(ledGlow);
  const screenGlow = new THREE.PointLight(0x4db8ff, 0.7, 2);
  screenGlow.position.set(0.7, 1.1, -0.4);
  scene.add(screenGlow);

  // Shell: floor + two walls, cut away toward the camera like a diorama.
  scene.add(box(6, 0.1, 5, mat(0x8a6a55), 0, -0.05, 0));
  scene.add(box(6, 3, 0.1, mat(0x3d3552), 0, 1.5, -2.55));
  scene.add(box(0.1, 3, 5, mat(0x463d5e), -3.05, 1.5, 0));
  const led = mat(0xff5cf4, { emissive: 0xff5cf4, emissiveIntensity: 1.5 });
  scene.add(box(6, 0.04, 0.04, led, 0, 2.9, -2.48));
  scene.add(box(0.04, 0.04, 5, led, -2.98, 2.9, 0));

  const rug = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.02, 40), mat(0xd77fa1));
  rug.scale.z = 0.7;
  rug.position.set(0.6, 0.01, 1.2);
  scene.add(rug);

  // Window
  scene.add(box(1.3, 1.0, 0.04, mat(0xf0e6ff), 1.4, 1.7, -2.5));
  scene.add(box(1.15, 0.85, 0.05, mat(0x1b2a5c, { emissive: 0x1b2a5c, emissiveIntensity: 0.8 }), 1.4, 1.7, -2.49));
  scene.add(box(0.03, 0.85, 0.06, mat(0xf0e6ff), 1.4, 1.7, -2.48));

  // Poster
  const poster = new THREE.Group();
  poster.add(box(0.02, 0.9, 0.65, mat(0xffd34d)));
  poster.add(box(0.03, 0.55, 0.45, mat(0xe0434b)));
  poster.position.set(-2.99, 1.65, -0.9);
  scene.add(poster);

  // Shelf with books
  const shelf = new THREE.Group();
  shelf.add(box(0.3, 0.05, 1.0, mat(0x6b4a3a)));
  const bookColors = [0xe0434b, 0x3aa3ff, 0x6ad38a, 0xffd34d, 0xb07cff];
  bookColors.forEach((c, i) => shelf.add(box(0.2, 0.28, 0.08, mat(c), 0, 0.165, -0.35 + i * 0.12)));
  shelf.position.set(-2.85, 1.25, 1.0);
  scene.add(shelf);

  // Plant
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.3, 16), mat(0xc96f4a));
  pot.position.set(2.6, 0.15, -2.2);
  scene.add(pot);
  for (const [x, y, z, r] of [[2.6, 0.5, -2.2, 0.22], [2.5, 0.68, -2.15, 0.16], [2.7, 0.62, -2.25, 0.15]]) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat(0x4caf6a));
    leaf.position.set(x, y, z);
    scene.add(leaf);
  }

  // Beanbag
  const bean = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 14), mat(0x5ec4c9));
  bean.scale.set(1, 0.55, 1);
  bean.position.set(2.2, 0.22, -1.5);
  scene.add(bean);

  // Desk (its own group so it can shake on desk slams)
  const desk = new THREE.Group();
  const deskMat = mat(0x2a2633);
  desk.add(box(1.6, 0.06, 0.6, deskMat, 0, 0.6, -0.6));
  desk.add(box(1.5, 0.45, 0.03, deskMat, 0, 0.35, -0.32));
  for (const x of [-0.75, 0.75]) desk.add(box(0.05, 0.57, 0.55, deskMat, x, 0.29, -0.6));
  desk.add(box(0.42, 0.02, 0.13, mat(0x111111), 0.05, 0.64, -0.75));
  desk.add(box(0.07, 0.025, 0.1, mat(0x111111), -0.3, 0.64, -0.75));
  const monitor = new THREE.Group();
  monitor.add(box(0.62, 0.38, 0.03, mat(0x111111)));
  monitor.add(box(0.57, 0.33, 0.01, mat(0x4db8ff, { emissive: 0x4db8ff, emissiveIntensity: 1.2 }), 0, 0, 0.017));
  monitor.add(box(0.05, 0.18, 0.05, mat(0x111111), 0, -0.25, -0.02));
  monitor.position.set(0.68, 0.86, -0.78);
  monitor.rotation.y = -2.1;
  desk.add(monitor);
  scene.add(desk);

  // Gaming chair
  const chairMat = mat(0x7a3cff);
  scene.add(box(0.45, 0.08, 0.45, chairMat, 0, 0.27, -1.15));
  scene.add(box(0.45, 0.65, 0.07, chairMat, 0, 0.62, -1.42));
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), mat(0x222222));
  pole.position.set(0, 0.12, -1.15);
  scene.add(pole);

  scene.traverse(o => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  return { renderer, scene, camera, desk };
}

export function makePlush() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), mat(0xffd84d));
  body.scale.y = 0.9;
  g.add(body);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 8), mat(0xffd84d));
    ear.position.set(s * 0.055, 0.1, 0);
    ear.rotation.z = -s * 0.4;
    g.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), mat(0x222222));
    eye.position.set(s * 0.035, 0.02, 0.092);
    g.add(eye);
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), mat(0xff6b6b));
    cheek.position.set(s * 0.065, -0.02, 0.075);
    g.add(cheek);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
