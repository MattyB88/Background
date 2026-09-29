import { el } from '../core/util';
import type { App } from '../app';
import type { StationSpot } from '../render/factory';
import { TOOL_NAMES, type ToolId } from '../render/hands';

export abstract class Station {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  private tray: HTMLElement;
  private extra: HTMLElement;
  /** Render the close-up bench scene instead of the factory while here. */
  closeup = false;
  /** Tools that make sense at this station (others can still be put down here). */
  tools: ToolId[] = [];

  constructor(readonly app: App, readonly spot: StationSpot) {
    this.root = el('div', { class: 'station' });
    const bar = el('div', { class: 'station-bar' });
    const leave = el('button', { class: 'btn' }, '← Leave ', el('kbd', {}, 'Q'));
    leave.onclick = () => app.leaveStation();
    this.tray = el('div', { class: 'tooltray' });
    this.extra = el('div', { class: 'tooltray' });
    bar.append(leave, el('h2', {}, spot.name), this.extra, el('div', { class: 'spacer' }), this.tray);
    this.body = el('div', { class: 'station-body' });
    this.root.append(bar, this.body);
  }

  /** Put buttons into the station bar. */
  barButtons(...nodes: Node[]) {
    this.extra.replaceChildren(...nodes);
  }

  abstract build(): void;
  enter(): void {}
  leave(): void {}
  update(_dt: number): void {}
  /** Safe to rebuild the DOM? Not while a click or a dropdown is in progress. */
  protected canRefresh(): boolean {
    const a = document.activeElement;
    const focused = !!a && this.root.contains(a) && (a instanceof HTMLSelectElement || a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement);
    return !this.app.pointerDown && !focused;
  }

  /** Return a short status for the walk-up prompt. */
  status(): string {
    return '';
  }

  refreshTools() {
    const a = this.app;
    const nodes: Node[] = [el('span', {}, 'Tools:')];
    for (const t of Object.keys(TOOL_NAMES) as ToolId[]) {
      const where = a.toolAt[t];
      if (where === this.spot.id) {
        const b = el('button', { class: 'btn onbench', title: 'On this bench. Click to put it back in your pocket.' }, `⤴ ${TOOL_NAMES[t]}`);
        b.onclick = () => {
          a.pickUpTool(t);
          this.refreshTools();
        };
        nodes.push(b);
      } else if (where === 'pocket' && this.tools.includes(t)) {
        const b = el('button', { class: 'btn', title: 'Take it out and put it on the bench.' }, `↓ ${TOOL_NAMES[t]}`);
        b.onclick = () => {
          a.putDownTool(t, this.spot.id);
          this.refreshTools();
        };
        nodes.push(b);
      }
    }
    this.tray.replaceChildren(...nodes);
  }
}
