import * as THREE from 'three';
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

/** First-person gloved hands attached to the camera. */
export class Hands {
  readonly group = new THREE.Group();
  private right = new THREE.Group();
  private left = new THREE.Group();
  private toolHolder = new THREE.Group();
  private current: ToolId | null = null;
  private bob = 0;
  shake = 0;

  constructor(camera: THREE.Camera) {
    camera.add(this.group);
    this.right.add(this.makeHand(1));
    this.left.add(this.makeHand(-1));
    this.right.rotation.set(0.35, -0.25, 0.25);
    this.left.rotation.set(0.35, 0.3, -0.35);
    this.right.scale.setScalar(0.85);
    this.left.scale.setScalar(0.85);
    this.toolHolder.position.set(-0.01, 0.02, -0.07);
    this.toolHolder.rotation.set(-0.35, 0.1, 0);
    this.right.add(this.toolHolder);
    this.group.add(this.right, this.left);
    this.group.traverse((o) => {
      o.castShadow = false;
      o.renderOrder = 10;
    });
  }

  private makeHand(side: number): THREE.Group {
    const h = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.035, 6, 12), M.glove);
    palm.scale.set(1.25, 0.55, 1);
    palm.rotation.x = Math.PI / 2;
    h.add(palm);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085, 0.035, 4, 8), M.glove);
      f.position.set(side * (-0.024 + i * 0.016), -0.008, -0.058);
      f.rotation.set(-Math.PI / 2 - 0.55 - i * 0.08, 0, 0);
      h.add(f);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.03, 4, 8), M.glove);
    thumb.position.set(side * -0.036, -0.004, -0.035);
    thumb.rotation.set(-Math.PI / 2 - 0.3, 0, side * -0.7);
    h.add(thumb);
    // Cuff
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.05, 14), new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.9 }));
    cuff.rotation.x = Math.PI / 2;
    cuff.position.z = 0.055;
    h.add(cuff);
    return h;
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

  update(dt: number, moving: number, visible: boolean) {
    this.group.visible = visible;
    this.bob += dt * (4 + moving * 6);
    const amp = 0.004 + moving * 0.01;
    const sx = Math.sin(this.bob) * amp + (Math.random() - 0.5) * this.shake * 0.006;
    const sy = Math.abs(Math.cos(this.bob)) * amp + (Math.random() - 0.5) * this.shake * 0.006;
    this.right.position.set(0.19 + sx, -0.2 + sy, -0.36);
    this.left.position.set(-0.21 - sx * 0.8, -0.23 + sy * 0.8, -0.38);
  }
}
