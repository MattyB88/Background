import { clamp, el } from '../core/util';
import { PACKAGES, PART_BY_IPN } from '../sim/parts';
import type { Job } from '../sim/types';
import { toBoard } from '../render/boardpaint';
import { Station } from './base';

interface PadGeom { x: number; y: number; w: number; h: number; idx: number }
interface Sample { x: number; y: number; t: number }

/**
 * Stencil print set-up. Drag the squeegee across in one smooth, steady stroke.
 * Too slow = too much paste, too fast = not enough, jerky = skipped pads.
 */
export class PrinterStation extends Station {
  private canvas!: HTMLCanvasElement;
  private side!: HTMLElement;
  private job: Job | null = null;
  private pads: PadGeom[] = [];
  private result: number[] | null = null;
  private samples: Sample[] = [];
  private stroking = false;
  private mode: 'stroke' | 'dab' = 'stroke';
  private dabPad: number | null = null;
  private view = { ox: 0, oy: 0, s: 1 };
  private raf = 0;

  build() {
    this.tools = ['syringe'];
    this.canvas = el('canvas');
    this.side = el('div', { class: 'side right', style: 'position:relative;inset:auto;width:320px;flex-shrink:0' });
    this.body.append(el('div', { class: 'stencil-wrap' }, this.canvas, this.side));
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', () => this.up());
  }

  status(): string {
    const g = this.app.game;
    const j = g.activeJob;
    if (g.line.printerDirt > 0.6) return 'Stencil needs a wipe';
    if (j && !j.printProfile) return `Needs print set-up for ${j.product.asmIpn}`;
    return '';
  }

  enter() {
    const g = this.app.game;
    const cands = this.candidates();
    this.job = cands.find((j) => !j.printProfile) ?? g.activeJob ?? cands[0] ?? null;
    this.loadJob();
  }

  private candidates(): Job[] {
    const g = this.app.game;
    const list = g.jobs.filter((j) => j.status === 'running' || j.status === 'ready');
    return list.sort((a, b) => (a.status === 'running' ? -1 : 0) - (b.status === 'running' ? -1 : 0));
  }

  private loadJob() {
    this.pads = [];
    this.result = this.job?.printProfile ? [...this.job.printProfile] : null;
    if (this.job) {
      let idx = 0;
      for (const pl of this.job.product.board.placements) {
        const pkg = PACKAGES[PART_BY_IPN.get(pl.ipn)!.pkg];
        for (const pad of pkg.pads) {
          const [x, y] = toBoard(pad.x, pad.y, pl.x, pl.y, pl.rot);
          const swap = pl.rot % 180 !== 0;
          this.pads.push({ x, y, w: swap ? pad.h : pad.w, h: swap ? pad.w : pad.h, idx: idx++ });
        }
      }
    }
    this.renderSide();
    this.draw();
  }

  private renderSide() {
    const g = this.app.game;
    const nodes: Node[] = [el('h3', {}, 'Print set-up')];
    const sel = el('select', { style: 'width:100%;padding:4px;margin-bottom:8px' }) as HTMLSelectElement;
    for (const j of this.candidates()) {
      const o = el('option', { value: String(j.id) }, `${j.product.asmIpn} ${j.printProfile ? '(set)' : '(NOT SET)'}`) as HTMLOptionElement;
      if (j === this.job) o.selected = true;
      sel.append(o);
    }
    sel.onchange = () => {
      this.job = g.job(Number(sel.value)) ?? null;
      this.loadJob();
    };
    nodes.push(sel);
    if (!this.job) {
      nodes.push(el('p', {}, 'No programmed jobs. Nothing to print.'));
      this.side.replaceChildren(...nodes);
      return;
    }
    nodes.push(el('p', { style: 'color:#aab' }, 'Press on the paste bead (left) and drag the squeegee to the right edge in one smooth, steady stroke. Not too slow, not too fast.'));
    if (this.result) {
      const r = this.result;
      const good = r.filter((v) => v >= 0.7 && v <= 1.35).length;
      const low = r.filter((v) => v < 0.7).length;
      const high = r.filter((v) => v > 1.35).length;
      nodes.push(el('div', { class: 'kv' },
        el('span', {}, 'Good pads'), el('span', {}, `${good}/${r.length}`),
        el('span', {}, 'Low / missing'), el('span', { style: low ? 'color:#ff8a80' : '' }, String(low)),
        el('span', {}, 'Too much'), el('span', { style: high ? 'color:#ffb21a' : '' }, String(high))));
      const dab = el('button', { class: `btn ${this.mode === 'dab' ? 'primary' : ''}`, style: 'margin-top:8px' }, this.mode === 'dab' ? 'Dabbing: hold on a pad' : 'Dab paste with syringe');
      dab.onclick = () => {
        if (!this.app.useTool('syringe')) return;
        this.mode = this.mode === 'dab' ? 'stroke' : 'dab';
        this.renderSide();
      };
      const retry = el('button', { class: 'btn', style: 'margin-top:8px' }, 'Wipe & reprint');
      retry.onclick = () => {
        this.result = null;
        this.mode = 'stroke';
        this.app.audio.play('wipe');
        this.renderSide();
        this.draw();
      };
      const accept = el('button', { class: 'btn primary', style: 'margin-top:8px' }, 'Accept print set-up');
      accept.onclick = () => {
        g.setPrintProfile(this.job!, [...r]);
        this.app.hud.toast(`Print set-up saved for ${this.job!.product.asmIpn}.`, 'good', 'Printer');
        this.app.audio.play('good');
        this.renderSide();
      };
      nodes.push(el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' }, dab, retry, accept));
      if (this.job.printProfile) nodes.push(el('p', { style: 'color:#3ad06a' }, '✓ This job has a saved set-up.'));
    }
    nodes.push(el('h3', { style: 'margin-top:16px' }, 'Stencil'));
    const dirt = Math.round(g.line.printerDirt * 100);
    const wipe = el('button', { class: 'btn' }, 'Wipe stencil (under-wipe)');
    wipe.onclick = () => {
      g.wipeStencil();
      this.renderSide();
    };
    nodes.push(el('div', { class: 'kv' }, el('span', {}, 'Dirt'), el('span', { style: dirt > 60 ? 'color:#ff8a80' : '' }, `${dirt}%`)), wipe);
    nodes.push(el('p', { style: 'color:#778;font-size:12px' }, 'A missed pad on a chip part → tombstones. On an IC → dry joints. Too much on fine pitch → bridges.'));
    this.side.replaceChildren(...nodes);
  }

  private layout() {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const def = this.job?.product.board;
    if (!def) return;
    const margin = 0.16;
    const s = Math.min((w * (1 - margin * 2)) / def.w, (h * 0.8) / def.h);
    this.view = { s, ox: (w - def.w * s) / 2, oy: (h - def.h * s) / 2 };
  }

  private toCanvas(x: number, y: number): [number, number] {
    const def = this.job!.product.board;
    return [this.view.ox + x * this.view.s, this.view.oy + (def.h - y) * this.view.s];
  }

  private local(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private down(e: PointerEvent) {
    if (!this.job) return;
    const [x, y] = this.local(e);
    if (this.mode === 'dab' && this.result) {
      this.dabPad = this.padAt(x, y);
      if (this.dabPad !== null) this.loopDab();
      return;
    }
    if (this.result) return;
    if (x > this.view.ox + 20) {
      this.app.hud.toast('Start the stroke on the paste bead at the left edge.', 'info', 'Printer');
      return;
    }
    this.stroking = true;
    this.samples = [{ x, y, t: performance.now() / 1000 }];
    this.canvas.setPointerCapture(e.pointerId);
    this.app.audio.play('squeegee');
  }

  private move(e: PointerEvent) {
    if (!this.stroking) return;
    const [x, y] = this.local(e);
    const last = this.samples[this.samples.length - 1];
    if (x < last.x) return;
    this.samples.push({ x, y, t: performance.now() / 1000 });
    this.draw();
    const def = this.job!.product.board;
    if (x > this.view.ox + def.w * this.view.s + 10) this.finishStroke();
  }

  private up() {
    if (this.stroking) this.finishStroke();
    this.dabPad = null;
  }

  private loopDab() {
    cancelAnimationFrame(this.raf);
    let last = performance.now();
    const step = () => {
      if (this.dabPad === null || !this.result) return;
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const jitter = 1 + (Math.random() - 0.5) * this.app.game.stress;
      this.result[this.dabPad] = clamp(this.result[this.dabPad] + dt * 0.9 * jitter, 0, 2.2);
      this.draw();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
    const stop = () => {
      window.removeEventListener('pointerup', stop);
      this.renderSide();
    };
    window.addEventListener('pointerup', stop);
  }

  private padAt(x: number, y: number): number | null {
    let best: number | null = null;
    let bd = 12;
    for (const p of this.pads) {
      const [cx, cy] = this.toCanvas(p.x, p.y);
      const d = Math.hypot(cx - x, cy - y);
      if (d < bd) {
        bd = d;
        best = p.idx;
      }
    }
    return best;
  }

  private finishStroke() {
    this.stroking = false;
    const def = this.job!.product.board;
    const S = this.samples;
    const width = def.w * this.view.s;
    const total = S[S.length - 1].t - S[0].t;
    // Ideal: cross the board in ~1.6 s. Speed is measured locally.
    const ideal = width / 1.6;
    const res: number[] = new Array(this.pads.length).fill(0);
    for (const p of this.pads) {
      const [cx] = this.toCanvas(p.x, p.y);
      let i = S.findIndex((s) => s.x >= cx);
      if (i < 0) {
        res[p.idx] = 0; // stroke never got here
        continue;
      }
      i = Math.max(1, i);
      const a = S[Math.max(0, i - 3)];
      const b = S[Math.min(S.length - 1, i + 3)];
      const dx = Math.max(1, b.x - a.x);
      const v = dx / Math.max(0.001, b.t - a.t);
      const jerk = Math.abs(b.y - a.y) / dx;
      const k = v / ideal;
      let paste = 1;
      if (k < 0.6) paste = 1 + (0.6 - k) * 1.6;
      else if (k > 1.6) paste = 1 - (k - 1.6) * 0.45;
      if (jerk > 0.7) paste *= 0.15;
      else if (jerk > 0.35) paste *= 0.7;
      paste *= 1 + (Math.random() - 0.5) * 0.08;
      res[p.idx] = clamp(paste, 0, 2.2);
    }
    this.result = res;
    this.app.audio.play('print');
    if (total < 0.5) this.app.hud.toast('Way too fast. Paste went everywhere except the pads.', 'warn', 'Printer');
    this.renderSide();
    this.draw();
  }

  update() {
    this.draw();
  }

  private draw() {
    this.layout();
    const c = this.canvas;
    const ctx = c.getContext('2d')!;
    const dpr = c.width / Math.max(1, c.clientWidth);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = c.clientWidth;
    const h = c.clientHeight;
    // Brushed stainless stencil
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#9aa0a6');
    g.addColorStop(0.5, '#c6cbd0');
    g.addColorStop(1, '#8d9399');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.08;
    for (let y = 0; y < h; y += 3) {
      ctx.fillStyle = y % 6 ? '#fff' : '#000';
      ctx.fillRect(0, y, w, 1);
    }
    ctx.globalAlpha = 1;
    if (!this.job) return;
    const def = this.job.product.board;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.strokeRect(this.view.ox, this.view.oy, def.w * this.view.s, def.h * this.view.s);
    const s = this.view.s;
    for (const p of this.pads) {
      const [cx, cy] = this.toCanvas(p.x, p.y);
      const v = this.result?.[p.idx];
      if (v === undefined) {
        ctx.fillStyle = '#23262a';
      } else if (v < 0.25) ctx.fillStyle = '#ff2a1a';
      else if (v < 0.7) ctx.fillStyle = '#ffb21a';
      else if (v > 1.6) ctx.fillStyle = '#c05cff';
      else if (v > 1.35) ctx.fillStyle = '#ffd96a';
      else ctx.fillStyle = '#3ad06a';
      const pw = Math.max(2, p.w * s);
      const ph = Math.max(2, p.h * s);
      ctx.fillRect(cx - pw / 2, cy - ph / 2, pw, ph);
      if (this.dabPad === p.idx) {
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(cx - pw / 2 - 2, cy - ph / 2 - 2, pw + 4, ph + 4);
      }
    }
    // Squeegee + paste bead
    const x = this.stroking ? this.samples[this.samples.length - 1].x : this.result ? this.view.ox + def.w * s + 14 : this.view.ox - 18;
    const top = this.view.oy - 16;
    const bot = this.view.oy + def.h * s + 16;
    ctx.fillStyle = '#7d8187';
    ctx.beginPath();
    ctx.ellipse(x + 10, (top + bot) / 2, 9, (bot - top) / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1d20';
    ctx.fillRect(x - 6, top - 10, 10, bot - top + 20);
    ctx.fillStyle = '#e7e9ec';
    ctx.fillRect(x + 2, top - 10, 3, bot - top + 20);
    if (!this.result && !this.stroking) {
      ctx.fillStyle = '#111';
      ctx.font = '600 15px system-ui';
      ctx.fillText('Grab the squeegee here →', Math.max(8, this.view.ox - 200), top - 22);
    }
    if (this.stroking && this.samples.length > 2) {
      ctx.strokeStyle = 'rgba(255,178,26,0.7)';
      ctx.beginPath();
      this.samples.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
    if (this.result) {
      ctx.fillStyle = '#111';
      ctx.font = '600 13px system-ui';
      ctx.fillText('SPI: green ok · yellow low · red missing · light-yellow heavy · purple way too much', 12, h - 12);
    }
  }
}
