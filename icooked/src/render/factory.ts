import * as THREE from 'three';
import { Rng } from '../core/rng';
import { M, Screen, StackLight, box, canvasTex, cyl } from './materials';

export type StationId = 'desk' | 'feeders' | 'printer' | 'px9' | 'inspect' | 'oven' | 'aoi' | 'test' | 'rework';

export interface StationSpot {
  id: StationId;
  name: string;
  at: THREE.Vector3;
  viewPos: THREE.Vector3;
  viewLook: THREE.Vector3;
  toolSpot: THREE.Vector3;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const LINE_Z = -3;
export const CONVEYOR_Y = 0.95;

export const STATIONS: StationSpot[] = [
  { id: 'desk', name: 'Programming Desk', at: V(-11, 0, 3.2), viewPos: V(-11, 1.28, 3.95), viewLook: V(-11, 1.18, 5.0), toolSpot: V(-10.3, 0.78, 4.7) },
  { id: 'feeders', name: 'Feeder Cart & Stores', at: V(-7, 0, 3.2), viewPos: V(-7, 1.55, 3.55), viewLook: V(-7, 1.05, 5.1), toolSpot: V(-6.1, 0.92, 4.4) },
  { id: 'rework', name: 'Rework Bench', at: V(3, 0, 3.3), viewPos: V(3, 1.45, 3.6), viewLook: V(3, 0.9, 4.6), toolSpot: V(3.6, 0.8, 4.4) },
  { id: 'printer', name: 'Stencil Printer', at: V(-11.5, 0, -1.4), viewPos: V(-11.5, 1.65, -1.55), viewLook: V(-11.5, 0.95, -3), toolSpot: V(-10.8, 0.97, -2.25) },
  { id: 'px9', name: 'PX-9 Pick & Place', at: V(-7.5, 0, -1.2), viewPos: V(-7.5, 1.95, -1.05), viewLook: V(-7.5, 0.95, -3), toolSpot: V(-6.6, 0.97, -2.0) },
  { id: 'inspect', name: 'Inspection Bench', at: V(-4.2, 0, -1.3), viewPos: V(-4.2, 1.5, -1.7), viewLook: V(-4.2, 0.95, -2.9), toolSpot: V(-3.7, 0.87, -2.15) },
  { id: 'oven', name: 'Reflow Oven', at: V(0, 0, -1.2), viewPos: V(-0.3, 1.6, -1.0), viewLook: V(0.2, 1.05, -3), toolSpot: V(1.2, 0.87, -2.0) },
  { id: 'aoi', name: 'AOI', at: V(4.4, 0, -1.4), viewPos: V(4.4, 1.55, -1.5), viewLook: V(4.4, 1.1, -3), toolSpot: V(5.0, 0.97, -2.1) },
  { id: 'test', name: 'Test Jig', at: V(7.4, 0, -1.3), viewPos: V(7.4, 1.5, -1.55), viewLook: V(7.4, 0.9, -2.65), toolSpot: V(8.0, 0.87, -2.2) },
];

/** x-positions along the line for each stage. */
export const LINE_X = {
  printer: -11.5, px9in: -9.7, px9: -7.5, convStart: -6.3, inspect: -4.2, ovenq: -3.0,
  ovenStart: -2.5, ovenEnd: 2.5, aoi: 4.4, test: 7.4,
};

export interface Collider { minX: number; maxX: number; minZ: number; maxZ: number }

export interface Factory {
  root: THREE.Group;
  colliders: Collider[];
  stack: Record<'printer' | 'px9' | 'oven' | 'aoi' | 'test', StackLight>;
  px9Gantry: THREE.Object3D;
  px9Head: THREE.Object3D;
  printerSqueegee: THREE.Object3D;
  ovenGlow: THREE.MeshStandardMaterial;
  ovenLight: THREE.PointLight;
  ovenScreen: Screen;
  px9Screen: Screen;
  deskScreens: Screen[];
  aoiScreen: Screen;
  wallClock: Screen;
  fireSign: Screen;
  testLamps: THREE.MeshStandardMaterial[];
  shipBoxes: THREE.Group;
  reworkRack: THREE.Group;
  ceilingLights: THREE.MeshStandardMaterial[];
  lights: THREE.Light[];
  exitSign: THREE.MeshStandardMaterial;
  feederReels: THREE.Mesh[];
}

function floorTexture(): THREE.CanvasTexture {
  const t = canvasTex(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#8d9398';
    ctx.fillRect(0, 0, w, h);
    const rng = new Rng(7);
    for (let i = 0; i < 9000; i++) {
      const v = rng.range(120, 170);
      ctx.fillStyle = `rgba(${v},${v + 4},${v + 8},0.08)`;
      ctx.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, 3), rng.range(1, 3));
    }
    // ESD tile grid
    ctx.strokeStyle = 'rgba(40,45,50,0.25)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo((i * w) / 4, 0);
      ctx.lineTo((i * w) / 4, h);
      ctx.moveTo(0, (i * h) / 4);
      ctx.lineTo(w, (i * h) / 4);
      ctx.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(14, 7);
  return t;
}

function poster(text: string[], bg: string, fg: string): THREE.CanvasTexture {
  return canvasTex(512, 700, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 14;
    ctx.strokeRect(20, 20, w - 40, h - 40);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    let y = 150;
    text.forEach((line, i) => {
      ctx.font = `${i === 0 ? 900 : 600} ${i === 0 ? 76 : 40}px system-ui, sans-serif`;
      ctx.fillText(line, w / 2, y);
      y += i === 0 ? 110 : 60;
    });
  });
}

export function buildFactory(scene: THREE.Scene): Factory {
  const root = new THREE.Group();
  scene.add(root);
  const colliders: Collider[] = [];
  const solid = (cx: number, cz: number, w: number, d: number) => colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });

  // --- Hall -----------------------------------------------------------------
  const HX0 = -15, HX1 = 13, HZ0 = -6, HZ1 = 7, HH = 4.6;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HX1 - HX0, HZ1 - HZ0), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.55, metalness: 0.05 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((HX0 + HX1) / 2, 0, (HZ0 + HZ1) / 2);
  floor.receiveShadow = true;
  root.add(floor);

  // Walkway lines (yellow/black)
  const stripe = new THREE.MeshStandardMaterial({ color: 0xf1c232, roughness: 0.7 });
  for (const z of [-1.0, 2.6]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(HX1 - HX0 - 1, 0.08), stripe);
    s.rotation.x = -Math.PI / 2;
    s.position.set((HX0 + HX1) / 2, 0.003, z);
    root.add(s);
  }

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd8dcdf, roughness: 0.9 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x2e6aa6, roughness: 0.8 });
  const wall = (x: number, z: number, w: number, rotY: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, HH), wallMat);
    m.position.set(x, HH / 2, z);
    m.rotation.y = rotY;
    m.receiveShadow = true;
    root.add(m);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.3), bandMat);
    b.position.set(x, 1.2, z);
    b.rotation.y = rotY;
    b.translateZ(0.005);
    root.add(b);
  };
  wall((HX0 + HX1) / 2, HZ0, HX1 - HX0, 0);
  wall((HX0 + HX1) / 2, HZ1, HX1 - HX0, Math.PI);
  wall(HX0, (HZ0 + HZ1) / 2, HZ1 - HZ0, Math.PI / 2);
  wall(HX1, (HZ0 + HZ1) / 2, HZ1 - HZ0, -Math.PI / 2);
  solid((HX0 + HX1) / 2, HZ0 - 0.25, HX1 - HX0, 0.5);
  solid((HX0 + HX1) / 2, HZ1 + 0.25, HX1 - HX0, 0.5);
  solid(HX0 - 0.25, (HZ0 + HZ1) / 2, 0.5, HZ1 - HZ0);
  solid(HX1 + 0.25, (HZ0 + HZ1) / 2, 0.5, HZ1 - HZ0);

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HX1 - HX0, HZ1 - HZ0), new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set((HX0 + HX1) / 2, HH, (HZ0 + HZ1) / 2);
  root.add(ceil);

  // Fluorescent panels + a few real lights.
  const ceilingLights: THREE.MeshStandardMaterial[] = [];
  for (let x = -12; x <= 11; x += 4.6) {
    for (const z of [-3, 1, 4.6]) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4f8ff, emissiveIntensity: 1.6 });
      ceilingLights.push(mat);
      const p = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.05, 0.4), mat);
      p.position.set(x, HH - 0.3, z);
      root.add(p);
      box(0.02, 0.3, 0.02, M.dark, x - 1, HH - 0.15, z, root);
      box(0.02, 0.3, 0.02, M.dark, x + 1, HH - 0.15, z, root);
    }
  }
  const lights: THREE.Light[] = [];
  const hemi = new THREE.HemisphereLight(0xe8f0ff, 0x4a4a52, 1.1);
  root.add(hemi);
  lights.push(hemi);
  const sun = new THREE.DirectionalLight(0xfff6ea, 1.5);
  sun.position.set(-4, 12, 6);
  sun.target.position.set(-2, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  root.add(sun, sun.target);
  lights.push(sun);
  for (const [x, z] of [[-10, 3.5], [-4, -2], [3, 4], [6, -2]]) {
    const pl = new THREE.PointLight(0xfff2e0, 6, 9, 1.6);
    pl.position.set(x, 3.4, z);
    root.add(pl);
    lights.push(pl);
  }

  // Posters and signs on the back wall.
  const posters: [string[], string, string][] = [
    [['ESD', 'KILLS', 'ground yourself', '(emotionally too)'], '#f2c12e', '#141414'],
    [['ZERO', 'DEFECTS', 'is a mindset', 'not a metric'], '#1d4f8a', '#f4f4f4'],
    [['QUALITY', 'IS FREE', '*terms and', 'conditions apply'], '#b8322a', '#f7f7f7'],
    [['THINK', 'BEFORE', 'YOU', 'SOLDER'], '#f4f4f0', '#1d1d1d'],
  ];
  posters.forEach(([t, bg, fg], i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.0), new THREE.MeshStandardMaterial({ map: poster(t, bg, fg), roughness: 0.8 }));
    m.position.set(-13 + i * 6.3, 2.3, HZ0 + 0.02);
    root.add(m);
  });

  const fireSign = new Screen(1024, 256, 2.6, 0.65);
  fireSign.mesh.position.set(-1, 3.2, HZ0 + 0.03);
  root.add(fireSign.mesh);
  const wallClock = new Screen(512, 256, 1.2, 0.6);
  wallClock.mesh.position.set(3.2, 3.2, HZ0 + 0.03);
  root.add(wallClock.mesh);

  const exitSign = new THREE.MeshStandardMaterial({ color: 0x0f7a3a, emissive: 0x19d45f, emissiveIntensity: 1.5, map: canvasTex(256, 96, (ctx, w, h) => {
    ctx.fillStyle = '#0c7a36';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = '900 56px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('EXIT →', w / 2, 68);
  }) });
  const exitM = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.22), exitSign);
  exitM.position.set(HX1 - 0.02, 2.6, 5.5);
  exitM.rotation.y = -Math.PI / 2;
  root.add(exitM);

  // --- Line conveyors --------------------------------------------------------
  const conveyor = (x0: number, x1: number) => {
    const len = x1 - x0;
    const cx = (x0 + x1) / 2;
    box(len, 0.04, 0.03, M.alu, cx, CONVEYOR_Y - 0.02, LINE_Z - 0.14, root);
    box(len, 0.04, 0.03, M.alu, cx, CONVEYOR_Y - 0.02, LINE_Z + 0.14, root);
    box(len, 0.012, 0.02, M.rubber, cx, CONVEYOR_Y - 0.006, LINE_Z - 0.125, root);
    box(len, 0.012, 0.02, M.rubber, cx, CONVEYOR_Y - 0.006, LINE_Z + 0.125, root);
    for (let x = x0 + 0.1; x < x1; x += 0.6) {
      box(0.04, CONVEYOR_Y - 0.04, 0.04, M.grey, x, (CONVEYOR_Y - 0.04) / 2, LINE_Z - 0.14, root);
      box(0.04, CONVEYOR_Y - 0.04, 0.04, M.grey, x, (CONVEYOR_Y - 0.04) / 2, LINE_Z + 0.14, root);
    }
    solid(cx, LINE_Z, len, 0.4);
  };
  conveyor(-10.8, -8.6);
  conveyor(-6.4, -2.5);
  conveyor(2.5, 3.8);
  conveyor(5.0, 6.8);

  const stack = {} as Factory['stack'];

  // --- Stencil printer -------------------------------------------------------
  const printer = new THREE.Group();
  printer.position.set(LINE_X.printer, 0, LINE_Z);
  root.add(printer);
  box(1.3, 0.85, 1.2, M.beige, 0, 0.425, 0, printer);
  box(1.3, 0.55, 1.2, M.beige, 0, 1.55, 0, printer);
  box(1.3, 0.02, 1.2, M.dark, 0, 1.28, 0, printer);
  const pWin = box(1.1, 0.45, 0.01, M.glass, 0, 1.08, 0.6, printer);
  pWin.castShadow = false;
  box(0.06, 0.45, 1.2, M.beige, -0.62, 1.07, 0, printer);
  box(0.06, 0.45, 1.2, M.beige, 0.62, 1.07, 0, printer);
  box(0.8, 0.02, 0.6, M.steel, 0, 1.18, 0, printer); // stencil frame
  const squeegee = new THREE.Group();
  box(0.05, 0.08, 0.5, M.dark, 0, 0, 0, squeegee);
  box(0.02, 0.05, 0.48, M.steel, 0, -0.06, 0, squeegee);
  squeegee.position.set(-0.35, 1.25, 0);
  printer.add(squeegee);
  const sl1 = new StackLight();
  sl1.group.position.set(0.55, 1.83, -0.5);
  printer.add(sl1.group);
  stack.printer = sl1;
  box(0.28, 0.2, 0.03, M.black, 0.45, 1.45, 0.62, printer);
  solid(LINE_X.printer, LINE_Z, 1.3, 1.2);

  // --- PX-9 pick and place ---------------------------------------------------
  const px9 = new THREE.Group();
  px9.position.set(LINE_X.px9, 0, LINE_Z);
  root.add(px9);
  box(2.1, 0.8, 1.6, M.white, 0, 0.4, 0, px9);
  box(2.1, 0.06, 1.6, M.dark, 0, 0.83, 0, px9);
  // Frame posts + glass hood
  for (const [x, z] of [[-1.02, -0.77], [1.02, -0.77], [-1.02, 0.77], [1.02, 0.77]]) box(0.06, 0.75, 0.06, M.white, x, 1.23, z, px9);
  box(2.1, 0.08, 1.6, M.white, 0, 1.64, 0, px9);
  const hood = box(2.0, 0.72, 0.01, M.glass, 0, 1.22, 0.78, px9);
  hood.castShadow = false;
  const hoodTop = box(2.0, 0.01, 1.5, M.glass, 0, 1.6, 0, px9);
  hoodTop.castShadow = false;
  // Blue brand stripe (no real brand).
  box(2.12, 0.08, 0.02, M.plasticBlue, 0, 0.72, 0.81, px9);
  // Gantry: y-beam that moves along x, head moves along z.
  const gantry = new THREE.Group();
  gantry.position.set(0, 1.45, 0);
  px9.add(gantry);
  box(0.12, 0.1, 1.45, M.alu, 0, 0, 0, gantry);
  box(0.02, 0.02, 1.45, M.dark, 0.07, 0.03, 0, gantry);
  box(2.0, 0.06, 0.08, M.alu, 0, 0.0, -0.72, px9).position.y = 1.45;
  box(2.0, 0.06, 0.08, M.alu, 0, 0.0, 0.72, px9).position.y = 1.45;
  const head = new THREE.Group();
  gantry.add(head);
  box(0.16, 0.22, 0.16, M.dark, 0, -0.1, 0, head);
  box(0.12, 0.05, 0.12, M.plasticBlue, 0, 0.03, 0, head);
  for (const dx of [-0.04, 0.04]) cyl(0.006, 0.12, M.steel, dx, -0.26, 0, head, 8);
  const headCam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 12), new THREE.MeshStandardMaterial({ color: 0x223355, emissive: 0x3366ff, emissiveIntensity: 0.6 }));
  headCam.position.set(0.07, -0.21, 0.05);
  head.add(headCam);
  // Feeder bank on the operator side: little tape feeders and reels.
  const feederReels: THREE.Mesh[] = [];
  const reelColors = [0x2b2d31, 0x2f6bb3, 0x2b2d31, 0x9aa1a8, 0x2b2d31];
  for (let i = 0; i < 20; i++) {
    const x = -0.9 + i * 0.095;
    box(0.02, 0.1, 0.42, M.grey, x, 0.95, 0.55, px9);
    const reel = cyl(0.09, 0.012, new THREE.MeshStandardMaterial({ color: reelColors[i % 5], roughness: 0.4 }), x, 0.82, 0.92, px9, 24);
    reel.rotation.z = Math.PI / 2;
    feederReels.push(reel);
  }
  box(2.0, 0.55, 0.5, M.grey, 0, 0.35, 1.05, px9); // feeder trolley
  const px9Screen = new Screen(640, 480, 0.42, 0.32);
  px9Screen.mesh.position.set(0.95, 1.55, 0.95);
  px9Screen.mesh.rotation.y = -0.3;
  px9.add(px9Screen.mesh);
  box(0.46, 0.36, 0.03, M.black, 0.95, 1.55, 0.93, px9).rotation.y = -0.3;
  cyl(0.015, 0.6, M.steel, 0.95, 1.2, 0.85, px9);
  const sl2 = new StackLight();
  sl2.group.position.set(-0.95, 1.68, -0.7);
  px9.add(sl2.group);
  stack.px9 = sl2;
  solid(LINE_X.px9, LINE_Z + 0.2, 2.1, 2.0);

  // --- Inspection bench ------------------------------------------------------
  const insp = new THREE.Group();
  insp.position.set(LINE_X.inspect, 0, LINE_Z + 0.75);
  root.add(insp);
  box(1.2, 0.04, 0.6, M.esdMat, 0, 0.85, 0, insp);
  box(1.2, 0.04, 0.62, M.grey, 0, 0.82, 0, insp);
  for (const x of [-0.55, 0.55]) for (const z of [-0.26, 0.26]) box(0.04, 0.82, 0.04, M.grey, x, 0.41, z, insp);
  // Magnifier lamp
  const arm = new THREE.Group();
  arm.position.set(-0.45, 0.87, -0.2);
  insp.add(arm);
  cyl(0.06, 0.03, M.dark, 0, 0.015, 0, arm);
  const a1 = cyl(0.012, 0.55, M.white, 0, 0.28, 0, arm);
  a1.rotation.z = -0.2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 12, 32), M.white);
  ring.position.set(0.2, 0.55, 0.05);
  ring.rotation.x = Math.PI / 2;
  arm.add(ring);
  const ringLight = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.008, 8, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 }));
  ringLight.position.set(0.2, 0.535, 0.05);
  ringLight.rotation.x = Math.PI / 2;
  arm.add(ringLight);
  solid(LINE_X.inspect, LINE_Z + 0.75, 1.2, 0.6);

  // --- Reflow oven ------------------------------------------------------------
  const oven = new THREE.Group();
  oven.position.set(0, 0, LINE_Z);
  root.add(oven);
  box(5.0, 0.9, 1.3, M.grey, 0, 0.45, 0, oven);
  box(5.0, 0.45, 1.3, M.dark, 0, 1.13, 0, oven);
  box(5.02, 0.04, 1.32, M.steel, 0, 0.92, 0, oven);
  const ovenGlow = new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xff5a14, emissiveIntensity: 0.6 });
  for (const x of [-2.51, 2.51]) {
    const mouth = box(0.02, 0.1, 0.5, ovenGlow, x, CONVEYOR_Y + 0.03, 0, oven);
    mouth.castShadow = false;
  }
  // Zone displays and vents
  for (let i = 0; i < 8; i++) {
    const x = -2.1 + i * 0.6;
    box(0.4, 0.03, 0.02, M.black, x, 1.25, 0.66, oven);
    box(0.4, 0.03, 0.02, M.black, x, 1.18, 0.66, oven);
    box(0.4, 0.03, 0.02, M.black, x, 1.11, 0.66, oven);
  }
  for (const x of [-1.6, 0, 1.6]) {
    cyl(0.13, 3.2, M.alu, x, 1.35 + 1.6, -0.2, oven, 16);
  }
  const ovenScreen = new Screen(800, 480, 0.6, 0.36);
  ovenScreen.mesh.position.set(-0.3, 1.2, 0.67);
  oven.add(ovenScreen.mesh);
  const ovenLight = new THREE.PointLight(0xff6a20, 0, 4, 2);
  ovenLight.position.set(0, 1.6, 0.9);
  oven.add(ovenLight);
  const sl3 = new StackLight();
  sl3.group.position.set(2.2, 1.35, -0.45);
  oven.add(sl3.group);
  stack.oven = sl3;
  box(0.5, 0.04, 0.4, M.esdMat, 1.2, 0.85, 0.95, oven);
  box(0.5, 0.85, 0.4, M.grey, 1.2, 0.42, 0.95, oven);
  solid(0, LINE_Z, 5.0, 1.3);

  // --- AOI ---------------------------------------------------------------------
  const aoi = new THREE.Group();
  aoi.position.set(LINE_X.aoi, 0, LINE_Z);
  root.add(aoi);
  box(1.2, 0.85, 1.2, M.dark, 0, 0.425, 0, aoi);
  box(1.2, 0.8, 1.2, M.black, 0, 1.25, 0, aoi);
  const aoiWin = box(0.7, 0.3, 0.01, new THREE.MeshStandardMaterial({ color: 0x0b1a2e, emissive: 0x2a6cff, emissiveIntensity: 0.5, transparent: true, opacity: 0.7 }), 0, 1.1, 0.605, aoi);
  aoiWin.castShadow = false;
  const aoiScreen = new Screen(640, 400, 0.45, 0.28);
  aoiScreen.mesh.position.set(0.35, 1.5, 0.64);
  aoi.add(aoiScreen.mesh);
  box(0.48, 0.31, 0.03, M.black, 0.35, 1.5, 0.62, aoi);
  const sl4 = new StackLight();
  sl4.group.position.set(-0.45, 1.65, -0.45);
  aoi.add(sl4.group);
  stack.aoi = sl4;
  solid(LINE_X.aoi, LINE_Z, 1.2, 1.2);

  // --- Test jig ------------------------------------------------------------------
  const test = new THREE.Group();
  test.position.set(LINE_X.test, 0, LINE_Z + 0.3);
  root.add(test);
  box(1.6, 0.05, 0.9, M.esdMat, 0, 0.83, 0, test);
  box(1.6, 0.8, 0.9, M.grey, 0, 0.4, 0, test);
  box(0.5, 0.1, 0.4, M.yellow, -0.2, 0.9, -0.05, test); // fixture base
  box(0.46, 0.03, 0.36, M.dark, -0.2, 0.96, -0.05, test);
  const lid = new THREE.Group();
  lid.position.set(-0.2, 1.1, -0.25);
  test.add(lid);
  box(0.5, 0.03, 0.4, M.glass, 0, 0, 0.2, lid);
  for (const x of [-0.42, 0.02]) box(0.03, 0.3, 0.03, M.steel, x - 0.0, -0.05, 0, test).position.set(x, 1.05, -0.25);
  const testLamps: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x0f3a14, emissive: 0x22ff44, emissiveIntensity: 0.05 });
    testLamps.push(mat);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), mat);
    lamp.position.set(0.25 + i * 0.13, 1.02, -0.3);
    test.add(lamp);
    cyl(0.05, 0.08, M.black, 0.25 + i * 0.13, 0.94, -0.3, test);
  }
  const sl5 = new StackLight();
  sl5.group.position.set(0.7, 0.85, -0.38);
  test.add(sl5.group);
  stack.test = sl5;
  solid(LINE_X.test, LINE_Z + 0.3, 1.6, 0.9);

  // Shipping rack: boxes pile up as you ship.
  const shipRack = new THREE.Group();
  shipRack.position.set(10.3, 0, -3.2);
  root.add(shipRack);
  for (let i = 0; i < 4; i++) box(1.6, 0.04, 0.8, M.orange, 0, 0.35 + i * 0.5, 0, shipRack);
  for (const x of [-0.78, 0.78]) for (const z of [-0.38, 0.38]) box(0.05, 1.9, 0.05, M.blueMat, x, 0.95, z, shipRack);
  const shipBoxes = new THREE.Group();
  shipRack.add(shipBoxes);
  solid(10.3, -3.2, 1.6, 0.8);

  // --- Back side: desk, feeders/stores, rework --------------------------------
  const desk = new THREE.Group();
  desk.position.set(-11, 0, 4.9);
  root.add(desk);
  box(2.0, 0.04, 0.8, M.wood, 0, 0.74, 0, desk);
  for (const x of [-0.95, 0.95]) box(0.05, 0.72, 0.7, M.grey, x, 0.36, 0, desk);
  const deskScreens: Screen[] = [];
  for (const [x, ry] of [[-0.3, 0.12], [0.3, -0.12]]) {
    const scr = new Screen(800, 500, 0.55, 0.34);
    scr.mesh.position.set(x, 1.15, -0.12);
    scr.mesh.rotation.y = ry;
    desk.add(scr.mesh);
    const bezel = box(0.59, 0.38, 0.03, M.black, x, 1.15, -0.14, desk);
    bezel.rotation.y = ry;
    box(0.04, 0.3, 0.04, M.black, x, 0.9, -0.18, desk);
    box(0.2, 0.02, 0.15, M.black, x, 0.77, -0.18, desk);
    deskScreens.push(scr);
  }
  box(0.45, 0.02, 0.15, M.black, 0, 0.77, 0.15, desk); // keyboard
  cyl(0.04, 0.1, M.white, 0.7, 0.81, 0.1, desk); // mug
  cyl(0.04, 0.1, M.plasticRed, 0.78, 0.81, -0.05, desk); // another mug
  for (let i = 0; i < 6; i++) box(0.3, 0.012, 0.21, M.white, -0.75, 0.77 + i * 0.013, 0.05, desk).rotation.y = (i % 3) * 0.08;
  // Chair
  const chair = new THREE.Group();
  chair.position.set(-11, 0, 3.9);
  root.add(chair);
  box(0.5, 0.08, 0.5, M.black, 0, 0.48, 0, chair);
  box(0.5, 0.55, 0.06, M.black, 0, 0.8, -0.25, chair).rotation.x = 0.12;
  cyl(0.03, 0.45, M.steel, 0, 0.23, 0, chair);
  solid(-11, 4.9, 2.0, 0.8);

  // Stores racks with reels
  const stores = new THREE.Group();
  stores.position.set(-7, 0, 5.6);
  root.add(stores);
  const reelMats = [0x2b2d31, 0x2f6bb3, 0x9aa1a8, 0xd9d9d9, 0x3a3a3a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 }));
  const rng = new Rng(3);
  for (let shelf = 0; shelf < 4; shelf++) {
    box(2.6, 0.03, 0.5, M.grey, 0, 0.3 + shelf * 0.5, 0, stores);
    for (let i = 0; i < 16; i++) {
      if (!rng.chance(0.8)) continue;
      const big = rng.chance(0.3);
      const r = cyl(big ? 0.165 : 0.09, 0.013, rng.pick(reelMats), -1.2 + i * 0.16, (big ? 0.48 : 0.4) + shelf * 0.5, 0, stores, 20);
      r.rotation.x = Math.PI / 2;
      r.rotation.y = rng.range(-0.1, 0.1);
    }
  }
  for (const x of [-1.3, 1.3]) for (const z of [-0.24, 0.24]) box(0.04, 2.1, 0.04, M.blueMat, x, 1.05, z, stores);
  solid(-7, 5.6, 2.6, 0.5);
  // Feeder trolley in front of stores
  const trolley = new THREE.Group();
  trolley.position.set(-7, 0, 4.6);
  root.add(trolley);
  box(1.4, 0.06, 0.5, M.esdMat, 0, 0.86, 0, trolley);
  box(1.4, 0.8, 0.5, M.grey, 0, 0.44, 0, trolley);
  for (let i = 0; i < 8; i++) box(0.03, 0.08, 0.35, M.dark, -0.55 + i * 0.16, 0.93, 0, trolley);
  solid(-7, 4.6, 1.4, 0.5);
  // Dump bin
  const dumpBin = new THREE.Group();
  dumpBin.position.set(-5.4, 0, 4.7);
  root.add(dumpBin);
  box(0.5, 0.35, 0.35, M.plasticRed, 0, 0.175, 0, dumpBin);
  const dumpLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.12), new THREE.MeshStandardMaterial({ map: canvasTex(256, 80, (ctx, w, h) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#b00';
    ctx.font = '900 44px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('DUMP BIN', w / 2, 56);
  }) }));
  dumpLabel.position.set(0, 0.2, 0.18);
  dumpBin.add(dumpLabel);
  solid(-5.4, 4.7, 0.5, 0.35);

  // Rework bench
  const rw = new THREE.Group();
  rw.position.set(3, 0, 4.7);
  root.add(rw);
  box(2.0, 0.04, 0.8, M.esdMat, 0, 0.76, 0, rw);
  box(2.0, 0.74, 0.8, M.grey, 0, 0.37, 0, rw);
  // microscope
  const scope = new THREE.Group();
  scope.position.set(-0.1, 0.78, -0.1);
  rw.add(scope);
  box(0.25, 0.03, 0.3, M.dark, 0, 0.015, 0, scope);
  cyl(0.02, 0.45, M.steel, 0, 0.24, -0.12, scope);
  const tube = cyl(0.04, 0.22, M.white, 0, 0.36, -0.02, scope);
  tube.rotation.x = 0.4;
  // hot air station + iron stand
  box(0.25, 0.14, 0.2, M.plasticBlue, 0.65, 0.85, -0.2, rw);
  box(0.2, 0.1, 0.18, M.dark, -0.75, 0.83, -0.2, rw);
  const ironHolder = cyl(0.03, 0.14, M.steel, -0.55, 0.86, -0.2, rw);
  ironHolder.rotation.z = 0.5;
  const reworkRack = new THREE.Group();
  reworkRack.position.set(0.7, 0.78, 0.15);
  rw.add(reworkRack);
  box(0.3, 0.02, 0.2, M.dark, 0, 0.01, 0, reworkRack);
  const rwSign = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.15), new THREE.MeshStandardMaterial({ map: canvasTex(400, 100, (ctx, w, h) => {
    ctx.fillStyle = '#f2c12e';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#111';
    ctx.font = '900 54px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('REWORK', w / 2, 70);
  }) }));
  rwSign.position.set(0, 1.4, 0.35);
  rw.add(rwSign);
  solid(3, 4.7, 2.0, 0.8);

  // Boss office (glass box) — the phone in there rings when things go wrong.
  const office = new THREE.Group();
  office.position.set(10, 0, 4.5);
  root.add(office);
  const gw = box(4.8, 2.6, 0.03, M.glass, 0, 1.3, -1.8, office);
  gw.castShadow = false;
  const gw2 = box(0.03, 2.6, 3.6, M.glass, -2.4, 1.3, 0, office);
  gw2.castShadow = false;
  box(1.6, 0.05, 0.8, M.wood, 0.5, 0.75, 0.6, office);
  box(0.6, 0.9, 0.6, M.black, 0.5, 0.45, 1.3, office);
  const bossSign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.25), new THREE.MeshStandardMaterial({ map: canvasTex(512, 110, (ctx, w, h) => {
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e0c060';
    ctx.font = '700 52px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('OPERATIONS DIRECTOR', w / 2, 72);
  }) }));
  bossSign.position.set(0, 2.3, -1.78);
  office.add(bossSign);
  solid(10, 2.7, 4.8, 0.1);
  solid(7.6, 4.5, 0.1, 3.6);

  return {
    root, colliders, stack, px9Gantry: gantry, px9Head: head, printerSqueegee: squeegee, ovenGlow, ovenLight, ovenScreen,
    px9Screen, deskScreens, aoiScreen, wallClock, fireSign, testLamps, shipBoxes, reworkRack, ceilingLights, lights, exitSign, feederReels,
  };
}
