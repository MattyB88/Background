import { Emitter } from '../core/events';
import { Rng } from '../core/rng';
import { clamp } from '../core/util';
import { makeProduct, makePuzzle } from './catalog';
import { aoiInspect, boardFaults, isRightPart, reflowBoard, testLights } from './defects';
import { LIBRARY, PACKAGES, PART_BY_IPN, type FeederKind, type PkgId } from './parts';
import type {
  BoardInst, FeederSlot, Job, Panel, PlacedPart, Product, PuzzleAnswer, Reel,
} from './types';

export type Ending = 'fire' | 'bankrupt' | 'revolt';
export type ToastKind = 'info' | 'good' | 'warn' | 'bad' | 'sales';

export interface GameEvents extends Record<string, unknown> {
  toast: { text: string; kind: ToastKind; from?: string };
  sfx: { name: string; at?: string };
  over: { ending: Ending };
  shipped: { board: BoardInst; points: number };
}

/** Machine panel limits (mm). */
export const PANEL_MAX_W = 250;
export const PANEL_MAX_H = 200;
export const PANEL_GAP = 4;

export const OVEN_TRAVEL = 30;
export const OVEN_SPACING = 6;

const REEL_SIZE: Record<FeederKind, number> = { T8: 400, T12: 150, T16: 60, STICK: 25, TRAY: 40 };

const SLOT_LAYOUT: FeederKind[] = [
  ...Array<FeederKind>(12).fill('T8'),
  ...Array<FeederKind>(5).fill('T12'),
  ...Array<FeederKind>(3).fill('T16'),
  'STICK', 'STICK', 'TRAY', 'TRAY',
];

export interface LineState {
  activeJobId: number | null;
  printerDirt: number;
  printerT: number;
  feedStopped: boolean;
  ovenLastEntry: number;
  aoiScope: 'critical' | 'full';
  px9Alarm: string | null;
  px9AlarmSlot: number | null;
  px9Paused: boolean;
  /** PX-9 control state: running, stopped by the operator, or a safety fault. */
  machine: 'run' | 'stop' | 'fault';
  /** E-stop: 0 released, 1 pressed, 2 pressed again (override armed). Twist to release. */
  estop: 0 | 1 | 2;
  /** Slot index of a feeder pulled out of the machine. */
  feederOut: number | null;
  maintenance: boolean;
  maintProgress: number;
  aoiT: number;
  testT: number;
}

export interface Stats {
  shipped: number;
  firstPass: number;
  reworked: number;
  scrapped: number;
  flicked: number;
  gamblesWon: number;
  gamblesLost: number;
  maintenances: number;
  jobsDone: number;
  jobsLate: number;
}

const CARD_SALES_NOTES = [
  'Customer is "flexible" on date. They are not.',
  'Promised these for the trade show. Which starts tomorrow.',
  'They asked for gold plating. I said yes. Not sure what that means for you.',
  'Repeat order. Last batch had a wonky LED apparently.',
  'Please do not scrap any. We quoted exactly the quantity.',
  'Customer might visit the line. Look busy.',
  'Rush. Everything is rush. This one is extra rush.',
];

const SALES_LINES = [
  "Great news! I told them we'd do it by Thursday. Which Thursday? This one.",
  'Customer wants to know if we can do it in blue. The board. Not the solder mask. Everything.',
  "They doubled the quantity. Same date. You've got this!",
  "I've pulled in the date on the last one, they were very nice about it.",
  'Is the oven supposed to smell like that?',
  "Quick one: can we swap all the 0603s for 0402s? Should be easy, they're smaller.",
  "Boss says overtime is 'a mindset'.",
];

export function wrapDeg(d: number): number {
  let v = ((d + 180) % 360 + 360) % 360 - 180;
  if (v === -180) v = 180;
  return v;
}

export class Game {
  readonly rng: Rng;
  readonly events = new Emitter<GameEvents>();
  t = 0;
  score = 0;
  cash = 9000;
  heat = 8;
  rage = 0;
  stress = 0;
  maintCount = 0;
  over: Ending | null = null;
  overAt = 0;
  streak = 0;
  notes = '';
  products: Product[] = [];
  jobs: Job[] = [];
  panels: Panel[] = [];
  rework: BoardInst[] = [];
  slots: FeederSlot[];
  stores = new Map<string, number>();
  dump = new Map<string, number>();
  altRequests: { ipn: string; altIpn: string; readyAt: number }[] = [];
  testLog: { serial: string; lights: number; t: number; aoi: string[] }[] = [];
  /** Reels on your trolley, picked from the stores rack. */
  carried: Reel[] = [];
  readonly carryMax = 8;
  /** Parts that pinged off the bench onto the floor. */
  floor: string[] = [];
  /** A single loose part held in tweezers / on blue tack. */
  hand: { ipn: string; from: 'floor' | 'feeder' } | null = null;
  taught: Partial<Record<PkgId, number>> = {};
  stats: Stats = { shipped: 0, firstPass: 0, reworked: 0, scrapped: 0, flicked: 0, gamblesWon: 0, gamblesLost: 0, maintenances: 0, jobsDone: 0, jobsLate: 0 };
  line: LineState = {
    activeJobId: null, printerDirt: 0, printerT: 0, feedStopped: false, ovenLastEntry: -99,
    aoiScope: 'critical', px9Alarm: null, px9AlarmSlot: null, px9Paused: false, machine: 'run', estop: 0, feederOut: null,
    maintenance: false, maintProgress: 0, aoiT: 0, testT: 0,
  };
  private nextJobAt = 40;
  private nextSalesAt = 90;
  private nextJobId = 1;
  private nextPanelId = 1;
  private serials = new Map<number, number>();
  private productCursor = 0;

  constructor(readonly seed: number) {
    this.rng = new Rng(seed);
    this.slots = SLOT_LAYOUT.map((kind, index) => ({ index, kind, reel: null }));
    // A catalogue of products; the first three are old in-house favourites with programs.
    for (let i = 0; i < 10; i++) this.products.push(makeProduct(i, this.rng, i < 3));
    this.rng.shuffle(this.products);
    this.products.forEach((p, i) => (p.inhouse = i < 3));
    for (const p of this.products.filter((q) => q.inhouse)) {
      for (const pl of p.board.placements) {
        const pkg = PART_BY_IPN.get(pl.ipn)!.pkg;
        this.taught[pkg] = Math.max(this.taught[pkg] ?? 0, this.rng.range(0.82, 0.95));
      }
    }
    this.productCursor = 3;
    // General stock already on the stores rack: a bit of everything, most of it not what you need.
    for (const p of this.rng.shuffle([...LIBRARY]).slice(0, 55)) {
      this.stores.set(p.ipn, Math.round(REEL_SIZE[PACKAGES[p.pkg].feeder] * this.rng.range(0.3, 1)));
    }
    // Day one: one in-house job ready, one contract on the table.
    this.addJob('inhouse', 12).card = 'printed';
    this.addJob('contract', 10);
    // Common parts already on the machine from yesterday.
    const common = ['RES 10K', 'CAP 100nF'];
    const pkgUsed = this.jobs[0].product.board.placements.map((p) => PART_BY_IPN.get(p.ipn)!);
    for (const part of pkgUsed) {
      if (!common.some((c) => part.desc.startsWith(c))) continue;
      const slot = this.slots.find((s) => !s.reel && s.kind === PACKAGES[part.pkg].feeder);
      if (slot && !this.slots.some((s) => s.reel?.ipn === part.ipn)) {
        slot.reel = { ipn: part.ipn, label: part.ipn, count: 260, labelCount: 300, tuning: 0.9, jam: false, source: 'stock' };
      }
    }
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  toast(text: string, kind: ToastKind = 'info', from?: string) {
    this.events.emit('toast', { text, kind, from });
  }
  sfx(name: string, at?: string) {
    this.events.emit('sfx', { name, at });
  }
  job(id: number | null | undefined): Job | undefined {
    return id == null ? undefined : this.jobs.find((j) => j.id === id);
  }
  get activeJob(): Job | undefined {
    return this.job(this.line.activeJobId);
  }
  boardsPerPanel(j: Job): number {
    return j.program ? j.program.nx * j.program.ny : 1;
  }
  panelFit(j: Job): { nx: number; ny: number } {
    const b = j.product.board;
    const nx = Math.max(1, Math.floor((PANEL_MAX_W + PANEL_GAP) / (b.w + PANEL_GAP)));
    const ny = Math.max(1, Math.floor((PANEL_MAX_H + PANEL_GAP) / (b.h + PANEL_GAP)));
    return { nx: Math.min(nx, 4), ny: Math.min(ny, 3) };
  }
  kitCost(j: Job): number {
    let per = 1.4; // bare PCB
    for (const p of j.product.board.placements) per += PART_BY_IPN.get(p.ipn)!.cost;
    return Math.round(per * j.qty * 1.05 + 40);
  }
  get lateJobs(): Job[] {
    return this.jobs.filter((j) => j.status !== 'finished' && j.status !== 'declined' && j.status !== 'offered' && this.t > j.dueAt);
  }
  get overhead(): number {
    return 2.2 + this.t / 700;
  }

  private pickProduct(kind: 'inhouse' | 'contract'): Product {
    if (kind === 'inhouse') {
      const pool = this.products.filter((p) => p.inhouse);
      return this.rng.pick(pool);
    }
    const p = this.products[this.productCursor % this.products.length];
    this.productCursor++;
    if (this.productCursor > this.products.length) {
      // Out of new products: a returning customer with a "small change".
      return this.rng.pick(this.products.slice(3));
    }
    return p;
  }

  addJob(kind: 'inhouse' | 'contract', qtyOverride?: number, forced = false): Job {
    const product = this.pickProduct(kind);
    const qty = qtyOverride ?? (kind === 'inhouse' ? this.rng.int(10, 30) : this.rng.int(8, 24));
    const perBoard = product.board.placements.length * 0.35 + 6;
    const pressure = clamp(1 - this.t / 5400, 0.35, 1);
    const due = this.t + (qty * perBoard + (kind === 'contract' ? 300 : 150)) * (1.6 * pressure + 0.5);
    const job: Job = {
      id: this.nextJobId++,
      product,
      kind,
      qty,
      arrivedAt: this.t,
      dueAt: due,
      price: Math.round(product.board.placements.length * (kind === 'contract' ? 0.9 : 0.6) + (kind === 'contract' ? 12 : 8)),
      status: kind === 'inhouse' ? 'ready' : forced ? 'accepted' : 'offered',
      panelsStarted: 0,
      boardsShipped: 0,
      boardsScrapped: 0,
      boardsDone: 0,
      lateCharged: false,
      printSeed: this.rng.int(1, 1e9),
      card: 'none',
      cardNotes: '',
      salesNote: this.rng.pick(CARD_SALES_NOTES),
    };
    if (kind === 'inhouse') {
      const fit = this.panelFit(job);
      const desIpn: Record<string, string> = {};
      for (const p of product.board.placements) desIpn[p.des] = p.ipn;
      job.program = { name: `${product.asmIpn}.px9`, nx: fit.nx, ny: fit.ny, fidQuality: 0.9, desIpn, setup: {}, adjust: {}, checked: {} };
    } else {
      job.puzzle = makePuzzle(product, clamp(this.t / 3600, 0, 1), this.rng);
    }
    this.jobs.push(job);
    return job;
  }

  acceptJob(j: Job) {
    if (j.status !== 'offered') return;
    j.status = 'accepted';
    this.toast(`Accepted ${j.product.asmIpn} for ${j.product.customer}. Now go find the data.`, 'info');
  }

  declineJob(j: Job) {
    if (j.status !== 'offered') return;
    j.status = 'declined';
    this.toast(`Declined ${j.product.name}. Sales is sulking.`, 'warn');
  }

  // -------------------------------------------------------------------------
  // programming
  // -------------------------------------------------------------------------

  /** Score the BOM Sudoku and turn the answer into the machine's designator map. */
  submitProgram(j: Job, answer: PuzzleAnswer, nx: number, ny: number, fidQuality: number, name: string) {
    const pz = j.puzzle!;
    const folder = pz.folders[answer.folder];
    const desIpn: Record<string, string | null> = {};
    for (const p of j.product.board.placements) desIpn[p.des] = null;
    let right = 0;
    let wrong = 0;
    let bonus = 0;
    folder.rows.forEach((row, ri) => {
      const chosenIpn = answer.ipn[ri] ?? row.shownIpn;
      const des = row.shownDes.map((d, si) => d ?? answer.des[ri]?.[si] ?? null);
      for (const d of des) if (d && d in desIpn) desIpn[d] = chosenIpn && PART_BY_IPN.has(chosenIpn) ? chosenIpn : null;
      if (!folder.correct) return;
      if (row.ipnKind !== 'given') {
        if (chosenIpn === row.truthIpn) {
          right++;
          bonus += row.ipnGamble ? 250 : row.ipnKind === 'wrong' ? 150 : 60;
          if (row.ipnGamble) this.stats.gamblesWon++;
        } else {
          wrong++;
          if (row.ipnGamble) this.stats.gamblesLost++;
        }
      }
      row.shownDes.forEach((d, si) => {
        if (d !== null) return;
        if (des[si] === row.truthDes[si]) {
          right++;
          bonus += row.desGamble[si] ? 250 : 60;
          if (row.desGamble[si]) this.stats.gamblesWon++;
        } else {
          wrong++;
          if (row.desGamble[si]) this.stats.gamblesLost++;
        }
      });
    });
    if (folder.correct) bonus += 150;
    this.score += bonus;
    j.answer = answer;
    j.program = { name: name || `${j.product.asmIpn}.px9`, nx, ny, fidQuality, desIpn, setup: {}, adjust: {}, checked: {} };
    j.status = 'ready';
    const verdict = !folder.correct
      ? 'Program saved. (Something about that folder felt old.)'
      : wrong === 0
        ? `Program saved. Data looked clean: +${bonus}`
        : `Program saved. +${bonus}. Fingers crossed on the rest.`;
    this.toast(verdict, wrong === 0 && folder.correct ? 'good' : 'info');
    void right;
  }

  teach(pkg: PkgId, quality: number) {
    this.taught[pkg] = clamp(quality, 0.05, 1);
  }

  requiredIpns(j: Job): string[] {
    if (!j.program) return [];
    return [...new Set(Object.values(j.program.desIpn).filter((x): x is string => !!x))];
  }

  /** Assign feeder slots: keep what is already loaded, fill free slots, else displace unneeded reels. */
  planSetup(j: Job): Record<string, number> {
    const need = this.requiredIpns(j);
    const setup: Record<string, number> = {};
    const used = new Set<number>();
    for (const ipn of need) {
      const s = this.slots.find((sl) => sl.reel?.label === ipn && !used.has(sl.index));
      if (s) {
        setup[ipn] = s.index;
        used.add(s.index);
      }
    }
    for (const ipn of need) {
      if (ipn in setup) continue;
      const kind = PACKAGES[PART_BY_IPN.get(ipn)!.pkg].feeder;
      const free = this.slots.find((sl) => sl.kind === kind && !sl.reel && !used.has(sl.index))
        ?? this.slots.find((sl) => sl.kind === kind && !used.has(sl.index) && !need.includes(sl.reel?.label ?? ''));
      if (free) {
        setup[ipn] = free.index;
        used.add(free.index);
      }
    }
    return setup;
  }

  /**
   * Operator accepted a component in the machine camera view. Returns how far the
   * programmed position still is from the real lands (mm) and the rotation error.
   */
  checkComponent(j: Job, des: string): { off: number; rot: number } {
    const prog = j.program!;
    const truth = j.product.board.placements.find((p) => p.des === des)!;
    const cad = j.product.cadPlacements.find((p) => p.des === des) ?? truth;
    const adj = prog.adjust[des] ?? { dx: 0, dy: 0, drot: 0 };
    const off = Math.hypot(cad.x + adj.dx - truth.x, cad.y + adj.dy - truth.y);
    const pkg = PACKAGES[PART_BY_IPN.get(truth.ipn)!.pkg];
    let rot = Math.abs(wrapDeg(cad.rot + adj.drot - truth.rot));
    if ((pkg.kind === 'chip' || pkg.kind === 'xtal') && rot > 90) rot = 180 - rot;
    const cadWasWrong = Math.hypot(cad.x - truth.x, cad.y - truth.y) > 0.2 || Math.abs(wrapDeg(cad.rot - truth.rot)) > 1;
    if (!prog.checked[des] && cadWasWrong && off < 0.15 && rot < 3) {
      this.score += 60;
      this.toast(`Fixed a bad CAD placement on ${des}. +60`, 'good', 'PX-9');
    }
    prog.checked[des] = true;
    return { off, rot };
  }

  printCard(j: Job) {
    if (j.card === 'none') j.card = 'printed';
    this.sfx('print');
  }

  /** Grab everything waiting in the office printer tray. */
  takeCards(): Job[] {
    const got = this.jobs.filter((j) => j.card === 'printed');
    for (const j of got) j.card = 'held';
    return got;
  }

  startJob(j: Job): string | null {
    if (j.status !== 'ready') return 'Job is not programmed yet.';
    if (j.card !== 'held') return `You need the work card for ${j.product.asmIpn} on your clipboard. Print it at the desk and grab it from the office printer.`;
    const cur = this.activeJob;
    if (cur && cur.panelsStarted * this.boardsPerPanel(cur) < cur.qty) return `Still running ${cur.product.asmIpn}. Finish or abort it first.`;
    const cost = this.kitCost(j);
    if (this.cash < cost) return `Can't afford the parts kit (${Math.round(cost)}). Ship something first.`;
    this.cash -= cost;
    j.program!.setup = this.planSetup(j);
    // Parts arrive into stores; sometimes the supplier shorts us.
    const counts = new Map<string, number>();
    for (const [, ipn] of Object.entries(j.program!.desIpn)) if (ipn) counts.set(ipn, (counts.get(ipn) ?? 0) + j.qty);
    const shortIpn = this.rng.chance(0.3) ? this.rng.pick([...counts.keys()]) : null;
    for (const [ipn, n] of counts) {
      const got = ipn === shortIpn ? Math.floor(n * this.rng.range(0.3, 0.7)) : Math.ceil(n * 1.1) + 10;
      this.stores.set(ipn, (this.stores.get(ipn) ?? 0) + got);
    }
    if (shortIpn) this.toast(`Stores: we only got some of ${shortIpn}. Supplier "is looking into it".`, 'warn', 'Stores');
    j.status = 'running';
    this.line.activeJobId = j.id;
    this.line.px9Alarm = null;
    this.sfx('changeover');
    this.toast(`Changeover to ${j.product.asmIpn}. Parts kit ${Math.round(cost)}.`, 'info');
    return null;
  }

  abortJob() {
    const j = this.activeJob;
    if (!j) return;
    j.qty = Math.max(j.boardsDone, j.panelsStarted * this.boardsPerPanel(j));
    this.line.activeJobId = null;
    this.toast(`Stopped ${j.product.asmIpn} early. The customer will get what they get.`, 'warn');
  }

  // -------------------------------------------------------------------------
  // feeders & materials
  // -------------------------------------------------------------------------

  loadFromStores(slotIdx: number, ipn: string): string | null {
    const slot = this.slots[slotIdx];
    const part = PART_BY_IPN.get(ipn)!;
    if (PACKAGES[part.pkg].feeder !== slot.kind) return `A ${PACKAGES[part.pkg].feeder} part won't go in a ${slot.kind} slot.`;
    const have = this.stores.get(ipn) ?? 0;
    if (have <= 0) return 'Stores has none. Try an alternate or the dump bin.';
    if (slot.reel) this.unload(slotIdx);
    const n = Math.min(have, REEL_SIZE[slot.kind]);
    this.stores.set(ipn, have - n);
    // Used reels lie about how many parts are left.
    const lie = this.rng.chance(0.3) ? this.rng.range(1.1, 1.6) : 1;
    slot.reel = { ipn, label: ipn, count: n, labelCount: Math.round(n * lie), tuning: 0, jam: this.rng.chance(0.07), source: 'stock' };
    this.clearSlotAlarm(slotIdx);
    this.sfx('feeder');
    return null;
  }

  reelSize(ipn: string): number {
    return REEL_SIZE[PACKAGES[PART_BY_IPN.get(ipn)!.pkg].feeder];
  }

  /** Reels sitting in the stores rack for an IPN (what you'd see on the shelf). */
  rackReels(ipn: string): number {
    const n = this.stores.get(ipn) ?? 0;
    return n <= 0 ? 0 : Math.min(4, Math.ceil(n / this.reelSize(ipn)));
  }

  /** Take one reel off the stores rack onto your trolley. */
  takeReel(ipn: string): string | null {
    if (this.carried.length >= this.carryMax) return `Your trolley is full (${this.carryMax} reels). Load or return some.`;
    const have = this.stores.get(ipn) ?? 0;
    if (have <= 0) return 'That slot on the rack is empty.';
    const n = Math.min(have, this.reelSize(ipn));
    this.stores.set(ipn, have - n);
    const lie = this.rng.chance(0.3) ? this.rng.range(1.1, 1.6) : 1;
    this.carried.push({ ipn, label: ipn, count: n, labelCount: Math.round(n * lie), tuning: 0, jam: this.rng.chance(0.07), source: 'stock' });
    this.sfx('feeder');
    return null;
  }

  returnReel(i: number) {
    const r = this.carried[i];
    if (!r) return;
    this.carried.splice(i, 1);
    if (r.source === 'dump') this.dump.set(r.ipn, (this.dump.get(r.ipn) ?? 0) + r.count);
    else this.stores.set(r.ipn, (this.stores.get(r.ipn) ?? 0) + r.count);
  }

  loadCarried(slotIdx: number, i: number): string | null {
    const r = this.carried[i];
    if (!r) return 'No such reel on the trolley.';
    const err = this.loadReel(slotIdx, r);
    if (!err) this.carried.splice(this.carried.indexOf(r), 1);
    return err;
  }

  loadReel(slotIdx: number, reel: Reel): string | null {
    const slot = this.slots[slotIdx];
    const part = PART_BY_IPN.get(reel.ipn)!;
    if (PACKAGES[part.pkg].feeder !== slot.kind) return `That won't fit a ${slot.kind} slot.`;
    if (slot.reel) this.unload(slotIdx, true);
    slot.reel = reel;
    this.clearSlotAlarm(slotIdx);
    this.sfx('feeder');
    return null;
  }

  private clearSlotAlarm(slotIdx: number) {
    if (this.line.px9AlarmSlot === slotIdx && this.line.px9Alarm?.startsWith('EMPTY')) {
      this.line.px9Alarm = null;
      this.line.px9AlarmSlot = null;
    }
  }

  /** Take a reel off the machine. It goes on your trolley if there's room. */
  unload(slotIdx: number, toTrolley = false) {
    const slot = this.slots[slotIdx];
    const r = slot.reel;
    if (!r) return;
    if (toTrolley && this.carried.length < this.carryMax && r.count > 0) {
      this.carried.push(r);
    } else if (r.source === 'dump') {
      this.dump.set(r.ipn, (this.dump.get(r.ipn) ?? 0) + r.count);
    } else {
      this.stores.set(r.ipn, (this.stores.get(r.ipn) ?? 0) + r.count);
    }
    slot.reel = null;
    if (this.line.px9AlarmSlot === slotIdx) this.line.px9Alarm = null;
  }

  // -------------------------------------------------------------------------
  // PX-9 controls
  // -------------------------------------------------------------------------

  pressStop() {
    if (this.line.machine === 'run') this.line.machine = 'stop';
    this.sfx('click');
  }

  pressStart(): string | null {
    const L = this.line;
    if (L.estop !== 0) return 'E-stop is pressed. Twist it to release first.';
    if (L.machine === 'fault') return 'Safety fault active. Press the E-stop twice (activate, override), twist to release, then start.';
    if (L.feederOut !== null) return 'A feeder is out of the machine. Seat it first.';
    L.machine = 'run';
    this.sfx('good');
    return null;
  }

  pressEstop() {
    const L = this.line;
    L.estop = L.estop === 0 ? 1 : 2;
    L.machine = L.machine === 'run' ? 'fault' : L.machine;
    this.sfx('alarm');
  }

  /** Twist-release the E-stop. Clears a fault only if it was pressed twice (override). */
  twistEstop(): string | null {
    const L = this.line;
    if (L.estop === 0) return null;
    if (L.machine === 'fault' && L.estop < 2) return 'Fault still latched. Press the E-stop again to override before releasing.';
    L.estop = 0;
    if (L.machine === 'fault') L.machine = 'stop';
    this.sfx('click');
    return null;
  }

  /** Slide a feeder out. Doing it while the machine runs trips the interlock. */
  pullFeeder(slotIdx: number): string | null {
    const L = this.line;
    if (L.feederOut !== null) return 'Another feeder is already out.';
    if (!this.slots[slotIdx].reel) return 'That slot is empty.';
    L.feederOut = slotIdx;
    if (L.machine === 'run') {
      L.machine = 'fault';
      this.toast('INTERLOCK: feeder removed while running. Machine faulted.', 'bad', 'PX-9');
      this.sfx('alarm');
    } else this.sfx('feeder');
    return null;
  }

  seatFeeder() {
    this.line.feederOut = null;
    this.sfx('feeder');
  }

  /** Dab a single part out of the tape with blue tack. */
  takeFromTape(): string | null {
    const L = this.line;
    if (L.feederOut === null) return 'Pull a feeder out first.';
    if (this.hand) return 'You already have a part on the blue tack.';
    const r = this.slots[L.feederOut].reel;
    if (!r || r.count <= 0) return 'That tape is empty.';
    r.count--;
    r.labelCount = Math.max(0, r.labelCount - 1);
    this.hand = { ipn: this.drawFromReel(r), from: 'feeder' };
    this.sfx('click');
    return null;
  }

  clearJam(slotIdx: number) {
    const r = this.slots[slotIdx].reel;
    if (r) r.jam = false;
    if (this.line.px9AlarmSlot === slotIdx) {
      this.line.px9Alarm = null;
      this.line.px9AlarmSlot = null;
    }
    this.sfx('click');
  }

  approvedAltFor(ipn: string): string | null {
    const p = PART_BY_IPN.get(ipn)!;
    return p.alt ?? null;
  }

  requestAlt(ipn: string): string | null {
    const alt = this.approvedAltFor(ipn);
    if (!alt) return 'Engineering says there is no approved alternate. Engineering is at lunch.';
    if (this.altRequests.some((r) => r.ipn === ipn)) return 'Already requested. Patience.';
    this.altRequests.push({ ipn, altIpn: alt, readyAt: this.t + 45 });
    this.toast(`Alternate for ${ipn} requested. ~45s for approval.`, 'info', 'Engineering');
    return null;
  }

  /** Something the same size and shape from the shelf. Nobody approved it. */
  unapprovedAlt(ipn: string): string | null {
    const p = PART_BY_IPN.get(ipn)!;
    const same = LIBRARY.filter((q) => q.ipn !== ipn && q.category === p.category && q.pkg === p.pkg && q.value === p.value);
    const pool = same.length ? same : LIBRARY.filter((q) => q.ipn !== ipn && q.category === p.category && q.pkg === p.pkg);
    return pool.length ? this.rng.pick(pool).ipn : null;
  }

  /** Build a "reel" of loose parts from the dump bin that look like the one we need. */
  dumpReel(ipn: string): Reel | null {
    const p = PART_BY_IPN.get(ipn)!;
    const similar = [...this.dump.entries()].filter(([k, n]) => n > 0 && PART_BY_IPN.get(k)!.pkg === p.pkg && PART_BY_IPN.get(k)!.category === p.category);
    const total = similar.reduce((s, [, n]) => s + n, 0);
    if (total <= 0) return null;
    // Pick the most common look-alike; the pile is mixed.
    similar.sort((a, b) => b[1] - a[1]);
    const take = Math.min(total, 30);
    let left = take;
    const mix: [string, number][] = [];
    for (const [k, n] of similar) {
      const m = Math.min(n, left);
      mix.push([k, m]);
      this.dump.set(k, n - m);
      left -= m;
      if (left <= 0) break;
    }
    const rightOnes = mix.find(([k]) => k === ipn)?.[1] ?? 0;
    const chosen = rightOnes >= take / 2 ? ipn : mix[0][0];
    return { ipn: chosen, label: `DUMP ~${ipn}`, count: take, labelCount: take, tuning: 0, jam: false, source: 'dump' };
  }

  // -------------------------------------------------------------------------
  // printing
  // -------------------------------------------------------------------------

  padCount(j: Job): number {
    let n = 0;
    for (const p of j.product.board.placements) n += PACKAGES[PART_BY_IPN.get(p.ipn)!.pkg].pads.length;
    return n;
  }

  setPrintProfile(j: Job, profile: number[]) {
    j.printProfile = profile;
    this.line.printerDirt = 0;
  }

  wipeStencil() {
    this.line.printerDirt = 0;
    this.sfx('wipe');
  }

  private makePanel(j: Job): Panel {
    const prog = j.program!;
    const boards: BoardInst[] = [];
    let padIdx = 0;
    const n = this.boardsPerPanel(j);
    const panelShift = { x: this.rng.gauss(0, (1 - prog.fidQuality) * 0.25), y: this.rng.gauss(0, (1 - prog.fidQuality) * 0.25) };
    for (let b = 0; b < n; b++) {
      const serialN = (this.serials.get(j.id) ?? 0) + 1;
      this.serials.set(j.id, serialN);
      padIdx = 0;
      const parts: PlacedPart[] = j.product.board.placements.map((pl) => {
        const truth = PART_BY_IPN.get(pl.ipn)!;
        const pads = PACKAGES[truth.pkg].pads.map(() => {
          const base = j.printProfile?.[padIdx++] ?? 1;
          let v = base * (1 + this.rng.gauss(0, 0.06));
          if (this.rng.chance(this.line.printerDirt * 0.04)) v *= this.rng.range(0, 0.4);
          return clamp(v, 0, 2.2);
        });
        // Where the machine thinks the part goes: CAD data plus on-machine corrections.
        const cad = j.product.cadPlacements.find((c) => c.des === pl.des) ?? pl;
        const adj = prog.adjust[pl.des] ?? { dx: 0, dy: 0, drot: 0 };
        return {
          des: pl.des, truthIpn: pl.ipn, ipn: null, pkg: truth.pkg, x: pl.x, y: pl.y, rot: pl.rot,
          dx: panelShift.x + cad.x + adj.dx - pl.x, dy: panelShift.y + cad.y + adj.dy - pl.y,
          drot: wrapDeg(cad.rot + adj.drot - pl.rot),
          placed: false, paste: pads, defect: null, fixed: false, fromDump: false,
        };
      });
      boards.push({
        serial: `${j.product.asmIpn.split('_')[0]}-${String(serialN).padStart(4, '0')}`,
        jobId: j.id, parts, scorch: 0, reflowed: false, aoiFlags: [], lights: 0, state: 'line', reworks: 0, version: 0,
      });
    }
    return { id: this.nextPanelId++, jobId: j.id, nx: prog.nx, ny: prog.ny, boards, stage: 'printer', t: 0, placedIdx: 0, held: false, binned: false };
  }

  // -------------------------------------------------------------------------
  // tick
  // -------------------------------------------------------------------------

  private stagePanels(stage: Panel['stage']): Panel[] {
    return this.panels.filter((p) => p.stage === stage);
  }

  tick(dt: number) {
    if (this.over) return;
    this.t += dt;
    this.tickJobs(dt);
    this.tickPrinter(dt);
    this.tickPx9(dt);
    this.tickConveyor(dt);
    this.tickOven(dt);
    this.tickAoiTest(dt);
    this.tickEconomy(dt);
    this.tickFeeders(dt);
    this.stress = clamp(
      0.32 * (this.heat / 100) + 0.3 * (this.rage / 100) + 0.12 * Math.min(1, this.lateJobs.length / 3) +
      (this.line.px9Alarm ? 0.08 : 0) + 0.12 * Math.min(1, this.t / 4800) + (this.cash < 0 ? 0.12 : 0),
      0, 1,
    );
  }

  private tickJobs(dt: number) {
    if (this.t >= this.nextJobAt) {
      const contract = this.rng.chance(0.5);
      const forced = contract && this.rng.chance(0.18);
      const j = this.addJob(contract ? 'contract' : 'inhouse', undefined, forced);
      if (forced) this.toast(`I already said yes to ${j.product.customer} for ${j.qty}x ${j.product.name}. You're welcome!`, 'sales', 'Sales');
      else this.toast(contract ? `New contract offered: ${j.qty}x ${j.product.name}` : `New in-house order: ${j.qty}x ${j.product.name}`, 'info', 'Schedule');
      this.sfx('mail');
      const gap = clamp(95 - this.t / 45, 28, 95);
      this.nextJobAt = this.t + gap * this.rng.range(0.7, 1.3);
    }
    if (this.t >= this.nextSalesAt) {
      this.toast(this.rng.pick(SALES_LINES), 'sales', 'Sales');
      this.nextSalesAt = this.t + this.rng.range(80, 160);
      // Sometimes sales pulls a due date in. Because of course they do.
      const open = this.jobs.filter((j) => ['accepted', 'ready'].includes(j.status));
      if (open.length && this.rng.chance(0.35)) {
        const j = this.rng.pick(open);
        j.dueAt -= (j.dueAt - this.t) * 0.25;
      }
    }
    for (const j of this.jobs) {
      if (j.status === 'offered' && this.t - j.arrivedAt > 150) {
        j.status = 'declined';
        this.toast(`${j.product.customer} went elsewhere. Sales blames you.`, 'warn', 'Sales');
      }
      if (['accepted', 'ready', 'running'].includes(j.status) && this.t > j.dueAt && !j.lateCharged) {
        j.lateCharged = true;
        this.stats.jobsLate++;
        const pen = Math.round(j.qty * j.price * 0.15);
        this.cash -= pen;
        this.toast(`${j.product.asmIpn} is LATE. ${j.product.customer} charged a penalty of ${pen}.`, 'bad', j.product.customer);
        this.sfx('bad');
      }
      if (j.status === 'running' && j.boardsDone >= j.qty) this.finishJob(j);
    }
    const late = this.lateJobs.length;
    this.rage = clamp(this.rage + (late > 0 ? late * 0.12 * dt : -0.08 * dt), 0, 100);
    if (this.rage >= 100) this.end('revolt');
    void dt;
  }

  private finishJob(j: Job) {
    j.status = 'finished';
    this.stats.jobsDone++;
    const onTime = this.t <= j.dueAt;
    if (onTime) {
      const b = j.kind === 'contract' ? 800 : 400;
      this.score += b;
      this.rage = Math.max(0, this.rage - 10);
      this.toast(`${j.product.asmIpn} complete ON TIME. +${b}`, 'good');
      this.sfx('good');
    } else {
      this.toast(`${j.product.asmIpn} finally complete. Late.`, 'warn');
      this.rage = Math.max(0, this.rage - 4);
    }
    if (this.line.activeJobId === j.id) this.line.activeJobId = null;
  }

  private tickPrinter(dt: number) {
    const printing = this.stagePanels('printer')[0];
    if (printing) {
      printing.t += dt;
      if (printing.t > 7 && !this.stagePanels('px9in').length) {
        printing.stage = 'px9in';
        printing.t = 0;
      }
      return;
    }
    if (this.stagePanels('px9in').length) return;
    const j = this.activeJob;
    if (!j || !j.program || !j.printProfile) return;
    if (j.panelsStarted * this.boardsPerPanel(j) >= j.qty) return;
    const panel = this.makePanel(j);
    j.panelsStarted++;
    this.line.printerDirt = Math.min(1, this.line.printerDirt + 0.07);
    if (this.line.printerDirt > 0.6 && this.rng.chance(0.2)) this.toast('Printer: stencil needs a wipe (prints getting patchy).', 'warn', 'Printer');
    this.panels.push(panel);
    this.sfx('print');
  }

  private tickPx9(dt: number) {
    const L = this.line;
    let p = this.stagePanels('px9')[0];
    if (!p) {
      const waiting = this.stagePanels('px9in')[0];
      if (waiting) {
        waiting.stage = 'px9';
        waiting.t = -3 - (1 - (this.job(waiting.jobId)?.program?.fidQuality ?? 1)) * 4;
        p = waiting;
      } else return;
    }
    if (L.px9Alarm || L.px9Paused || L.machine !== 'run' || L.feederOut !== null) return;
    const j = this.job(p.jobId)!;
    const prog = j.program!;
    p.t += dt;
    const nParts = j.product.board.placements.length;
    const total = nParts * p.boards.length;
    while (p.t > 0 && p.placedIdx < total) {
      const bi = Math.floor(p.placedIdx / nParts);
      const part = p.boards[bi].parts[p.placedIdx % nParts];
      const want = prog.desIpn[part.des];
      if (!want) {
        p.placedIdx++;
        continue;
      }
      if (prog.setup[want] == null) prog.setup = this.planSetup(j);
      const slotIdx = prog.setup[want];
      const slot = slotIdx == null ? undefined : this.slots[slotIdx];
      if (!slot || !slot.reel || slot.reel.count <= 0) {
        L.px9Alarm = `EMPTY: slot ${slotIdx ?? '?'} needs ${want}`;
        L.px9AlarmSlot = slotIdx ?? null;
        this.sfx('alarm', 'px9');
        this.toast(`PX-9 stopped: ${L.px9Alarm}`, 'bad', 'PX-9');
        return;
      }
      if (slot.reel.jam) {
        L.px9Alarm = `PICK ERROR: slot ${slotIdx} tape jam`;
        L.px9AlarmSlot = slotIdx;
        this.sfx('alarm', 'px9');
        this.toast(`PX-9 stopped: ${L.px9Alarm}`, 'bad', 'PX-9');
        return;
      }
      const pkg = PACKAGES[part.pkg];
      const teach = this.taught[part.pkg] ?? 0.3;
      const reel = slot.reel;
      reel.count--;
      reel.labelCount = Math.max(0, reel.labelCount - 1);
      const cost = (pkg.kind === 'ic' || pkg.kind === 'conn' ? 0.45 : 0.2) / (1 + this.maintCount * 0.02);
      p.t -= cost;
      // Camera rejects: part goes to the dump bin and we try again next tick.
      if (this.rng.chance((1 - teach) * 0.28)) {
        const actual = this.drawFromReel(reel);
        this.dump.set(actual, (this.dump.get(actual) ?? 0) + 1);
        p.t -= 0.3;
        continue;
      }
      const actual = this.drawFromReel(reel);
      const sd = 0.02 + (1 - teach) * 0.35 + (1 - reel.tuning) * 0.04;
      part.ipn = actual;
      part.fromDump = reel.source === 'dump';
      part.placed = true;
      part.dx += this.rng.gauss(0, sd);
      part.dy += this.rng.gauss(0, sd);
      part.drot = this.rng.gauss(0, (1 - teach) * 7);
      p.boards[bi].version++;
      p.placedIdx++;
      if (reel.source === 'unapproved' && this.rng.chance(0.35)) part.ipn = this.unapprovedWrong(part.truthIpn);
    }
    if (p.placedIdx >= total && p.t > 1.5) {
      if (this.stagePanels('conv').length >= 2) return;
      p.stage = 'conv';
      p.t = 0;
      this.sfx('conveyor');
    }
  }

  private unapprovedWrong(truth: string): string {
    const p = PART_BY_IPN.get(truth)!;
    const others = LIBRARY.filter((q) => q.category === p.category && q.pkg === p.pkg && q.ipn !== truth && q.ipn !== p.alt);
    return others.length ? this.rng.pick(others).ipn : truth;
  }

  private drawFromReel(reel: Reel): string {
    if (reel.source !== 'dump') return reel.ipn;
    // Loose parts: mostly what the pile looked like, sometimes a twin that isn't.
    if (this.rng.chance(0.25)) {
      const p = PART_BY_IPN.get(reel.ipn)!;
      const twins = LIBRARY.filter((q) => q.pkg === p.pkg && q.category === p.category && q.ipn !== p.ipn);
      if (twins.length) return this.rng.pick(twins).ipn;
    }
    return reel.ipn;
  }

  private tickConveyor(dt: number) {
    for (const p of this.stagePanels('conv')) {
      p.t += dt;
      if (p.t > 3 && !this.stagePanels('inspect').length) {
        p.stage = 'inspect';
        p.t = 0;
      }
    }
    for (const p of this.stagePanels('inspect')) {
      if (!p.held) p.t += dt;
      if (p.t > 3.5) {
        p.stage = 'ovenq';
        p.t = 0;
      }
    }
  }

  private tickOven(dt: number) {
    const L = this.line;
    const mult = 1 + this.maintCount * 0.45;
    const inOven = this.stagePanels('oven');
    for (const p of inOven) {
      p.t += dt;
      if (p.t >= OVEN_TRAVEL) {
        for (const b of p.boards) reflowBoard(b, this.heat, this.rng);
        p.stage = 'aoi';
        p.t = 0;
      }
    }
    const q = this.stagePanels('ovenq')[0];
    if (q && !L.feedStopped && !L.maintenance && this.t - L.ovenLastEntry > OVEN_SPACING) {
      q.stage = 'oven';
      q.t = 0;
      L.ovenLastEntry = this.t;
      this.heat += 1.5 * mult * Math.pow(q.boards.length, 0.35);
    }
    const busy = this.stagePanels('oven').length > 0;
    this.heat += (busy ? 0.012 * mult : -0.03) * dt;
    this.heat = Math.max(0, this.heat);
    if (this.heat >= 85 && Math.floor(this.t * 2) !== Math.floor((this.t - dt) * 2) && Math.floor(this.t) % 4 === 0) this.sfx('alarm', 'oven');
    if (this.heat >= 100) this.end('fire');
  }

  binOven() {
    for (const p of this.stagePanels('oven')) {
      for (const b of p.boards) {
        b.state = 'scrap';
        this.boardDone(b, 0);
        this.stats.scrapped++;
      }
      p.stage = 'done';
      p.binned = true;
    }
    this.panels = this.panels.filter((p) => p.stage !== 'done');
    this.sfx('bin');
    this.toast('Binned everything in the oven. Accounting felt that.', 'warn');
  }

  canMaintain(): string | null {
    if (!this.line.feedStopped) return 'Stop the oven feed first.';
    if (this.stagePanels('oven').length) return 'Oven still has boards in it. Wait, or bin them.';
    return null;
  }

  startMaintenance() {
    if (this.canMaintain()) return;
    this.line.maintenance = true;
    this.line.maintProgress = 0;
  }

  /** Residue blobs needed for this maintenance: grows every time. */
  maintenanceBlobs(): number {
    return 7 + this.maintCount * 5;
  }

  finishMaintenance() {
    this.line.maintenance = false;
    this.maintCount++;
    this.stats.maintenances++;
    this.heat = 0;
    this.line.feedStopped = false;
    this.score += 200;
    this.toast(`Oven serviced (#${this.maintCount}). It'll heat faster now. Probably fine.`, 'good');
    this.sfx('good');
  }

  private tickAoiTest(dt: number) {
    const L = this.line;
    const a = this.stagePanels('aoi')[0];
    if (a) {
      L.aoiT += dt;
      const parts = a.boards.reduce((s, b) => s + b.parts.length, 0);
      const need = L.aoiScope === 'full' ? 3 + parts * 0.035 : 2.5;
      if (L.aoiT >= need && !this.stagePanels('test').length) {
        for (const b of a.boards) {
          b.aoiFlags = aoiInspect(b, L.aoiScope, this.rng);
          b.version++;
        }
        a.stage = 'test';
        a.t = 0;
        L.aoiT = 0;
        L.testT = 0;
      }
    }
    const t = this.stagePanels('test')[0];
    if (t) {
      L.testT += dt;
      const pending = t.boards.filter((b) => b.state === 'line' && b.lights === 0);
      if (!pending.length) {
        t.stage = 'done';
        this.panels = this.panels.filter((p) => p.stage !== 'done');
        return;
      }
      const b = pending[0];
      if (b.aoiFlags.length) {
        // AOI failures skip test and go straight to the rework rack.
        b.lights = -1;
        this.logTest(b);
        b.state = 'rework';
        this.rework.push(b);
        this.streak = 0;
        return;
      }
      if (L.testT >= 3.2) {
        L.testT = 0;
        b.lights = testLights(b);
        b.version++;
        this.logTest(b);
        if (b.lights === 3) {
          this.shipBoard(b, 1);
          this.stats.firstPass++;
          this.streak++;
        } else {
          b.state = 'rework';
          this.rework.push(b);
          this.streak = 0;
          this.sfx('fail', 'test');
        }
      }
    }
  }

  private logTest(b: BoardInst) {
    this.testLog.unshift({ serial: b.serial, lights: b.lights, t: this.t, aoi: [...b.aoiFlags] });
    if (this.testLog.length > 40) this.testLog.pop();
  }

  private boardDone(b: BoardInst, _pts: number) {
    const j = this.job(b.jobId);
    if (!j) return;
    j.boardsDone++;
    if (b.state === 'shipped') j.boardsShipped++;
    if (b.state === 'scrap') j.boardsScrapped++;
  }

  shipBoard(b: BoardInst, quality: number) {
    const j = this.job(b.jobId)!;
    b.state = 'shipped';
    const base = j.kind === 'contract' ? 160 : 100;
    const mult = quality >= 1 ? 1 + Math.min(2, this.streak * 0.1) : 1;
    const pts = Math.round(base * quality * mult);
    this.score += pts;
    this.cash += j.price * (quality >= 0.7 ? 1 : 0.8);
    this.stats.shipped++;
    this.boardDone(b, pts);
    this.events.emit('shipped', { board: b, points: pts });
    this.sfx('ship');
  }

  // -------------------------------------------------------------------------
  // rework
  // -------------------------------------------------------------------------

  /** Try to fix a part with the iron. Shaky hands can make it worse. */
  reworkFix(b: BoardInst, des: string): 'fixed' | 'slipped' | 'nothing' {
    const p = b.parts.find((q) => q.des === des);
    if (!p || !p.placed) return 'nothing';
    const ok = this.rng.chance(0.96 - this.stress * 0.45);
    if (!ok) {
      const others = b.parts.filter((q) => q !== p && q.placed && !q.defect && Math.hypot(q.x - p.x, q.y - p.y) < 6);
      if (others.length) {
        const n = this.rng.pick(others);
        n.defect = 'misalign';
        n.dx += this.rng.gauss(0, 0.5);
        n.dy += this.rng.gauss(0, 0.5);
      }
      b.version++;
      return 'slipped';
    }
    p.dx = this.rng.gauss(0, 0.03);
    p.dy = this.rng.gauss(0, 0.03);
    p.drot = 0;
    p.defect = null;
    p.fixed = true;
    p.paste = p.paste.map(() => 1);
    b.version++;
    return 'fixed';
  }

  reworkReplace(b: BoardInst, des: string, ipn: string): string | null {
    const p = b.parts.find((q) => q.des === des);
    if (!p) return 'No such designator.';
    const part = PART_BY_IPN.get(ipn);
    if (!part) return 'Unknown IPN.';
    if (part.pkg !== p.pkg) return `That's a ${part.pkg}, the footprint is ${p.pkg}.`;
    const have = this.stores.get(ipn) ?? 0;
    if (have > 0) this.stores.set(ipn, have - 1);
    else this.cash -= Math.max(2, part.cost * 20); // expedited single part, the most expensive resistor in the world
    p.ipn = ipn;
    p.placed = true;
    p.defect = null;
    p.fixed = true;
    p.dx = 0;
    p.dy = 0;
    p.drot = 0;
    p.fromDump = false;
    b.version++;
    this.sfx('click');
    return null;
  }

  retest(b: BoardInst): number {
    b.reworks++;
    b.lights = testLights(b);
    b.aoiFlags = [];
    b.version++;
    if (b.lights === 3) {
      this.rework = this.rework.filter((x) => x !== b);
      const q = b.reworks <= 1 ? 0.7 : 0.45;
      this.stats.reworked++;
      this.shipBoard(b, q);
      this.toast(`${b.serial} repaired and shipped.`, 'good');
    } else {
      this.sfx('fail', 'rework');
    }
    return b.lights;
  }

  scrapBoard(b: BoardInst) {
    this.rework = this.rework.filter((x) => x !== b);
    b.state = 'scrap';
    this.stats.scrapped++;
    this.boardDone(b, 0);
    this.sfx('bin');
  }

  /** Tweezer contact moves the part on its wet paste. */
  nudge(b: BoardInst, des: string, dx: number, dy: number, drot = 0) {
    const p = b.parts.find((q) => q.des === des);
    if (!p || !p.placed || b.reflowed) return;
    p.dx += dx;
    p.dy += dy;
    p.drot = wrapDeg(p.drot + drot);
    b.version++;
  }

  /** Too much force: the part jumps a little. */
  hop(b: BoardInst, des: string) {
    const p = b.parts.find((q) => q.des === des);
    if (!p || !p.placed) return;
    p.dx += this.rng.gauss(0, 0.5);
    p.dy += this.rng.gauss(0, 0.5);
    p.drot = wrapDeg(p.drot + this.rng.gauss(0, 18));
    b.version++;
    this.sfx('click');
  }

  /** The part pings out of the tweezers and lands somewhere on the floor. */
  flick(b: BoardInst, des: string) {
    const p = b.parts.find((q) => q.des === des);
    if (!p || !p.placed) return;
    p.placed = false;
    p.defect = 'flicked';
    this.stats.flicked++;
    if (p.ipn) this.floor.push(p.ipn);
    b.version++;
    this.sfx('ping');
  }

  /** Put the part in your tweezers back on its lands. */
  placeFromHand(b: BoardInst, des: string, x: number, y: number): string | null {
    if (!this.hand) return 'Nothing in your tweezers.';
    const p = b.parts.find((q) => q.des === des);
    if (!p) return 'No land there.';
    if (p.placed) return `${des} already has a part on it.`;
    if (b.reflowed) return 'Too late, that board has been through the oven. Use the rework bench.';
    p.placed = true;
    p.defect = null;
    p.ipn = this.hand.ipn;
    p.dx = x - p.x;
    p.dy = y - p.y;
    p.drot = this.rng.gauss(0, 6);
    p.fromDump = this.hand.from === 'floor';
    this.hand = null;
    b.version++;
    this.sfx('click');
    return null;
  }

  /** Look for a dropped part on the floor. */
  floorPick(i: number): string | null {
    const ipn = this.floor[i];
    if (ipn === undefined) return null;
    this.floor.splice(i, 1);
    this.hand = { ipn, from: 'floor' };
    return ipn;
  }

  // -------------------------------------------------------------------------
  // economy
  // -------------------------------------------------------------------------

  private tickEconomy(dt: number) {
    this.cash -= this.overhead * dt;
    if (this.cash < -2500) this.end('bankrupt');
  }

  private tickFeeders(dt: number) {
    for (const s of this.slots) if (s.reel) s.reel.tuning = Math.min(1, s.reel.tuning + dt / 200);
    for (const r of [...this.altRequests]) {
      if (this.t >= r.readyAt) {
        this.stores.set(r.altIpn, (this.stores.get(r.altIpn) ?? 0) + 200);
        this.altRequests = this.altRequests.filter((x) => x !== r);
        this.toast(`Alternate ${r.altIpn} approved for ${r.ipn} and in stores.`, 'good', 'Engineering');
        this.sfx('mail');
      }
    }
  }

  end(e: Ending) {
    if (this.over) return;
    this.over = e;
    this.overAt = this.t;
    this.events.emit('over', { ending: e });
  }

  faultsOf(b: BoardInst) {
    return boardFaults(b);
  }

  isRight = isRightPart;
}
