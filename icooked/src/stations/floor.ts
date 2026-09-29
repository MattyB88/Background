import { el } from '../core/util';
import type { App } from '../app';
import { PACKAGES, PART_BY_IPN } from '../sim/parts';

interface Item { x: number; y: number; kind: 'part' | 'junk'; idx: number; w: number; h: number; col: string; rot: number; label: string }

/** Torch-lit hunt for a pinged part on the factory floor. Everything tiny looks the same down here. */
export class FloorSearch {
  readonly root = el('div', { class: 'floor-search' });
  private canvas = el('canvas');
  private items: Item[] = [];
  private mouse = { x: -999, y: -999 };
  private raf = 0;
  private seed = 1;

  constructor(private app: App, private onDone: () => void) {
    const close = el('button', { class: 'btn', style: 'position:absolute;right:12px;top:12px' }, 'Give up and stand up');
    close.onclick = () => this.close();
    this.root.append(this.canvas, close, el('div', { class: 'floor-hint' }, 'Sweep the torch. Click a part to pick it up with your tweezers.'));
    this.root.style.display = 'none';
    this.canvas.addEventListener('pointermove', (e) => this.moveTo(e));
    this.canvas.addEventListener('pointerdown', (e) => {
      this.moveTo(e);
      this.pick();
    });
  }

  private moveTo(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  open() {
    const g = this.app.game;
    this.root.style.display = '';
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.seed = 1 + Math.floor(g.t * 13) % 100000;
    this.items = [];
    g.floor.forEach((ipn, idx) => {
      const p = PART_BY_IPN.get(ipn)!;
      const pk = PACKAGES[p.pkg];
      const s = 5;
      this.items.push({ x: 40 + this.rand() * (w - 80), y: 60 + this.rand() * (h - 120), kind: 'part', idx, w: Math.max(3, pk.w * s), h: Math.max(2, pk.h * s), col: p.body, rot: this.rand() * Math.PI, label: p.marking });
    });
    const junk = ['#b9bcc2', '#8a8a8a', '#d8d2c0', '#1b1b1b', '#a88a5e', '#c9a13a'];
    for (let i = 0; i < 70; i++) {
      const col = junk[Math.floor(this.rand() * junk.length)];
      this.items.push({ x: this.rand() * w, y: this.rand() * h, kind: 'junk', idx: -1, w: 2 + this.rand() * 8, h: 1.5 + this.rand() * 4, col, rot: this.rand() * Math.PI, label: '' });
    }
    cancelAnimationFrame(this.raf);
    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  close() {
    cancelAnimationFrame(this.raf);
    this.root.style.display = 'none';
    this.onDone();
  }

  private pick() {
    const g = this.app.game;
    let best: Item | null = null;
    let bd = 14;
    for (const it of this.items) {
      const d = Math.hypot(it.x - this.mouse.x, it.y - this.mouse.y);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    if (!best) return;
    if (best.kind === 'junk') {
      this.app.hud.toast(['A solder ball.', 'A cut lead.', 'Somebody\'s fingernail. Gross.', 'Dust. Very old dust.', 'A screw from something important.'][Math.floor(this.rand() * 5)], 'info', 'Floor');
      this.items = this.items.filter((i) => i !== best);
      return;
    }
    const ipn = g.floorPick(best.idx);
    if (ipn) {
      const p = PART_BY_IPN.get(ipn)!;
      this.app.hud.toast(`Found a ${p.pkg} part${p.marking ? ` marked "${p.marking}"` : ' (unmarked)'}. Is it the right one? Only you know.`, 'good', 'Floor');
    }
    this.close();
  }

  private draw() {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#5d6166';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(30,32,35,0.5)';
    for (let x = 0; x < w; x += 160) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 160) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (const it of this.items) {
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.rotate(it.rot);
      ctx.fillStyle = it.col;
      ctx.fillRect(-it.w / 2, -it.h / 2, it.w, it.h);
      if (it.kind === 'part') {
        ctx.fillStyle = '#d7dade';
        ctx.fillRect(-it.w / 2, -it.h / 2, Math.max(1, it.w * 0.2), it.h);
        ctx.fillRect(it.w / 2 - Math.max(1, it.w * 0.2), -it.h / 2, Math.max(1, it.w * 0.2), it.h);
      }
      ctx.restore();
    }
    // Torch: everything outside the beam is nearly black.
    const g = ctx.createRadialGradient(this.mouse.x, this.mouse.y, 20, this.mouse.x, this.mouse.y, 150);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.93)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}
