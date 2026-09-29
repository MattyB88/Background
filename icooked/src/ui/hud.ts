import { clamp, el, fmtMoney, fmtTime } from '../core/util';
import type { Game, ToastKind } from '../sim/game';
import { TOOL_NAMES, type ToolId } from '../render/hands';

export class Hud {
  readonly root = el('div');
  private chips: Record<string, { b: HTMLElement; bar?: HTMLElement; chip: HTMLElement }> = {};
  private toasts = el('div', { class: 'toasts' });
  readonly prompt = el('div', { class: 'prompt' });
  readonly crosshair = el('div', { class: 'crosshair' });
  private pockets = el('div', { class: 'pockets' });
  private hints = el('div', { class: 'hint-bar' });
  readonly vignette = el('div', { class: 'vignette' });
  readonly fade = el('div', { class: 'fade' });
  private objective = el('div', { class: 'objective' });

  constructor() {
    const top = el('div', { class: 'hud-top' });
    const chip = (key: string, label: string, meter = false) => {
      const b = el('b', {}, '-');
      const c = el('div', { class: 'hud-chip' }, el('small', {}, label), b);
      let bar: HTMLElement | undefined;
      if (meter) {
        bar = el('i');
        c.append(el('div', { class: 'meter' }, bar));
      }
      this.chips[key] = { b, bar, chip: c };
      top.append(c);
    };
    chip('time', 'Shift');
    chip('score', 'Score');
    chip('cash', 'Cash');
    chip('heat', 'Oven', true);
    chip('rage', 'Customers', true);
    chip('stress', 'Stress', true);
    this.hints.innerHTML = '<kbd>WASD</kbd> walk · <kbd>Shift</kbd> run · <kbd>E</kbd> use · <kbd>N</kbd> notes · <kbd>1-4</kbd> tool · <kbd>Esc</kbd> "pause"';
    this.prompt.style.display = 'none';
    this.root.append(this.vignette, this.objective, top, this.toasts, this.prompt, this.crosshair, this.pockets, this.hints, this.fade);
  }

  toast(text: string, kind: ToastKind = 'info', from?: string) {
    const t = el('div', { class: `toast ${kind}` });
    if (from) t.append(el('div', { class: 'from' }, from));
    t.append(text);
    this.toasts.prepend(t);
    while (this.toasts.children.length > 5) this.toasts.lastChild!.remove();
    setTimeout(() => t.remove(), kind === 'sales' ? 9000 : 6500);
  }

  setWalking(walking: boolean) {
    this.crosshair.style.display = walking ? '' : 'none';
    this.hints.style.display = walking ? '' : 'none';
  }

  setObjective(text: string) {
    if (this.objective.dataset.t === text) return;
    this.objective.dataset.t = text;
    this.objective.replaceChildren(el('small', {}, 'Next'), text);
  }

  setInStation(on: boolean) {
    document.body.classList.toggle('in-station', on);
  }

  update(g: Game, toolAt: Record<ToolId, string>, selected: ToolId | null, stationNames: Record<string, string>) {
    const set = (k: string, v: string, frac?: number, hot = false) => {
      const c = this.chips[k];
      c.b.textContent = v;
      if (c.bar && frac !== undefined) {
        c.bar.style.width = `${clamp(frac, 0, 1) * 100}%`;
        c.bar.style.background = frac > 0.85 ? 'var(--danger)' : frac > 0.6 ? 'var(--accent)' : 'var(--good)';
      }
      c.chip.classList.toggle('hot', hot);
    };
    set('time', fmtTime(g.t));
    set('score', g.score.toLocaleString('en-US'));
    set('cash', fmtMoney(g.cash), undefined, g.cash < 0);
    set('heat', `${Math.round(g.heat)}%`, g.heat / 100, g.heat > 85);
    set('rage', `${Math.round(g.rage)}%`, g.rage / 100, g.rage > 85);
    set('stress', `${Math.round(g.stress * 100)}%`, g.stress);
    this.vignette.classList.toggle('red', g.heat > 85 || g.rage > 85);
    const nodes: Node[] = [];
    (Object.keys(TOOL_NAMES) as ToolId[]).forEach((t, i) => {
      const where = toolAt[t];
      const p = el('div', { class: `pocket${selected === t ? ' sel' : ''}${where !== 'pocket' ? ' away' : ''}` },
        el('div', {}, `${i + 1} · ${TOOL_NAMES[t]}`),
        el('div', { class: 'where' }, where === 'pocket' ? 'in pocket' : `left at ${stationNames[where] ?? where}`));
      nodes.push(p);
    });
    this.pockets.replaceChildren(...nodes);
  }
}
