import { clamp, el } from '../core/util';
import { Station } from './base';

interface Blob { x: number; y: number; r: number; hp: number; max: number }

/** Reflow oven HMI and the maintenance scrape mini-game. */
export class OvenStation extends Station {
  private left!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private blobs: Blob[] = [];
  private scraper = { x: -100, y: -100, down: false, lx: 0, ly: 0 };
  private t = 0;
  private confirmBin = false;

  build() {
    this.tools = ['scraper'];
    this.left = el('div', { class: 'hmi-panel' });
    this.canvas = el('canvas', { style: 'width:100%;height:100%;border-radius:10px;background:#111;touch-action:none' });
    const right = el('div', { class: 'hmi-panel', style: 'padding:6px' }, this.canvas);
    this.body.append(el('div', { class: 'hmi' }, this.left, right));
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.app.game.line.maintenance) return;
      if (!this.app.useTool('scraper')) return;
      this.scraper.down = true;
      const [x, y] = this.local(e);
      this.scraper.lx = x;
      this.scraper.ly = y;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const [x, y] = this.local(e);
      this.scraper.x = x;
      this.scraper.y = y;
    });
    window.addEventListener('pointerup', () => (this.scraper.down = false));
  }

  status(): string {
    const g = this.app.game;
    if (g.line.maintenance) return 'Maintenance in progress';
    if (g.heat > 85) return `⚠ ${Math.round(g.heat)}% — service it NOW`;
    if (g.heat > 60) return `Running hot: ${Math.round(g.heat)}%`;
    return `${Math.round(g.heat)}%`;
  }

  private local(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  enter() {
    this.render();
  }

  update(dt: number) {
    const g = this.app.game;
    this.t -= dt;
    if (this.t <= 0 && this.canRefresh()) {
      this.t = 0.4;
      this.render();
    }
    if (g.line.maintenance && !this.blobs.length) this.spawnBlobs();
    if (g.line.maintenance && this.scraper.down) {
      const shake = g.stress * 6;
      const sx = this.scraper.x + (Math.random() - 0.5) * shake;
      const sy = this.scraper.y + (Math.random() - 0.5) * shake;
      const moved = Math.hypot(sx - this.scraper.lx, sy - this.scraper.ly);
      this.scraper.lx = sx;
      this.scraper.ly = sy;
      let hit = false;
      for (const b of this.blobs) {
        if (b.hp <= 0) continue;
        if (Math.hypot(b.x - sx, b.y - sy) < b.r + 18) {
          b.hp -= moved * 0.9;
          hit = true;
        }
      }
      if (hit && Math.random() < dt * 8) this.app.audio.play('scrape');
      if (this.blobs.every((b) => b.hp <= 0)) {
        this.blobs = [];
        g.finishMaintenance();
        this.render();
      }
    }
    this.draw();
  }

  private spawnBlobs() {
    const g = this.app.game;
    const n = g.maintenanceBlobs();
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.blobs = [];
    for (let i = 0; i < n; i++) {
      const r = 12 + Math.random() * 26;
      const max = 120 + r * 8 + g.maintCount * 40;
      this.blobs.push({ x: 40 + Math.random() * (w - 80), y: 60 + Math.random() * (h - 100), r, hp: max, max });
    }
  }

  private render() {
    const g = this.app.game;
    const L = g.line;
    const heat = Math.round(g.heat);
    const inside = g.panels.filter((p) => p.stage === 'oven').length;
    const queued = g.panels.filter((p) => p.stage === 'ovenq').length;
    const bar = el('div', { class: 'bigbar' },
      el('i', { style: `width:${clamp(heat, 0, 100)}%;background:${heat > 85 ? 'var(--danger)' : heat > 60 ? 'var(--accent)' : 'var(--good)'}` }),
      el('span', {}, `HEAT / RESIDUE ${heat}%`));
    const feed = el('button', { class: `btn ${L.feedStopped ? 'good' : 'danger'}` }, L.feedStopped ? 'Resume feed' : 'Stop feed');
    feed.onclick = () => {
      L.feedStopped = !L.feedStopped;
      this.app.audio.play('click');
      this.render();
    };
    const bin = el('button', { class: 'btn danger' }, this.confirmBin ? `Really bin ${inside} panel(s)?` : 'Pull & bin boards inside');
    bin.disabled = inside === 0;
    bin.onclick = () => {
      if (!this.confirmBin) {
        this.confirmBin = true;
        this.render();
        setTimeout(() => {
          this.confirmBin = false;
        }, 3000);
        return;
      }
      this.confirmBin = false;
      g.binOven();
      this.render();
    };
    const why = g.canMaintain();
    const maint = el('button', { class: 'btn primary' }, L.maintenance ? 'Maintenance running…' : 'Start maintenance');
    maint.disabled = !!why || L.maintenance;
    maint.onclick = () => {
      if (!this.app.useTool('scraper')) return;
      g.startMaintenance();
      this.blobs = [];
      this.render();
    };
    this.left.replaceChildren(
      el('h3', {}, 'Reflow oven'),
      bar,
      el('div', { class: 'kv', style: 'margin:12px 0' },
        el('span', {}, 'Panels inside'), el('span', {}, String(inside)),
        el('span', {}, 'Waiting at entry'), el('span', {}, String(queued)),
        el('span', {}, 'Services so far'), el('span', {}, String(g.maintCount)),
        el('span', {}, 'Next service'), el('span', {}, `${g.maintenanceBlobs()} residue spots`),
        el('span', {}, 'Heat rate'), el('span', {}, `x${(1 + g.maintCount * 0.45).toFixed(2)}`)),
      el('div', {}, feed, bin, maint),
      el('p', { style: 'color:#aab;font-size:13px' }, why && !L.maintenance ? `To service: ${why}` : L.maintenance ? 'Scrub every residue spot with the scraper. Keep your hand steady.' : 'Ready to service.'),
      el('p', { style: 'color:#778;font-size:12px' }, 'Above 60% boards start to suffer. Above 75% they scorch. At 100% the oven catches fire and you are fired. Every service makes the oven heat faster and the next service longer.'),
    );
  }

  private draw() {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = this.app.game;
    // Oven interior: heater panels and conveyor chain.
    const grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#3a3530');
    grd.addColorStop(1, '#1d1a17');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#4a4540';
    for (let x = 0; x < w; x += 22) for (let y = 20; y < h; y += 22) {
      ctx.beginPath();
      ctx.arc(x + 11, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#777';
    ctx.fillRect(0, h * 0.5 - 4, w, 8);
    ctx.fillRect(0, h * 0.8 - 4, w, 8);
    if (!g.line.maintenance) {
      const heat = g.heat / 100;
      ctx.fillStyle = `rgba(255,${Math.round(120 - heat * 80)},20,${0.15 + heat * 0.5})`;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = '700 20px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(g.line.feedStopped ? 'Feed stopped. Wait for it to empty, then service.' : 'Oven running. Stop the feed to service it.', w / 2, h / 2 - 20);
      ctx.textAlign = 'left';
      return;
    }
    for (const b of this.blobs) {
      if (b.hp <= 0) continue;
      const k = b.hp / b.max;
      ctx.fillStyle = `rgba(${60 + 40 * k},${40 + 20 * k},10,${0.45 + 0.5 * k})`;
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const rr = b.r * (0.75 + 0.25 * Math.sin(a * 3 + b.x)) * (0.5 + 0.5 * k);
        const x = b.x + Math.cos(a) * rr;
        const y = b.y + Math.sin(a) * rr;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.fill();
    }
    const left = this.blobs.filter((b) => b.hp > 0).length;
    ctx.fillStyle = '#fff';
    ctx.font = '700 16px system-ui';
    ctx.fillText(`Residue spots left: ${left}`, 12, 22);
    // Scraper
    ctx.save();
    ctx.translate(this.scraper.x, this.scraper.y);
    ctx.rotate(-0.5);
    ctx.fillStyle = '#c9ced4';
    ctx.fillRect(-22, -4, 44, 8);
    ctx.fillStyle = '#e8732c';
    ctx.fillRect(-6, 4, 12, 50);
    ctx.restore();
  }
}
