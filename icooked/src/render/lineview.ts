import * as THREE from 'three';
import { clamp, fmtMoney, fmtTime, lerp } from '../core/util';
import { OVEN_TRAVEL, type Game } from '../sim/game';
import type { Panel } from '../sim/types';
import { bakePanel, boardOrigin, panelSize } from './boardpaint';
import { CONVEYOR_Y, LINE_X, LINE_Z, type Factory } from './factory';
import { M, box } from './materials';

interface PanelVis {
  mesh: THREE.Mesh;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  sig: string;
  bakedAt: number;
}

const PX_PER_MM = 3;

/** Keeps the 3D line (panels on conveyors, machine animation, screens) in sync with the sim. */
export class LineView {
  private vis = new Map<number, PanelVis>();
  private screenT = 0;
  private lastShipped = -1;
  private lastRework = -1;
  private lampUntil = 0;
  private lampLights = 0;
  private headPos = new THREE.Vector3(0.8, 0, -0.5);
  private smoke: THREE.Points;
  private smokeData: { v: THREE.Vector3; life: number }[] = [];
  private fire: THREE.Points;
  private fireData: { v: THREE.Vector3; life: number }[] = [];

  constructor(private game: Game, private f: Factory, scene: THREE.Object3D) {
    game.events.on('shipped', () => {
      this.lampLights = 3;
      this.lampUntil = game.t + 1.4;
    });
    const smokeGeo = new THREE.BufferGeometry();
    smokeGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(120 * 3), 3));
    this.smoke = new THREE.Points(smokeGeo, new THREE.PointsMaterial({ color: 0x5a5550, size: 0.45, transparent: true, opacity: 0.35, depthWrite: false, map: softDot(), sizeAttenuation: true }));
    this.smoke.frustumCulled = false;
    scene.add(this.smoke);
    for (let i = 0; i < 120; i++) this.smokeData.push({ v: new THREE.Vector3(0, -99, 0), life: 0 });
    const fireGeo = new THREE.BufferGeometry();
    fireGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(300 * 3), 3));
    this.fire = new THREE.Points(fireGeo, new THREE.PointsMaterial({ color: 0xff8a2a, size: 0.5, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, map: softDot() }));
    this.fire.frustumCulled = false;
    this.fire.visible = false;
    scene.add(this.fire);
    for (let i = 0; i < 300; i++) this.fireData.push({ v: new THREE.Vector3(0, -99, 0), life: 0 });
  }

  panelWorld(p: Panel): THREE.Vector3 {
    let x = LINE_X.printer;
    let y = CONVEYOR_Y + 0.005;
    const z = LINE_Z;
    switch (p.stage) {
      case 'printer': x = LINE_X.printer; y = 1.19; break;
      case 'px9in': x = LINE_X.px9in; break;
      case 'px9': x = LINE_X.px9; break;
      case 'conv': x = lerp(LINE_X.convStart, LINE_X.inspect, clamp(p.t / 3, 0, 1)); break;
      case 'inspect': x = LINE_X.inspect; break;
      case 'ovenq': x = LINE_X.ovenq; break;
      case 'oven': x = lerp(LINE_X.ovenStart, LINE_X.ovenEnd, clamp(p.t / OVEN_TRAVEL, 0, 1)); break;
      case 'aoi': x = LINE_X.aoi; break;
      case 'test': x = LINE_X.test - 0.2; y = 0.97; break;
      default: break;
    }
    return new THREE.Vector3(x, y, z + (p.stage === 'test' ? 0.25 : 0));
  }

  private ensure(p: Panel): PanelVis {
    let v = this.vis.get(p.id);
    if (v) return v;
    const job = this.game.job(p.jobId)!;
    const def = job.product.board;
    const size = panelSize(def, p.nx, p.ny);
    const canvas = bakePanel(def, p.nx, p.ny, p.boards, PX_PER_MM);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.05 });
    const edge = new THREE.MeshStandardMaterial({ color: 0xcbb98a, roughness: 0.8 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.w / 1000, 0.0016, size.h / 1000), [edge, edge, top, edge, edge, edge]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.f.root.add(mesh);
    v = { mesh, canvas, tex, sig: '', bakedAt: 0 };
    this.vis.set(p.id, v);
    return v;
  }

  update(dt: number, now: number) {
    const g = this.game;
    const live = new Set<number>();
    for (const p of g.panels) {
      live.add(p.id);
      const v = this.ensure(p);
      const target = this.panelWorld(p);
      if (v.mesh.position.lengthSq() === 0) v.mesh.position.copy(target);
      v.mesh.position.lerp(target, clamp(dt * 6, 0, 1));
      const sig = p.boards.map((b) => b.version).join(',');
      if (sig !== v.sig && now - v.bakedAt > 0.35) {
        const def = g.job(p.jobId)!.product.board;
        bakePanel(def, p.nx, p.ny, p.boards, PX_PER_MM, v.canvas);
        v.tex.needsUpdate = true;
        v.sig = sig;
        v.bakedAt = now;
      }
    }
    for (const [id, v] of this.vis) {
      if (!live.has(id)) {
        this.f.root.remove(v.mesh);
        v.mesh.geometry.dispose();
        v.tex.dispose();
        this.vis.delete(id);
      }
    }
    this.animateMachines(dt, now);
    this.particles(dt);
    this.screenT -= dt;
    if (this.screenT <= 0) {
      this.screenT = 0.5;
      this.drawScreens();
    }
    if (g.stats.shipped !== this.lastShipped) {
      this.lastShipped = g.stats.shipped;
      this.syncShipBoxes();
    }
    if (g.rework.length !== this.lastRework) {
      this.lastRework = g.rework.length;
      this.syncRework();
    }
  }

  private animateMachines(dt: number, now: number) {
    const g = this.game;
    const f = this.f;
    const L = g.line;
    // PX-9 head chases the next placement.
    const p = g.panels.find((q) => q.stage === 'px9');
    let goal = new THREE.Vector3(0.8, 0, -0.5);
    if (p && !L.px9Alarm) {
      const job = g.job(p.jobId)!;
      const def = job.product.board;
      const n = def.placements.length;
      const bi = Math.min(p.boards.length - 1, Math.floor(p.placedIdx / n));
      const part = def.placements[p.placedIdx % n];
      const size = panelSize(def, p.nx, p.ny);
      const o = boardOrigin(def, bi, p.nx);
      const px = (o.x + part.x - size.w / 2) / 1000;
      const pz = -(o.y + part.y - size.h / 2) / 1000;
      // Alternate between the feeders and the board, like the real thing.
      const phase = (now * 3) % 1;
      goal = phase < 0.45 ? new THREE.Vector3(px, 0, pz) : new THREE.Vector3(-0.8 + ((p.placedIdx * 7) % 17) * 0.095, 0, 0.6);
    }
    this.headPos.lerp(goal, clamp(dt * 12, 0, 1));
    f.px9Gantry.position.x = this.headPos.x;
    f.px9Head.position.z = this.headPos.z;
    f.px9Head.position.y = p && !L.px9Alarm ? -0.02 * Math.abs(Math.sin(now * 20)) : 0;

    // Printer squeegee
    const printing = g.panels.find((q) => q.stage === 'printer');
    f.printerSqueegee.position.x = printing ? -0.35 + 0.7 * Math.abs(Math.sin((printing.t / 7) * Math.PI)) : -0.35;

    // Stack lights
    f.stack.printer.set(L.printerDirt > 0.6 ? 'red' : printing ? 'green' : 'amber', L.printerDirt > 0.6, now);
    f.stack.px9.set(L.px9Alarm ? 'red' : p ? 'green' : 'amber', !!L.px9Alarm, now);
    f.stack.oven.set(g.heat > 85 ? 'red' : g.heat > 60 ? 'amber' : L.feedStopped ? 'amber' : 'green', g.heat > 85, now);
    f.stack.aoi.set(g.panels.some((q) => q.stage === 'aoi') ? 'green' : 'amber');
    f.stack.test.set(g.rework.length > 8 ? 'red' : g.panels.some((q) => q.stage === 'test') ? 'green' : 'amber', g.rework.length > 8, now);

    // Oven glow scales with heat.
    const h = g.heat / 100;
    f.ovenGlow.emissiveIntensity = 0.4 + h * 3 + (g.over === 'fire' ? 4 : 0);
    f.ovenLight.intensity = h > 0.6 ? (h - 0.6) * 25 * (0.8 + 0.2 * Math.sin(now * 13)) : 0;
    if (g.over === 'fire') f.ovenLight.intensity = 30 + 10 * Math.sin(now * 17);

    // Test lamps
    const lampOn = now < this.lampUntil || g.t < this.lampUntil;
    f.testLamps.forEach((m, i) => (m.emissiveIntensity = lampOn && i < this.lampLights ? 3 : 0.05));
    // Feeder reels spin while placing.
    if (p && !L.px9Alarm) for (const r of f.feederReels) r.rotation.x += dt * 0.6;
  }

  private particles(dt: number) {
    const g = this.game;
    const smokeRate = g.heat > 70 ? (g.heat - 70) / 30 : 0;
    const pos = this.smoke.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.smokeData.forEach((s, i) => {
      if (s.life <= 0 && Math.random() < smokeRate * dt * 3) {
        s.life = 4;
        s.v.set(lerp(-2.3, 2.3, Math.random()), 1.4, LINE_Z + (Math.random() - 0.5) * 0.8);
      }
      if (s.life > 0) {
        s.life -= dt;
        s.v.y += dt * 0.35;
        s.v.x += (Math.random() - 0.5) * dt * 0.3;
      } else s.v.y = -99;
      pos.setXYZ(i, s.v.x, s.v.y, s.v.z);
    });
    pos.needsUpdate = true;
    this.fire.visible = g.over === 'fire';
    if (this.fire.visible) {
      const fp = this.fire.geometry.getAttribute('position') as THREE.BufferAttribute;
      this.fireData.forEach((s, i) => {
        if (s.life <= 0) {
          s.life = 0.6 + Math.random() * 0.9;
          s.v.set(lerp(-2.5, 2.5, Math.random()), 1.0 + Math.random() * 0.4, LINE_Z + (Math.random() - 0.5) * 1.2);
        }
        s.life -= dt;
        s.v.y += dt * (1.2 + Math.random());
        fp.setXYZ(i, s.v.x, s.v.y, s.v.z);
      });
      fp.needsUpdate = true;
    }
  }

  private syncShipBoxes() {
    const grp = this.f.shipBoxes;
    const want = Math.min(32, Math.floor(this.game.stats.shipped / 4));
    while (grp.children.length < want) {
      const i = grp.children.length;
      const shelf = Math.floor(i / 8);
      const slot = i % 8;
      const b = box(0.17, 0.14, 0.24, M.cardboard, -0.66 + slot * 0.19, 0.44 + shelf * 0.5, (slot % 2) * 0.1 - 0.05, grp);
      b.rotation.y = ((i * 37) % 10) * 0.02 - 0.1;
    }
  }

  private syncRework() {
    const rack = this.f.reworkRack;
    while (rack.children.length > 1) rack.remove(rack.children[rack.children.length - 1]);
    const n = Math.min(12, this.game.rework.length);
    for (let i = 0; i < n; i++) {
      const b = box(0.08, 0.004, 0.06, new THREE.MeshStandardMaterial({ color: 0x1d6b3a, roughness: 0.5 }), -0.1 + (i % 4) * 0.07, 0.03 + Math.floor(i / 4) * 0.012, 0);
      b.rotation.y = (i % 3) * 0.1;
      rack.add(b);
    }
  }

  private drawScreens() {
    const g = this.game;
    const f = this.f;
    const L = g.line;
    const job = g.activeJob;
    const px = g.panels.find((q) => q.stage === 'px9');
    f.px9Screen.draw((c, w, h) => {
      c.fillStyle = '#aeb2c3';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#5b6b94';
      c.fillRect(0, 0, w, 44);
      c.fillStyle = '#fff';
      c.font = 'bold 26px monospace';
      c.fillText('PX-9 Production', 14, 31);
      c.fillStyle = '#111';
      c.font = '24px monospace';
      c.fillText(`Job:   ${job ? job.product.asmIpn : '---'}`, 20, 90);
      c.fillText(`Prog:  ${job?.program?.name ?? '---'}`, 20, 125);
      if (px) {
        const job2 = g.job(px.jobId)!;
        const total = job2.product.board.placements.length * px.boards.length;
        c.fillText(`Place: ${px.placedIdx}/${total}`, 20, 160);
        c.fillStyle = '#333';
        c.fillRect(20, 180, w - 40, 24);
        c.fillStyle = '#3a8f4a';
        c.fillRect(22, 182, ((w - 44) * px.placedIdx) / total, 20);
      }
      if (L.px9Alarm) {
        c.fillStyle = '#c0231a';
        c.fillRect(20, 240, w - 40, 110);
        c.fillStyle = '#fff';
        c.font = 'bold 26px monospace';
        c.fillText('!! MACHINE STOPPED !!', 40, 285);
        c.font = '22px monospace';
        c.fillText(L.px9Alarm.slice(0, 40), 40, 325);
      } else {
        c.fillStyle = '#1d3d1d';
        c.font = 'bold 26px monospace';
        c.fillText(px ? 'RUNNING' : job ? 'WAITING FOR BOARD' : 'IDLE - NO JOB', 20, 290);
      }
    });
    f.ovenScreen.draw((c, w, h) => {
      c.fillStyle = '#1b1f24';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#e8eef4';
      c.font = 'bold 30px system-ui';
      c.fillText('REFLOW 8-ZONE', 20, 40);
      const zones = [150, 165, 175, 185, 200, 235, 248, 60];
      zones.forEach((z, i) => {
        const t = Math.round(z * (1 + g.heat / 250));
        const bh = (t / 320) * 220;
        c.fillStyle = t > 280 ? '#ff3a2a' : t > 250 ? '#ffae2a' : '#3ab0ff';
        c.fillRect(30 + i * 92, 300 - bh, 60, bh);
        c.fillStyle = '#cdd6df';
        c.font = '22px monospace';
        c.fillText(`${t}°`, 30 + i * 92, 330);
      });
      c.fillStyle = '#333a42';
      c.fillRect(20, 370, w - 40, 50);
      c.fillStyle = g.heat > 85 ? '#ff2a1a' : g.heat > 60 ? '#ffae2a' : '#3ad06a';
      c.fillRect(24, 374, ((w - 48) * clamp(g.heat, 0, 100)) / 100, 42);
      c.fillStyle = '#fff';
      c.font = 'bold 26px system-ui';
      c.fillText(`RESIDUE / HEAT ${Math.round(g.heat)}%${L.feedStopped ? '  FEED STOPPED' : ''}${L.maintenance ? '  MAINTENANCE' : ''}`, 34, 404);
      c.font = '20px monospace';
      c.fillStyle = '#9aa7b4';
      c.fillText(`services: ${g.maintCount}`, 20, 460);
    });
    f.aoiScreen.draw((c, w, h) => {
      c.fillStyle = '#0a0f14';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#39ff88';
      c.font = 'bold 28px monospace';
      c.fillText(`AOI  [${L.aoiScope.toUpperCase()}]`, 20, 44);
      const a = g.panels.find((q) => q.stage === 'aoi' || q.stage === 'test');
      c.font = '22px monospace';
      if (a) {
        a.boards.forEach((b, i) => {
          c.fillStyle = b.aoiFlags.length ? '#ff5050' : b.reflowed ? '#39ff88' : '#88a';
          c.fillText(`${b.serial} ${b.aoiFlags.length ? 'FAIL ' + b.aoiFlags.slice(0, 3).join(',') : 'PASS'}`, 20, 90 + i * 28);
        });
      } else {
        c.fillStyle = '#4a6';
        c.fillText('waiting for boards...', 20, 90);
      }
    });
    f.deskScreens[0].draw((c, w, h) => {
      c.fillStyle = '#3d6e8a';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#c9ccd6';
      c.fillRect(30, 30, w - 60, h - 60);
      c.fillStyle = '#6b5b95';
      c.fillRect(30, 30, w - 60, 36);
      c.fillStyle = '#fff';
      c.font = 'bold 22px monospace';
      c.fillText('schedule.txt', 42, 56);
      c.fillStyle = '#111';
      c.font = '20px monospace';
      const open = g.jobs.filter((j) => j.status !== 'finished' && j.status !== 'declined').slice(0, 11);
      open.forEach((j, i) => {
        const late = g.t > j.dueAt;
        c.fillStyle = late ? '#b00' : '#111';
        c.fillText(`${j.product.asmIpn.padEnd(14)} ${String(j.qty).padStart(3)} ${j.status.padEnd(9)} ${late ? 'LATE' : fmtTime(j.dueAt - g.t)}`, 42, 100 + i * 30);
      });
    });
    f.deskScreens[1].draw((c, w, h) => {
      c.fillStyle = '#2b4a5c';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#e4e4e4';
      c.fillRect(40, 40, w - 80, h - 80);
      c.fillStyle = '#23466b';
      c.fillRect(40, 40, w - 80, 40);
      c.fillStyle = '#fff';
      c.font = 'bold 22px system-ui';
      c.fillText('OmniTrack ERP 6.2', 54, 68);
      c.fillStyle = '#333';
      c.font = '20px system-ui';
      c.fillText('Session will expire in 00:00:04', 60, 130);
      c.fillText(`Cash on hand: ${fmtMoney(g.cash)}`, 60, 170);
      c.fillText('Press E to sit down.', 60, 230);
    });
    f.wallClock.draw((c, w, h) => {
      c.fillStyle = '#0c0c0c';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ff3b2a';
      c.font = 'bold 92px monospace';
      c.textAlign = 'center';
      c.fillText(fmtTime(g.t), w / 2, 130);
      c.font = 'bold 40px monospace';
      c.fillStyle = '#ffb02a';
      c.fillText(`SCORE ${g.score}`, w / 2, 210);
      c.textAlign = 'left';
    });
    f.fireSign.draw((c, w, h) => {
      c.fillStyle = '#f4f4ee';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#c0231a';
      c.lineWidth = 12;
      c.strokeRect(6, 6, w - 12, h - 12);
      c.fillStyle = '#111';
      c.font = '900 64px system-ui';
      c.textAlign = 'center';
      c.fillText('DAYS SINCE LAST OVEN FIRE', w / 2 - 70, 110);
      c.fillStyle = '#c0231a';
      c.font = '900 150px system-ui';
      c.fillText('0', w - 90, 180);
      c.fillStyle = '#555';
      c.font = '600 38px system-ui';
      c.fillText(`(oven is at ${Math.round(g.heat)}%)`, w / 2 - 70, 190);
      c.textAlign = 'left';
    });
  }
}

let dotTex: THREE.Texture | null = null;
function softDot(): THREE.Texture {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}
