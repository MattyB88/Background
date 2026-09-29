import { clamp, el, fmtMoney, fmtTime } from '../core/util';
import { LIBRARY, PACKAGES, PART_BY_IPN } from '../sim/parts';
import type { BoardDef, Job } from '../sim/types';
import { paintBareBoard } from '../render/boardpaint';
import { Station } from './base';

type Tab = 'prod' | 'check' | 'feeders';

const boardCache = new Map<BoardDef, { canvas: HTMLCanvasElement; s: number }>();
function boardImage(def: BoardDef) {
  let c = boardCache.get(def);
  if (!c) {
    const s = Math.min(20, 3800 / Math.max(def.w, def.h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(def.w * s);
    canvas.height = Math.ceil(def.h * s);
    paintBareBoard(canvas.getContext('2d')!, def, s);
    c = { canvas, s };
    boardCache.set(def, c);
  }
  return c;
}

/**
 * The PX-9: production screen, on-machine program check through the placement camera,
 * feeder access, and the control pendant (START, STOP, E-STOP).
 */
export class Px9Station extends Station {
  private win!: HTMLElement;
  private tabBar!: HTMLElement;
  private pendant!: HTMLElement;
  private tab: Tab = 'prod';
  private t = 0;
  private checkJob: number | null = null;
  private checkIdx = 0;
  private step = 0.05;
  private cam!: HTMLCanvasElement;
  private tape!: HTMLCanvasElement;
  private selSlot: number | null = null;
  private twist = 0;

  build() {
    this.win = el('div', { class: 'win-body' });
    this.tabBar = el('div', { style: 'display:flex;gap:4px;padding:4px 8px;background:#9ea3b6' });
    const w = el('div', { class: 'win px9-win' }, el('div', { class: 'win-title' }, 'PX-9 Production Manager — /opt/px9/bin/prodman'), this.tabBar, this.win);
    this.pendant = el('div', { class: 'pendant' });
    this.body.append(w, this.pendant);
    this.cam = el('canvas', { width: '440', height: '330', class: 'machine-cam' }) as HTMLCanvasElement;
    this.tape = el('canvas', { width: '520', height: '150', class: 'machine-cam', style: 'cursor:crosshair' }) as HTMLCanvasElement;
    this.tape.addEventListener('pointerdown', (e) => this.tapeClick(e));
  }

  status(): string {
    const g = this.app.game;
    const L = g.line;
    if (L.machine === 'fault') return '⚠ SAFETY FAULT — reset with the E-stop';
    if (L.px9Alarm) return `⚠ ${L.px9Alarm}`;
    if (L.machine === 'stop') return 'Stopped';
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
    if (this.tab === 'feeders') this.drawTape();
  }

  private render() {
    const tabs: [Tab, string][] = [['prod', 'Production'], ['check', 'Program check (camera)'], ['feeders', 'Feeders']];
    this.tabBar.replaceChildren(...tabs.map(([id, label]) => {
      const b = el('button', { class: `rbtn${this.tab === id ? ' go' : ''}` }, label);
      b.onclick = () => {
        this.tab = id;
        this.render();
      };
      return b;
    }));
    if (this.tab === 'prod') this.renderProd();
    else if (this.tab === 'check') this.renderCheck();
    else this.renderFeeders();
    this.renderPendant();
  }

  // ------------------------------------------------------------------ pendant

  private renderPendant() {
    const g = this.app.game;
    const L = g.line;
    const lamp = el('div', { class: `pend-lamp ${L.machine}` }, L.machine === 'run' ? 'RUN' : L.machine === 'stop' ? 'STOPPED' : 'FAULT');
    const start = el('button', { class: 'pend-btn start', title: 'Start' }, 'I');
    start.onclick = () => {
      const err = g.pressStart();
      if (err) this.app.hud.toast(err, 'warn', 'PX-9');
      this.render();
    };
    const stop = el('button', { class: 'pend-btn stop', title: 'Stop' }, 'O');
    stop.onclick = () => {
      g.pressStop();
      this.render();
    };
    const estop = el('button', { class: `estop${L.estop ? ' down' : ''}`, title: 'Emergency stop: press. Drag sideways to twist-release.', style: `transform: rotate(${this.twist}deg)` }, 'STOP');
    let dragX: number | null = null;
    estop.addEventListener('pointerdown', (e) => {
      dragX = e.clientX;
      estop.setPointerCapture(e.pointerId);
    });
    estop.addEventListener('pointermove', (e) => {
      if (dragX === null || !L.estop) return;
      this.twist = clamp((e.clientX - dragX) * 1.2, 0, 90);
      estop.style.transform = `rotate(${this.twist}deg)`;
    });
    estop.addEventListener('pointerup', () => {
      if (dragX === null) return;
      dragX = null;
      if (L.estop && this.twist > 60) {
        const err = g.twistEstop();
        if (err) this.app.hud.toast(err, 'warn', 'PX-9');
        else this.app.hud.toast('E-stop released.', 'info', 'PX-9');
      } else if (this.twist < 10) {
        g.pressEstop();
      }
      this.twist = 0;
      this.render();
    });
    const twistBtn = el('button', { class: 'btn', style: 'font-size:11px;padding:3px 8px' }, '↻ twist to release');
    twistBtn.onclick = () => {
      const err = g.twistEstop();
      if (err) this.app.hud.toast(err, 'warn', 'PX-9');
      this.render();
    };
    const help = L.machine === 'fault'
      ? (L.estop === 0 ? 'Fault latched: press the E-stop.' : L.estop === 1 ? 'Press the E-stop again to override.' : 'Now twist the E-stop to release, then press START.')
      : L.estop ? 'E-stop pressed. Twist to release.' : L.feederOut !== null ? 'Feeder out. Seat it before START.' : '';
    this.pendant.replaceChildren(
      el('div', { class: 'pend-title' }, 'PX-9 CONTROL'),
      lamp,
      el('div', { class: 'pend-row' }, el('div', {}, start, el('small', {}, 'START')), el('div', {}, stop, el('small', {}, 'STOP'))),
      el('div', { class: 'estop-ring' }, estop),
      twistBtn,
      el('div', { class: 'pend-help' }, help),
    );
  }

  // ------------------------------------------------------------------ production

  private renderProd() {
    const g = this.app.game;
    const L = g.line;
    const j = g.activeJob;
    const nodes: Node[] = [];
    if (L.px9Alarm) {
      nodes.push(el('div', { class: 'inset', style: 'background:#c0231a;color:#fff;font-weight:700;margin-bottom:8px' },
        `MACHINE STOPPED: ${L.px9Alarm}`, el('br'), el('span', { style: 'font-weight:400' }, 'Fix it at the Feeder Cart (reload, clear jam, or find an alternate).')));
    }
    if (L.machine !== 'run') nodes.push(el('div', { class: 'inset', style: 'background:#e8c85a;margin-bottom:8px' }, L.machine === 'fault' ? 'SAFETY FAULT. Use the pendant: E-stop ×2, twist, START.' : 'Machine stopped. Press START on the pendant.'));
    if (j) {
      const per = g.boardsPerPanel(j);
      nodes.push(el('div', { class: 'inset', style: 'margin-bottom:8px' },
        el('b', {}, `${j.product.asmIpn}  ${j.product.name}`), el('br'),
        `Program ${j.program!.name}  panel ${j.program!.nx}x${j.program!.ny} (${per} up)`, el('br'),
        `Panels started ${j.panelsStarted}/${Math.ceil(j.qty / per)} · boards done ${j.boardsDone}/${j.qty} · shipped ${j.boardsShipped}`, el('br'),
        `Due ${g.t > j.dueAt ? 'LATE' : 'in ' + fmtTime(j.dueAt - g.t)}`,
        !j.printProfile ? el('div', { style: 'color:#b00;font-weight:700' }, '→ Printer has no print set-up for this job. Go to the Stencil Printer.') : el('span'),
      ));
      const abort = el('button', { class: 'rbtn stop' }, 'End job early');
      abort.onclick = () => {
        g.abortJob();
        this.render();
      };
      nodes.push(el('div', { style: 'display:flex;gap:6px;margin-bottom:10px' }, abort));
    } else {
      nodes.push(el('div', { class: 'inset', style: 'margin-bottom:8px' }, 'No job loaded. The line is idle and the overheads are not.'));
    }
    const ready = g.jobs.filter((x) => x.status === 'ready');
    const busy = !!j && j.panelsStarted * g.boardsPerPanel(j) < j.qty;
    const table = el('table', { class: 'grid' },
      el('tr', {}, el('th', {}, 'Job'), el('th', {}, 'Qty'), el('th', {}, 'Due'), el('th', {}, 'Kit'), el('th', {}, 'Card'), el('th', {}, '')));
    for (const r of ready) {
      const late = g.t > r.dueAt;
      const b = el('button', { class: 'rbtn go' }, 'Load');
      b.disabled = busy;
      b.onclick = () => {
        const err = g.startJob(r);
        if (err) this.app.hud.toast(err, 'warn', 'PX-9');
        else this.app.hud.toast(`${r.product.asmIpn} loaded. Collect its parts from the Stores Rack (see your work card).`, 'info', 'PX-9');
        this.render();
      };
      table.append(el('tr', { class: late ? 'late' : '' },
        el('td', {}, `${r.product.asmIpn}${r.kind === 'contract' ? ' ★' : ''}`), el('td', {}, String(r.qty)),
        el('td', {}, late ? 'LATE' : fmtTime(r.dueAt - g.t)), el('td', {}, fmtMoney(g.kitCost(r))),
        el('td', {}, r.card === 'held' ? '📋' : r.card === 'printed' ? 'tray' : '—'), el('td', {}, b)));
    }
    nodes.push(el('div', {}, el('b', {}, 'Programs ready to run')), ready.length ? table : el('div', { class: 'inset' }, 'Nothing programmed. Contracts need the Programming Desk first.'));
    if (busy) nodes.push(el('p', {}, 'Finish printing the current job before a changeover (or end it early).'));
    nodes.push(el('p', { style: 'color:#333' }, 'Tip: run the Program check tab on a new contract before its first panel. The CAD data is never right.'));
    this.win.replaceChildren(...nodes);
  }

  // ------------------------------------------------------------------ program check

  private checkJobs(): Job[] {
    return this.app.game.jobs.filter((j) => j.program && (j.status === 'ready' || j.status === 'running'));
  }

  private renderCheck() {
    const g = this.app.game;
    const jobs = this.checkJobs();
    if (!jobs.some((j) => j.id === this.checkJob)) {
      this.checkJob = (g.activeJob && g.activeJob.program ? g.activeJob.id : jobs[0]?.id) ?? null;
      this.checkIdx = 0;
    }
    const j = g.job(this.checkJob);
    if (!j) {
      this.win.replaceChildren(el('div', { class: 'inset' }, 'No programs to check.'));
      return;
    }
    const sel = el('select') as HTMLSelectElement;
    for (const x of jobs) {
      const o = el('option', { value: String(x.id) }, x.product.asmIpn) as HTMLOptionElement;
      if (x.id === j.id) o.selected = true;
      sel.append(o);
    }
    sel.onchange = () => {
      this.checkJob = Number(sel.value);
      this.checkIdx = 0;
      this.render();
    };
    const pl = j.product.board.placements;
    this.checkIdx = clamp(this.checkIdx, 0, pl.length - 1);
    const des = pl[this.checkIdx].des;
    const prog = j.program!;
    const list = el('div', { class: 'inset', style: 'height:300px;overflow:auto;min-width:110px' });
    pl.forEach((p, i) => {
      const row = el('div', { class: 'folder-row' + (i === this.checkIdx ? ' sel' : '') }, `${prog.checked[p.des] ? '✓' : '·'} ${p.des}`);
      row.onclick = () => {
        this.checkIdx = i;
        this.render();
      };
      list.append(row);
    });
    const ipn = prog.desIpn[des];
    const adj = (prog.adjust[des] ??= { dx: 0, dy: 0, drot: 0 });
    const btn = (label: string, fn: () => void) => {
      const b = el('button', { class: 'rbtn' }, label);
      b.onclick = () => {
        fn();
        this.app.audio.play('click');
        this.render();
      };
      return b;
    };
    const stepSel = btn(`step ${this.step} mm`, () => (this.step = this.step === 0.05 ? 0.25 : this.step === 0.25 ? 1 : 0.05));
    const pad = el('div', { class: 'jog' },
      el('span'), btn('▲ Y+', () => (adj.dy += this.step)), el('span'),
      btn('◀ X-', () => (adj.dx -= this.step)), stepSel, btn('X+ ▶', () => (adj.dx += this.step)),
      el('span'), btn('▼ Y-', () => (adj.dy -= this.step)), el('span'));
    const rot = el('div', { style: 'display:flex;gap:4px;flex-wrap:wrap;margin-top:4px' },
      btn('⟲ 90°', () => (adj.drot += 90)), btn('⟳ 90°', () => (adj.drot -= 90)), btn('⟲ 1°', () => (adj.drot += 1)), btn('⟳ 1°', () => (adj.drot -= 1)));
    const part = ipn ? PART_BY_IPN.get(ipn) : undefined;
    const change = el('select', { style: 'max-width:260px' }) as HTMLSelectElement;
    change.append(el('option', { value: '' }, `Part: ${ipn ?? '(not placed)'} ${part ? part.pkg : ''}`));
    const truthCat = PART_BY_IPN.get(pl[this.checkIdx].ipn)!.category;
    for (const q of LIBRARY.filter((x) => x.category === truthCat)) change.append(el('option', { value: q.ipn }, `${q.ipn} ${q.desc}`));
    change.onchange = () => {
      if (change.value) prog.desIpn[des] = change.value;
      this.render();
    };
    const accept = btn('Accept ✓ & next', () => {
      const r = g.checkComponent(j, des);
      if (r.off > 0.3 || r.rot > 10) this.app.hud.toast(`${des} accepted. (It still looked a bit off.)`, 'info', 'PX-9');
      this.checkIdx = Math.min(pl.length - 1, this.checkIdx + 1);
    });
    accept.classList.add('go');
    const cadP = j.product.cadPlacements.find((c) => c.des === des)!;
    const info = el('div', { style: 'font-size:11px;margin-top:4px' }, `${des}  X ${(cadP.x + adj.dx).toFixed(2)}  Y ${(cadP.y + adj.dy).toFixed(2)}  R ${((cadP.rot + adj.drot) % 360 + 360) % 360}°  (offset ${adj.dx.toFixed(2)}, ${adj.dy.toFixed(2)}, ${adj.drot}°)`);
    this.win.replaceChildren(
      el('div', { style: 'display:flex;gap:6px;align-items:center;margin-bottom:6px' }, 'Program:', sel, el('span', { style: 'font-size:11px' }, `${Object.keys(prog.checked).length}/${pl.length} checked`)),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, list, el('div', {}, this.cam, info, el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:6px' }, el('div', {}, pad, rot), el('div', {}, change, el('div', { style: 'margin-top:6px' }, accept))))),
      el('p', { style: 'font-size:11px;color:#333' }, 'The overlay is what the machine will place: the programmed part\'s body and leads at the programmed position. Line the leads up with the lands. Wrong size or wrong pin count = wrong part in the program.'),
    );
    this.drawCam(j, des);
  }

  private drawCam(j: Job, des: string) {
    const ctx = this.cam.getContext('2d')!;
    const W = this.cam.width;
    const H = this.cam.height;
    const prog = j.program!;
    const def = j.product.board;
    const cad = j.product.cadPlacements.find((c) => c.des === des)!;
    const adj = prog.adjust[des] ?? { dx: 0, dy: 0, drot: 0 };
    const ipn = prog.desIpn[des];
    const pkg = PACKAGES[(ipn ? PART_BY_IPN.get(ipn)! : PART_BY_IPN.get(cad.ipn)!).pkg];
    const truePkg = PACKAGES[PART_BY_IPN.get(def.placements.find((p) => p.des === des)!.ipn)!.pkg];
    const view = Math.max(5, Math.max(truePkg.w, truePkg.h, pkg.w, pkg.h) * 2.4);
    const px = W / view;
    const cx = cad.x + adj.dx;
    const cy = cad.y + adj.dy;
    const img = boardImage(def);
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.filter = 'grayscale(1) contrast(1.3) brightness(0.95)';
    const sw = view * img.s;
    const sh = (view * H / W) * img.s;
    ctx.drawImage(img.canvas, cx * img.s - sw / 2, (def.h - cy) * img.s - sh / 2, sw, sh, 0, 0, W, H);
    ctx.filter = 'none';
    // Overlay: programmed package at programmed position.
    ctx.translate(W / 2, H / 2);
    ctx.rotate((-(cad.rot + adj.drot) * Math.PI) / 180);
    ctx.strokeStyle = '#4ff0ff';
    ctx.lineWidth = 2;
    ctx.strokeRect((-pkg.w / 2) * px, (-pkg.h / 2) * px, pkg.w * px, pkg.h * px);
    ctx.fillStyle = 'rgba(79,240,255,0.25)';
    for (const pad of pkg.pads) ctx.fillRect((pad.x - pad.w * 0.35) * px, (-pad.y - pad.h * 0.35) * px, pad.w * 0.7 * px, pad.h * 0.7 * px);
    ctx.strokeStyle = 'rgba(79,240,255,0.9)';
    ctx.lineWidth = 1;
    for (const pad of pkg.pads) ctx.strokeRect((pad.x - pad.w * 0.35) * px, (-pad.y - pad.h * 0.35) * px, pad.w * 0.7 * px, pad.h * 0.7 * px);
    // Pin-1 marker for polarised parts.
    if (pkg.kind !== 'chip') {
      ctx.fillStyle = '#ff4f9e';
      ctx.beginPath();
      ctx.arc((-pkg.w / 2 + 0.4) * px, (pkg.h / 2 - 0.4) * px, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.fillStyle = '#4ff0ff';
    ctx.font = '12px monospace';
    ctx.fillText(`CAM2 ${des} ${ipn ?? '—'} ${pkg.id}`, 8, 16);
    ctx.fillText(`${view.toFixed(1)} mm FOV`, 8, H - 8);
  }

  // ------------------------------------------------------------------ feeders

  private renderFeeders() {
    const g = this.app.game;
    const L = g.line;
    const grid = el('div', { class: 'slots', style: 'grid-template-columns:repeat(6,1fr)' });
    for (const s of g.slots) {
      const d = el('div', { class: `slot${this.selSlot === s.index ? ' ok' : ''}${L.feederOut === s.index ? ' alarm' : ''}`, style: 'min-height:44px;color:#fff' },
        el('div', { class: 'k' }, `${s.index + 1} · ${s.kind}`), s.reel ? el('div', { class: 'reel' }, s.reel.label) : el('div', { class: 'k' }, 'empty'));
      d.onclick = () => {
        this.selSlot = s.index;
        this.render();
      };
      grid.append(d);
    }
    const nodes: Node[] = [el('div', { class: 'bank', style: 'padding:6px' }, grid)];
    if (L.feederOut !== null) {
      const r = g.slots[L.feederOut].reel;
      const seat = el('button', { class: 'rbtn go' }, 'Seat the feeder back in');
      seat.onclick = () => {
        g.seatFeeder();
        this.app.hud.toast('Feeder seated. Press START when ready.', 'info', 'PX-9');
        this.render();
      };
      nodes.push(el('div', { style: 'margin:6px 0' }, el('b', {}, `Feeder ${L.feederOut + 1} is out: ${r?.label ?? ''}`), el('br'), 'Dab a part out of a pocket with the blue tack (click a pocket).'), this.tape, el('div', { style: 'margin-top:6px' }, seat));
      if (g.hand) nodes.push(el('div', { class: 'inset', style: 'margin-top:6px;background:#d9f2d0' }, 'Part on the blue tack. Take it to the Inspection Bench and grip over the empty land to place it.'));
    } else if (this.selSlot !== null) {
      const pull = el('button', { class: 'rbtn' }, `Pull feeder ${this.selSlot + 1} out`);
      pull.onclick = () => {
        const err = g.pullFeeder(this.selSlot!);
        if (err) this.app.hud.toast(err, 'warn', 'PX-9');
        this.render();
      };
      nodes.push(el('div', { style: 'margin-top:6px' }, pull, el('p', { style: 'font-size:11px;color:#333' }, 'Press STOP first. Pull a feeder out of a running machine and the interlock will fault it.')));
    }
    this.win.replaceChildren(...nodes);
    this.drawTape();
  }

  private pockets(): number {
    return 9;
  }

  private tapeClick(e: PointerEvent) {
    const g = this.app.game;
    if (g.line.feederOut === null) return;
    const r = this.tape.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * this.tape.width;
    const pitch = this.tape.width / (this.pockets() + 1);
    const i = Math.round(x / pitch) - 1;
    if (i < 0 || i >= this.pockets()) return;
    if (i < 3) {
      this.app.hud.toast('That pocket is already empty (the machine picked it).', 'info', 'Blue tack');
      return;
    }
    const err = g.takeFromTape();
    if (err) this.app.hud.toast(err, 'warn', 'Blue tack');
    else this.app.hud.toast('Got one on the blue tack.', 'good', 'Blue tack');
    this.render();
  }

  private drawTape() {
    const g = this.app.game;
    if (g.line.feederOut === null) return;
    const reel = g.slots[g.line.feederOut].reel;
    const ctx = this.tape.getContext('2d')!;
    const W = this.tape.width;
    const H = this.tape.height;
    ctx.fillStyle = '#20242a';
    ctx.fillRect(0, 0, W, H);
    // Carrier tape (embossed black plastic), sprocket holes along the top edge.
    ctx.fillStyle = '#121315';
    ctx.fillRect(0, 30, W, 100);
    ctx.fillStyle = '#20242a';
    for (let x = 12; x < W; x += 26) {
      ctx.beginPath();
      ctx.arc(x, 42, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    const part = reel ? PART_BY_IPN.get(reel.ipn) : undefined;
    const pkg = part ? PACKAGES[part.pkg] : null;
    const pitch = W / (this.pockets() + 1);
    for (let i = 0; i < this.pockets(); i++) {
      const x = pitch * (i + 1);
      ctx.fillStyle = '#060607';
      ctx.fillRect(x - 20, 58, 40, 56);
      if (i >= 3 && pkg && reel && reel.count > i - 3) {
        const s = Math.min(34 / pkg.w, 46 / pkg.h, 12);
        ctx.fillStyle = part!.body;
        ctx.fillRect(x - (pkg.w * s) / 2, 86 - (pkg.h * s) / 2, pkg.w * s, pkg.h * s);
        if (pkg.kind === 'chip' || pkg.kind === 'led' || pkg.kind === 'tant') {
          ctx.fillStyle = '#d7dade';
          ctx.fillRect(x - (pkg.w * s) / 2, 86 - (pkg.h * s) / 2, pkg.w * s * 0.18, pkg.h * s);
          ctx.fillRect(x + (pkg.w * s) / 2 - pkg.w * s * 0.18, 86 - (pkg.h * s) / 2, pkg.w * s * 0.18, pkg.h * s);
        }
      }
    }
    // Cover tape, peeled back over the first pockets.
    ctx.fillStyle = 'rgba(210,225,235,0.28)';
    ctx.fillRect(pitch * 3.5, 52, W, 68);
    ctx.fillStyle = '#9ab';
    ctx.font = '12px monospace';
    ctx.fillText(`${reel?.label ?? ''}  ~${reel?.labelCount ?? 0} left`, 8, 20);
    // Blue tack blob on the cursor side.
    ctx.fillStyle = '#3b7be0';
    ctx.beginPath();
    ctx.ellipse(W - 30, 16, 16, 10, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
