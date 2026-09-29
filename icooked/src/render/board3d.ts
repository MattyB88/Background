import * as THREE from 'three';
import { PACKAGES, PART_BY_IPN, type PkgId } from '../sim/parts';
import type { BoardDef, BoardInst } from '../sim/types';
import { paintBareBoard } from './boardpaint';

/**
 * Detailed 3D board for close-up stations. Units are millimetres.
 * Board top surface sits at y = 0; board x -> world x, board y -> world -z.
 */

const ATLAS_CELLS = 16;
const atlasIndex = new Map<string, number>();
let atlasTex: THREE.CanvasTexture | null = null;
let atlasCanvas: HTMLCanvasElement | null = null;

function markingAtlas(): THREE.CanvasTexture {
  if (atlasTex) return atlasTex;
  atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = atlasCanvas.height = 1024;
  atlasTex = new THREE.CanvasTexture(atlasCanvas);
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.anisotropy = 4;
  return atlasTex;
}

function markingCell(text: string, ic: boolean): number {
  const key = `${ic ? 'i' : 'r'}:${text}`;
  const found = atlasIndex.get(key);
  if (found !== undefined) return found;
  markingAtlas();
  const idx = atlasIndex.size % (ATLAS_CELLS * ATLAS_CELLS);
  atlasIndex.set(key, idx);
  const ctx = atlasCanvas!.getContext('2d')!;
  const cell = 1024 / ATLAS_CELLS;
  const cx = (idx % ATLAS_CELLS) * cell;
  const cy = Math.floor(idx / ATLAS_CELLS) * cell;
  ctx.clearRect(cx, cy, cell, cell);
  ctx.fillStyle = ic ? 'rgba(190,192,196,0.9)' : 'rgba(245,245,245,0.95)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = Math.min(cell * 0.62, (cell * 1.5) / Math.max(1, text.length));
  ctx.font = `${ic ? 500 : 700} ${size}px "Roboto Mono", monospace`;
  ctx.fillText(text, cx + cell / 2, cy + cell / 2);
  atlasTex!.needsUpdate = true;
  return idx;
}

function markingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { atlas: { value: markingAtlas() } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    vertexShader: /* glsl */ `
      attribute float aCell;
      varying vec2 vUv;
      void main() {
        float cx = mod(aCell, ${ATLAS_CELLS}.0);
        float cy = floor(aCell / ${ATLAS_CELLS}.0);
        vUv = vec2((cx + uv.x) / ${ATLAS_CELLS}.0, 1.0 - (cy + 1.0 - uv.y) / ${ATLAS_CELLS}.0);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D atlas;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(atlas, vUv);
        if (c.a < 0.05) discard;
        gl_FragColor = vec4(c.rgb, c.a);
      }`,
  });
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 28, 1).translate(0, 0.5, 0);
const planeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
const metalMat = new THREE.MeshStandardMaterial({ color: 0xd7dadf, roughness: 0.28, metalness: 0.9 });
const pasteMat = new THREE.MeshStandardMaterial({ color: 0x8e9196, roughness: 0.95, metalness: 0.1 });
const solderMat = new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.12, metalness: 1 });

interface Capacity { bodies: number; metal: number; cyl: number; mark: number; paste: number }

function capacityFor(def: BoardDef): Capacity {
  let pads = 0;
  let leads = 0;
  let cyl = 0;
  for (const pl of def.placements) {
    const pkg = PACKAGES[PART_BY_IPN.get(pl.ipn)!.pkg];
    pads += pkg.pads.length;
    leads += pkg.pads.length + 4;
    if (pkg.kind === 'elec') cyl += 2;
  }
  return { bodies: def.placements.length * 2, metal: leads + 8, cyl: cyl + 2, mark: def.placements.length, paste: pads };
}

export class Board3D {
  readonly group = new THREE.Group();
  readonly def: BoardDef;
  private bodies: THREE.InstancedMesh;
  private metal: THREE.InstancedMesh;
  private cyl: THREE.InstancedMesh;
  private marks: THREE.InstancedMesh;
  private paste: THREE.InstancedMesh;
  private solder: THREE.InstancedMesh;
  private cellAttr: THREE.InstancedBufferAttribute;
  private substrate: THREE.Mesh;
  private scorchMat: THREE.MeshStandardMaterial;
  /** instanceId in `bodies` -> part index */
  bodyPart: number[] = [];
  private lastVersion = -1;
  private board: BoardInst | null = null;
  private tmp = new THREE.Object3D();
  private col = new THREE.Color();

  constructor(def: BoardDef, pxPerMm = 12) {
    this.def = def;
    const cap = capacityFor(def);
    const canvas = document.createElement('canvas');
    const s = Math.min(pxPerMm, 2048 / Math.max(def.w, def.h));
    canvas.width = Math.ceil(def.w * s);
    canvas.height = Math.ceil(def.h * s);
    paintBareBoard(canvas.getContext('2d')!, def, s);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const edge = new THREE.MeshStandardMaterial({ color: 0xcbb98a, roughness: 0.8 });
    this.scorchMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0.05 });
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z
    this.substrate = new THREE.Mesh(new THREE.BoxGeometry(def.w, 1.6, def.h), [edge, edge, this.scorchMat, edge, edge, edge]);
    this.substrate.position.set(def.w / 2, -0.8, -def.h / 2);
    this.substrate.receiveShadow = true;
    this.group.add(this.substrate);

    const bm = bodyMat.clone();
    this.bodies = new THREE.InstancedMesh(boxGeo, bm, cap.bodies);
    this.metal = new THREE.InstancedMesh(boxGeo, metalMat, cap.metal);
    this.cyl = new THREE.InstancedMesh(cylGeo, bm, cap.cyl);
    this.paste = new THREE.InstancedMesh(boxGeo, pasteMat, cap.paste);
    this.solder = new THREE.InstancedMesh(boxGeo, solderMat, cap.paste);
    this.marks = new THREE.InstancedMesh(planeGeo, markingMaterial(), cap.mark);
    this.cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap.mark), 1);
    this.marks.geometry = planeGeo.clone();
    this.marks.geometry.setAttribute('aCell', this.cellAttr);
    for (const m of [this.bodies, this.metal, this.cyl]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    for (const m of [this.bodies, this.metal, this.cyl, this.paste, this.solder, this.marks]) {
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
  }

  /** Board-mm to local group coordinates. */
  static toLocal(x: number, y: number): THREE.Vector3 {
    return new THREE.Vector3(x, 0, -y);
  }

  setBoard(b: BoardInst | null) {
    this.board = b;
    this.lastVersion = -1;
    this.update();
  }

  update() {
    const b = this.board;
    if (!b) {
      for (const m of [this.bodies, this.metal, this.cyl, this.paste, this.solder, this.marks]) m.count = 0;
      return;
    }
    if (b.version === this.lastVersion) return;
    this.lastVersion = b.version;
    this.rebuild(b);
  }

  private put(mesh: THREE.InstancedMesh, i: number, o: THREE.Object3D, color?: THREE.Color) {
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
    if (color) mesh.setColorAt(i, color);
  }

  private rebuild(b: BoardInst) {
    const o = this.tmp;
    let nb = 0, nm = 0, nc = 0, np = 0, ns = 0, nk = 0;
    this.bodyPart = [];

    // Paste / solder on pads (under parts).
    b.parts.forEach((p) => {
      const pkg = PACKAGES[p.pkg];
      pkg.pads.forEach((pad, i) => {
        const v = p.paste[i] ?? 1;
        if (v < 0.08) return;
        const r = (p.rot * Math.PI) / 180;
        const px = p.x + pad.x * Math.cos(r) - pad.y * Math.sin(r);
        const py = p.y + pad.x * Math.sin(r) + pad.y * Math.cos(r);
        o.position.set(px, 0, -py);
        o.rotation.set(0, r, 0);
        if (b.reflowed) {
          o.scale.set(pad.w * 0.92, 0.05 + v * 0.05, pad.h * 0.92);
          this.put(this.solder, ns++, o);
        } else {
          const sc = Math.min(1.3, 0.55 + v * 0.4);
          o.scale.set(pad.w * sc, 0.1 * v + 0.02, pad.h * sc);
          this.put(this.paste, np++, o);
        }
      });
    });

    b.parts.forEach((p, idx) => {
      if (!p.placed) return;
      const pkg = PACKAGES[p.pkg];
      const erp = p.ipn ? PART_BY_IPN.get(p.ipn) : undefined;
      const r = ((p.rot + p.drot) * Math.PI) / 180;
      const base = new THREE.Object3D();
      base.position.set(p.x + p.dx, 0.05, -(p.y + p.dy));
      base.rotation.set(0, r, 0);
      if (p.defect === 'tombstone') {
        // Stand the part up on its right-hand pad.
        const pivot = new THREE.Object3D();
        pivot.position.set(pkg.w / 2, 0, 0);
        pivot.rotation.set(0, 0, (75 * Math.PI) / 180);
        base.add(pivot);
        const inner = new THREE.Object3D();
        inner.position.set(-pkg.w / 2, 0, 0);
        pivot.add(inner);
        base.updateMatrixWorld(true);
        this.counts = { nb, nm, nc, nk };
        this.emitPart(pkg.id, erp?.body ?? '#222', erp?.marking ?? '', inner, idx);
      } else {
        base.updateMatrixWorld(true);
        this.counts = { nb, nm, nc, nk };
        this.emitPart(pkg.id, erp?.body ?? '#222', erp?.marking ?? '', base, idx);
      }
      nb = this.counts.nb;
      nm = this.counts.nm;
      nc = this.counts.nc;
      nk = this.counts.nk;
    });

    // Bridges: blob across neighbouring leads.
    b.parts.forEach((p) => {
      if (p.defect !== 'bridge' || !b.reflowed) return;
      const pkg = PACKAGES[p.pkg];
      const pad = pkg.pads[0];
      const r = (p.rot * Math.PI) / 180;
      const px = p.x + pad.x * Math.cos(r) - pad.y * Math.sin(r);
      const py = p.y + pad.x * Math.sin(r) + pad.y * Math.cos(r);
      o.position.set(px, 0, -py);
      o.rotation.set(0, r, 0);
      o.scale.set(Math.max(1.2, pad.w * 3), 0.35, pad.h * 0.8);
      this.put(this.solder, ns++, o);
    });

    this.bodies.count = nb;
    this.metal.count = nm;
    this.cyl.count = nc;
    this.paste.count = np;
    this.solder.count = ns;
    this.marks.count = nk;
    for (const m of [this.bodies, this.metal, this.cyl, this.paste, this.solder, this.marks]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.cellAttr.needsUpdate = true;
    const sc = Math.min(1, b.scorch);
    this.scorchMat.color.setRGB(1 - sc * 0.55, 1 - sc * 0.65, 1 - sc * 0.8);
  }

  private counts = { nb: 0, nm: 0, nc: 0, nk: 0 };

  private emitPart(pkgId: PkgId, bodyHex: string, marking: string, parent: THREE.Object3D, idx: number) {
    let { nb, nm, nc, nk } = this.counts;
    const pkg = PACKAGES[pkgId];
    const child = new THREE.Object3D();
    parent.add(child);
    const placeLocal = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      child.position.set(x, y, z);
      child.rotation.set(0, 0, 0);
      child.scale.set(sx, sy, sz);
      child.updateMatrixWorld(true);
      return child.matrixWorld;
    };
    const color = this.col.set(bodyHex);
    const setM = (mesh: THREE.InstancedMesh, i: number, m: THREE.Matrix4, c?: THREE.Color) => {
      mesh.setMatrixAt(i, m);
      if (c) mesh.setColorAt(i, c);
    };
    const H = pkg.height;
    switch (pkg.kind) {
      case 'chip':
      case 'led':
      case 'tant': {
        const cap = Math.min(pkg.w * 0.2, 0.5);
        const bodyH = pkg.kind === 'led' ? H * 0.55 : H;
        this.bodyPart[nb] = idx;
        setM(this.bodies, nb++, placeLocal(0, 0, 0, pkg.w - (pkg.kind === 'tant' ? 0 : cap * 1.6), bodyH, pkg.h), color);
        if (pkg.kind === 'led') {
          this.bodyPart[nb] = idx;
          setM(this.bodies, nb++, placeLocal(0, bodyH, 0, pkg.w * 0.6, H - bodyH, pkg.h * 0.8), this.col.set('#f4f2ea').lerp(new THREE.Color(bodyHex), 0.5));
        }
        const capW = pkg.kind === 'tant' ? 0.9 : cap;
        setM(this.metal, nm++, placeLocal(-pkg.w / 2 + capW / 2, 0, 0, capW, pkg.kind === 'tant' ? 0.5 : H, pkg.h * 0.98));
        setM(this.metal, nm++, placeLocal(pkg.w / 2 - capW / 2, 0, 0, capW, pkg.kind === 'tant' ? 0.5 : H, pkg.h * 0.98));
        if (marking) {
          this.cellAttr.setX(nk, markingCell(marking, false));
          setM(this.marks, nk++, placeLocal(0, bodyH + 0.01, 0, pkg.w * 0.62, 1, pkg.h * 0.85));
        }
        break;
      }
      case 'ic':
      case 'xtal':
      case 'conn': {
        for (const pad of pkg.pads) {
          if (pad.w > 2.5 && pad.h > 2.5) continue; // thermal pad hidden under body
          const lead = pkg.kind === 'ic' && (pkg.id === 'SOIC8' || pkg.id === 'TSSOP16' || pkg.id === 'QFP44' || pkg.id === 'SOT23');
          const lw = Math.min(pad.w, pad.h) * 0.55;
          const long = Math.max(pad.w, pad.h) * 0.75;
          const alongX = pad.w > pad.h;
          setM(this.metal, nm++, placeLocal(pad.x * (lead ? 0.96 : 0.98), 0, -pad.y * (lead ? 0.96 : 0.98), alongX ? long : lw, lead ? 0.28 : 0.2, alongX ? lw : long));
        }
        const bodyColor = pkg.kind === 'conn' ? this.col.set('#b8bcc3') : color;
        this.bodyPart[nb] = idx;
        setM(this.bodies, nb++, placeLocal(0, pkg.kind === 'ic' && pkg.id !== 'QFN32' ? 0.12 : 0, 0, pkg.w, H - 0.12, pkg.h), bodyColor);
        if (pkg.kind === 'conn') {
          this.bodyPart[nb] = idx;
          setM(this.bodies, nb++, placeLocal(0, H * 0.25, pkg.h / 2 - 0.2, pkg.w * 0.82, H * 0.5, 0.5), this.col.set('#1c1c1c'));
        }
        if (marking) {
          this.cellAttr.setX(nk, markingCell(marking, true));
          setM(this.marks, nk++, placeLocal(0, H + 0.01, 0, Math.min(pkg.w * 0.85, 6), 1, Math.min(pkg.h * 0.55, 3)));
        }
        break;
      }
      case 'elec': {
        const d = pkg.w * 0.95;
        this.bodyPart[nb] = idx;
        setM(this.bodies, nb++, placeLocal(0, 0, 0, pkg.w, 0.9, pkg.h), this.col.set('#1c1c1c'));
        setM(this.cyl, nc++, placeLocal(0, 0.9, 0, d, H - 1.0, d), color);
        setM(this.cyl, nc++, placeLocal(0, H - 0.1, 0, d * 0.82, 0.12, d * 0.82), this.col.set('#dfe2e6'));
        setM(this.metal, nm++, placeLocal(-pkg.w / 2 + 0.5, 0, 0, 1.2, 0.3, 1.0));
        setM(this.metal, nm++, placeLocal(pkg.w / 2 - 0.5, 0, 0, 1.2, 0.3, 1.0));
        break;
      }
    }
    parent.remove(child);
    this.counts = { nb, nm, nc, nk };
  }

  /** Raycast a part under a normalised device coordinate. */
  pick(ray: THREE.Raycaster): number | null {
    const hits = ray.intersectObject(this.bodies, false);
    if (!hits.length || hits[0].instanceId == null) return null;
    return this.bodyPart[hits[0].instanceId] ?? null;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        if (o.geometry !== boxGeo && o.geometry !== cylGeo && o.geometry !== planeGeo) o.geometry.dispose();
      }
    });
    (this.scorchMat.map as THREE.Texture).dispose();
  }
}
