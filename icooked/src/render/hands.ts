import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { M, box, cyl } from './materials';

export type ToolId = 'tweezers' | 'syringe' | 'iron' | 'scraper';

export const TOOL_NAMES: Record<ToolId, string> = {
  tweezers: 'ESD Tweezers',
  syringe: 'Paste Syringe',
  iron: 'Soldering Iron',
  scraper: 'Oven Scraper',
};

/** Tool models in metres, pointing along -z (away from the hand). */
export function makeTool(id: ToolId): THREE.Group {
  const g = new THREE.Group();
  switch (id) {
    case 'tweezers': {
      for (const s of [-1, 1]) {
        const arm = box(0.004, 0.002, 0.12, M.steel, s * 0.004, 0, -0.06, g);
        arm.rotation.y = s * 0.035;
      }
      box(0.012, 0.004, 0.02, M.plasticBlue, 0, 0, -0.005, g);
      break;
    }
    case 'syringe': {
      const barrel = cyl(0.008, 0.1, new THREE.MeshStandardMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.7, roughness: 0.2 }), 0, 0, -0.05, g, 14);
      barrel.rotation.x = Math.PI / 2;
      const paste = cyl(0.0065, 0.06, M.grey, 0, 0, -0.065, g, 12);
      paste.rotation.x = Math.PI / 2;
      const needle = cyl(0.0012, 0.03, M.steel, 0, 0, -0.115, g, 6);
      needle.rotation.x = Math.PI / 2;
      const plunger = cyl(0.003, 0.05, M.white, 0, 0, 0.02, g, 8);
      plunger.rotation.x = Math.PI / 2;
      break;
    }
    case 'iron': {
      const handle = cyl(0.011, 0.11, new THREE.MeshStandardMaterial({ color: 0x1f5fbf, roughness: 0.5 }), 0, 0, -0.03, g, 14);
      handle.rotation.x = Math.PI / 2;
      const grip = cyl(0.012, 0.05, M.rubber, 0, 0, -0.06, g, 14);
      grip.rotation.x = Math.PI / 2;
      const shaft = cyl(0.004, 0.06, M.steel, 0, 0, -0.115, g, 8);
      shaft.rotation.x = Math.PI / 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.02, 8), new THREE.MeshStandardMaterial({ color: 0x8a7a6a, emissive: 0xff4400, emissiveIntensity: 0.4, metalness: 0.8, roughness: 0.3 }));
      tip.rotation.x = -Math.PI / 2;
      tip.position.z = -0.155;
      g.add(tip);
      break;
    }
    case 'scraper': {
      const handle = cyl(0.012, 0.1, M.orange, 0, 0, -0.02, g, 12);
      handle.rotation.x = Math.PI / 2;
      box(0.05, 0.002, 0.06, M.steel, 0, 0, -0.1, g);
      break;
    }
  }
  return g;
}

type Pose = 'relaxed' | 'grip' | 'hold';

const gloveMat = new THREE.MeshPhysicalMaterial({ color: 0x4d84d6, roughness: 0.42, metalness: 0, sheen: 0.4, sheenColor: new THREE.Color(0x9cc4ff), clearcoat: 0.25, clearcoatRoughness: 0.5 });
const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x1d2740, roughness: 0.95 });
const cuffMat = new THREE.MeshStandardMaterial({ color: 0x141a2c, roughness: 1 });

interface Finger { joints: THREE.Object3D[]; base: number }

/** One gloved hand with jointed fingers. Built pointing along -z, palm down. */
class Hand {
  readonly root = new THREE.Group();
  private fingers: Finger[] = [];
  private thumb: THREE.Object3D[] = [];
  readonly holdPoint = new THREE.Group();

  constructor(side: 1 | -1) {
    const palm = new THREE.Mesh(new RoundedBoxGeometry(0.074, 0.026, 0.082, 3, 0.011), gloveMat);
    palm.position.z = -0.01;
    this.root.add(palm);
    // Four fingers, each three segments.
    const lens = [[0.026, 0.017, 0.014], [0.029, 0.019, 0.015], [0.027, 0.018, 0.014], [0.021, 0.014, 0.012]];
    const xs = [-0.026, -0.009, 0.008, 0.025];
    for (let f = 0; f < 4; f++) {
      const joints: THREE.Object3D[] = [];
      let parent: THREE.Object3D = this.root;
      let z = -0.051;
      const r = 0.0085 - f * 0.0005 - (f === 3 ? 0.0008 : 0);
      for (let k = 0; k < 3; k++) {
        const j = new THREE.Group();
        j.position.set(k === 0 ? side * xs[f] : 0, k === 0 ? 0.002 : 0, k === 0 ? z : -lens[f][k - 1]);
        const seg = new THREE.Mesh(new THREE.CapsuleGeometry(r * (1 - k * 0.08), lens[f][k] - r, 4, 10), gloveMat);
        seg.rotation.x = -Math.PI / 2;
        seg.position.z = -lens[f][k] / 2;
        j.add(seg);
        parent.add(j);
        joints.push(j);
        parent = j;
        z = 0;
      }
      this.fingers.push({ joints, base: 0 });
    }
    // Thumb: two segments from the side of the palm.
    const t0 = new THREE.Group();
    t0.position.set(side * -0.036, -0.004, -0.004);
    t0.rotation.set(0, side * 0.9, side * -0.5);
    const t0m = new THREE.Mesh(new THREE.CapsuleGeometry(0.0098, 0.018, 4, 10), gloveMat);
    t0m.rotation.x = -Math.PI / 2;
    t0m.position.z = -0.014;
    t0.add(t0m);
    const t1 = new THREE.Group();
    t1.position.z = -0.028;
    const t1m = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.012, 4, 10), gloveMat);
    t1m.rotation.x = -Math.PI / 2;
    t1m.position.z = -0.011;
    t1.add(t1m);
    t0.add(t1);
    this.root.add(t0);
    this.thumb = [t0, t1];
    // Wrist, then the ESD smock sleeve with a ribbed cuff.
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.05, 16), gloveMat);
    wrist.rotation.x = Math.PI / 2;
    wrist.position.z = 0.045;
    wrist.scale.set(1.25, 0.8, 1);
    this.root.add(wrist);
    for (let i = 0; i < 3; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.006, 8, 20), cuffMat);
      rib.position.z = 0.07 + i * 0.01;
      rib.scale.set(1.15, 0.9, 1);
      this.root.add(rib);
    }
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.055, 0.3, 18, 1, true), sleeveMat);
    sleeve.rotation.x = Math.PI / 2;
    sleeve.position.z = 0.24;
    sleeve.scale.set(1.15, 0.95, 1);
    this.root.add(sleeve);
    this.holdPoint.position.set(side * -0.012, -0.012, -0.068);
    this.root.add(this.holdPoint);
    this.root.traverse((o) => {
      o.castShadow = false;
      o.renderOrder = 10;
    });
  }

  pose(p: Pose, t: number) {
    const curl = p === 'grip' ? [0.85, 1.2, 1.3, 1.35] : p === 'hold' ? [0.25, 0.3, 0.35, 0.4] : [0.85, 0.95, 1.0, 1.08];
    this.fingers.forEach((f, i) => {
      const c = curl[i] + Math.sin(t * 1.3 + i) * 0.03;
      f.joints[0].rotation.x = -c * 0.55;
      f.joints[1].rotation.x = -c * 0.8;
      f.joints[2].rotation.x = -c * 0.6;
    });
    const tc = p === 'grip' ? 0.9 : p === 'hold' ? 0.1 : 0.4;
    this.thumb[1].rotation.x = -tc * 0.8;
    this.thumb[0].rotation.x = -tc * 0.3;
  }
}

/** First-person gloved hands attached to the camera. */
export class Hands {
  readonly group = new THREE.Group();
  private right = new Hand(1);
  private left = new Hand(-1);
  private toolHolder = new THREE.Group();
  private clipboard: THREE.Group;
  private current: ToolId | null = null;
  private holdingClip = false;
  private bob = 0;
  private time = 0;
  shake = 0;

  constructor(camera: THREE.Camera) {
    camera.add(this.group);
    this.group.add(this.right.root, this.left.root);
    this.right.holdPoint.add(this.toolHolder);
    this.toolHolder.rotation.set(-0.25, 0.15, 0.1);
    this.clipboard = this.makeClipboard();
    this.left.holdPoint.add(this.clipboard);
    this.clipboard.visible = false;
  }

  private makeClipboard(): THREE.Group {
    const g = new THREE.Group();
    const board = new THREE.Mesh(new RoundedBoxGeometry(0.23, 0.006, 0.31, 2, 0.008), new THREE.MeshStandardMaterial({ color: 0x7b5a37, roughness: 0.7 }));
    g.add(board);
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.28), new THREE.MeshStandardMaterial({ color: 0xf7f5ea, roughness: 0.9 }));
    paper.rotation.x = -Math.PI / 2;
    paper.position.set(0, 0.0035, 0.008);
    g.add(paper);
    for (let i = 0; i < 9; i++) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.004), new THREE.MeshBasicMaterial({ color: 0x9aa0a8 }));
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, 0.004, -0.09 + i * 0.022);
      g.add(line);
    }
    const clip = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.014, 0.03, 2, 0.004), new THREE.MeshStandardMaterial({ color: 0xc9ced4, metalness: 0.9, roughness: 0.3 }));
    clip.position.set(0, 0.008, -0.145);
    g.add(clip);
    g.position.set(0.1, 0.02, -0.05);
    g.rotation.set(-0.9, 0.35, 0.1);
    g.traverse((o) => (o.renderOrder = 10));
    return g;
  }

  setTool(t: ToolId | null) {
    if (t === this.current) return;
    this.current = t;
    this.toolHolder.clear();
    if (t) {
      const m = makeTool(t);
      m.traverse((o) => (o.renderOrder = 10));
      this.toolHolder.add(m);
    }
  }

  setClipboard(on: boolean) {
    this.holdingClip = on;
    this.clipboard.visible = on;
  }

  update(dt: number, moving: number, visible: boolean) {
    this.group.visible = visible;
    this.time += dt;
    this.bob += dt * (4 + moving * 6);
    const amp = 0.004 + moving * 0.01;
    const n = this.shake * 0.004;
    const sx = Math.sin(this.bob) * amp + Math.sin(this.time * 17) * n;
    const sy = Math.abs(Math.cos(this.bob)) * amp + Math.cos(this.time * 21) * n;
    this.right.root.position.set(0.2 + sx, -0.21 + sy, -0.36);
    this.right.root.rotation.set(0.3, -0.25, this.current ? 0.5 : 1.05);
    this.right.pose(this.current ? 'grip' : 'relaxed', this.time);
    if (this.holdingClip) {
      this.left.root.position.set(-0.17 - sx * 0.5, -0.17 + sy * 0.5, -0.34);
      this.left.root.rotation.set(0.9, 0.35, -0.2);
      this.left.pose('hold', this.time);
    } else {
      this.left.root.position.set(-0.21 - sx * 0.8, -0.23 + sy * 0.8, -0.38);
      this.left.root.rotation.set(0.3, 0.25, -1.05);
      this.left.pose('relaxed', this.time + 1);
    }
  }
}
