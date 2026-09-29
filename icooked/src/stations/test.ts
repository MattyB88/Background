import { el, fmtTime } from '../core/util';
import { Station } from './base';

/** Functional test jig: 3 lights good, 2 = one fault, 1 = two or more. */
export class TestStation extends Station {
  private win!: HTMLElement;
  private t = 0;

  build() {
    this.win = el('div', { class: 'side left', style: 'width:min(420px,calc(100vw - 20px))' });
    this.body.append(this.win);
  }

  status(): string {
    const g = this.app.game;
    return g.rework.length ? `${g.rework.length} board(s) waiting for rework` : '';
  }

  enter() {
    this.render();
  }

  update(dt: number) {
    this.t -= dt;
    if (this.t <= 0 && this.canRefresh()) {
      this.t = 0.5;
      this.render();
    }
  }

  private render() {
    const g = this.app.game;
    const lamps = (n: number) => (n < 0 ? 'AOI FAIL' : '●'.repeat(n) + '○'.repeat(3 - n));
    const pass = g.testLog.filter((r) => r.lights === 3).length;
    this.win.replaceChildren(
      el('h3', {}, 'Test jig log'),
      el('p', { style: 'color:#aab' }, '3 lights = ship it. 2 = one fault. 1 = two or more. Failures go to the rework rack.'),
      el('div', { class: 'kv', style: 'margin-bottom:10px' },
        el('span', {}, 'Shipped'), el('span', {}, String(g.stats.shipped)),
        el('span', {}, 'First-pass'), el('span', {}, String(g.stats.firstPass)),
        el('span', {}, 'Recent pass rate'), el('span', {}, g.testLog.length ? `${Math.round((pass / g.testLog.length) * 100)}%` : '-'),
        el('span', {}, 'Streak bonus'), el('span', {}, `x${(1 + Math.min(2, g.streak * 0.1)).toFixed(1)}`)),
      ...g.testLog.slice(0, 18).map((r) => el('div', { class: `list-item${r.lights === 3 ? '' : ' bad'}` }, `${fmtTime(r.t)}  ${r.serial}  `, el('span', { style: `color:${r.lights === 3 ? '#3ad06a' : '#ff8a80'}` }, lamps(r.lights)))),
    );
  }
}
