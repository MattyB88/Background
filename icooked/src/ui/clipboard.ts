import { el, fmtTime } from '../core/util';
import type { App } from '../app';
import { PART_BY_IPN } from '../sim/parts';
import type { Job } from '../sim/types';

/** The clipboard: work cards (travellers) with job details, a parts checklist and your notes. */
export class Clipboard {
  readonly root = el('div', { class: 'clipboard' });
  private jobId: number | null = null;
  private t = 0;

  constructor(private app: App) {
    this.root.style.display = 'none';
  }

  get open(): boolean {
    return this.root.style.display !== 'none';
  }

  toggle() {
    this.root.style.display = this.open ? 'none' : '';
    if (this.open) this.render();
  }

  update(dt: number) {
    if (!this.open) return;
    this.t -= dt;
    const typing = document.activeElement instanceof HTMLTextAreaElement && this.root.contains(document.activeElement);
    if (this.t <= 0 && !typing && !this.app.pointerDown) {
      this.t = 1;
      this.render();
    }
  }

  private cards(): Job[] {
    return this.app.game.jobs.filter((j) => j.card === 'held' && j.status !== 'finished');
  }

  render() {
    const g = this.app.game;
    const cards = this.cards();
    if (!cards.some((c) => c.id === this.jobId)) this.jobId = cards[0]?.id ?? null;
    const close = el('button', { class: 'btn', style: 'margin-left:auto' }, 'Put it away (C)');
    close.onclick = () => this.toggle();
    const tabs = el('div', { class: 'clip-tabs' });
    for (const c of cards) {
      const b = el('button', { class: `clip-tab${c.id === this.jobId ? ' on' : ''}` }, c.product.asmIpn);
      b.onclick = () => {
        this.jobId = c.id;
        this.render();
      };
      tabs.append(b);
    }
    const j = g.job(this.jobId);
    const paper = el('div', { class: 'clip-paper' });
    if (!j) {
      paper.append(el('h2', {}, 'No work cards'), el('p', {}, 'Print a work card for a job at the Programming Desk (Schedule), then grab it from the office printer.'));
    } else {
      const late = g.t > j.dueAt;
      paper.append(
        el('div', { class: 'clip-head' }, el('b', {}, 'WORK CARD / TRAVELLER'), el('span', {}, `#${String(j.id).padStart(5, '0')}`)),
        el('div', { class: 'clip-grid' },
          el('span', {}, 'Assembly'), el('b', {}, j.product.asmIpn),
          el('span', {}, 'Product'), el('span', {}, j.product.name),
          el('span', {}, 'Customer'), el('span', {}, j.product.customer),
          el('span', {}, 'Bare PCB'), el('span', {}, j.product.pcbIpn),
          el('span', {}, 'Quantity'), el('b', {}, `${j.qty}  (done ${j.boardsDone}, shipped ${j.boardsShipped})`),
          el('span', {}, 'Due'), el('b', { style: late ? 'color:#b00' : '' }, late ? 'LATE' : `in ${fmtTime(j.dueAt - g.t)}`),
          el('span', {}, 'Program'), el('span', {}, j.program?.name ?? 'not programmed')),
        el('div', { class: 'clip-note' }, el('b', {}, 'Sales: '), j.salesNote),
        el('div', { class: 'clip-note' }, el('b', {}, 'Engineering: '), j.puzzle ? j.puzzle.notes.slice(0, 3).join(' / ') : 'Standard build. Program on file. Don\'t touch anything.'),
      );
      if (j.program) {
        const counts = new Map<string, number>();
        for (const ipn of Object.values(j.program.desIpn)) if (ipn) counts.set(ipn, (counts.get(ipn) ?? 0) + 1);
        const t = el('table', { class: 'clip-table' }, el('tr', {}, ...['IPN', 'Description', '/brd', 'Total', 'Got', 'On'].map((h) => el('th', {}, h))));
        for (const [ipn, n] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          const got = g.carried.some((r) => r.label === ipn);
          const on = g.slots.some((s) => s.reel?.label === ipn);
          t.append(el('tr', {}, el('td', {}, ipn), el('td', {}, PART_BY_IPN.get(ipn)?.desc ?? '?'), el('td', {}, String(n)), el('td', {}, String(n * j.qty)),
            el('td', {}, got || on ? '☑' : '☐'), el('td', {}, on ? '☑' : '☐')));
        }
        paper.append(el('div', { style: 'margin-top:8px;font-weight:700' }, 'Parts list (collect from stores, load at the feeder cart)'), t);
      }
      const ta = el('textarea', { class: 'clip-notes', placeholder: 'Write on the card… e.g. "used a dump-bin part on C3, S/N 0012"' }) as HTMLTextAreaElement;
      ta.value = j.cardNotes;
      ta.oninput = () => (j.cardNotes = ta.value);
      paper.append(el('div', { style: 'margin-top:8px;font-weight:700' }, 'Operator notes'), ta);
    }
    this.root.replaceChildren(el('div', { class: 'clip-board' }, el('div', { class: 'clip-clip' }), el('div', { class: 'clip-top' }, tabs, close), paper));
  }
}
