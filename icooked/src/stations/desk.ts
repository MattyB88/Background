import { clamp, el, fmtMoney, fmtTime } from '../core/util';
import { LIBRARY, PACKAGES, PART_BY_IPN, type ErpPart, type Light, type PkgId, type SearchMethod } from '../sim/parts';
import type { FidShape, Job, PuzzleRow } from '../sim/types';
import { paintBareBoard } from '../render/boardpaint';
import { Station } from './base';
import { Desktop } from './desktop';

interface Work {
  folder: number | null;
  ipn: (string | null)[];
  des: (string | null)[][];
  nx: number;
  ny: number;
  fids: { found: boolean; shape: FidShape | null; thr: number }[];
  name: string;
}

const LIGHTS: Light[] = ['front', 'side', 'back'];
const METHODS: SearchMethod[] = ['body', 'leads', 'corners'];

/** The programming desk: a retro workstation with schedule, baselines, ERP, BOM editor and PX-9 programmer. */
export class DeskStation extends Station {
  private desk!: Desktop;
  private jobId: number | null = null;
  private work = new Map<number, Work>();
  private selFolder: number | null = null;
  private erpQuery = '';
  private erpTab: 'parts' | 'assy' = 'parts';
  private picker: HTMLElement | null = null;
  private step = 1;
  private t = 0;

  build() {
    this.desk = new Desktop();
    this.body.append(this.desk.root);
    this.desk.addDock('🗓', 'Schedule', () => this.openSchedule());
    this.desk.addDock('📁', 'Baselines', () => this.openBaselines());
    this.desk.addDock('🗂', 'Engineer', () => this.openEngineer());
    this.desk.addDock('🏢', 'ERP', () => this.openErp());
    this.desk.addDock('📋', 'BOM Edit', () => this.openBom());
    this.desk.addDock('🧩', 'ODB++', () => this.openOdb());
    this.desk.addDock('⚙', 'PX-9 Prog', () => this.openProg());
    this.desk.root.addEventListener('pointerdown', (e) => {
      if (this.picker && !this.picker.contains(e.target as Node)) this.closePicker();
    });
  }

  status(): string {
    const g = this.app.game;
    const offered = g.jobs.filter((j) => j.status === 'offered').length;
    const toProg = g.jobs.filter((j) => j.status === 'accepted').length;
    const bits = [];
    if (offered) bits.push(`${offered} new offer(s)`);
    if (toProg) bits.push(`${toProg} job(s) to program`);
    return bits.join(' · ');
  }

  enter() {
    if (!this.desk.isOpen('sched')) this.openSchedule();
  }

  update(dt: number) {
    this.t -= dt;
    if (this.t <= 0 && this.canRefresh() && !this.picker) {
      this.t = 1;
      if (this.desk.isOpen('sched')) this.desk.refresh('sched');
    }
  }

  private get job(): Job | undefined {
    return this.app.game.job(this.jobId);
  }

  private workFor(j: Job): Work {
    let w = this.work.get(j.id);
    if (!w) {
      const fit = this.app.game.panelFit(j);
      w = { folder: null, ipn: [], des: [], nx: fit.nx, ny: fit.ny, fids: j.product.board.fids.map(() => ({ found: false, shape: null, thr: 50 })), name: '' };
      this.work.set(j.id, w);
    }
    return w;
  }

  private select(j: Job) {
    this.jobId = j.id;
    this.step = 1;
    this.desk.refreshAll();
  }

  private closePicker() {
    this.picker?.remove();
    this.picker = null;
  }

  // ---------------------------------------------------------------- Schedule

  private openSchedule() {
    this.desk.open({ id: 'sched', title: 'schedule.txt — /home/prod', x: 20, y: 20, w: 760, h: 330, render: (b) => this.renderSchedule(b) });
  }

  private renderSchedule(b: HTMLElement) {
    const g = this.app.game;
    const t = el('table', { class: 'grid' }, el('tr', {},
      ...['Assembly', 'Product', 'Customer', 'Type', 'Qty', 'Due', '$/brd', 'Status', ''].map((h) => el('th', {}, h))));
    const jobs = g.jobs.filter((j) => j.status !== 'declined' && j.status !== 'finished').sort((a, b2) => a.dueAt - b2.dueAt);
    for (const j of jobs) {
      const late = g.t > j.dueAt && j.status !== 'offered';
      const act = el('td');
      if (j.status === 'offered') {
        const acc = el('button', { class: 'rbtn go' }, 'Accept');
        acc.onclick = () => {
          g.acceptJob(j);
          this.select(j);
        };
        const dec = el('button', { class: 'rbtn stop' }, 'Decline');
        dec.onclick = () => {
          g.declineJob(j);
          this.desk.refreshAll();
        };
        act.append(acc, ' ', dec);
      } else if (j.status === 'accepted') {
        const p = el('button', { class: 'rbtn' }, j.id === this.jobId ? '▶ selected' : 'Program');
        p.onclick = () => {
          this.select(j);
          this.openBaselines();
        };
        act.append(p);
      } else if (j.status === 'ready' || j.status === 'running') {
        if (j.card === 'none') {
          const pc = el('button', { class: 'rbtn' }, '🖨 Print work card');
          pc.onclick = () => {
            g.printCard(j);
            this.app.hud.toast(`Work card for ${j.product.asmIpn} is printing at the office printer.`, 'info', 'Printer');
            this.desk.refresh('sched');
          };
          act.append(pc);
        } else act.append(j.card === 'printed' ? 'card in printer tray' : 'card on clipboard');
      }
      t.append(el('tr', { class: `${late ? 'late' : ''}${j.id === this.jobId ? ' sel' : ''}` },
        el('td', {}, j.product.asmIpn), el('td', {}, j.product.name), el('td', {}, j.product.customer),
        el('td', {}, j.kind === 'contract' ? 'CONTRACT' : 'in-house'), el('td', {}, String(j.qty)),
        el('td', {}, j.status === 'offered' ? `offer ${fmtTime(150 - (g.t - j.arrivedAt))}` : late ? 'LATE' : fmtTime(j.dueAt - g.t)),
        el('td', {}, fmtMoney(j.price)), el('td', {}, j.status), act));
    }
    b.append(t, el('p', {}, 'Contracts pay more and score more, but come with "engineering data". In-house jobs already have programs.'));
  }

  // ---------------------------------------------------------------- Baselines

  private allFolders(): { job: Job; idx: number; name: string; rev: string }[] {
    const g = this.app.game;
    const out: { job: Job; idx: number; name: string; rev: string }[] = [];
    for (const j of g.jobs) {
      if (!j.puzzle) continue;
      j.puzzle.folders.forEach((f, idx) => out.push({ job: j, idx, name: f.name, rev: f.rev }));
    }
    return out;
  }

  private openBaselines() {
    this.desk.open({ id: 'base', title: '/net/baselines — File Manager', x: 60, y: 60, w: 620, h: 380, render: (b) => this.renderBaselines(b) });
  }

  private renderBaselines(b: HTMLElement) {
    const j = this.job;
    const all = this.allFolders();
    const list = el('div', { class: 'inset', style: 'height:150px;overflow:auto' });
    const seen = new Set<string>();
    for (const f of all) {
      const key = `${f.job.product.key}:${f.idx}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const isCur = j && f.job.id === j.id;
      const row = el('div', { class: `folder-row${isCur && this.selFolder === f.idx ? ' sel' : ''}` }, '📁 ', f.name);
      row.onclick = () => {
        if (!isCur) {
          this.app.hud.toast(j ? 'That folder is for a different job.' : 'Pick a job on the schedule first.', 'info', 'Baselines');
          return;
        }
        this.selFolder = f.idx;
        this.desk.refresh('base');
      };
      list.append(row);
    }
    for (const junk of ['old stuff DO NOT DELETE', "Dave's backup (2)", 'test', 'New Folder (7)']) list.append(el('div', { class: 'folder-row', style: 'color:#666' }, '📁 ', junk));
    b.append(el('div', {}, j ? `Job: ${j.product.asmIpn} (${j.product.name}) — find its release folder.` : 'No job selected (Schedule → Program).'), list);
    if (j && this.selFolder !== null && j.puzzle) {
      const f = j.puzzle.folders[this.selFolder];
      if (f) {
        const use = el('button', { class: 'rbtn go' }, 'Use this release for the program');
        use.onclick = () => {
          const w = this.workFor(j);
          w.folder = this.selFolder;
          w.ipn = f.rows.map(() => null);
          w.des = f.rows.map((r) => r.shownDes.map(() => null));
          this.app.audio.play('click');
          this.openBom();
          this.desk.refreshAll();
        };
        const odb = el('button', { class: 'rbtn' }, 'Open ODB++');
        odb.onclick = () => this.openOdb(this.selFolder!);
        b.append(el('div', { class: 'inset', style: 'margin-top:6px' },
          el('b', {}, f.name), el('br'),
          ...f.files.map((x) => el('div', {}, `  📄 ${x}`)),
          el('div', { style: 'margin-top:4px;color:#555' }, `README: ${f.readme}`)),
          el('div', { style: 'display:flex;gap:6px;margin-top:6px' }, use, odb));
        const w = this.work.get(j.id);
        if (w?.folder === this.selFolder) b.append(el('div', { style: 'color:#060;margin-top:4px' }, '✓ In use for this program.'));
      }
    }
  }

  // ---------------------------------------------------------------- Engineer

  private openEngineer() {
    this.desk.open({ id: 'eng', title: '/home/engineering — notes', x: 120, y: 90, w: 480, h: 360, render: (b) => this.renderEngineer(b) });
  }

  private renderEngineer(b: HTMLElement) {
    const j = this.job;
    if (!j?.puzzle) {
      b.append('Select a contract job on the schedule.');
      return;
    }
    b.append(el('div', {}, `📄 notes_${j.product.name.toLowerCase().replace(/\s+/g, '_')}.txt`),
      el('pre', { class: 'inset note-paper', style: 'white-space:pre-wrap;margin:4px 0 10px' }, j.puzzle.notes.map((n) => `- ${n}`).join('\n')),
      el('div', {}, '✉ latest.eml'),
      el('pre', { class: 'inset', style: 'white-space:pre-wrap;margin-top:4px' }, j.puzzle.email));
  }

  // ---------------------------------------------------------------- ERP

  private openErp() {
    this.desk.open({ id: 'erp', title: 'OmniTrack ERP 6.2 — Internet Explorer-ish', x: 200, y: 40, w: 640, h: 440, render: (b) => this.renderErp(b) });
  }

  private renderErp(b: HTMLElement) {
    const g = this.app.game;
    b.classList.add('erp');
    const tabs = el('div', { style: 'margin:4px 0' });
    for (const [k, label] of [['parts', 'Item Master'], ['assy', 'Assemblies']] as const) {
      const a = el('a', { href: '#', style: `margin-right:12px;${this.erpTab === k ? 'font-weight:700' : ''}` }, label);
      a.onclick = (e) => {
        e.preventDefault();
        this.erpTab = k;
        this.desk.refresh('erp');
      };
      tabs.append(a);
    }
    b.append(el('div', { class: 'erp-head' }, 'OmniTrack ERP'), tabs);
    if (this.erpTab === 'assy') {
      const t = el('table', { class: 'grid' }, el('tr', {}, ...['Assembly', 'Description', 'Customer', 'Bare PCB', 'Status'].map((h) => el('th', {}, h))));
      for (const p of g.products) {
        t.append(el('tr', {}, el('td', {}, p.asmIpn), el('td', {}, p.name.toUpperCase()), el('td', {}, p.customer), el('td', {}, p.pcbIpn), el('td', {}, 'RELEASED')));
      }
      b.append(t);
      return;
    }
    const q = el('input', { type: 'text', value: this.erpQuery, placeholder: 'search IPN / description, e.g. "10K 0603" or "100nF"', style: 'width:100%' }) as HTMLInputElement;
    const results = el('div');
    const run = () => {
      this.erpQuery = q.value;
      const terms = q.value.toUpperCase().split(/\s+/).filter(Boolean);
      const hits = terms.length ? LIBRARY.filter((p) => terms.every((t) => `${p.ipn} ${p.desc} ${p.mpn}`.toUpperCase().includes(t))).slice(0, 60) : [];
      const t = el('table', { class: 'grid' }, el('tr', {}, ...['IPN', 'Description', 'MPN', 'Stock', 'Approved alt'].map((h) => el('th', {}, h))));
      for (const p of hits) t.append(el('tr', {}, el('td', {}, p.ipn), el('td', {}, p.desc), el('td', {}, p.mpn), el('td', {}, String(g.stores.get(p.ipn) ?? 0)), el('td', {}, p.alt ?? '')));
      results.replaceChildren(terms.length ? (hits.length ? t : el('p', {}, 'No records found. (Have you tried turning it off and on again?)')) : el('p', {}, 'Type to search the item master.'));
    };
    q.oninput = run;
    b.append(q, results);
    run();
    setTimeout(() => q.focus(), 0);
  }

  // ---------------------------------------------------------------- BOM editor

  private openBom() {
    this.desk.open({ id: 'bom', title: 'bomedit — BOM', x: 40, y: 120, w: 820, h: 420, render: (b) => this.renderBom(b) });
  }

  private rowsOf(j: Job): PuzzleRow[] | null {
    const w = this.work.get(j.id);
    if (!j.puzzle || w?.folder == null) return null;
    return j.puzzle.folders[w.folder].rows;
  }

  private renderBom(b: HTMLElement) {
    const j = this.job;
    if (!j?.puzzle) {
      b.append('Select a contract job on the schedule.');
      return;
    }
    const rows = this.rowsOf(j);
    if (!rows) {
      b.append(`No release loaded for ${j.product.asmIpn}. Open Baselines, find the right folder, "Use this release".`);
      return;
    }
    const w = this.workFor(j);
    const f = j.puzzle.folders[w.folder!];
    b.append(el('div', { style: 'margin-bottom:4px' }, `${f.name}  —  BOM for ${f.files[1] ?? ''}. Orange = blank. Click any IPN to change it.`));
    const t = el('table', { class: 'grid' }, el('tr', {}, ...['#', 'Designators', 'Qty', 'Value (eng.)', 'Pkg', 'IPN', 'ERP description'].map((h) => el('th', {}, h))));
    rows.forEach((row, ri) => {
      const desCell = el('td');
      row.shownDes.forEach((d, si) => {
        if (si) desCell.append(', ');
        if (d !== null) desCell.append(d);
        else {
          const cur = w.des[ri]?.[si] ?? null;
          const span = el('span', { class: `blank${cur ? ' filled' : ''}` }, cur ?? '??');
          span.onclick = (e) => this.pickDes(e, j, ri, si);
          desCell.append(span);
        }
      });
      const chosen = w.ipn[ri] ?? row.shownIpn;
      const valid = chosen ? PART_BY_IPN.get(chosen) : undefined;
      const ipnCell = el('td', { class: `cell-ipn${row.shownIpn === null && !w.ipn[ri] ? ' blank' : ''}${w.ipn[ri] ? ' edited' : ''}` }, chosen ?? '??');
      ipnCell.onclick = (e) => this.pickIpn(e, j, ri);
      t.append(el('tr', {},
        el('td', {}, String(ri + 1)), desCell, el('td', {}, String(row.shownDes.length)), el('td', {}, row.valueText), el('td', {}, row.pkgText),
        ipnCell, el('td', { style: valid ? '' : 'color:#b00' }, valid ? valid.desc : chosen ? 'NOT FOUND IN ERP' : '')));
    });
    b.append(t);
  }

  private showPicker(e: MouseEvent, items: { label: string; value: string | null; dim?: boolean }[], onPick: (v: string | null) => void) {
    this.closePicker();
    const p = el('div', { class: 'picker' });
    for (const it of items) {
      const d = el('div', { style: it.dim ? 'color:#999' : '' }, it.label);
      d.onclick = () => {
        onPick(it.value);
        this.closePicker();
      };
      p.append(d);
    }
    const r = this.desk.root.getBoundingClientRect();
    p.style.left = `${Math.min(e.clientX - r.left, r.width - 380)}px`;
    p.style.top = `${Math.min(e.clientY - r.top + 8, r.height - 280)}px`;
    this.desk.root.append(p);
    this.picker = p;
    e.stopPropagation();
  }

  private pickDes(e: MouseEvent, j: Job, ri: number, si: number) {
    const rows = this.rowsOf(j)!;
    const w = this.workFor(j);
    const used = new Set<string>();
    rows.forEach((r, rj) => r.shownDes.forEach((d, sj) => {
      const v = d ?? w.des[rj]?.[sj];
      if (v) used.add(v);
    }));
    const prefix = rows[ri].shownDes.find((d) => d)?.replace(/\d+/g, '') ?? rows[ri].truthDes[0].replace(/\d+/g, '');
    const all = j.product.board.placements.map((p) => p.des).filter((d) => d.replace(/\d+/g, '') === prefix)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const items = all.map((d) => ({ label: `${d}${used.has(d) ? '  (in BOM)' : ''}`, value: d, dim: used.has(d) }));
    items.unshift({ label: '(leave blank)', value: null as unknown as string, dim: false });
    this.showPicker(e, items, (v) => {
      w.des[ri][si] = v;
      this.desk.refresh('bom');
    });
  }

  private pickIpn(e: MouseEvent, j: Job, ri: number) {
    const rows = this.rowsOf(j)!;
    const row = rows[ri];
    const w = this.workFor(j);
    const truth = PART_BY_IPN.get(row.truthIpn)!;
    const cands: ErpPart[] = LIBRARY.filter((p) => p.pkg === truth.pkg && p.category === truth.category);
    const items: { label: string; value: string | null }[] = cands.map((p) => ({ label: `${p.ipn}  ${p.desc}`, value: p.ipn }));
    items.unshift({ label: `(as released: ${row.shownIpn ?? 'blank'})`, value: null });
    this.showPicker(e, items, (v) => {
      w.ipn[ri] = v;
      this.desk.refresh('bom');
    });
  }

  // ---------------------------------------------------------------- ODB++ viewer

  private openOdb(folder?: number) {
    if (folder !== undefined) this.selFolder = folder;
    this.desk.open({ id: 'odb', title: 'odbview — placement data', x: 300, y: 70, w: 640, h: 460, render: (b) => this.renderOdb(b) });
  }

  private renderOdb(b: HTMLElement) {
    const j = this.job;
    if (!j) {
      b.append('Select a job.');
      return;
    }
    const def = j.product.board;
    const c = el('canvas');
    const s = Math.min(9, 580 / def.w);
    c.width = Math.ceil(def.w * s);
    c.height = Math.ceil(def.h * s);
    c.style.width = `${Math.min(590, def.w * s)}px`;
    paintBareBoard(c.getContext('2d')!, def, s);
    const t = el('table', { class: 'grid' }, el('tr', {}, ...['Des', 'Package', 'X', 'Y', 'Rot'].map((h) => el('th', {}, h))));
    for (const p of [...def.placements].sort((a, b2) => a.des.localeCompare(b2.des, undefined, { numeric: true }))) {
      t.append(el('tr', {}, el('td', {}, p.des), el('td', {}, PART_BY_IPN.get(p.ipn)!.pkg), el('td', {}, p.x.toFixed(1)), el('td', {}, p.y.toFixed(1)), el('td', {}, String(p.rot))));
    }
    b.append(el('div', {}, `${def.pcbIpn}  ${def.w}x${def.h} mm  ${def.placements.length} placements`), c, t);
  }

  // ---------------------------------------------------------------- PX-9 programmer

  private openProg() {
    this.desk.open({ id: 'prog', title: 'PX-9 Programmer — offline', x: 160, y: 30, w: 720, h: 520, render: (b) => this.renderProg(b) });
  }

  private renderProg(b: HTMLElement) {
    const g = this.app.game;
    const j = this.job;
    if (!j || j.status !== 'accepted') {
      b.append('Select an accepted contract on the schedule to program it.');
      return;
    }
    const w = this.workFor(j);
    const steps = ['1 Layout', '2 PCB / Panel', '3 Fiducials', '4 Packages', '5 Save'];
    const tabs = el('div', { style: 'display:flex;gap:4px;margin-bottom:8px' });
    steps.forEach((s, i) => {
      const t = el('button', { class: `rbtn${this.step === i + 1 ? ' go' : ''}` }, s);
      t.onclick = () => {
        this.step = i + 1;
        this.desk.refresh('prog');
      };
      tabs.append(t);
    });
    b.append(tabs);
    const def = j.product.board;
    if (this.step === 1) {
      const name = el('input', { type: 'text', value: w.name, placeholder: `${j.product.asmIpn}.px9`, style: 'width:260px' }) as HTMLInputElement;
      name.oninput = () => (w.name = name.value);
      const next = el('button', { class: 'rbtn go' }, 'Create layout →');
      next.onclick = () => {
        this.step = 2;
        this.app.audio.play('click');
        this.desk.refresh('prog');
      };
      b.append(el('div', { class: 'inset' },
        el('div', {}, 'Layout name: ', name),
        el('div', { style: 'margin-top:6px' }, `Conveyor width: auto (${def.h + 12} mm)`),
        el('div', {}, 'Board support: magnetic pins x4'),
        el('div', { style: 'margin-top:8px' }, next)));
    } else if (this.step === 2) {
      const fit = g.panelFit(j);
      const nx = el('input', { type: 'number', min: '1', max: String(fit.nx), value: String(w.nx), style: 'width:60px' }) as HTMLInputElement;
      const ny = el('input', { type: 'number', min: '1', max: String(fit.ny), value: String(w.ny), style: 'width:60px' }) as HTMLInputElement;
      const upd = () => {
        w.nx = clamp(Math.round(Number(nx.value) || 1), 1, fit.nx);
        w.ny = clamp(Math.round(Number(ny.value) || 1), 1, fit.ny);
        this.desk.refresh('prog');
      };
      nx.onchange = upd;
      ny.onchange = upd;
      const per = w.nx * w.ny;
      const cycle = def.placements.length * per * 0.22 + 6;
      b.append(el('div', { class: 'inset' },
        el('div', {}, `Board ${def.w} x ${def.h} mm. Machine max panel 250 x 200 mm → up to ${fit.nx} x ${fit.ny}.`),
        el('div', { style: 'margin:6px 0' }, 'Panel: ', nx, ' x ', ny, `  = ${per} boards per cycle`),
        el('div', {}, `Estimated PX-9 cycle: ~${Math.round(cycle)} s per panel (${(cycle / per).toFixed(1)} s/board)`),
        el('div', { style: 'color:#555;margin-top:4px' }, 'More boards per panel = fewer fiducial/load cycles, but each panel ties up the PX-9 longer and a bad print hits every board on it.')));
    } else if (this.step === 3) {
      b.append(this.fidEditor(j, w));
    } else if (this.step === 4) {
      b.append(this.packageList(j));
    } else {
      b.append(this.saveStep(j, w));
    }
  }

  private fidEditor(j: Job, w: Work): HTMLElement {
    const def = j.product.board;
    const wrap = el('div');
    const c = el('canvas', { style: 'cursor:crosshair;max-width:100%' });
    const s = Math.min(7, 520 / def.w);
    c.width = Math.ceil(def.w * s);
    c.height = Math.ceil(def.h * s);
    const ctx = c.getContext('2d')!;
    paintBareBoard(ctx, def, s);
    w.fids.forEach((f, i) => {
      if (!f.found) return;
      const fd = def.fids[i];
      ctx.strokeStyle = '#ff0';
      ctx.lineWidth = 2;
      ctx.strokeRect(fd.x * s - 12, (def.h - fd.y) * s - 12, 24, 24);
      ctx.fillStyle = '#ff0';
      ctx.fillText(`F${i + 1}`, fd.x * s + 14, (def.h - fd.y) * s);
    });
    c.onclick = (e) => {
      const r = c.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * c.width / s;
      const y = def.h - ((e.clientY - r.top) / r.height) * c.height / s;
      const i = def.fids.findIndex((f) => Math.hypot(f.x - x, f.y - y) < 3);
      if (i >= 0) {
        w.fids[i].found = true;
        this.app.audio.play('click');
      } else this.app.hud.toast('No fiducial there. Look for small bare copper marks near the corners.', 'info', 'PX-9 Prog');
      this.desk.refresh('prog');
    };
    wrap.append(el('div', {}, 'Click the fiducials on the board (need at least 2). Then set the search shape and threshold until the camera sees a clean mark.'), c);
    w.fids.forEach((f, i) => {
      if (!f.found) return;
      const fd = def.fids[i];
      const shape = el('select') as HTMLSelectElement;
      shape.append(el('option', { value: '' }, 'shape…'));
      for (const sh of ['round', 'cross', 'square'] as FidShape[]) {
        const o = el('option', { value: sh }, sh) as HTMLOptionElement;
        if (f.shape === sh) o.selected = true;
        shape.append(o);
      }
      shape.onchange = () => {
        f.shape = (shape.value || null) as FidShape | null;
        this.desk.refresh('prog');
      };
      const thr = el('input', { type: 'range', min: '0', max: '100', value: String(f.thr) }) as HTMLInputElement;
      const cam = el('canvas', { width: '90', height: '90', style: 'background:#000;vertical-align:middle' }) as HTMLCanvasElement;
      const drawCam = () => {
        const cx = cam.getContext('2d')!;
        const img = cx.createImageData(90, 90);
        const bg = 0.25;
        const fg = 0.25 + fd.contrast * 0.6;
        const t = f.thr / 100;
        for (let yy = 0; yy < 90; yy++) for (let xx = 0; xx < 90; xx++) {
          const dx = xx - 45;
          const dy = yy - 45;
          let inside = false;
          if (fd.shape === 'round') inside = dx * dx + dy * dy < 20 * 20;
          else if (fd.shape === 'cross') inside = (Math.abs(dx) < 24 && Math.abs(dy) < 6) || (Math.abs(dy) < 24 && Math.abs(dx) < 6);
          else inside = Math.abs(dx) < 18 && Math.abs(dy) < 18;
          const v = (inside ? fg : bg) + (Math.random() - 0.5) * 0.16;
          const on = v > t;
          const k = (yy * 90 + xx) * 4;
          img.data[k] = img.data[k + 1] = img.data[k + 2] = on ? 255 : 0;
          img.data[k + 3] = 255;
        }
        cx.putImageData(img, 0, 0);
      };
      thr.oninput = () => {
        f.thr = Number(thr.value);
        drawCam();
      };
      drawCam();
      wrap.append(el('div', { class: 'inset', style: 'display:flex;gap:10px;align-items:center;margin-top:6px' }, `F${i + 1}`, cam, el('div', {}, 'Shape ', shape, el('br'), 'Threshold ', thr)));
    });
    return wrap;
  }

  private fidQuality(j: Job, w: Work): number {
    const def = j.product.board;
    const qs = w.fids.map((f, i) => {
      if (!f.found) return -1;
      const fd = def.fids[i];
      const ideal = (0.25 + fd.contrast * 0.3) * 100;
      const thrQ = clamp(1 - Math.abs(f.thr - ideal) / (fd.contrast * 30 + 5), 0, 1);
      return (f.shape === fd.shape ? 0.5 : 0.1) + 0.5 * thrQ;
    }).filter((q) => q >= 0).sort((a, b) => b - a);
    if (qs.length < 2) return 0;
    return (qs[0] + qs[1]) / 2;
  }

  private packagesOf(j: Job): PkgId[] {
    return [...new Set(j.product.board.placements.map((p) => PART_BY_IPN.get(p.ipn)!.pkg))];
  }

  private packageList(j: Job): HTMLElement {
    const g = this.app.game;
    const wrap = el('div');
    wrap.append(el('div', { style: 'margin-bottom:6px' }, 'Every package needs a vision model. New ones must be taught. How well you teach decides placement accuracy and camera rejects.'));
    const t = el('table', { class: 'grid' }, el('tr', {}, el('th', {}, 'Package'), el('th', {}, 'Library'), el('th', {}, '')));
    for (const pkg of this.packagesOf(j)) {
      const q = g.taught[pkg];
      const btn = el('button', { class: 'rbtn' }, q === undefined ? 'Teach…' : 'Re-teach…');
      btn.onclick = () => this.openTeach(pkg);
      t.append(el('tr', {}, el('td', {}, pkg), el('td', { style: q === undefined ? 'color:#b00;font-weight:700' : '' }, q === undefined ? 'NOT IN LIBRARY' : 'taught'), el('td', {}, btn)));
    }
    wrap.append(t);
    return wrap;
  }

  private openTeach(pkg: PkgId) {
    this.desk.open({ id: 'teach', title: `Package teach — ${pkg}`, x: 260, y: 90, w: 560, h: 470, render: (b) => this.renderTeach(b, pkg) });
  }

  private renderTeach(b: HTMLElement, pkgId: PkgId) {
    const pkg = PACKAGES[pkgId];
    const W = 360;
    const H = 300;
    const c = el('canvas', { width: String(W), height: String(H), class: 'teach-canvas' }) as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const zoom = Math.min((W * 0.5) / (pkg.w + 2), (H * 0.5) / (pkg.h + 2));
    const off = { x: W / 2 + (Math.random() - 0.5) * 30, y: H / 2 + (Math.random() - 0.5) * 30 };
    const body = { x: off.x - (pkg.w * zoom) / 2, y: off.y - (pkg.h * zoom) / 2, w: pkg.w * zoom, h: pkg.h * zoom };
    let light: Light = 'front';
    let method: SearchMethod = 'body';
    let box: { x: number; y: number; w: number; h: number } | null = null;
    let drag: { x: number; y: number } | null = null;
    const draw = () => {
      ctx.fillStyle = light === 'back' ? '#e8e8e8' : '#050505';
      ctx.fillRect(0, 0, W, H);
      const leadCol = light === 'side' ? '#f4f4f4' : light === 'front' ? '#8a8a8a' : '#050505';
      const bodyCol = light === 'front' ? '#9a9a9a' : light === 'side' ? '#2a2a2a' : '#050505';
      ctx.fillStyle = leadCol;
      for (const p of pkg.pads) {
        if (p.w > 2.5 && p.h > 2.5) continue;
        ctx.fillRect(off.x + (p.x - p.w * 0.35) * zoom, off.y + (-p.y - p.h * 0.35) * zoom, p.w * 0.7 * zoom, p.h * 0.7 * zoom);
      }
      ctx.fillStyle = bodyCol;
      ctx.fillRect(body.x, body.y, body.w, body.h);
      // Sensor noise
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.12})`;
        ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
      }
      ctx.strokeStyle = '#2f6';
      ctx.setLineDash([4, 3]);
      if (box) ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.setLineDash([]);
      ctx.fillStyle = '#2f6';
      ctx.font = '12px monospace';
      ctx.fillText(`light:${light} search:${method}`, 8, 16);
      ctx.fillText('drag a box around the part body', 8, H - 8);
    };
    const pos = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
    };
    c.onpointerdown = (e) => {
      drag = pos(e);
      box = { x: drag.x, y: drag.y, w: 0, h: 0 };
      c.setPointerCapture(e.pointerId);
    };
    c.onpointermove = (e) => {
      if (!drag) return;
      const p = pos(e);
      box = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) };
      draw();
    };
    c.onpointerup = () => (drag = null);
    const choice = <T extends string>(label: string, opts: T[], get: () => T, set: (v: T) => void) => {
      const d = el('div', { style: 'margin:4px 0' }, `${label}: `);
      for (const o of opts) {
        const btn = el('button', { class: `rbtn${get() === o ? ' go' : ''}` }, o);
        btn.onclick = () => {
          set(o);
          d.querySelectorAll('button').forEach((x) => x.classList.toggle('go', x.textContent === o));
          draw();
        };
        d.append(btn, ' ');
      }
      return d;
    };
    const save = el('button', { class: 'rbtn go' }, 'Save to library');
    const result = el('div');
    save.onclick = () => {
      if (!box || box.w < 4) {
        result.textContent = 'Draw a box around the body first.';
        return;
      }
      const ix = Math.max(0, Math.min(box.x + box.w, body.x + body.w) - Math.max(box.x, body.x));
      const iy = Math.max(0, Math.min(box.y + box.h, body.y + body.h) - Math.max(box.y, body.y));
      const inter = ix * iy;
      const iou = inter / (box.w * box.h + body.w * body.h - inter);
      const q = clamp(iou * 0.55 + (light === pkg.bestLight ? 0.25 : 0.05) + (method === pkg.bestMethod ? 0.25 : 0.05) - pkg.teachDifficulty * 0.12, 0.08, 1);
      this.app.game.teach(pkgId, q);
      this.app.audio.play(q > 0.55 ? 'good' : 'click');
      result.replaceChildren(el('b', {}, q > 0.7 ? 'Vision test: PASS' : q > 0.45 ? 'Vision test: PASS (marginal — accept the risk?)' : 'Vision test: found… something. PASS?'));
      this.desk.refresh('prog');
      setTimeout(() => this.desk.close('teach'), 1600);
    };
    b.append(el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, c,
      el('div', { style: 'min-width:150px' },
        el('div', {}, `${pkg.id}  body ${pkg.w} x ${pkg.h} mm, ${pkg.pads.length} terminals`),
        choice('Lighting', LIGHTS, () => light, (v) => (light = v)),
        choice('Search', METHODS, () => method, (v) => (method = v)),
        el('div', { style: 'margin-top:8px' }, save), result)));
    draw();
  }

  private saveStep(j: Job, w: Work): HTMLElement {
    const g = this.app.game;
    const rows = this.rowsOf(j);
    const missingPk = this.packagesOf(j).filter((p) => g.taught[p] === undefined);
    const fidQ = this.fidQuality(j, w);
    const blanks = rows ? rows.reduce((n, r, ri) => n + (r.shownIpn === null && !w.ipn[ri] ? 1 : 0) + r.shownDes.filter((d, si) => d === null && !w.des[ri]?.[si]).length, 0) : 0;
    const problems: string[] = [];
    if (!rows) problems.push('No BOM release loaded (Baselines).');
    if (w.fids.filter((f) => f.found).length < 2) problems.push('Need at least 2 fiducials.');
    if (missingPk.length) problems.push(`Packages not taught: ${missingPk.join(', ')}`);
    const wrap = el('div', { class: 'inset' });
    wrap.append(el('div', {}, el('b', {}, `${w.name || j.product.asmIpn + '.px9'}`)),
      el('div', {}, `Panel ${w.nx} x ${w.ny}`),
      el('div', {}, `BOM blanks left: ${blanks}${blanks ? ' (blank = not placed!)' : ''}`),
      el('div', {}, `Fiducials: ${w.fids.filter((f) => f.found).length} found`));
    for (const p of problems) wrap.append(el('div', { style: 'color:#b00' }, `✗ ${p}`));
    const save = el('button', { class: 'rbtn go', style: 'margin-top:8px' }, 'Save program & release to line');
    save.disabled = problems.length > 0;
    save.onclick = () => {
      g.submitProgram(j, { folder: w.folder!, ipn: w.ipn, des: w.des }, w.nx, w.ny, Math.max(0.15, fidQ), w.name);
      this.app.audio.play('good');
      this.jobId = null;
      this.desk.refreshAll();
    };
    wrap.append(save);
    return wrap;
  }
}
