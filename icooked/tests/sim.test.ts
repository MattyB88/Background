import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { PACKAGES, PART_BY_IPN } from '../src/sim/parts';
import { partRisk, PERFECT_RISK } from '../src/sim/defects';
import type { PlacedPart } from '../src/sim/types';

/** A bot that does the minimum: loads feeders from stores, prints perfectly, never inspects. */
function autoplay(g: Game, seconds: number) {
  const dt = 0.1;
  for (let i = 0; i < seconds / dt && !g.over; i++) {
    if (!g.activeJob || g.activeJob.panelsStarted * g.boardsPerPanel(g.activeJob) >= g.activeJob.qty) {
      const next = g.jobs.find((j) => j.status === 'ready');
      if (next) next.card = 'held';
      if (next && g.startJob(next) === null) {
        g.setPrintProfile(next, Array(g.padCount(next)).fill(1));
        for (const [ipn, slot] of Object.entries(next.program!.setup)) {
          if (g.slots[slot].reel?.label !== ipn) g.loadFromStores(slot, ipn);
        }
      }
    }
    if (g.line.px9Alarm && g.line.px9AlarmSlot != null) {
      const s = g.slots[g.line.px9AlarmSlot];
      if (s.reel?.jam) g.clearJam(s.index);
      else {
        const j = g.activeJob;
        const ipn = j && Object.entries(j.program!.setup).find(([, v]) => v === s.index)?.[0];
        if (ipn && g.loadFromStores(s.index, ipn)) {
          const r = g.dumpReel(ipn) ?? { ipn, label: ipn, count: 50, labelCount: 50, tuning: 0, jam: false, source: 'unapproved' as const };
          g.loadReel(s.index, r);
        }
        g.line.px9Alarm = null;
      }
    }
    if (g.heat > 80 && !g.line.maintenance) g.line.feedStopped = true;
    if (g.line.feedStopped && !g.canMaintain()) {
      g.startMaintenance();
      g.finishMaintenance();
    }
    g.tick(dt);
  }
}

describe('simulation', () => {
  it('generates products whose parts are all in the ERP', () => {
    const g = new Game(1234);
    for (const p of g.products) {
      expect(p.board.placements.length).toBeGreaterThan(5);
      for (const pl of p.board.placements) expect(PART_BY_IPN.has(pl.ipn)).toBe(true);
      expect(new Set(p.board.placements.map((x) => x.des)).size).toBe(p.board.placements.length);
    }
  });

  it('puzzle correct folder contains the true designators', () => {
    const g = new Game(99);
    const job = g.jobs.find((j) => j.kind === 'contract')!;
    const folder = job.puzzle!.folders.find((f) => f.correct)!;
    const allDes = folder.rows.flatMap((r) => r.truthDes).sort();
    expect(allDes).toEqual(job.product.board.placements.map((p) => p.des).sort());
  });

  it('a perfect part still has the 0.5% floor', () => {
    const part: PlacedPart = {
      des: 'R1', truthIpn: '', ipn: '', pkg: '0603', x: 0, y: 0, rot: 0, dx: 0, dy: 0, drot: 0,
      placed: true, paste: [1, 1], defect: null, fixed: false, fromDump: false,
    };
    expect(partRisk(part, 20).total).toBeCloseTo(PERFECT_RISK, 5);
    part.paste = [0, 1];
    expect(partRisk(part, 20).total).toBeGreaterThan(0.5);
    expect(PACKAGES['0603'].pads.length).toBe(2);
  });

  it('runs a shift with an autoplay bot and eventually gets fired', () => {
    const g = new Game(42);
    autoplay(g, 60 * 60 * 3);
    process.stdout.write(`ending ${g.over} at ${Math.round(g.overAt)}s score ${g.score} shipped ${g.stats.shipped} rework ${g.rework.length} maint ${g.maintCount} cash ${Math.round(g.cash)} jobsDone ${g.stats.jobsDone} late ${g.stats.jobsLate}\n`);
    const kinds: Record<string, number> = {};
    for (const b of g.rework) for (const f of g.faultsOf(b)) kinds[f.kind + (b.parts.find(p=>p.des===f.des)?.fromDump ? '(dump)' : '')] = (kinds[f.kind] ?? 0) + 1;
    process.stdout.write(JSON.stringify(kinds) + '\n');
    expect(g.stats.shipped).toBeGreaterThan(5);
    expect(g.over).not.toBeNull();
  });

  it('is deterministic for a seed', () => {
    const a = new Game(7);
    const b = new Game(7);
    autoplay(a, 600);
    autoplay(b, 600);
    expect(a.score).toBe(b.score);
    expect(a.stats.shipped).toBe(b.stats.shipped);
  });
});
