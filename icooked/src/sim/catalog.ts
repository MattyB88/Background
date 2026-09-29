import { Rng } from '../core/rng';
import { LIBRARY, PACKAGES, PART_BY_IPN, type Category, type ErpPart, type PkgId } from './parts';
import type {
  BaselineFolder, BoardDef, Fiducial, FidShape, Placement, Product, Puzzle, PuzzleRow,
} from './types';

type Want = [cat: Category, value: string, count: number];

interface Recipe {
  name: string;
  w: number;
  h: number;
  passive: PkgId;
  wants: Want[];
}

const RECIPES: Recipe[] = [
  { name: 'USB-C Charger', w: 42, h: 26, passive: '0603', wants: [['CONN', 'USB-C', 1], ['IC', 'CHG1S', 1], ['TRANS', 'NMOS30V', 1], ['CAP', '100nF', 3], ['CAP', '10uF', 2], ['CAP', '1uF', 1], ['RES', '10K', 3], ['RES', '4K7', 2], ['RES', '1K', 2], ['LED', 'LED_RED', 1], ['LED', 'LED_GREEN', 1], ['TANT', '47uF', 1]] },
  { name: 'Plant Moisture Sensor', w: 52, h: 30, passive: '0402', wants: [['IC', 'MCU32', 1], ['IC', 'OPAMP2', 1], ['TRANS', 'LDO3V3', 1], ['CAP', '100nF', 4], ['CAP', '10uF', 1], ['CAP', '22pF', 2], ['RES', '10K', 4], ['RES', '100K', 2], ['RES', '330R', 1], ['LED', 'LED_GREEN', 1], ['XTAL', '8MHz', 1]] },
  { name: 'Guitar Pedal Overdrive', w: 68, h: 44, passive: '0805', wants: [['IC', 'OPAMP2', 2], ['RES', '10K', 3], ['RES', '100K', 2], ['RES', '1K', 2], ['RES', '47K', 2], ['RES', '2K2', 1], ['RES', '4K7', 1], ['CAP', '100nF', 3], ['CAP', '10nF', 2], ['CAP', '1uF', 2], ['ELEC', '100uF', 2], ['TRANS', 'NPN', 1], ['LED', 'LED_RED', 1], ['RES', '330R', 1]] },
  { name: 'Cat Feeder Controller', w: 78, h: 54, passive: '0603', wants: [['IC', 'MCU8', 1], ['IC', 'EEPROM64K', 1], ['TRANS', 'NMOS30V', 2], ['TRANS', 'LDO3V3', 1], ['XTAL', '16MHz', 1], ['CAP', '22pF', 2], ['CAP', '100nF', 5], ['CAP', '10uF', 2], ['RES', '10K', 5], ['RES', '1K', 3], ['LED', 'LED_BLUE', 1], ['ELEC', '220uF', 1], ['CONN', 'USB-C', 1]] },
  { name: 'E-Scooter Tail Light', w: 62, h: 20, passive: '0603', wants: [['IC', 'SHIFT8', 1], ['LED', 'LED_RED', 6], ['RES', '330R', 6], ['TRANS', 'NMOS30V', 1], ['CAP', '100nF', 2], ['CAP', '10uF', 1], ['TRANS', 'LDO3V3', 1]] },
  { name: 'Smart Doorbell Button', w: 36, h: 36, passive: '0402', wants: [['IC', 'MCU32', 1], ['TRANS', 'LDO3V3', 1], ['IC', 'EEPROM64K', 1], ['TRANS', 'NPN', 1], ['CAP', '100nF', 3], ['CAP', '4.7uF', 2], ['CAP', '22pF', 2], ['XTAL', '8MHz', 1], ['RES', '10K', 3], ['RES', '1K', 2], ['LED', 'LED_BLUE', 1]] },
  { name: 'Drone ESC', w: 46, h: 28, passive: '0603', wants: [['IC', 'MCU32', 1], ['TRANS', 'NMOS30V', 6], ['RES', '10K', 6], ['RES', '100R', 6], ['CAP', '100nF', 4], ['CAP', '10uF', 3], ['TANT', '10uF', 2]] },
  { name: 'Fridge Thermostat', w: 74, h: 50, passive: '0805', wants: [['IC', 'MCU8', 1], ['IC', 'OPAMP2', 1], ['IC', 'CANXCVR', 1], ['RES', '100K', 2], ['RES', '10K', 4], ['CAP', '100nF', 4], ['CAP', '1uF', 2], ['CAP', '22pF', 2], ['XTAL', '16MHz', 1], ['ELEC', '100uF', 1], ['LED', 'LED_GREEN', 1], ['LED', 'LED_RED', 1], ['RES', '1K', 2]] },
  { name: 'LED Name Badge', w: 50, h: 30, passive: '0603', wants: [['IC', 'SHIFT8', 2], ['IC', 'MCU32', 1], ['LED', 'LED_BLUE', 8], ['RES', '100R', 8], ['CAP', '100nF', 3], ['CAP', '10uF', 1], ['TRANS', 'LDO3V3', 1], ['CONN', 'USB-C', 1]] },
  { name: 'Coffee Machine Timer', w: 58, h: 38, passive: '0805', wants: [['IC', 'MCU8', 1], ['IC', 'USBPD', 1], ['TRANS', 'NPN', 2], ['RES', '10K', 4], ['RES', '2K2', 2], ['CAP', '100nF', 4], ['CAP', '4.7uF', 2], ['CAP', '22pF', 2], ['XTAL', '16MHz', 1], ['LED', 'LED_RED', 1], ['ELEC', '220uF', 1]] },
];

const CUSTOMERS = [
  'Brightside Gadgets', 'Vaporware Innovations', 'NeverShip Robotics', 'Kickstarted Again Inc',
  'Hype Cycle Labs', 'Big Promise Co', 'Pivot Twice Ltd', 'Synergy Synergies', 'Quantum Toaster Corp',
  'Disruptive Kettles',
];
const ENGINEERS = ['Dave (HW)', 'Priya (R&D)', 'Steve (only in Tuesdays)', 'Gaz (contractor)', 'Mo (intern)', 'Linda (principal, on leave)'];
const ALIAS_TEMPLATES = [
  '{n} - version that works',
  '{n} FINAL final2',
  'new {n} (use this one)',
  '{n}_fixed_REALLY',
  "{n} dave's copy DO NOT EDIT",
  '{n} v2 for real',
  'copy of {n} (3)',
];

function messyName(name: string, rng: Rng): string {
  const lower = rng.chance(0.5) ? name.toLowerCase() : name;
  const n = lower.replace('USB-C', rng.pick(['USB c', 'usbc', 'USB-C'])).replace(' Controller', rng.pick([' ctrl', ' controller', '']));
  return rng.pick(ALIAS_TEMPLATES).replace('{n}', n);
}

function findPart(cat: Category, value: string, pkg: PkgId, rng: Rng): ErpPart {
  const matches = LIBRARY.filter((p) => {
    if (p.category !== cat || p.value !== value) return false;
    if (cat === 'RES' || cat === 'CAP') return p.pkg === pkg;
    return true;
  });
  if (!matches.length) throw new Error(`no part ${cat} ${value} ${pkg}`);
  return rng.pick(matches);
}

const PREFIX: Record<Category, string> = { RES: 'R', CAP: 'C', TANT: 'C', ELEC: 'C', IC: 'U', TRANS: 'Q', LED: 'D', XTAL: 'Y', CONN: 'J' };

function footprint(pkg: PkgId, rot: number): { w: number; h: number } {
  const def = PACKAGES[pkg];
  let minX = -def.w / 2, maxX = def.w / 2, minY = -def.h / 2, maxY = def.h / 2;
  for (const p of def.pads) {
    minX = Math.min(minX, p.x - p.w / 2);
    maxX = Math.max(maxX, p.x + p.w / 2);
    minY = Math.min(minY, p.y - p.h / 2);
    maxY = Math.max(maxY, p.y + p.h / 2);
  }
  const w = maxX - minX + 1.2;
  const h = maxY - minY + 1.2 + 1.4; // room for silkscreen designator
  return rot % 180 === 0 ? { w, h } : { w: h, h: w };
}

function layoutBoard(parts: ErpPart[], w0: number, h0: number, rng: Rng): { w: number; h: number; placements: Placement[] } {
  let w = w0;
  let h = h0;
  for (let attempt = 0; attempt < 12; attempt++) {
    const rects: { x: number; y: number; w: number; h: number }[] = [
      { x: 0, y: 0, w: 7, h: 7 }, { x: w - 7, y: h - 7, w: 7, h: 7 }, { x: w - 7, y: 0, w: 7, h: 7 },
    ];
    const placements: Placement[] = [];
    const counters: Record<string, number> = {};
    const sorted = [...parts].sort((a, b) => PACKAGES[b.pkg].w * PACKAGES[b.pkg].h - PACKAGES[a.pkg].w * PACKAGES[a.pkg].h);
    let ok = true;
    for (const part of sorted) {
      const rot = rng.pick([0, 0, 90, 90, 180, 270]);
      const fp = footprint(part.pkg, rot);
      let placed = false;
      for (let tries = 0; tries < 600 && !placed; tries++) {
        const x = rng.range(2 + fp.w / 2, w - 2 - fp.w / 2);
        const y = rng.range(2 + fp.h / 2, h - 2 - fp.h / 2);
        const r = { x: x - fp.w / 2, y: y - fp.h / 2, w: fp.w, h: fp.h };
        if (rects.some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y)) continue;
        rects.push(r);
        const pre = PREFIX[part.category];
        counters[pre] = (counters[pre] ?? 0) + 1;
        placements.push({ des: `${pre}${counters[pre]}`, ipn: part.ipn, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, rot });
        placed = true;
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok) {
      // Renumber designators in reading order, like a real CAD tool would.
      const byPre: Record<string, Placement[]> = {};
      for (const p of placements) (byPre[p.des.replace(/\d+/g, '')] ??= []).push(p);
      for (const list of Object.values(byPre)) {
        list.sort((a, b) => b.y - a.y || a.x - b.x);
        list.forEach((p, i) => (p.des = `${p.des.replace(/\d+/g, '')}${i + 1}`));
      }
      return { w, h, placements };
    }
    w *= 1.1;
    h *= 1.08;
  }
  throw new Error('layout failed');
}

const MASKS = [
  { mask: '#1d6b3a', silk: '#f2f2ea' },
  { mask: '#1d6b3a', silk: '#f2f2ea' },
  { mask: '#16181b', silk: '#f2f2ea' },
  { mask: '#1b3f8f', silk: '#f2f2ea' },
  { mask: '#7a1a1a', silk: '#f2f2ea' },
  { mask: '#f1f1ee', silk: '#111111' },
];

function makeFids(w: number, h: number, rng: Rng): Fiducial[] {
  const shape = (): FidShape => rng.pick(['round', 'round', 'round', 'cross', 'square'] as FidShape[]);
  return [
    { x: 3.5, y: 3.5, shape: shape(), contrast: rng.range(0.35, 1) },
    { x: w - 3.5, y: h - 3.5, shape: shape(), contrast: rng.range(0.35, 1) },
    { x: w - 3.5, y: 3.5, shape: shape(), contrast: rng.range(0.35, 1) },
  ];
}

export function makeProduct(index: number, rng: Rng, inhouse: boolean): Product {
  const recipe = RECIPES[index % RECIPES.length];
  const parts: ErpPart[] = [];
  const chosen = new Map<string, ErpPart>();
  for (const [cat, value, count] of recipe.wants) {
    const key = `${cat}|${value}`;
    if (!chosen.has(key)) chosen.set(key, findPart(cat, value, recipe.passive, rng));
    for (let i = 0; i < count; i++) parts.push(chosen.get(key)!);
  }
  const { w, h, placements } = layoutBoard(parts, recipe.w, recipe.h, rng);
  const num = String(index + 1).padStart(3, '0');
  const major = rng.int(1, 3);
  const minor = rng.int(1, 4);
  const rev = `Rev${major}.${minor}`;
  const prevRev = `Rev${major}.${minor - 1}`;
  const colors = rng.pick(MASKS);

  // Previous revision: a couple of parts had different values.
  const prevPlacements = placements.map((p) => ({ ...p }));
  const swappable = prevPlacements.filter((p) => ['RES', 'CAP'].includes(PART_BY_IPN.get(p.ipn)!.category));
  rng.shuffle(swappable);
  for (const p of swappable.slice(0, 2)) {
    const cur = PART_BY_IPN.get(p.ipn)!;
    const alts = LIBRARY.filter((q) => q.category === cur.category && q.pkg === cur.pkg && q.value !== cur.value);
    p.ipn = rng.pick(alts).ipn;
  }

  const board: BoardDef = {
    pcbIpn: `CPC${num}_${rev}`,
    w: Math.round(w),
    h: Math.round(h),
    placements,
    fids: makeFids(Math.round(w), Math.round(h), rng),
    mask: colors.mask,
    silk: colors.silk,
    finish: rng.chance(0.6) ? 'enig' : 'hasl',
    seed: rng.int(1, 1e9),
    label: `${recipe.name.toUpperCase()} ${rev}`,
  };
  return {
    key: `p${index}`,
    name: recipe.name,
    customer: rng.pick(CUSTOMERS),
    asmIpn: `AA${num}_${rev}`,
    pcbIpn: board.pcbIpn,
    rev,
    prevRev,
    board,
    prevPlacements,
    engineer: rng.pick(ENGINEERS),
    fileAlias: messyName(recipe.name, rng),
    inhouse,
  };
}

// ---------------------------------------------------------------------------
// BOM Sudoku generation
// ---------------------------------------------------------------------------

function messyValue(p: ErpPart, rng: Rng): string {
  const v = p.value;
  if (p.category === 'RES') {
    const forms = [v, v.toLowerCase(), v.replace('K', 'k0'), `${v.replace('R', '')} ohm`.replace('K ohm', 'kOhm')];
    return rng.pick(forms);
  }
  if (p.category === 'CAP') {
    const map: Record<string, string[]> = {
      '100nF': ['100n', '0.1uF', '100nF', '0.1u'],
      '10nF': ['10n', '0.01uF', '10nF'],
      '22pF': ['22p', '22pF'],
      '1uF': ['1u', '1uF', '1µF'],
      '4.7uF': ['4u7', '4.7uF', '4.7u'],
      '10uF': ['10u', '10uF'],
    };
    return rng.pick(map[v] ?? [v]);
  }
  return rng.pick([v, p.desc.split(' ').slice(0, 3).join(' ').toLowerCase()]);
}

function typo(ipn: string, rng: Rng): string {
  const choices = [
    () => ipn.replace('0', 'O'),
    () => ipn.replace('-', '_'),
    () => {
      const d = ipn.split('');
      const i = rng.int(4, d.length - 2);
      [d[i], d[i + 1]] = [d[i + 1], d[i]];
      return d.join('');
    },
  ];
  for (let i = 0; i < 5; i++) {
    const t = rng.pick(choices)();
    if (t !== ipn && !PART_BY_IPN.has(t)) return t;
  }
  return ipn.replace('-', ' - ');
}

function rowsFor(placements: Placement[]): { ipn: string; des: string[] }[] {
  const map = new Map<string, string[]>();
  for (const p of placements) {
    if (!map.has(p.ipn)) map.set(p.ipn, []);
    map.get(p.ipn)!.push(p.des);
  }
  return [...map.entries()]
    .map(([ipn, des]) => ({ ipn, des: des.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) }))
    .sort((a, b) => a.des[0].localeCompare(b.des[0], undefined, { numeric: true }));
}

/** Parts in the ERP that match value+package (what a player could deduce from the text). */
export function ipnCandidates(truth: ErpPart): ErpPart[] {
  return LIBRARY.filter((p) => p.category === truth.category && p.pkg === truth.pkg && p.value === truth.value);
}

export function makePuzzle(prod: Product, difficulty: number, rng: Rng): Puzzle {
  const notes: string[] = [];
  const truthRows = rowsFor(prod.board.placements);
  const faults = Math.min(truthRows.length, 2 + Math.floor(difficulty * 4) + rng.int(0, 1));
  const faultRows = rng.shuffle([...truthRows.keys()]).slice(0, faults);

  const rows: PuzzleRow[] = truthRows.map((r) => {
    const part = PART_BY_IPN.get(r.ipn)!;
    return {
      valueText: messyValue(part, rng),
      pkgText: rng.chance(0.2) ? part.pkg.toLowerCase() : part.pkg,
      shownIpn: r.ipn,
      shownDes: [...r.des],
      truthIpn: r.ipn,
      truthDes: [...r.des],
      ipnKind: 'given',
      ipnGamble: false,
      desGamble: r.des.map(() => false),
    };
  });

  const missingDes: { row: number; slot: number; des: string; pkg: PkgId }[] = [];
  for (const ri of faultRows) {
    const row = rows[ri];
    const part = PART_BY_IPN.get(row.truthIpn)!;
    const kind = rng.pick(['blank', 'blank', 'typo', 'wrong', 'des', 'des'] as const);
    if (kind === 'des' && row.truthDes.length > 1) {
      const slot = rng.int(0, row.truthDes.length - 1);
      missingDes.push({ row: ri, slot, des: row.truthDes[slot], pkg: part.pkg });
      row.shownDes[slot] = null;
      continue;
    }
    if (kind === 'wrong') {
      const others = LIBRARY.filter((p) => p.category === part.category && p.pkg === part.pkg && p.value !== part.value);
      if (others.length) {
        row.shownIpn = rng.pick(others).ipn;
        row.ipnKind = 'wrong';
        continue;
      }
    }
    row.ipnKind = kind === 'typo' ? 'typo' : 'blank';
    row.shownIpn = kind === 'typo' ? typo(row.truthIpn, rng) : null;
    const cands = ipnCandidates(part);
    if (cands.length > 1) {
      // Several ERP parts share the value/package. Either leave a clue or make it a gamble.
      const roll = rng.next();
      if (roll < 0.4 && part.variant) {
        row.valueText += ` ${part.variant}`;
      } else if (roll < 0.75 && part.variant) {
        const clue = part.category === 'RES'
          ? `${part.value} on this job must be ${part.variant} (the ${part.variant === '1%' ? '5% ones drift' : '1% ones are for the other build'})`
          : `${part.value} caps: use the ${part.variant} ones. last batch with the others popped`;
        notes.push(clue);
      } else {
        row.ipnGamble = true;
      }
    }
  }

  // Designators that went missing with the same package are ambiguous unless a note pins them down.
  for (const m of missingDes) {
    const clash = missingDes.filter((o) => o !== m && o.pkg === m.pkg && PART_BY_IPN.get(rows[o.row].truthIpn)!.value !== PART_BY_IPN.get(rows[m.row].truthIpn)!.value);
    if (clash.length) {
      if (rng.chance(0.6)) {
        notes.push(`${m.des} is the other ${PART_BY_IPN.get(rows[m.row].truthIpn)!.value}, forgot it in the BOM sorry`);
      } else {
        rows[m.row].desGamble[m.slot] = true;
      }
    }
  }

  const fluff = [
    'pls build asap customer is shouting',
    'the zip in baselines is the right one I think',
    'if the USB port is wonky just push harder',
    'ignore the DNP column, there is no DNP column',
    'I renamed some designators, should be fine',
    'will update ERP after lunch',
    'the old rev also works (mostly)',
  ];
  notes.push(...rng.shuffle([...fluff]).slice(0, 2));
  rng.shuffle(notes);

  // Baseline folders: correct release, previous rev, and some junk.
  const correctFolder: BaselineFolder = {
    name: prod.fileAlias,
    rev: prod.rev,
    rows,
    correct: true,
    files: [`${prod.pcbIpn}.odb.tgz`, `BOM_${prod.asmIpn}.xlsx`, 'assy_drawing.pdf', 'notes.txt'],
    readme: `Released by ${prod.engineer}. Board ${prod.pcbIpn}.`,
  };
  const prevRows = rowsFor(prod.prevPlacements).map((r): PuzzleRow => {
    const part = PART_BY_IPN.get(r.ipn)!;
    return {
      valueText: messyValue(part, rng),
      pkgText: part.pkg,
      shownIpn: r.ipn,
      shownDes: [...r.des],
      truthIpn: r.ipn,
      truthDes: [...r.des],
      ipnKind: 'given',
      ipnGamble: false,
      desGamble: r.des.map(() => false),
    };
  });
  const oldPcb = prod.pcbIpn.replace(prod.rev, prod.prevRev);
  const prevFolder: BaselineFolder = {
    name: `${prod.name} ${rng.pick(['FINAL', 'latest', 'release', 'good one'])}`,
    rev: prod.prevRev,
    rows: prevRows,
    correct: false,
    files: [`${oldPcb}.odb.tgz`, `BOM_${prod.asmIpn.replace(prod.rev, prod.prevRev)}.xlsx`, 'assy_drawing.pdf'],
    readme: `Released by ${prod.engineer}. Board ${oldPcb}.`,
  };
  const folders = rng.shuffle([correctFolder, prevFolder]);

  const email = rng.pick([
    `From: ${prod.engineer}\nSubject: RE: RE: RE: ${prod.name}\n\nIt's in baselines. The one that works.\nERP is right, trust ERP. Unless ERP is wrong.`,
    `From: Sales\nSubject: ${prod.name} - URGENT\n\nPromised ${prod.customer} these by yesterday. You're a legend.\nPS what is a BOM`,
    `From: ${prod.engineer}\nSubject: ${prod.name} release\n\nReleased ${prod.rev}. The ${prod.prevRev} folder is still there, don't use it.\nMight have missed a designator or two.`,
  ]);

  return { folders, notes, email };
}
