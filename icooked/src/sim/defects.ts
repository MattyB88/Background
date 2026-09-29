import type { Rng } from '../core/rng';
import { PACKAGES, PART_BY_IPN, type ErpPart } from './parts';
import type { BoardInst, Defect, PlacedPart } from './types';

/** The floor: even a perfect part on a perfect board has a small chance of failing. */
export const PERFECT_RISK = 0.005;

export function padScale(p: PlacedPart): number {
  const pads = PACKAGES[p.pkg].pads;
  let m = Infinity;
  for (const pad of pads) m = Math.min(m, pad.w, pad.h);
  return Math.max(0.5, m);
}

export function offsetRatio(p: PlacedPart): number {
  return Math.hypot(p.dx, p.dy) / padScale(p) + Math.abs(p.drot) / 25;
}

/** Is the part electrically the right one? Approved alternates count as right. */
export function isRightPart(p: PlacedPart): boolean {
  if (!p.ipn) return false;
  if (p.ipn === p.truthIpn) return true;
  const truth = PART_BY_IPN.get(p.truthIpn);
  return !!truth && truth.alt === p.ipn;
}

export interface RiskBreakdown {
  total: number;
  weights: Partial<Record<Defect, number>>;
}

/** Per-part defect risk given print, placement and oven state. */
export function partRisk(p: PlacedPart, heat: number): RiskBreakdown {
  const pkg = PACKAGES[p.pkg];
  const w: Partial<Record<Defect, number>> = {};
  const add = (d: Defect, v: number) => (w[d] = (w[d] ?? 0) + v);
  const off = offsetRatio(p);
  const minPaste = Math.min(...p.paste);
  const maxPaste = Math.max(...p.paste);
  const imbalance = p.paste.length >= 2 ? Math.abs(p.paste[0] - p.paste[1]) : 0;
  const finePitch = pkg.kind === 'ic' && pkg.pads.length > 8;

  if (pkg.kind === 'chip' || pkg.kind === 'led') {
    if (minPaste < 0.25) add('tombstone', 0.55);
    add('tombstone', Math.max(0, imbalance - 0.18) * 0.6 + Math.max(0, off - 0.3) * 0.4);
    if (maxPaste > 1.6) add('bridge', (maxPaste - 1.6) * 0.3);
  } else {
    if (minPaste < 0.3) add('dry', 0.6);
    else if (minPaste < 0.6) add('dry', (0.6 - minPaste) * 0.5);
    if (maxPaste > 1.45) add('bridge', (maxPaste - 1.45) * (finePitch ? 1.1 : 0.4));
  }
  add('misalign', Math.max(0, off - 0.45) * 0.9);
  const heatRisk = heat > 60 ? ((heat - 60) / 40) * 0.12 : 0;
  add(pkg.kind === 'ic' ? 'dry' : 'tombstone', heatRisk);

  let total = PERFECT_RISK;
  for (const v of Object.values(w)) total += v!;
  return { total: Math.min(0.95, total), weights: w };
}

function pickWeighted(rng: Rng, w: Partial<Record<Defect, number>>, fallback: Defect): Defect {
  const entries = Object.entries(w).filter(([, v]) => v! > 0) as [Defect, number][];
  const sum = entries.reduce((s, [, v]) => s + v, 0);
  if (sum <= 0) return fallback;
  let r = rng.next() * sum;
  for (const [d, v] of entries) {
    r -= v;
    if (r <= 0) return d;
  }
  return entries[entries.length - 1][0];
}

/** Turn accumulated risk into real defects as the board passes through the oven. */
export function reflowBoard(b: BoardInst, heat: number, rng: Rng): void {
  for (const p of b.parts) {
    if (!p.placed || p.defect) continue;
    const kind = PACKAGES[p.pkg].kind;
    // Symmetric two-terminal parts don't care about 180 degrees; everything else is polarised.
    const symmetric = kind === 'chip' || kind === 'xtal';
    if (symmetric && Math.abs(p.drot) > 90) p.drot = p.drot > 0 ? p.drot - 180 : p.drot + 180;
    if (!symmetric && Math.abs(p.drot) > 45) {
      p.defect = 'rotated';
      continue;
    }
    // Molten solder pulls small parts back towards the pads.
    const pull = kind === 'chip' || kind === 'led' ? 0.5 : kind === 'ic' ? 0.75 : 0.9;
    p.dx *= pull;
    p.dy *= pull;
    p.drot *= pull;
    const r = partRisk(p, heat);
    if (rng.chance(r.total)) {
      p.defect = pickWeighted(rng, r.weights, kind === 'ic' ? 'dry' : 'tombstone');
    } else if (offsetRatio(p) > 0.6) {
      p.defect = 'misalign';
    }
  }
  if (heat > 75) b.scorch = Math.min(1, b.scorch + (heat - 75) / 25);
  b.reflowed = true;
  b.version++;
}

export interface BoardFault {
  des: string;
  kind: Defect | 'scorch';
}

export function boardFaults(b: BoardInst): BoardFault[] {
  const f: BoardFault[] = [];
  if (b.scorch > 0.5) f.push({ des: '*', kind: 'scorch' });
  for (const p of b.parts) {
    if (!p.placed) f.push({ des: p.des, kind: p.defect === 'flicked' ? 'flicked' : 'missing' });
    else if (p.defect) f.push({ des: p.des, kind: p.defect });
    else if (!isRightPart(p)) f.push({ des: p.des, kind: 'wrong' });
  }
  return f;
}

/** Test-jig lights: 3 = good, 2 = one fault, 1 = two or more. */
export function testLights(b: BoardInst): number {
  const n = boardFaults(b).length;
  return n === 0 ? 3 : n === 1 ? 2 : 1;
}

const AOI_DETECT: Record<string, number> = {
  rotated: 0.9,
  missing: 0.98, flicked: 0.98, tombstone: 0.95, bridge: 0.85, misalign: 0.8, dry: 0.4, scorch: 1,
};

/** AOI can see shapes and markings, not values. */
export function aoiInspect(b: BoardInst, scope: 'critical' | 'full', rng: Rng): string[] {
  const flags: string[] = [];
  for (const f of boardFaults(b)) {
    if (f.kind === 'scorch') {
      flags.push('*');
      continue;
    }
    const p = b.parts.find((q) => q.des === f.des)!;
    const kind = PACKAGES[p.pkg].kind;
    if (scope === 'critical' && (kind === 'chip' || kind === 'led')) continue;
    let pd = AOI_DETECT[f.kind] ?? 0;
    if (f.kind === 'wrong') {
      const a = p.ipn ? PART_BY_IPN.get(p.ipn) : undefined;
      const t = PART_BY_IPN.get(p.truthIpn) as ErpPart;
      pd = a && a.marking !== t.marking ? 0.7 : 0;
    }
    if (rng.chance(pd)) flags.push(f.des);
  }
  return flags;
}
