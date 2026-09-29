/**
 * Package + ERP part library. Everything here is fictional: part numbers,
 * manufacturer codes and descriptions are invented for the game.
 */

export type PkgId =
  | '0402' | '0603' | '0805' | '1206'
  | 'SOT23' | 'SOIC8' | 'TSSOP16' | 'QFN32' | 'QFP44'
  | 'TANT_B' | 'ELEC_6' | 'USBC' | 'LED0805' | 'XTAL3225';

export type FeederKind = 'T8' | 'T12' | 'T16' | 'STICK' | 'TRAY';
export type Light = 'front' | 'side' | 'back';
export type SearchMethod = 'body' | 'leads' | 'corners';
export type PkgKind = 'chip' | 'ic' | 'tant' | 'elec' | 'conn' | 'led' | 'xtal';

export interface Pad { x: number; y: number; w: number; h: number }

export interface PackageDef {
  id: PkgId;
  kind: PkgKind;
  /** Body size in mm (x along pin axis for 2-terminal parts). */
  w: number;
  h: number;
  height: number;
  pads: Pad[];
  feeder: FeederKind;
  bestLight: Light;
  bestMethod: SearchMethod;
  /** Base difficulty to teach, 0 easy .. 1 hard. */
  teachDifficulty: number;
}

function twoPad(dx: number, pw: number, ph: number): Pad[] {
  return [
    { x: -dx, y: 0, w: pw, h: ph },
    { x: dx, y: 0, w: pw, h: ph },
  ];
}

function dualRow(n: number, pitch: number, rowY: number, pw: number, ph: number): Pad[] {
  const pads: Pad[] = [];
  const per = n / 2;
  const x0 = -((per - 1) * pitch) / 2;
  for (let i = 0; i < per; i++) pads.push({ x: x0 + i * pitch, y: rowY, w: pw, h: ph });
  for (let i = per - 1; i >= 0; i--) pads.push({ x: x0 + i * pitch, y: -rowY, w: pw, h: ph });
  return pads;
}

function quad(perSide: number, pitch: number, off: number, pw: number, ph: number): Pad[] {
  const pads: Pad[] = [];
  const s0 = -((perSide - 1) * pitch) / 2;
  for (let i = 0; i < perSide; i++) pads.push({ x: -off, y: s0 + i * pitch, w: ph, h: pw });
  for (let i = 0; i < perSide; i++) pads.push({ x: s0 + i * pitch, y: off, w: pw, h: ph });
  for (let i = 0; i < perSide; i++) pads.push({ x: off, y: -s0 - i * pitch, w: ph, h: pw });
  for (let i = 0; i < perSide; i++) pads.push({ x: -s0 - i * pitch, y: -off, w: pw, h: ph });
  return pads;
}

export const PACKAGES: Record<PkgId, PackageDef> = {
  '0402': { id: '0402', kind: 'chip', w: 1.0, h: 0.5, height: 0.35, pads: twoPad(0.5, 0.5, 0.55), feeder: 'T8', bestLight: 'front', bestMethod: 'body', teachDifficulty: 0.35 },
  '0603': { id: '0603', kind: 'chip', w: 1.6, h: 0.8, height: 0.45, pads: twoPad(0.8, 0.8, 0.9), feeder: 'T8', bestLight: 'front', bestMethod: 'body', teachDifficulty: 0.2 },
  '0805': { id: '0805', kind: 'chip', w: 2.0, h: 1.25, height: 0.5, pads: twoPad(1.0, 1.0, 1.4), feeder: 'T8', bestLight: 'front', bestMethod: 'body', teachDifficulty: 0.15 },
  '1206': { id: '1206', kind: 'chip', w: 3.2, h: 1.6, height: 0.55, pads: twoPad(1.6, 1.2, 1.8), feeder: 'T8', bestLight: 'front', bestMethod: 'body', teachDifficulty: 0.1 },
  SOT23: { id: 'SOT23', kind: 'ic', w: 2.9, h: 1.3, height: 1.0, pads: [{ x: -0.95, y: -1.1, w: 0.6, h: 0.8 }, { x: 0.95, y: -1.1, w: 0.6, h: 0.8 }, { x: 0, y: 1.1, w: 0.6, h: 0.8 }], feeder: 'T8', bestLight: 'side', bestMethod: 'leads', teachDifficulty: 0.35 },
  SOIC8: { id: 'SOIC8', kind: 'ic', w: 4.9, h: 3.9, height: 1.5, pads: dualRow(8, 1.27, 2.7, 0.6, 1.5), feeder: 'STICK', bestLight: 'side', bestMethod: 'leads', teachDifficulty: 0.3 },
  TSSOP16: { id: 'TSSOP16', kind: 'ic', w: 5.0, h: 4.4, height: 1.0, pads: dualRow(16, 0.65, 3.0, 0.35, 1.2), feeder: 'T12', bestLight: 'side', bestMethod: 'leads', teachDifficulty: 0.55 },
  QFN32: { id: 'QFN32', kind: 'ic', w: 5.0, h: 5.0, height: 0.9, pads: [...quad(8, 0.5, 2.6, 0.25, 0.8), { x: 0, y: 0, w: 3.3, h: 3.3 }], feeder: 'T12', bestLight: 'back', bestMethod: 'corners', teachDifficulty: 0.7 },
  QFP44: { id: 'QFP44', kind: 'ic', w: 10, h: 10, height: 1.4, pads: quad(11, 0.8, 5.9, 0.45, 1.5), feeder: 'TRAY', bestLight: 'side', bestMethod: 'leads', teachDifficulty: 0.6 },
  TANT_B: { id: 'TANT_B', kind: 'tant', w: 3.5, h: 2.8, height: 1.9, pads: twoPad(1.5, 1.5, 2.4), feeder: 'T12', bestLight: 'front', bestMethod: 'body', teachDifficulty: 0.2 },
  ELEC_6: { id: 'ELEC_6', kind: 'elec', w: 6.6, h: 6.6, height: 5.4, pads: twoPad(2.6, 1.8, 3.2), feeder: 'T16', bestLight: 'back', bestMethod: 'body', teachDifficulty: 0.25 },
  USBC: { id: 'USBC', kind: 'conn', w: 8.9, h: 7.3, height: 3.2, pads: [...dualRow(12, 0.5, 3.4, 0.3, 1.0), { x: -4.3, y: 1.0, w: 1.0, h: 1.8 }, { x: 4.3, y: 1.0, w: 1.0, h: 1.8 }, { x: -4.3, y: -2.0, w: 1.0, h: 1.8 }, { x: 4.3, y: -2.0, w: 1.0, h: 1.8 }], feeder: 'T16', bestLight: 'side', bestMethod: 'corners', teachDifficulty: 0.65 },
  LED0805: { id: 'LED0805', kind: 'led', w: 2.0, h: 1.25, height: 0.8, pads: twoPad(1.0, 1.0, 1.4), feeder: 'T8', bestLight: 'back', bestMethod: 'body', teachDifficulty: 0.3 },
  XTAL3225: { id: 'XTAL3225', kind: 'xtal', w: 3.2, h: 2.5, height: 0.8, pads: [{ x: -1.1, y: -0.85, w: 1.4, h: 1.2 }, { x: 1.1, y: -0.85, w: 1.4, h: 1.2 }, { x: 1.1, y: 0.85, w: 1.4, h: 1.2 }, { x: -1.1, y: 0.85, w: 1.4, h: 1.2 }], feeder: 'T8', bestLight: 'side', bestMethod: 'corners', teachDifficulty: 0.4 },
};

export type Category = 'RES' | 'CAP' | 'TANT' | 'ELEC' | 'IC' | 'TRANS' | 'LED' | 'XTAL' | 'CONN';

export interface ErpPart {
  ipn: string;
  category: Category;
  value: string;
  pkg: PkgId;
  desc: string;
  mpn: string;
  cost: number;
  /** Text printed on the part body (resistor code, IC marking). '' = unmarked. */
  marking: string;
  /** Hex colour for the body in renders. */
  body: string;
  /** Approved alternate IPN, if any. */
  alt?: string;
  /** Tolerance / voltage / variant tag used to make near-duplicates. */
  variant?: string;
}

const RES_VALUES: [string, number][] = [
  ['0R', 0], ['10R', 10], ['100R', 100], ['330R', 330], ['1K', 1e3], ['2K2', 2.2e3],
  ['4K7', 4.7e3], ['10K', 1e4], ['22K', 2.2e4], ['47K', 4.7e4], ['100K', 1e5],
];

/** EIA 3-digit resistor code, e.g. 10K -> 103. */
export function resCode(ohms: number): string {
  if (ohms === 0) return '000';
  if (ohms < 10) return `${Math.round(ohms)}R0`;
  let exp = 0;
  let v = ohms;
  while (v >= 100) {
    v /= 10;
    exp++;
  }
  return `${Math.round(v)}${exp}`;
}

function buildLibrary(): ErpPart[] {
  const parts: ErpPart[] = [];
  let n = 100;
  const next = (prefix: string) => `${prefix}-${String(n++).padStart(4, '0')}`;

  for (const pkg of ['0402', '0603', '0805'] as PkgId[]) {
    for (const [v, ohms] of RES_VALUES) {
      for (const tol of ['1%', '5%']) {
        const pw = pkg === '0402' ? '1/16W' : pkg === '0603' ? '0.1W' : '1/8W';
        parts.push({
          ipn: next('100'),
          category: 'RES',
          value: v,
          pkg,
          desc: `RES ${v} ${tol} ${pkg} ${pw}`,
          mpn: `RK${pkg}${tol === '1%' ? 'F' : 'J'}${v.replace('.', 'R')}`,
          cost: tol === '1%' ? 0.012 : 0.006,
          marking: pkg === '0402' ? '' : resCode(ohms),
          body: '#1b1b1b',
          variant: tol,
        });
      }
    }
  }

  const caps: [string, string[]][] = [
    ['22pF', ['C0G 50V']],
    ['10nF', ['X7R 50V']],
    ['100nF', ['X7R 16V', 'X7R 50V']],
    ['1uF', ['X5R 16V', 'X7R 25V']],
    ['4.7uF', ['X5R 10V', 'X5R 25V']],
    ['10uF', ['X5R 10V', 'X5R 25V']],
  ];
  for (const pkg of ['0402', '0603', '0805'] as PkgId[]) {
    for (const [v, variants] of caps) {
      for (const vr of variants) {
        parts.push({
          ipn: next('200'),
          category: 'CAP',
          value: v,
          pkg,
          desc: `CAP ${v} ${vr} ${pkg}`,
          mpn: `CM${pkg}${vr.split(' ')[0]}${v.replace('.', 'R')}${vr.split(' ')[1]}`,
          cost: 0.02 + (v.includes('uF') ? 0.03 : 0),
          marking: '',
          body: v === '22pF' ? '#c9b48d' : '#a88a5e',
          variant: vr,
        });
      }
    }
  }

  parts.push(
    { ipn: next('210'), category: 'TANT', value: '10uF', pkg: 'TANT_B', desc: 'CAP TANT 10uF 16V CASE-B', mpn: 'TB106K016', cost: 0.22, marking: '106', body: '#d8a019', variant: '16V' },
    { ipn: next('210'), category: 'TANT', value: '47uF', pkg: 'TANT_B', desc: 'CAP TANT 47uF 10V CASE-B', mpn: 'TB476K010', cost: 0.31, marking: '476', body: '#d8a019', variant: '10V' },
    { ipn: next('220'), category: 'ELEC', value: '100uF', pkg: 'ELEC_6', desc: 'CAP ALU 100uF 25V 6.3x5.4', mpn: 'EA101M025', cost: 0.18, marking: '100', body: '#1a2c5c', variant: '25V' },
    { ipn: next('220'), category: 'ELEC', value: '220uF', pkg: 'ELEC_6', desc: 'CAP ALU 220uF 16V 6.3x5.4', mpn: 'EA221M016', cost: 0.21, marking: '220', body: '#1a2c5c', variant: '16V' },
  );

  const ics: [string, PkgId, string, string, number][] = [
    ['LDO3V3', 'SOT23', 'IC LDO 3.3V 300mA SOT23', 'L33', 0.32],
    ['NMOS30V', 'SOT23', 'MOSFET N-CH 30V 4A SOT23', 'N30', 0.12],
    ['NPN', 'SOT23', 'TRANS NPN 40V 200mA SOT23', '1AM', 0.04],
    ['OPAMP2', 'SOIC8', 'IC OPAMP DUAL RRIO SOIC8', 'OPA2X', 0.55],
    ['EEPROM64K', 'SOIC8', 'IC EEPROM 64Kbit I2C SOIC8', '24C64', 0.28],
    ['CANXCVR', 'SOIC8', 'IC CAN TRANSCEIVER 5V SOIC8', 'CN1051', 0.84],
    ['USBPD', 'TSSOP16', 'IC USB-PD SINK CONTROLLER TSSOP16', 'PD2016', 1.45],
    ['SHIFT8', 'TSSOP16', 'IC SHIFT REGISTER 8BIT TSSOP16', 'HC595', 0.19],
    ['MCU32', 'QFN32', 'IC MCU 32BIT 64K FLASH QFN32', 'ZM32F0', 1.9],
    ['CHG1S', 'QFN32', 'IC LI-ION CHARGER 2A QFN32', 'CHG4056', 1.1],
    ['MCU8', 'QFP44', 'IC MCU 8BIT 32K FLASH QFP44', 'AT8M44', 2.4],
  ];
  for (const [v, pkg, desc, mark, cost] of ics) {
    parts.push({ ipn: next('300'), category: pkg === 'SOT23' ? 'TRANS' : 'IC', value: v, pkg, desc, mpn: `ZX-${mark}`, cost, marking: mark, body: '#161616' });
  }

  for (const [c, hex] of [['RED', '#ff3322'], ['GREEN', '#22ff55'], ['BLUE', '#3377ff']]) {
    parts.push({ ipn: next('400'), category: 'LED', value: `LED_${c}`, pkg: 'LED0805', desc: `LED ${c} 0805 20mA`, mpn: `LD0805${c[0]}`, cost: 0.05, marking: '', body: hex });
  }
  for (const f of ['8MHz', '16MHz']) {
    parts.push({ ipn: next('600'), category: 'XTAL', value: f, pkg: 'XTAL3225', desc: `XTAL ${f} 20pF 3225`, mpn: `XT3225-${f}`, cost: 0.24, marking: f.replace('MHz', '.000'), body: '#c7c9cc' });
  }
  parts.push({ ipn: next('500'), category: 'CONN', value: 'USB-C', pkg: 'USBC', desc: 'CONN USB-C RCPT 16P SMT', mpn: 'UC16-SMT', cost: 0.62, marking: '', body: '#b9bcc2' });

  // Approved alternates: 1% resistors can stand in for the matching 5% part.
  for (const p of parts) {
    if (p.category === 'RES' && p.variant === '5%') {
      const alt = parts.find((q) => q.category === 'RES' && q.value === p.value && q.pkg === p.pkg && q.variant === '1%');
      if (alt) p.alt = alt.ipn;
    }
  }
  return parts;
}

export const LIBRARY: ErpPart[] = buildLibrary();
export const PART_BY_IPN: Map<string, ErpPart> = new Map(LIBRARY.map((p) => [p.ipn, p]));

export function partsLike(p: ErpPart): ErpPart[] {
  return LIBRARY.filter((q) => q.category === p.category && q.pkg === p.pkg);
}

/** Two parts that look the same to a camera and to a human eye. */
export function looksIdentical(a: ErpPart, b: ErpPart): boolean {
  return a.pkg === b.pkg && a.category === b.category && a.marking === b.marking && a.body === b.body;
}
