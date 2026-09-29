import { el, fmtMoney, fmtTime } from '../core/util';
import { Station } from './base';

/** The PX-9 production screen: pick the next job, watch alarms. */
export class Px9Station extends Station {
  private win!: HTMLElement;
  private t = 0;

  build() {
    this.win = el('div', { class: 'win-body' });
    const w = el('div', { class: 'win', style: 'left:10px;top:10px;width:min(560px,calc(100vw - 20px));max-height:calc(100% - 20px)' },
      el('div', { class: 'win-title' }, 'PX-9 Production Manager  —  /opt/px9/bin/prodman'),
      this.win);
    w.style.fontFamily = 'var(--mono)';
    w.style.color = '#111';
    this.body.append(w);
  }

  status(): string {
    const g = this.app.game;
    if (g.line.px9Alarm) return `⚠ ${g.line.px9Alarm}`;
    if (!g.activeJob) return 'Idle — choose a job';
    return `Running ${g.activeJob.product.asmIpn}`;
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
    const j = g.activeJob;
    const nodes: Node[] = [];
    if (L.px9Alarm) {
      nodes.push(el('div', { class: 'inset', style: 'background:#c0231a;color:#fff;font-weight:700;margin-bottom:8px' },
        `MACHINE STOPPED: ${L.px9Alarm}`, el('br'), el('span', { style: 'font-weight:400' }, 'Fix it at the Feeder Cart (reload, clear jam, or find an alternate).')));
    }
    if (j) {
      const per = g.boardsPerPanel(j);
      nodes.push(el('div', { class: 'inset', style: 'margin-bottom:8px' },
        el('b', {}, `${j.product.asmIpn}  ${j.product.name}`), el('br'),
        `Program ${j.program!.name}  panel ${j.program!.nx}x${j.program!.ny} (${per} up)`, el('br'),
        `Panels started ${j.panelsStarted}/${Math.ceil(j.qty / per)} · boards done ${j.boardsDone}/${j.qty} · shipped ${j.boardsShipped}`, el('br'),
        `Due ${g.t > j.dueAt ? 'LATE' : 'in ' + fmtTime(j.dueAt - g.t)}`,
        !j.printProfile ? el('div', { style: 'color:#b00;font-weight:700' }, '→ Printer has no print set-up for this job. Go to the Stencil Printer.') : el('span'),
      ));
      const pause = el('button', { class: `rbtn ${L.px9Paused ? 'go' : 'stop'}` }, L.px9Paused ? 'Resume placing' : 'Pause placing');
      pause.onclick = () => {
        L.px9Paused = !L.px9Paused;
        this.app.audio.play('click');
        this.render();
      };
      const abort = el('button', { class: 'rbtn stop' }, 'End job early');
      abort.onclick = () => {
        g.abortJob();
        this.render();
      };
      nodes.push(el('div', { style: 'display:flex;gap:6px;margin-bottom:10px' }, pause, abort));
    } else {
      nodes.push(el('div', { class: 'inset', style: 'margin-bottom:8px' }, 'No job loaded. The line is idle and the overheads are not.'));
    }
    const ready = g.jobs.filter((x) => x.status === 'ready');
    const busy = !!j && j.panelsStarted * g.boardsPerPanel(j) < j.qty;
    const table = el('table', { class: 'grid' },
      el('tr', {}, el('th', {}, 'Job'), el('th', {}, 'Qty'), el('th', {}, 'Due'), el('th', {}, 'Kit'), el('th', {}, '')));
    for (const r of ready) {
      const late = g.t > r.dueAt;
      const b = el('button', { class: 'rbtn go' }, 'Load');
      b.disabled = busy;
      b.onclick = () => {
        const err = g.startJob(r);
        if (err) this.app.hud.toast(err, 'warn', 'PX-9');
        else {
          this.app.hud.toast(`Feeder set-up for ${r.product.asmIpn} is at the Feeder Cart.`, 'info', 'PX-9');
          if (!r.printProfile) this.app.hud.toast('The printer needs a print set-up for this job.', 'info', 'Printer');
        }
        this.render();
      };
      table.append(el('tr', { class: late ? 'late' : '' },
        el('td', {}, `${r.product.asmIpn}${r.kind === 'contract' ? ' ★' : ''}`),
        el('td', {}, String(r.qty)),
        el('td', {}, late ? 'LATE' : fmtTime(r.dueAt - g.t)),
        el('td', {}, fmtMoney(g.kitCost(r))),
        el('td', {}, b)));
    }
    nodes.push(el('div', {}, el('b', {}, 'Programs ready to run')), ready.length ? table : el('div', { class: 'inset' }, 'Nothing programmed. Contracts need the Programming Desk first.'));
    if (busy) nodes.push(el('p', {}, 'Finish printing the current job before a changeover (or end it early).'));
    this.win.replaceChildren(...nodes);
  }
}
