import { el } from '../core/util';
import { Station } from './base';

/** The office printer: work cards come out here. Grab them onto your clipboard. */
export class OfficeStation extends Station {
  private side!: HTMLElement;

  build() {
    this.side = el('div', { class: 'side left' });
    this.body.append(this.side);
  }

  status(): string {
    const n = this.app.game.jobs.filter((j) => j.card === 'printed').length;
    return n ? `${n} work card(s) in the tray` : 'Tray empty';
  }

  enter() {
    this.render();
  }

  private render() {
    const g = this.app.game;
    const waiting = g.jobs.filter((j) => j.card === 'printed');
    const nodes: Node[] = [el('h3', {}, 'Printer output tray')];
    if (!waiting.length) nodes.push(el('p', {}, 'Nothing printed. Print a work card from the schedule at the Programming Desk.'));
    for (const j of waiting) nodes.push(el('div', { class: 'list-item' }, `WORK CARD  ${j.product.asmIpn}  x${j.qty}`));
    const take = el('button', { class: 'btn primary', style: 'margin-top:8px' }, 'Take them and clip them on your clipboard');
    take.disabled = !waiting.length;
    take.onclick = () => {
      const got = g.takeCards();
      this.app.audio.play('wipe');
      this.app.hud.toast(`Clipped ${got.length} work card(s). Press C to read your clipboard.`, 'good', 'Clipboard');
      this.render();
    };
    nodes.push(take, el('p', { style: 'color:#778;font-size:12px' }, 'A job can only be loaded on the PX-9 with its work card on your clipboard.'));
    this.side.replaceChildren(...nodes);
  }
}
