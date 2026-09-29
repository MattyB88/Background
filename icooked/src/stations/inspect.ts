import * as THREE from 'three';
import { clamp, el } from '../core/util';
import { PACKAGES, PART_BY_IPN } from '../sim/parts';
import type { BoardInst, Panel, PlacedPart } from '../sim/types';
import { BenchStation } from './benchbase';
import { FloorSearch } from './floor';

/** Tip contact radius (mm): the very point plus the side of the jaws. */
const TIP_R = 0.12;
/** Pushing faster than this (mm/s) makes a part jump. */
const HOP_SPEED = 28;
/** Moving a held part faster than this (mm/s) pings it out of the tweezers. */
const PING_SPEED = 45;

/**
 * Manual inspection after the PX-9. Real contact physics: the tweezer tip pushes a part
 * by its edges on the wet paste. Grip to lift it. Too fast and it jumps; too fast (or too
 * long) while held and it pings off onto the floor. Tremor is physical (mm), so zooming in
 * makes it easier to see and harder to hide.
 */
export class InspectStation extends BenchStation {
  private side!: HTMLElement;
  private panel: Panel | null = null;
  private boardIdx = 0;
  private down = false;
  private held: { part: PlacedPart; since: number } | null = null;
  private tip = new THREE.Vector2();
  private lastTip = new THREE.Vector2();
  private tipSpeed = 0;
  private t = 0;
  private time = 0;
  private hopCool = 0;
  private floor!: FloorSearch;

  build() {
    this.tools = ['tweezers'];
    this.initBench();
    this.side = el('div', { class: 'side right' });
    this.body.append(this.side);
    this.floor = new FloorSearch(this.app, () => this.render());
    this.body.append(this.floor.root);
  }

  status(): string {
    const g = this.app.game;
    const waiting = g.panels.filter((p) => p.stage === 'inspect' || p.stage === 'conv').length;
    return waiting ? `${waiting} panel(s) coming off the PX-9` : 'Nothing to inspect';
  }

  enter() {
    this.panel = null;
    this.boardIdx = 0;
    this.sync();
    this.render();
  }

  leave() {
    super.leave();
    this.dropHeld(false);
    if (this.panel) this.panel.held = false;
    this.panel = null;
    this.floor.close();
    this.setBoard(null, null);
  }

  private sync() {
    const g = this.app.game;
    const at = g.panels.find((p) => p.stage === 'inspect') ?? null;
    if (at !== this.panel) {
      this.dropHeld(false);
      if (this.panel) this.panel.held = false;
      this.panel = at;
      this.boardIdx = 0;
      if (at) {
        at.held = true;
        this.app.audio.play('conveyor');
      }
      this.showBoard();
      this.render();
    }
  }

  private get board(): BoardInst | null {
    return this.panel?.boards[this.boardIdx] ?? null;
  }

  private showBoard() {
    const p = this.panel;
    if (!p) {
      this.setBoard(null, null);
      return;
    }
    const def = this.app.game.job(p.jobId)!.product.board;
    this.setBoard(def, p.boards[this.boardIdx]);
  }

  protected onPress(e: PointerEvent) {
    if (!this.board || this.board.reflowed) return;
    if (!this.app.useTool('tweezers')) return;
    this.updateNdc(e);
    this.down = true;
  }

  protected onRelease() {
    this.down = false;
  }

  /** Close the jaws on whatever is between them, or open them to let go. */
  protected onGrip() {
    const g = this.app.game;
    const b = this.board;
    if (!b || b.reflowed) return;
    if (!this.app.useTool('tweezers')) return;
    if (this.held) {
      this.dropHeld(true);
      return;
    }
    if (g.hand) {
      // Placing a loose part (from the floor or the feeder) onto an empty land.
      const land = this.nearestEmptyLand(b);
      if (!land) {
        this.app.hud.toast('No empty land under the tip.', 'info', 'Tweezers');
        return;
      }
      const err = g.placeFromHand(b, land.des, this.tip.x, this.tip.y);
      if (err) this.app.hud.toast(err, 'warn', 'Tweezers');
      this.render();
      return;
    }
    const p = this.partAtTip(b, 0.35);
    if (!p) {
      this.app.audio.play('click');
      return;
    }
    this.held = { part: p, since: this.time };
    this.app.audio.play('click');
  }

  private dropHeld(onPurpose: boolean) {
    if (!this.held) return;
    if (onPurpose) this.app.audio.play('click');
    this.held = null;
  }

  private partAtTip(b: BoardInst, slack: number): PlacedPart | null {
    for (const p of b.parts) {
      if (!p.placed) continue;
      const pkg = PACKAGES[p.pkg];
      const l = this.toLocal(p);
      if (Math.abs(l.x) <= pkg.w / 2 + slack && Math.abs(l.y) <= pkg.h / 2 + slack) return p;
    }
    return null;
  }

  private nearestEmptyLand(b: BoardInst): PlacedPart | null {
    let best: PlacedPart | null = null;
    let bd = Infinity;
    for (const p of b.parts) {
      if (p.placed) continue;
      const d = Math.hypot(p.x - this.tip.x, p.y - this.tip.y);
      const r = Math.max(PACKAGES[p.pkg].w, PACKAGES[p.pkg].h) / 2 + 1;
      if (d < r && d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** Tip position in the part's own frame. */
  private toLocal(p: PlacedPart): THREE.Vector2 {
    const a = (-(p.rot + p.drot) * Math.PI) / 180;
    const x = this.tip.x - (p.x + p.dx);
    const y = this.tip.y - (p.y + p.dy);
    return new THREE.Vector2(x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a));
  }

  private fromLocal(p: PlacedPart, v: THREE.Vector2): THREE.Vector2 {
    const a = ((p.rot + p.drot) * Math.PI) / 180;
    return new THREE.Vector2(v.x * Math.cos(a) - v.y * Math.sin(a), v.x * Math.sin(a) + v.y * Math.cos(a));
  }

  update(dt: number) {
    super.update(dt);
    const g = this.app.game;
    this.time += dt;
    this.hopCool -= dt;
    this.sync();
    const b = this.board;
    this.app.bench.setTool(this.app.toolAt.tweezers === this.spot.id ? 'tweezers' : null);

    // Physical tremor in millimetres: always a little, a lot when stressed.
    const s = g.stress;
    const amp = 0.03 + s * s * 0.42;
    const tt = this.time;
    const tremor = new THREE.Vector2(
      amp * (Math.sin(tt * 9.1) * 0.6 + Math.sin(tt * 23.7) * 0.3 + Math.sin(tt * 3.3) * 0.4),
      amp * (Math.cos(tt * 8.3) * 0.6 + Math.sin(tt * 19.9) * 0.3 + Math.cos(tt * 2.9) * 0.4),
    );
    const c = this.app.bench.cursorBoard();
    this.lastTip.copy(this.tip);
    this.tip.set(c.x + tremor.x, c.y + tremor.y);
    const inst = this.tip.distanceTo(this.lastTip) / Math.max(dt, 1e-3);
    this.tipSpeed = this.tipSpeed * 0.6 + inst * 0.4;

    const touching = this.down || !!this.held;
    const gap = this.held ? Math.max(PACKAGES[this.held.part.pkg].h * 0.9, 0.3) : this.app.game.hand ? 0.25 : 1.1;
    this.app.bench.setTip(this.tip.x, this.tip.y, touching ? 0.05 : 1.6, gap);

    if (b && !b.reflowed) {
      if (this.held) this.moveHeld(b, dt);
      else if (this.down) this.pushContacts(b);
    }

    this.t -= dt;
    if (this.t <= 0 && this.canRefresh()) {
      this.t = 0.3;
      this.render();
    }
  }

  private moveHeld(b: BoardInst, _dt: number) {
    const g = this.app.game;
    const p = this.held!.part;
    if (!p.placed) {
      this.held = null;
      return;
    }
    const gripLimit = 4.5 - g.stress * 3;
    if (this.tipSpeed > PING_SPEED || this.time - this.held!.since > gripLimit) {
      const why = this.tipSpeed > PING_SPEED ? 'too fast' : 'held too long, your grip slipped';
      g.flick(b, p.des);
      this.held = null;
      this.app.hud.toast(`${p.des} pinged out of the tweezers (${why}). It's on the floor somewhere.`, 'bad', 'Tweezers');
      this.render();
      return;
    }
    // The part rides in the jaws: its centre follows the tip.
    const dx = this.tip.x - (p.x + p.dx);
    const dy = this.tip.y - (p.y + p.dy);
    g.nudge(b, p.des, dx, dy);
  }

  private pushContacts(b: BoardInst) {
    const g = this.app.game;
    for (const p of b.parts) {
      if (!p.placed) continue;
      const pkg = PACKAGES[p.pkg];
      const hw = pkg.w / 2;
      const hh = pkg.h / 2;
      const l = this.toLocal(p);
      if (Math.abs(l.x) >= hw + TIP_R || Math.abs(l.y) >= hh + TIP_R) continue;
      // Contact: push the part out along the shallowest axis, from the edge the tip hit.
      const px = hw + TIP_R - Math.abs(l.x);
      const py = hh + TIP_R - Math.abs(l.y);
      const push = px < py ? new THREE.Vector2(-Math.sign(l.x) * px, 0) : new THREE.Vector2(0, -Math.sign(l.y) * py);
      // Hitting near an end twists it a little.
      const lever = px < py ? l.y / Math.max(hh, 0.1) : -l.x / Math.max(hw, 0.1);
      const torque = clamp(lever * (px < py ? px : py) * 12, -8, 8);
      const w = this.fromLocal(p, push);
      if (this.tipSpeed > HOP_SPEED && this.hopCool <= 0) {
        g.hop(b, p.des);
        this.hopCool = 0.35;
        this.app.hud.toast(`${p.des} jumped. Gently.`, 'warn', 'Tweezers');
      } else {
        g.nudge(b, p.des, w.x, w.y, torque);
      }
    }
  }

  private render() {
    const g = this.app.game;
    const p = this.panel;
    const nodes: Node[] = [];
    if (!p) {
      const next = g.panels.filter((q) => q.stage === 'conv' || q.stage === 'px9').length;
      nodes.push(el('h3', {}, 'Inspection'), el('p', {}, next ? 'Panel on its way from the PX-9…' : 'Nothing coming. The PX-9 might be starved or stopped.'));
      nodes.push(...this.lostPartTools());
      this.side.replaceChildren(...nodes);
      return;
    }
    const job = g.job(p.jobId)!;
    nodes.push(el('h3', {}, `Panel ${job.product.asmIpn}`));
    const behind = g.panels.filter((q) => q.stage === 'conv').length;
    nodes.push(el('p', { style: behind >= 2 ? 'color:#ff8a80' : 'color:#aab' }, behind >= 2 ? '⚠ The PX-9 is backing up behind you.' : 'Panel held. The line behind you keeps going.'));
    const boards = el('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px' });
    p.boards.forEach((bb, i) => {
      const btn = el('button', { class: `btn ${i === this.boardIdx ? 'primary' : ''}` }, bb.serial.split('-')[1]);
      btn.onclick = () => {
        this.dropHeld(false);
        this.boardIdx = i;
        this.showBoard();
        this.render();
      };
      boards.append(btn);
    });
    nodes.push(boards);
    const grip = el('button', { class: `btn ${this.held ? 'primary' : ''}`, style: 'width:100%;margin-bottom:6px' }, this.held ? `Let go of ${this.held.part.des}` : g.hand ? 'Place the loose part (grip)' : 'Grip (right-click / Space)');
    grip.onclick = () => this.onGrip();
    const release = el('button', { class: 'btn good', style: 'width:100%;margin-bottom:10px' }, 'Release panel to oven →');
    release.onclick = () => {
      this.dropHeld(false);
      p.held = false;
      p.t = 99;
      this.app.audio.play('conveyor');
    };
    nodes.push(grip, release);
    if (this.hover) {
      const h = this.hover;
      const erp = h.ipn ? PART_BY_IPN.get(h.ipn) : undefined;
      nodes.push(el('div', { class: 'kv' },
        el('span', {}, 'Designator'), el('span', {}, h.des),
        el('span', {}, 'Package'), el('span', {}, PACKAGES[h.pkg].id),
        el('span', {}, 'Marking'), el('span', {}, h.placed ? (erp?.marking || '(none)') : '-'),
        el('span', {}, 'On the board'), el('span', {}, h.placed ? 'yes' : h.defect === 'flicked' ? 'PINGED OFF' : 'NO'),
        el('span', {}, 'Paste'), el('span', {}, h.paste.map((v) => (v < 0.3 ? '✗' : v > 1.5 ? '▲' : '•')).join(''))));
    }
    nodes.push(...this.lostPartTools());
    nodes.push(el('p', { style: 'color:#778;font-size:12px;margin-top:10px' },
      'Hold left: lower the tip and push a part by its edge. Right-click / Space: grip or let go. Wheel zoom, middle-drag or WASD pan. Two fingers pinch/pan on touch.'));
    this.side.replaceChildren(...nodes);
  }

  private lostPartTools(): Node[] {
    const g = this.app.game;
    const out: Node[] = [];
    if (g.hand) {
      const part = PART_BY_IPN.get(g.hand.ipn);
      out.push(el('div', { class: 'toast good', style: 'margin-top:8px' }, `On your tweezers: a loose ${part?.pkg ?? ''} part${part?.marking ? ` marked "${part.marking}"` : ''}. Hover the empty land and grip to place it.`));
    }
    if (g.floor.length || this.board?.parts.some((q) => q.defect === 'flicked' && !q.placed)) {
      const look = el('button', { class: 'btn', style: 'width:100%;margin-top:8px' }, `🔦 Search the floor (${g.floor.length} lost)`);
      look.onclick = () => this.floor.open();
      out.push(look, el('p', { style: 'color:#aab;font-size:12px' }, 'Or get a fresh one: go to the PX-9, stop it, pull the feeder and dab one out with blue tack.'));
    }
    return out;
  }
}
