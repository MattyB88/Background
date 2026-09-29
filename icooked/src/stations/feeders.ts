import { el } from '../core/util';
import { PACKAGES, PART_BY_IPN } from '../sim/parts';
import type { Job, Reel } from '../sim/types';
import { Station } from './base';

/** Feeder set-up: load reels into the right slots, handle shortages. */
export class FeederStation extends Station {
  private sheet!: HTMLElement;
  private bank!: HTMLElement;
  private stores!: HTMLElement;
  private selSlot: number | null = null;
  private busyUntil = 0;
  private busyLabel = '';
  private scanned: Map<number, string> | null = null;
  private t = 0;

  build() {
    this.sheet = el('div', { class: 'sheet' });
    this.bank = el('div', { class: 'bank' });
    this.stores = el('div', { class: 'stores' });
    this.body.append(el('div', { class: 'feeder-wrap' }, this.sheet, this.bank, this.stores));
  }

  status(): string {
    const g = this.app.game;
    if (g.line.px9Alarm) return `⚠ ${g.line.px9Alarm}`;
    const j = this.setupJob();
    if (!j) return '';
    const miss = this.missing(j).length;
    return miss ? `${miss} feeder(s) to load for ${j.product.asmIpn}` : '';
  }

  private setupJob(): Job | undefined {
    const g = this.app.game;
    return g.activeJob ?? g.jobs.find((j) => j.status === 'ready');
  }

  private setupOf(j: Job): Record<string, number> {
    const g = this.app.game;
    return j.status === 'running' ? j.program!.setup : g.planSetup(j);
  }

  private missing(j: Job): string[] {
    const g = this.app.game;
    const setup = this.setupOf(j);
    return Object.entries(setup).filter(([ipn, s]) => g.slots[s].reel?.label !== ipn).map(([ipn]) => ipn);
  }

  enter() {
    this.scanned = null;
    const alarm = this.app.game.line.px9AlarmSlot;
    if (alarm != null) this.selSlot = alarm;
    this.render();
  }

  update(dt: number) {
    this.t -= dt;
    if (this.t <= 0 && this.canRefresh()) {
      this.t = 0.4;
      this.render();
    }
  }

  private get busy(): boolean {
    return performance.now() < this.busyUntil;
  }

  /** Physical work takes time: the line doesn't wait for you. */
  private work(label: string, secs: number, fn: () => void) {
    if (this.busy) return;
    this.busyUntil = performance.now() + secs * 1000;
    this.busyLabel = label;
    this.render();
    setTimeout(() => {
      fn();
      this.busyUntil = 0;
      this.render();
    }, secs * 1000);
  }

  private render() {
    const g = this.app.game;
    const j = this.setupJob();
    const setup = j ? this.setupOf(j) : {};
    const slotNeed = new Map<number, string>(Object.entries(setup).map(([ipn, s]) => [s, ipn]));

    // --- set-up sheet
    const sheetNodes: Node[] = [el('h3', {}, j ? `Set-up sheet: ${j.product.asmIpn}` : 'Set-up sheet')];
    if (!j) sheetNodes.push(el('p', {}, 'No job loaded or programmed.'));
    else {
      if (j.status !== 'running') sheetNodes.push(el('p', { style: 'color:#a60' }, 'Next job (not loaded on the PX-9 yet). Slots may change at changeover.'));
      const t = el('table', { class: 'grid' }, el('tr', {}, el('th', {}, 'Slot'), el('th', {}, 'IPN'), el('th', {}, 'Description'), el('th', {}, '')));
      for (const [ipn, s] of Object.entries(setup).sort((a, b) => a[1] - b[1])) {
        const reel = g.slots[s].reel;
        const ok = reel?.label === ipn;
        const scan = this.scanned?.get(s);
        const mark = !reel ? '—' : ok ? (scan && scan !== ipn ? '✗ scan' : '✓') : '✗';
        const row = el('tr', { class: this.selSlot === s ? 'sel' : '' },
          el('td', {}, String(s + 1)), el('td', {}, ipn), el('td', {}, PART_BY_IPN.get(ipn)!.desc), el('td', { style: ok ? 'color:#070' : 'color:#b00;font-weight:700' }, mark));
        row.style.cursor = 'pointer';
        row.onclick = () => {
          this.selSlot = s;
          this.render();
        };
        t.append(row);
      }
      sheetNodes.push(t);
      const unassigned = g.requiredIpns(j).filter((ipn) => !(ipn in setup));
      if (unassigned.length) sheetNodes.push(el('p', { style: 'color:#b00' }, `No free slot for: ${unassigned.join(', ')}. Unload something.`));
      const verify = el('button', { class: 'btn', style: 'margin-top:8px' }, 'Scan-verify set-up (4s)');
      verify.onclick = () => this.work('Scanning reels...', 4, () => {
        this.scanned = new Map();
        for (const s of g.slots) if (s.reel) this.scanned.set(s.index, s.reel.source === 'dump' ? 'LOOSE' : s.reel.ipn);
        const bad = Object.entries(setup).filter(([ipn, s]) => this.scanned!.get(s) !== ipn);
        this.app.hud.toast(bad.length ? `Scan: ${bad.length} slot(s) don't match the set-up.` : 'Scan: set-up verified.', bad.length ? 'warn' : 'good', 'Feeders');
      });
      sheetNodes.push(verify);
    }
    this.sheet.replaceChildren(...sheetNodes);

    // --- feeder bank
    const slots = el('div', { class: 'slots' });
    for (const s of g.slots) {
      const need = slotNeed.get(s.index);
      const cls = ['slot'];
      if (need) cls.push(s.reel?.label === need ? 'ok' : s.reel ? 'wrong' : 'need');
      if (g.line.px9AlarmSlot === s.index && g.line.px9Alarm) cls.push('alarm');
      if (this.selSlot === s.index) cls.push('sel');
      const d = el('div', { class: cls.join(' '), style: this.selSlot === s.index ? 'outline:2px solid #fff' : '' },
        el('div', { class: 'k' }, `${s.index + 1} · ${s.kind}`),
        s.reel ? el('div', { class: 'reel' }, s.reel.label) : el('div', { class: 'k' }, 'empty'),
        s.reel ? el('div', { class: 'cnt' }, `label: ${s.reel.labelCount}`) : el('span'),
        need ? el('div', { class: 'k', style: 'color:#ffb21a' }, `want ${need}`) : el('span'));
      d.onclick = () => {
        this.selSlot = s.index;
        this.render();
      };
      slots.append(d);
    }
    const bankNodes: Node[] = [el('h3', { style: 'margin:0 0 8px;color:#ccd' }, 'PX-9 feeder bank'), slots];
    if (this.busy) bankNodes.unshift(el('div', { class: 'toast warn', style: 'margin-bottom:8px' }, `⏳ ${this.busyLabel}`));
    if (this.selSlot !== null) {
      const s = g.slots[this.selSlot];
      const acts = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:10px' });
      if (s.reel) {
        const un = el('button', { class: 'btn' }, 'Unload reel (1.5s)');
        un.onclick = () => this.work('Unloading...', 1.5, () => g.unload(s.index));
        acts.append(un);
      }
      if (g.line.px9AlarmSlot === s.index && g.line.px9Alarm?.startsWith('PICK')) {
        const cj = el('button', { class: 'btn primary' }, 'Clear tape jam (2s)');
        cj.onclick = () => this.work('Re-threading tape...', 2, () => g.clearJam(s.index));
        acts.append(cj);
      }
      bankNodes.push(el('div', { style: 'margin-top:10px;color:#dde' }, `Slot ${s.index + 1} (${s.kind})${s.reel ? `: ${s.reel.label}, tuning ${Math.round(s.reel.tuning * 100)}%` : ''}`), acts);
    }
    this.bank.replaceChildren(...bankNodes);

    // --- stores
    const want = this.selSlot !== null ? slotNeed.get(this.selSlot) : undefined;
    const storeNodes: Node[] = [el('h3', { style: 'margin:0 0 8px;color:#ccd' }, 'Stores')];
    if (this.selSlot === null) storeNodes.push(el('p', { style: 'color:#aab' }, 'Pick a slot first.'));
    const kind = this.selSlot !== null ? g.slots[this.selSlot].kind : null;
    const entries = [...g.stores.entries()].filter(([, n]) => n > 0).sort((a, b) => (a[0] === want ? -1 : b[0] === want ? 1 : a[0].localeCompare(b[0])));
    for (const [ipn, n] of entries) {
      const p = PART_BY_IPN.get(ipn)!;
      const fits = kind === PACKAGES[p.pkg].feeder;
      const b = el('div', { class: `reelbtn${ipn === want ? ' sel' : ''}${fits ? '' : ' dim'}` }, el('span', {}, `${ipn}  ${p.desc}`), el('span', {}, String(n)));
      b.onclick = () => {
        if (this.selSlot === null) return;
        const slot = this.selSlot;
        this.work(`Loading ${ipn} into slot ${slot + 1}...`, 2, () => {
          const err = g.loadFromStores(slot, ipn);
          if (err) this.app.hud.toast(err, 'warn', 'Feeders');
        });
      };
      storeNodes.push(b);
    }
    const alarmHere = this.selSlot !== null && g.line.px9AlarmSlot === this.selSlot && !!g.line.px9Alarm;
    if (want && ((g.stores.get(want) ?? 0) === 0 || alarmHere)) {
      const have = g.stores.get(want) ?? 0;
      storeNodes.push(el('h3', { style: 'margin:14px 0 6px;color:#ccd' }, `Short on ${want}?`));
      if (have > 0) storeNodes.push(el('p', { style: 'color:#aab' }, `Stores still has ${have}. Load it above.`));
      const reqAlt = el('button', { class: 'btn' }, 'Request approved alternate');
      reqAlt.onclick = () => {
        const err = g.requestAlt(want);
        if (err) this.app.hud.toast(err, 'warn', 'Engineering');
      };
      const alt = el('button', { class: 'btn' }, 'Grab a look-alike (unapproved)');
      alt.onclick = () => {
        const a = g.unapprovedAlt(want);
        if (!a) return;
        const slot = this.selSlot!;
        this.work('Loading something that looks right...', 2, () => {
          const reel: Reel = { ipn: a, label: want, count: 60, labelCount: 60, tuning: 0, jam: false, source: 'unapproved' };
          const err = g.loadReel(slot, reel);
          if (err) this.app.hud.toast(err, 'warn');
          else this.app.hud.toast(`Loaded ${a} and wrote ${want} on it. Nobody will know. (Write it down.)`, 'warn', 'You');
        });
      };
      const dump = el('button', { class: 'btn' }, 'Hand-feed from dump bin');
      dump.onclick = () => {
        const slot = this.selSlot!;
        const r = g.dumpReel(want);
        if (!r) {
          this.app.hud.toast('Nothing in the dump bin that looks like that.', 'warn');
          return;
        }
        this.work('Picking loose parts out of the bin...', 3, () => {
          const err = g.loadReel(slot, r);
          if (err) this.app.hud.toast(err, 'warn');
          else this.app.hud.toast(`Hand-fed ${r.count} loose parts into slot ${slot + 1}. Some of them might even be ${want}.`, 'warn', 'You');
        });
      };
      storeNodes.push(el('div', { style: 'display:flex;flex-direction:column;gap:6px' }, reqAlt, alt, dump));
      const pend = g.altRequests.find((r) => r.ipn === want);
      if (pend) storeNodes.push(el('p', { style: 'color:#ffb21a' }, `Alternate pending: ${Math.ceil(pend.readyAt - g.t)}s`));
    }
    const dumpTotal = [...g.dump.values()].reduce((a, b) => a + b, 0);
    storeNodes.push(el('p', { style: 'color:#778;margin-top:12px' }, `Dump bin: ${dumpTotal} loose parts (rejects, flicks, leftovers).`));
    this.stores.replaceChildren(...storeNodes);
  }
}
