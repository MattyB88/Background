import { el } from '../core/util';
import { LIBRARY, PACKAGES, PART_BY_IPN } from '../sim/parts';
import type { BoardInst, PlacedPart } from '../sim/types';
import { BenchStation } from './benchbase';

/**
 * Rework bench: find the fault, fix it with the iron or replace the part.
 * Recover some of the points that board was worth.
 */
export class ReworkStation extends BenchStation {
  private left!: HTMLElement;
  private right!: HTMLElement;
  private board: BoardInst | null = null;
  private selected: PlacedPart | null = null;
  private heating: { part: PlacedPart; t: number } | null = null;
  private t = 0;
  private lastLights: number | null = null;

  build() {
    this.tools = ['iron', 'tweezers'];
    this.initBench();
    this.left = el('div', { class: 'side left' });
    this.right = el('div', { class: 'side right' });
    this.body.append(this.left, this.right);
  }

  status(): string {
    const n = this.app.game.rework.length;
    return n ? `${n} board(s) in the rework rack` : 'Rack is empty';
  }

  enter() {
    this.board = null;
    this.selected = null;
    this.lastLights = null;
    const first = this.app.game.rework[0];
    if (first) this.pick(first);
    else this.setBoard(null, null);
    this.render();
  }

  leave() {
    super.leave();
    this.setBoard(null, null);
    this.heating = null;
  }

  private pick(b: BoardInst) {
    this.board = b;
    this.selected = null;
    this.lastLights = null;
    const def = this.app.game.job(b.jobId)!.product.board;
    this.setBoard(def, b);
  }

  protected onPress() {
    const b = this.board;
    if (!b || !this.hover) return;
    this.selected = this.hover;
    if (this.hover.placed && this.app.toolAt.iron === this.spot.id) {
      this.heating = { part: this.hover, t: 0 };
      this.app.audio.play('sizzle');
    }
    this.render();
  }

  protected onRelease() {
    this.heating = null;
  }

  update(dt: number) {
    super.update(dt);
    const g = this.app.game;
    this.app.bench.setTool(this.app.toolAt.iron === this.spot.id ? 'iron' : this.app.toolAt.tweezers === this.spot.id ? 'tweezers' : null);
    if (this.heating && this.board) {
      if (this.hover !== this.heating.part) {
        this.heating = null;
      } else {
        this.heating.t += dt;
        if (this.heating.t > 1.2) {
          const r = g.reworkFix(this.board, this.heating.part.des);
          this.app.audio.play(r === 'fixed' ? 'click' : 'bad');
          if (r === 'slipped') this.app.hud.toast('Your hand slipped and nudged a neighbour. Steady…', 'warn', 'Rework');
          else if (r === 'fixed') this.app.hud.toast(`Reflowed ${this.heating.part.des}.`, 'info', 'Rework');
          this.heating = null;
          this.render();
        }
      }
    }
    if (this.board && !g.rework.includes(this.board)) {
      this.board = null;
      const next = g.rework[0];
      if (next) this.pick(next);
      else this.setBoard(null, null);
      this.render();
    }
    this.t -= dt;
    if (this.t <= 0 && this.canRefresh()) {
      this.t = 0.4;
      this.render();
    }
  }

  private render() {
    const g = this.app.game;
    // Rack list
    const rack: Node[] = [el('h3', {}, `Rework rack (${g.rework.length})`)];
    for (const b of g.rework.slice(0, 30)) {
      const lights = b.lights < 0 ? 'AOI' : '●'.repeat(b.lights) + '○'.repeat(3 - b.lights);
      const it = el('div', { class: `list-item${b === this.board ? ' sel' : ''}` }, `${b.serial}  ${lights}  ${b.aoiFlags.length ? b.aoiFlags.join(',') : ''}`);
      it.onclick = () => {
        this.pick(b);
        this.render();
      };
      rack.push(it);
    }
    if (!g.rework.length) rack.push(el('p', {}, 'Empty. Enjoy it while it lasts.'));
    rack.push(el('h3', { style: 'margin-top:14px' }, 'Your notes'), el('pre', { class: 'note-paper', style: 'white-space:pre-wrap;padding:8px;border-radius:4px;min-height:60px;font-size:12px' }, g.notes || '(nothing written. press N to write notes any time)'));
    this.left.replaceChildren(...rack);

    // Board detail
    const b = this.board;
    const nodes: Node[] = [];
    if (!b) {
      this.right.replaceChildren(el('h3', {}, 'No board selected'));
      return;
    }
    const job = g.job(b.jobId)!;
    nodes.push(el('h3', {}, b.serial), el('div', { class: 'kv' },
      el('span', {}, 'Job'), el('span', {}, job.product.asmIpn),
      el('span', {}, 'Test'), el('span', {}, b.lights < 0 ? 'not tested (AOI fail)' : `${b.lights}/3 lights`),
      el('span', {}, 'AOI flags'), el('span', {}, b.aoiFlags.join(', ') || 'none'),
      el('span', {}, 'Reworks'), el('span', {}, String(b.reworks))));
    if (b.aoiFlags.length) {
      const flags = el('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin:6px 0' });
      for (const d of b.aoiFlags) {
        const p = b.parts.find((q) => q.des === d);
        const btn = el('button', { class: 'btn' }, `🔍 ${d}`);
        btn.onclick = () => p && this.app.bench.focusOn(p.x, p.y, 25);
        flags.append(btn);
      }
      nodes.push(flags);
    }
    if (b.scorch > 0.5) nodes.push(el('p', { style: 'color:#ff8a80' }, 'This board is scorched. No amount of rework saves it.'));
    const sel = this.selected;
    if (sel) {
      const erp = sel.ipn ? PART_BY_IPN.get(sel.ipn) : undefined;
      const prog = job.program?.desIpn[sel.des] ?? '(not in program)';
      nodes.push(el('h3', { style: 'margin-top:12px' }, `Selected ${sel.des}`), el('div', { class: 'kv' },
        el('span', {}, 'Package'), el('span', {}, sel.pkg),
        el('span', {}, 'Marking'), el('span', {}, sel.placed ? (erp?.marking || '(unmarked)') : '(no part)'),
        el('span', {}, 'Program says'), el('span', {}, `${prog}`),
        el('span', {}, ''), el('span', { style: 'color:#aab' }, prog && PART_BY_IPN.get(prog) ? PART_BY_IPN.get(prog)!.desc : '')));
      const replace = el('select', { style: 'width:100%;margin-top:6px;padding:4px' }) as HTMLSelectElement;
      replace.append(el('option', { value: '' }, 'Replace with… (needs tweezers)'));
      for (const p of LIBRARY.filter((q) => q.pkg === sel.pkg)) replace.append(el('option', { value: p.ipn }, `${p.ipn}  ${p.desc}`));
      replace.onchange = () => {
        if (!replace.value) return;
        if (!this.app.useTool('tweezers')) return;
        const err = g.reworkReplace(b, sel.des, replace.value);
        if (err) this.app.hud.toast(err, 'warn', 'Rework');
        else this.app.hud.toast(`Replaced ${sel.des} with ${replace.value}.`, 'info', 'Rework');
        this.render();
      };
      nodes.push(replace);
      if (this.heating) nodes.push(el('div', { class: 'meter', style: 'height:10px;margin-top:8px' }, el('i', { style: `width:${Math.min(100, (this.heating.t / 1.2) * 100)}%;background:var(--accent)` })));
    }
    const iron = el('button', { class: 'btn' }, this.app.toolAt.iron === this.spot.id ? '🔥 Iron is out (hold on a part)' : 'Take out the iron');
    iron.onclick = () => {
      this.app.useTool('iron');
      this.render();
    };
    const retest = el('button', { class: 'btn primary' }, 'Retest on jig');
    retest.onclick = () => {
      this.lastLights = g.retest(b);
      this.render();
    };
    const scrap = el('button', { class: 'btn danger' }, 'Scrap it');
    scrap.onclick = () => {
      g.scrapBoard(b);
      this.render();
    };
    nodes.push(el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:12px' }, iron, retest, scrap));
    if (this.lastLights !== null && this.lastLights < 3) nodes.push(el('p', { style: 'color:#ff8a80' }, `Retest: ${this.lastLights}/3 lights. Still broken.`));
    nodes.push(el('p', { style: 'color:#778;font-size:12px;margin-top:10px' },
      'Iron: hold left on a tombstoned, bridged, dry or crooked part for a second. Wrong or missing part: select it and replace it. Compare markings with what the program says. Check your notes.'));
    void PACKAGES;
    this.right.replaceChildren(...nodes);
  }
}
