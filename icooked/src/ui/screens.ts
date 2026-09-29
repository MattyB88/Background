import { el, fmtMoney, fmtTime } from '../core/util';
import type { App } from '../app';
import type { Ending } from '../sim/game';

const BEST_KEY = 'icooked.best';

export interface Best {
  score: number;
  time: number;
}

export function loadBest(): Best | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    return raw ? (JSON.parse(raw) as Best) : null;
  } catch {
    return null;
  }
}

function saveBest(b: Best) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(b));
  } catch {
    /* private mode etc. */
  }
}

const CONTROLS: [string, string][] = [
  ['WASD / arrows', 'walk (Shift to run)'],
  ['Mouse', 'look'],
  ['E', 'use the station you are facing'],
  ['Q / Esc', 'leave a station'],
  ['N', 'notepad (write down your crimes)'],
  ['1-4', 'hold a tool from your pocket'],
  ['Mouse wheel', 'zoom at inspection / rework'],
];

function controlsGrid(): HTMLElement {
  const g = el('div', { class: 'controls' });
  for (const [k, v] of CONTROLS) g.append(el('kbd', {}, k), el('span', {}, v));
  return g;
}

export class TitleScreen {
  readonly root: HTMLElement;
  constructor(app: App) {
    const best = loadBest();
    const seedIn = el('input', { type: 'text', placeholder: 'random', style: 'width:130px;padding:6px;border-radius:6px;border:1px solid #444;background:#111;color:#eee' }) as HTMLInputElement;
    const vol = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(app.audio.volume) }) as HTMLInputElement;
    vol.oninput = () => app.audio.setVolume(Number(vol.value));
    const music = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(app.audio.musicVolume) }) as HTMLInputElement;
    music.oninput = () => app.audio.setMusic(Number(music.value));
    const go = el('button', { class: 'btn primary' }, 'Clock in');
    go.onclick = () => {
      const s = seedIn.value.trim();
      app.startRun(s ? Math.abs(hash(s)) : undefined);
    };
    this.root = el('div', { class: 'overlay', style: 'background:rgba(5,6,8,0.45)' },
      el('div', { class: 'card' },
        el('h1', { class: 'logo' }, 'ICOOKED'),
        el('p', { class: 'tag' }, 'An SMT line. One operator. Sales has made promises. The oven has opinions. You will be fired — the only question is your score.'),
        best ? el('p', {}, `Best: ${best.score.toLocaleString('en-US')} pts, survived ${fmtTime(best.time)}`) : el('span'),
        controlsGrid(),
        el('p', { style: 'color:#aab;font-size:13px;margin:8px 0 0' }, 'On a phone: hold it sideways. Left thumb walks, right thumb looks, tap USE at a station. Pinch to zoom at the benches.'),
        el('div', { class: 'menu-btns' }, go),
        el('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;margin-top:14px;font-size:13px;color:#aab' },
          el('label', {}, 'Seed ', seedIn),
          el('label', {}, 'Volume ', vol),
          el('label', {}, 'Music ', music)),
        el('p', { style: 'color:#778;font-size:12px;margin-top:14px' }, 'Tip: pausing does not stop the factory. Nothing stops the factory.'),
      ));
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

export class PauseMenu {
  readonly root: HTMLElement;
  constructor(private app: App) {
    const resume = el('button', { class: 'btn primary' }, 'Get back to work');
    resume.onclick = () => {
      this.hide();
      app.player.lock();
    };
    const quit = el('button', { class: 'btn danger' }, 'Quit (get fired early)');
    quit.onclick = () => {
      this.hide();
      app.game.end('revolt');
    };
    this.root = el('div', { class: 'overlay' },
      el('div', { class: 'card' },
        el('h2', { style: 'margin:0' }, 'PAUSED*'),
        el('p', { class: 'tag' }, '*The factory is not paused. The oven is still heating. Sales is still selling. Take your time.'),
        controlsGrid(),
        el('div', { class: 'menu-btns' }, resume, quit)));
  }
  show() {
    if (!this.root.isConnected) this.app.ui.append(this.root);
  }
  hide() {
    this.root.remove();
  }
}

const CAUSE: Record<Ending, { title: string; line: string }> = {
  fire: { title: 'THE OVEN CAUGHT FIRE', line: 'The sprinklers worked. You did not. Security will walk you out.' },
  bankrupt: { title: 'LIGHTS OUT', line: 'No cash for parts, no cash for power. The last thing you saw was the EXIT sign.' },
  revolt: { title: 'CUSTOMERS REVOLTED', line: 'The Operations Director would like your badge. It was not your fault. You are fired anyway.' },
};

export class EndScreen {
  constructor(app: App, ending: Ending, prevBest: Best | null) {
    const g = app.game;
    const isBest = !prevBest || g.score > prevBest.score;
    if (isBest) saveBest({ score: g.score, time: g.overAt });
    const c = CAUSE[ending];
    const stat = (k: string, v: string) => el('div', { class: 'stat' }, el('small', {}, k), el('b', {}, v));
    const again = el('button', { class: 'btn primary' }, 'Clock in again');
    const share = el('button', { class: 'btn' }, 'Save share card');
    const root = el('div', { class: 'overlay' },
      el('div', { class: 'card' },
        el('h1', { class: 'logo', style: 'font-size:clamp(48px,10vw,96px)' }, 'ICOOKED'),
        el('h2', { style: 'margin:6px 0 2px;color:#ff6a4a' }, c.title),
        el('p', { class: 'tag' }, c.line),
        el('div', { class: 'stat-grid' },
          stat('Score', g.score.toLocaleString('en-US') + (isBest ? ' ★' : '')),
          stat('Survived', fmtTime(g.overAt)),
          stat('Boards shipped', String(g.stats.shipped)),
          stat('First-pass good', String(g.stats.firstPass)),
          stat('Reworked', String(g.stats.reworked)),
          stat('Scrapped', String(g.stats.scrapped)),
          stat('Parts flicked', String(g.stats.flicked)),
          stat('Gambles won', `${g.stats.gamblesWon}/${g.stats.gamblesWon + g.stats.gamblesLost}`),
          stat('Oven services', String(g.stats.maintenances)),
          stat('Cash', fmtMoney(g.cash))),
        prevBest && !isBest ? el('p', { class: 'tag' }, `Best: ${prevBest.score.toLocaleString('en-US')}`) : el('span'),
        el('div', { class: 'menu-btns' }, again, share)));
    again.onclick = () => {
      root.remove();
      app.startRun();
    };
    share.onclick = () => {
      const url = shareCard(app, ending).toDataURL('image/png');
      const a = el('a', { href: url, download: `icooked-${g.score}.png` });
      document.body.append(a);
      a.click();
      a.remove();
    };
    app.ui.append(root);
  }
}

export function shareCard(app: App, ending: Ending): HTMLCanvasElement {
  const g = app.game;
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 630;
  const ctx = c.getContext('2d')!;
  const bg = ctx.createLinearGradient(0, 0, 1200, 630);
  bg.addColorStop(0, '#1a0f0a');
  bg.addColorStop(1, '#3a120a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1200, 630);
  // PCB-ish traces
  ctx.strokeStyle = 'rgba(255,170,60,0.12)';
  ctx.lineWidth = 6;
  for (let i = 0; i < 14; i++) {
    ctx.beginPath();
    const y = 40 + i * 42;
    ctx.moveTo(700, y);
    ctx.lineTo(900, y);
    ctx.lineTo(950, y + 50);
    ctx.lineTo(1200, y + 50);
    ctx.stroke();
  }
  const grad = ctx.createLinearGradient(0, 60, 0, 220);
  grad.addColorStop(0, '#ffd35a');
  grad.addColorStop(0.6, '#ff6a1a');
  grad.addColorStop(1, '#b3200e');
  ctx.fillStyle = grad;
  ctx.font = '900 170px system-ui, sans-serif';
  ctx.fillText('ICOOKED', 60, 210);
  ctx.fillStyle = '#ff8a6a';
  ctx.font = '800 44px system-ui, sans-serif';
  ctx.fillText(CAUSE[ending].title, 64, 290);
  ctx.fillStyle = '#fff';
  ctx.font = '900 110px ui-monospace, monospace';
  ctx.fillText(g.score.toLocaleString('en-US'), 60, 430);
  ctx.fillStyle = '#d9c9b9';
  ctx.font = '600 34px system-ui, sans-serif';
  ctx.fillText(`survived ${fmtTime(g.overAt)} · ${g.stats.shipped} boards shipped · ${g.stats.flicked} parts flicked`, 64, 500);
  ctx.fillStyle = '#9a8a7a';
  ctx.font = '500 26px ui-monospace, monospace';
  ctx.fillText(`seed ${app.seed}   —   you were fired. it wasn't your fault.`, 64, 575);
  return c;
}
