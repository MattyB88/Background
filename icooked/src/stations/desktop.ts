import { el } from '../core/util';

export interface WinSpec {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  render: (body: HTMLElement) => void;
}

/** A tiny window manager in the style of a 90s unix workstation. */
export class Desktop {
  readonly root = el('div', { class: 'desktop' });
  private wins = new Map<string, { el: HTMLElement; body: HTMLElement; spec: WinSpec; titleText: Text }>();
  private z = 10;
  private dock = el('div', { class: 'dock' });

  constructor() {
    this.root.append(this.dock);
  }

  addDock(icon: string, label: string, onClick: () => void) {
    const b = el('button', {}, el('span', { class: 'ico' }, icon), label);
    b.onclick = onClick;
    this.dock.append(b);
  }

  open(spec: WinSpec) {
    const existing = this.wins.get(spec.id);
    if (existing) {
      existing.spec = spec;
      existing.titleText.data = spec.title;
      this.focus(spec.id);
      this.refresh(spec.id);
      return;
    }
    const body = el('div', { class: 'win-body' });
    const close = el('span', { class: 'x' }, '×');
    const titleText = document.createTextNode(spec.title);
    const title = el('div', { class: 'win-title' }, titleText, close);
    const maxW = this.root.clientWidth || window.innerWidth;
    const maxH = (this.root.clientHeight || window.innerHeight) - 70;
    const w = Math.min(spec.w, maxW - 10);
    const h = Math.min(spec.h, maxH - 10);
    const x = Math.max(4, Math.min(spec.x, maxW - w - 4));
    const y = Math.max(4, Math.min(spec.y, maxH - h));
    const win = el('div', { class: 'win', style: `left:${x}px;top:${y}px;width:${w}px;height:${h}px` }, title, body);
    close.onclick = (e) => {
      e.stopPropagation();
      this.close(spec.id);
    };
    win.addEventListener('pointerdown', () => this.focus(spec.id));
    let drag: { dx: number; dy: number } | null = null;
    title.addEventListener('pointerdown', (e) => {
      drag = { dx: e.clientX - win.offsetLeft, dy: e.clientY - win.offsetTop };
      title.setPointerCapture(e.pointerId);
    });
    title.addEventListener('pointermove', (e) => {
      if (!drag) return;
      win.style.left = `${Math.max(0, e.clientX - drag.dx)}px`;
      win.style.top = `${Math.max(0, e.clientY - drag.dy)}px`;
    });
    title.addEventListener('pointerup', () => (drag = null));
    this.root.append(win);
    this.wins.set(spec.id, { el: win, body, spec, titleText });
    this.focus(spec.id);
    this.refresh(spec.id);
  }

  isOpen(id: string): boolean {
    return this.wins.has(id);
  }

  close(id: string) {
    this.wins.get(id)?.el.remove();
    this.wins.delete(id);
  }

  focus(id: string) {
    for (const [k, w] of this.wins) w.el.classList.toggle('focus', k === id);
    const w = this.wins.get(id);
    if (w) w.el.style.zIndex = String(++this.z);
  }

  refresh(id: string) {
    const w = this.wins.get(id);
    if (!w) return;
    const scroll = w.body.scrollTop;
    w.body.replaceChildren();
    w.spec.render(w.body);
    w.body.scrollTop = scroll;
  }

  refreshAll() {
    for (const id of this.wins.keys()) this.refresh(id);
  }
}
