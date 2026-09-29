import { el } from '../core/util';
import type { App } from '../app';

export const IS_TOUCH =
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);

/**
 * On-screen controls for phones and tablets: a floating joystick under the left thumb,
 * drag anywhere else to look, and buttons for Use / Run / Notes.
 */
export class TouchControls {
  readonly root = el('div', { class: 'touch-ui' });
  private zone = el('div', { class: 'touch-zone' });
  private stick = el('div', { class: 'stick' }, el('div', { class: 'knob' }));
  private use = el('button', { class: 'tbtn use' }, 'USE');
  private run = el('button', { class: 'tbtn run' }, 'RUN');
  private notes = el('button', { class: 'tbtn notes' }, '📝');
  private clip = el('button', { class: 'tbtn clip' }, '📋');
  private moveId: number | null = null;
  private lookId: number | null = null;
  private origin = { x: 0, y: 0 };
  private last = { x: 0, y: 0 };

  constructor(private app: App) {
    this.root.append(this.zone, this.stick, this.use, this.run, this.notes, this.clip);
    this.clip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      app.toggleClipboard();
    });
    this.zone.addEventListener('pointerdown', (e) => this.down(e));
    this.zone.addEventListener('pointermove', (e) => this.move(e));
    this.zone.addEventListener('pointerup', (e) => this.up(e));
    this.zone.addEventListener('pointercancel', (e) => this.up(e));
    this.use.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const near = app.nearStation;
      if (near) app.enterStation(near);
    });
    this.run.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      app.player.touchSprint = !app.player.touchSprint;
      this.run.classList.toggle('on', app.player.touchSprint);
    });
    this.notes.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      app.toggleNotes();
    });
  }

  private down(e: PointerEvent) {
    try {
      this.zone.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointer */
    }
    if (e.clientX < window.innerWidth * 0.45 && this.moveId === null) {
      this.moveId = e.pointerId;
      this.origin = { x: e.clientX, y: e.clientY };
      this.stick.style.display = 'block';
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.setKnob(0, 0);
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.last = { x: e.clientX, y: e.clientY };
    }
  }

  private move(e: PointerEvent) {
    if (e.pointerId === this.moveId) {
      const R = 55;
      let dx = e.clientX - this.origin.x;
      let dy = e.clientY - this.origin.y;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx = (dx / d) * R;
        dy = (dy / d) * R;
      }
      this.setKnob(dx, dy);
      const dead = 0.12;
      const nx = Math.abs(dx / R) < dead ? 0 : dx / R;
      const ny = Math.abs(dy / R) < dead ? 0 : dy / R;
      this.app.player.touchMove = { x: nx, y: -ny };
    } else if (e.pointerId === this.lookId) {
      this.app.player.look(e.clientX - this.last.x, e.clientY - this.last.y);
      this.last = { x: e.clientX, y: e.clientY };
    }
  }

  private up(e: PointerEvent) {
    if (e.pointerId === this.moveId) {
      this.moveId = null;
      this.stick.style.display = 'none';
      this.app.player.touchMove = { x: 0, y: 0 };
    }
    if (e.pointerId === this.lookId) this.lookId = null;
  }

  private setKnob(dx: number, dy: number) {
    (this.stick.firstChild as HTMLElement).style.transform = `translate(${dx}px, ${dy}px)`;
  }

  update(walking: boolean) {
    this.root.style.display = walking ? '' : 'none';
    if (!walking) {
      this.moveId = this.lookId = null;
      this.stick.style.display = 'none';
      this.app.player.touchMove = { x: 0, y: 0 };
    }
    const near = this.app.nearStation;
    const label = near ? `USE · ${near.spot.name}` : 'USE';
    if (this.use.textContent !== label) this.use.textContent = label;
    this.use.disabled = !near;
  }
}
