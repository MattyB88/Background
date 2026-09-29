import * as THREE from 'three';
import { Rng } from '../core/rng';
import type { Game } from '../sim/game';
import { PACKAGES, PART_BY_IPN, type Category } from '../sim/parts';

export interface RackItem {
  ipn: string;
  group: THREE.Group;
  home: THREE.Vector3;
  homeRot: number;
  kind: 'reel' | 'stick' | 'tray';
}

const SECTION_ORDER: Category[] = ['RES', 'CAP', 'TANT', 'ELEC', 'TRANS', 'IC', 'LED', 'XTAL', 'CONN'];
const SECTION_LABEL: Record<Category, string> = { RES: 'RES', CAP: 'CAP', TANT: 'TANT', ELEC: 'ELEC', TRANS: 'TR', IC: 'IC', LED: 'LED', XTAL: 'XTAL', CONN: 'CONN' };
// Fill eye-level shelves first, the awkward top and bottom ones last.
const SHELF_Y = [1.02, 1.44, 0.6, 1.86, 0.18];
const X0 = -1.8;
const X1 = 1.8;

const texCache = new Map<string, THREE.CanvasTexture>();
function tex(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  let t = texCache.get(key);
  if (!t) {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    draw(cv.getContext('2d')!);
    t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(key, t);
  }
  return t;
}

/** The tiny sticker on the edge of a reel: IPN written sideways. */
function spineTex(ipn: string) {
  return tex(`spine:${ipn}`, 32, 160, (c) => {
    c.fillStyle = '#f7f5ee';
    c.fillRect(0, 0, 32, 160);
    c.save();
    c.translate(22, 150);
    c.rotate(-Math.PI / 2);
    c.fillStyle = '#111';
    c.font = 'bold 20px monospace';
    c.fillText(ipn, 0, 0);
    c.restore();
  });
}

/** The big label on the flat face of the reel, readable once you pull it out. */
export function faceTex(ipn: string, qty: number) {
  return tex(`face:${ipn}:${qty}`, 512, 320, (c) => {
    const p = PART_BY_IPN.get(ipn)!;
    c.fillStyle = '#fbfaf4';
    c.fillRect(0, 0, 512, 320);
    c.strokeStyle = '#222';
    c.lineWidth = 6;
    c.strokeRect(6, 6, 500, 308);
    c.fillStyle = '#111';
    c.font = 'bold 78px monospace';
    c.fillText(ipn, 24, 92);
    c.font = '26px monospace';
    c.fillText(p.desc.slice(0, 30), 24, 140);
    c.fillText(`MPN ${p.mpn}`, 24, 178);
    c.font = 'bold 30px monospace';
    c.fillText(`QTY ${qty}`, 24, 222);
    for (let i = 0; i < 60; i++) {
      const w = [2, 3, 5][(i * 7 + ipn.length) % 3];
      c.fillRect(24 + i * 7.6, 244, w, 54);
    }
  });
}

function sectionTex(label: string) {
  return tex(`sec:${label}`, 256, 64, (c) => {
    c.fillStyle = '#f1c232';
    c.fillRect(0, 0, 256, 64);
    c.fillStyle = '#111';
    c.font = 'bold 40px system-ui';
    c.fillText(label, 12, 46);
  });
}

const flangeMats = [0x1c1e21, 0x2a5fa8, 0x1c1e21, 0x8e959c].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.05 }));
const tapeMat = new THREE.MeshStandardMaterial({ color: 0x2c2a26, roughness: 0.6 });
const hubMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.5 });
const stickMat = new THREE.MeshPhysicalMaterial({ color: 0xd9e6f0, roughness: 0.2, transparent: true, opacity: 0.55 });
const trayMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });

function makeItem(ipn: string, qty: number, rng: Rng): { group: THREE.Group; width: number; kind: RackItem['kind'] } {
  const p = PART_BY_IPN.get(ipn)!;
  const feeder = PACKAGES[p.pkg].feeder;
  const g = new THREE.Group();
  if (feeder === 'STICK') {
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.36), stickMat);
      s.position.set(0, 0.006 + i * 0.013, 0);
      g.add(s);
    }
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.05), new THREE.MeshBasicMaterial({ map: spineTex(ipn) }));
    lab.position.set(0, 0.03, 0.181);
    g.add(lab);
    return { group: g, width: 0.04, kind: 'stick' };
  }
  if (feeder === 'TRAY') {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.32), trayMat);
    t.position.y = 0.07;
    g.add(t);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.028, 0.1), new THREE.MeshBasicMaterial({ map: spineTex(ipn) }));
    lab.position.set(0, 0.07, 0.161);
    g.add(lab);
    return { group: g, width: 0.045, kind: 'tray' };
  }
  const r = feeder === 'T16' ? 0.165 : 0.09;
  const th = feeder === 'T8' ? 0.013 : feeder === 'T12' ? 0.017 : 0.021;
  const flange = rng.pick(flangeMats);
  const disk = new THREE.Mesh(new THREE.CylinderGeometry(r, r, th, 40), flange);
  disk.rotation.z = Math.PI / 2;
  disk.position.y = r;
  g.add(disk);
  const tape = new THREE.Mesh(new THREE.CylinderGeometry(r * (0.55 + Math.min(1, qty / 300) * 0.4), r * (0.55 + Math.min(1, qty / 300) * 0.4), th * 1.02, 40), tapeMat);
  tape.rotation.z = Math.PI / 2;
  tape.position.y = r;
  g.add(tape);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.2, th * 1.1, 20), hubMat);
  hub.rotation.z = Math.PI / 2;
  hub.position.y = r;
  g.add(hub);
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(th * 0.9, 0.06), new THREE.MeshBasicMaterial({ map: spineTex(ipn) }));
  lab.position.set(0, r, r + 0.0015);
  g.add(lab);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.1, r * 0.69), new THREE.MeshBasicMaterial({ map: faceTex(ipn, qty) }));
  face.position.set(th / 2 + 0.0015, r, 0);
  face.rotation.y = Math.PI / 2;
  g.add(face);
  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return { group: g, width: th + 0.007, kind: 'reel' };
}

/** Live stores rack: one physical item per reel in stores, in rough section order. */
export class StoresRack {
  items: RackItem[] = [];
  private sig = '';
  private pulled: RackItem | null = null;
  private labels = new THREE.Group();

  constructor(private root: THREE.Group, private game: Game) {
    root.add(this.labels);
  }

  sync() {
    const g = this.game;
    const entries = [...g.stores.entries()].filter(([, n]) => n > 0).sort((a, b) => a[0].localeCompare(b[0]));
    const sig = entries.map(([k, n]) => `${k}:${g.rackReels(k)}`).join(',');
    if (sig === this.sig) return;
    this.sig = sig;
    for (const it of this.items) this.root.remove(it.group);
    this.items = [];
    this.pulled = null;
    this.labels.clear();
    const rng = new Rng(77);
    // Section order, then IPN order... mostly.
    const list: { ipn: string; qty: number }[] = [];
    for (const cat of SECTION_ORDER) {
      for (const [ipn, n] of entries) {
        if (PART_BY_IPN.get(ipn)!.category !== cat) continue;
        const reels = g.rackReels(ipn);
        const size = g.reelSize(ipn);
        for (let k = 0; k < reels; k++) list.push({ ipn, qty: Math.min(size, n - k * size) });
      }
    }
    for (let i = 0; i < list.length; i++) {
      if (rng.chance(0.07)) {
        const j = Math.min(list.length - 1, i + rng.int(1, 6));
        [list[i], list[j]] = [list[j], list[i]];
      }
    }
    let shelf = 0;
    let x = X0;
    let lastCat = '';
    for (const it of list) {
      const made = makeItem(it.ipn, it.qty, rng);
      if (x + made.width > X1) {
        shelf++;
        x = X0;
        lastCat = '';
      }
      if (shelf >= SHELF_Y.length) break;
      const cat = PART_BY_IPN.get(it.ipn)!.category;
      if (cat !== lastCat) {
        x += 0.07;
        const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.028), new THREE.MeshBasicMaterial({ map: sectionTex(`${SECTION_LABEL[cat]} ${String.fromCharCode(65 + shelf)}`) }));
        lab.position.set(-(x + 0.05), SHELF_Y[shelf] - 0.016, 0.212);
        this.labels.add(lab);
        lastCat = cat;
        x += 0.04;
      }
      const home = new THREE.Vector3(-(x + made.width / 2), SHELF_Y[shelf] + 0.013, 0.02);
      made.group.position.copy(home);
      made.group.userData.rackItem = true;
      this.root.add(made.group);
      this.items.push({ ipn: it.ipn, group: made.group, home, homeRot: 0, kind: made.kind });
      x += made.width + 0.012;
    }
  }

  pick(ray: THREE.Raycaster): RackItem | null {
    const hits = ray.intersectObjects(this.items.map((i) => i.group), true);
    if (!hits.length) return null;
    let o: THREE.Object3D | null = hits[0].object;
    while (o && !o.userData.rackItem) o = o.parent;
    return this.items.find((i) => i.group === o) ?? null;
  }

  get current(): RackItem | null {
    return this.pulled;
  }

  pull(it: RackItem | null) {
    this.pulled = it;
  }

  highlight(it: RackItem | null) {
    for (const i of this.items) i.group.position.y = i.home.y + (i === it && i !== this.pulled ? 0.01 : 0);
  }

  update(dt: number) {
    const k = Math.min(1, dt * 8);
    for (const it of this.items) {
      const out = it === this.pulled;
      // Pulled items slide out towards you and turn their face (and label) to the front.
      const tp = out ? new THREE.Vector3(it.home.x, it.home.y + 0.06, 0.42) : it.home;
      if (!out && it.group.position.z > it.home.z + 0.001) it.group.position.lerp(tp, k);
      else if (out) it.group.position.lerp(tp, k);
      const tr = out ? -Math.PI / 2 : 0;
      it.group.rotation.y += (tr - it.group.rotation.y) * k;
    }
  }
}
