import { el } from '../core/util';
import { PACKAGES, PART_BY_IPN } from '../sim/parts';
import type { Panel, PlacedPart } from '../sim/types';
import { BenchStation } from './benchbase';

/**
 * Manual inspection after the PX-9. Hold the panel, zoom in, nudge parts with tweezers.
 * Hands shake more as stress rises. Push too far and the part is gone.
 */
export class InspectStation extends BenchStation {
  private side!: HTMLElement;
  private panel: Panel | null = null;
  private boardIdx = 0;
  private grab: { part: PlacedPart; lastX: number; lastY: number } | null = null;
  private t = 0;

  build() {
    this.tools = ['tweezers'];
    this.initBench();
    this.side = el('div', { class: 'side right' });
    this.body.append(this.side);
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
    if (this.panel) this.panel.held = false;
    this.panel = null;
    this.grab = null;
    this.setBoard(null, null);
  }

  private sync() {
    const g = this.app.game;
    const at = g.panels.find((p) => p.stage === 'inspect') ?? null;
    if (at !== this.panel) {
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
    const b = this.app.bench.inst;
    if (!b || !this.hover || !this.hover.placed || b.reflowed) return;
    if (!this.app.useTool('tweezers')) return;
    this.app.bench.setTool('tweezers');
    this.updateNdc(e);
    const c = this.app.bench.cursorBoard();
    this.grab = { part: this.hover, lastX: c.x, lastY: c.y };
    this.app.audio.play('click');
  }

  protected onRelease() {
    this.grab = null;
  }

  update(dt: number) {
    super.update(dt);
    const g = this.app.game;
    this.sync();
    const b = this.app.bench.inst;
    this.app.bench.setTool(g.line && this.app.toolAt.tweezers === this.spot.id ? 'tweezers' : null);
    if (this.grab && b) {
      const c = this.app.bench.cursorBoard();
      // Tremor: grows with stress, always a little bit there.
      const tremor = 0.02 + g.stress * g.stress * 0.35;
      const dx = c.x - this.grab.lastX + (Math.random() - 0.5) * tremor;
      const dy = c.y - this.grab.lastY + (Math.random() - 0.5) * tremor;
      this.grab.lastX = c.x;
      this.grab.lastY = c.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.0005) {
        const flicked = g.nudge(b, this.grab.part.des, dx, dy);
        if (flicked) {
          this.app.hud.toast(`${this.grab.part.des} pinged off into the void. (That goes in the dump bin... eventually.)`, 'bad', 'Tweezers');
          this.grab = null;
        }
      }
    }
    this.t -= dt;
    if (this.t <= 0 && this.canRefresh()) {
      this.t = 0.3;
      this.render();
    }
  }

  private render() {
    const g = this.app.game;
    const p = this.panel;
    const nodes: Node[] = [];
    if (!p) {
      const next = g.panels.filter((q) => q.stage === 'conv' || q.stage === 'px9').length;
      nodes.push(el('h3', {}, 'Inspection'), el('p', {}, next ? 'Panel on its way from the PX-9…' : 'Nothing coming. The PX-9 might be starved or stopped.'));
      this.side.replaceChildren(...nodes);
      return;
    }
    const job = g.job(p.jobId)!;
    const b = p.boards[this.boardIdx];
    nodes.push(el('h3', {}, `Panel ${job.product.asmIpn}`));
    const behind = g.panels.filter((q) => q.stage === 'conv').length;
    nodes.push(el('p', { style: behind >= 2 ? 'color:#ff8a80' : 'color:#aab' }, behind >= 2 ? '⚠ The PX-9 is backing up behind you.' : 'Panel held. The line behind you keeps going.'));
    const boards = el('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px' });
    p.boards.forEach((bb, i) => {
      const btn = el('button', { class: `btn ${i === this.boardIdx ? 'primary' : ''}` }, bb.serial.split('-')[1]);
      btn.onclick = () => {
        this.boardIdx = i;
        this.showBoard();
        this.render();
      };
      boards.append(btn);
    });
    nodes.push(boards);
    const release = el('button', { class: 'btn good', style: 'width:100%;margin-bottom:10px' }, 'Release panel to oven →');
    release.onclick = () => {
      p.held = false;
      p.t = 99;
      this.app.audio.play('conveyor');
    };
    nodes.push(release);
    if (this.hover) {
      const h = this.hover;
      const erp = h.ipn ? PART_BY_IPN.get(h.ipn) : undefined;
      nodes.push(el('div', { class: 'kv' },
        el('span', {}, 'Designator'), el('span', {}, h.des),
        el('span', {}, 'Package'), el('span', {}, PACKAGES[h.pkg].id),
        el('span', {}, 'Marking'), el('span', {}, h.placed ? (erp?.marking || '(none)') : '-'),
        el('span', {}, 'Placed'), el('span', {}, h.placed ? 'yes' : h.defect === 'flicked' ? 'FLICKED OFF' : 'NO'),
        el('span', {}, 'Paste'), el('span', {}, h.paste.map((v) => (v < 0.3 ? '✗' : v > 1.5 ? '▲' : '•')).join(''))));
    }
    nodes.push(el('p', { style: 'color:#778;font-size:12px;margin-top:10px' },
      'Wheel/+- zoom · right-drag or WASD pan · hold left on a part to grab it with tweezers and nudge it onto its pads. Stressed hands shake.'));
    void b;
    this.side.replaceChildren(...nodes);
  }
}
