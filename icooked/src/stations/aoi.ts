import { el, fmtTime } from '../core/util';
import { Station } from './base';

/** AOI program scope selection and results. */
export class AoiStation extends Station {
  private win!: HTMLElement;
  private t = 0;

  build() {
    this.win = el('div', { class: 'side left', style: 'background:#0a0f14;border-color:#1f3a2a;font-family:var(--mono);color:#b8ffd0;width:min(460px,calc(100vw - 20px))' });
    this.body.append(this.win);
  }

  status(): string {
    return `Program: ${this.app.game.line.aoiScope}`;
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
    const L = g.line;
    const scope = (s: 'critical' | 'full', label: string, desc: string) => {
      const b = el('button', { class: `btn ${L.aoiScope === s ? 'good' : ''}`, style: 'display:block;width:100%;text-align:left;margin-bottom:6px' }, el('b', {}, label), el('br'), el('small', {}, desc));
      b.onclick = () => {
        L.aoiScope = s;
        this.app.audio.play('click');
        this.render();
      };
      return b;
    };
    const log = g.testLog.filter((r) => r.lights === -1 || r.aoi.length).slice(0, 14);
    this.win.replaceChildren(
      el('h3', { style: 'color:#39ff88' }, 'AOI-3000 inspection program'),
      scope('critical', 'Critical parts only (fast)', 'ICs, connectors, crystals. Chip parts are not checked. ~2.5 s/panel'),
      scope('full', 'Full board (slow)', 'Every part. Catches more. ~3 s + 35 ms per part, per panel. Can bottleneck the line.'),
      el('p', { style: 'color:#6a8' }, 'AOI sees shapes, not values. A wrong-value part that looks identical will pass. Failures go straight to the rework rack.'),
      el('h3', { style: 'color:#39ff88' }, 'Recent fails'),
      ...(log.length ? log.map((r) => el('div', { class: 'list-item bad', style: 'background:#141c22' }, `${fmtTime(r.t)}  ${r.serial}  ${r.aoi.join(', ') || 'test fail'}`)) : [el('p', {}, 'No fails yet. Suspicious.')]),
    );
  }
}
