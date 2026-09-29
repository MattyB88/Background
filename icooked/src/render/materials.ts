import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Procedural grain for metals and paint so surfaces don't look like flat plastic. */
function grainTex(kind: 'brushed' | 'paint', seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = kind === 'brushed' ? '#8c8c8c' : '#b4b4b4';
  ctx.fillRect(0, 0, 256, 256);
  if (kind === 'brushed') {
    for (let y = 0; y < 256; y++) {
      const v = 110 + r() * 60;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(0, y, 256, 1);
    }
  } else {
    for (let i = 0; i < 4000; i++) {
      const v = 150 + r() * 70;
      ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
      ctx.fillRect(r() * 256, r() * 256, 2, 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(kind === 'brushed' ? 2 : 3, kind === 'brushed' ? 2 : 3);
  return t;
}
const brushed = grainTex('brushed', 11);
const paint = grainTex('paint', 23);

export const M = {
  beige: new THREE.MeshStandardMaterial({ color: 0xd9d4c4, roughness: 0.6, metalness: 0.05, roughnessMap: paint }),
  grey: new THREE.MeshStandardMaterial({ color: 0x8b9096, roughness: 0.55, metalness: 0.3, roughnessMap: paint }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, metalness: 0.3 }),
  black: new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.7, metalness: 0.2 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xc3c8ce, roughness: 0.45, metalness: 0.9, roughnessMap: brushed }),
  alu: new THREE.MeshStandardMaterial({ color: 0xd3d7dc, roughness: 0.5, metalness: 0.8, roughnessMap: brushed }),
  blueMat: new THREE.MeshStandardMaterial({ color: 0x2f5f9e, roughness: 0.85 }),
  esdMat: new THREE.MeshStandardMaterial({ color: 0x3b6d8f, roughness: 0.9 }),
  wood: new THREE.MeshStandardMaterial({ color: 0xa88c68, roughness: 0.8 }),
  white: new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.55, roughnessMap: paint }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xf2c12e, roughness: 0.6 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xe8732c, roughness: 0.55 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x202224, roughness: 0.95 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0xdfeaf2, roughness: 0.05, metalness: 0, transmission: 0.0, transparent: true, opacity: 0.18, depthWrite: false }),
  glove: new THREE.MeshStandardMaterial({ color: 0x5b8fd8, roughness: 0.55, metalness: 0.0 }),
  plasticRed: new THREE.MeshStandardMaterial({ color: 0xc23a2b, roughness: 0.5 }),
  plasticBlue: new THREE.MeshStandardMaterial({ color: 0x2c6bc2, roughness: 0.5 }),
  cardboard: new THREE.MeshStandardMaterial({ color: 0xb58a57, roughness: 0.9 }),
};

const roundCache = new Map<string, THREE.BufferGeometry>();

/** A box with softly rounded edges (big shapes) so highlights catch the corners like real sheet metal. */
export function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, parent?: THREE.Object3D): THREE.Mesh {
  const min = Math.min(w, h, d);
  let geo: THREE.BufferGeometry;
  if (min >= 0.03 && mat !== M.glass) {
    const key = `${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}`;
    geo = roundCache.get(key) ?? new RoundedBoxGeometry(w, h, d, 2, Math.min(0.018, min * 0.18));
    roundCache.set(key, geo);
  } else geo = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent?.add(m);
  return m;
}

export function cyl(r: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, parent?: THREE.Object3D, seg = 20): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent?.add(m);
  return m;
}

export function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A live-updatable screen (monitor, HMI, wall sign). */
export class Screen {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly tex: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;
  constructor(pxW: number, pxH: number, w: number, h: number, emissive = true) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxW;
    this.canvas.height = pxH;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = emissive
      ? new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false })
      : new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.7 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  }
  draw(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
    fn(this.ctx, this.canvas.width, this.canvas.height);
    this.tex.needsUpdate = true;
  }
}

/** Andon stack light with red / amber / green segments. */
export class StackLight {
  readonly group = new THREE.Group();
  private segs: THREE.MeshStandardMaterial[] = [];
  private colors = [0xff2a1a, 0xffb21a, 0x22e05a];
  constructor() {
    cyl(0.015, 0.25, M.steel, 0, 0.125, 0, this.group, 8);
    this.colors.forEach((c, i) => {
      const mat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.05, roughness: 0.3, transparent: true, opacity: 0.92 });
      this.segs.push(mat);
      cyl(0.045, 0.07, mat, 0, 0.5 - i * 0.075, 0, this.group, 16);
    });
    cyl(0.047, 0.02, M.dark, 0, 0.545, 0, this.group, 16);
    cyl(0.047, 0.03, M.dark, 0, 0.26, 0, this.group, 16);
  }
  set(state: 'red' | 'amber' | 'green' | 'off', flash = false, t = 0) {
    const on = !flash || Math.floor(t * 3) % 2 === 0;
    const idx = { red: 0, amber: 1, green: 2, off: -1 }[state];
    this.segs.forEach((m, i) => (m.emissiveIntensity = i === idx && on ? 2.6 : 0.04));
  }
}
