import type { FeederKind, PkgId } from './parts';

export interface Placement {
  des: string;
  ipn: string;
  /** mm from board origin (bottom-left). */
  x: number;
  y: number;
  rot: number;
}

export type FidShape = 'round' | 'cross' | 'square';

export interface Fiducial {
  x: number;
  y: number;
  shape: FidShape;
  /** 0..1, how well it stands out from the solder mask. */
  contrast: number;
}

export interface BoardDef {
  pcbIpn: string;
  w: number;
  h: number;
  placements: Placement[];
  fids: Fiducial[];
  mask: string;
  silk: string;
  finish: 'enig' | 'hasl';
  seed: number;
  label: string;
}

export interface Product {
  key: string;
  name: string;
  customer: string;
  asmIpn: string;
  pcbIpn: string;
  rev: string;
  prevRev: string;
  board: BoardDef;
  /** The previous revision's placements (differs in a few values). */
  prevPlacements: Placement[];
  engineer: string;
  fileAlias: string;
  inhouse: boolean;
}

export type JobStatus =
  | 'offered'
  | 'accepted'
  | 'ready'
  | 'running'
  | 'finished'
  | 'declined';

export interface PuzzleRow {
  valueText: string;
  pkgText: string;
  shownIpn: string | null;
  shownDes: (string | null)[];
  truthIpn: string;
  truthDes: string[];
  ipnKind: 'given' | 'blank' | 'typo' | 'wrong';
  ipnGamble: boolean;
  desGamble: boolean[];
}

export interface BaselineFolder {
  name: string;
  files: string[];
  rev: string;
  rows: PuzzleRow[];
  correct: boolean;
  readme: string;
}

export interface Puzzle {
  folders: BaselineFolder[];
  notes: string[];
  email: string;
}

export interface PuzzleAnswer {
  folder: number;
  ipn: (string | null)[];
  des: (string | null)[][];
}

export interface Program {
  name: string;
  nx: number;
  ny: number;
  fidQuality: number;
  /** designator -> IPN the machine will place (null = not placed). */
  desIpn: Record<string, string | null>;
  /** IPN -> feeder slot index. */
  setup: Record<string, number>;
}

export interface Job {
  id: number;
  product: Product;
  kind: 'inhouse' | 'contract';
  qty: number;
  arrivedAt: number;
  dueAt: number;
  price: number;
  status: JobStatus;
  puzzle?: Puzzle;
  answer?: PuzzleAnswer;
  program?: Program;
  panelsStarted: number;
  boardsShipped: number;
  boardsScrapped: number;
  boardsDone: number;
  lateCharged: boolean;
  printProfile?: number[];
  printSeed: number;
}

export type Defect = 'tombstone' | 'misalign' | 'bridge' | 'dry' | 'missing' | 'wrong' | 'flicked';

export interface PlacedPart {
  des: string;
  truthIpn: string;
  /** What actually got placed. */
  ipn: string | null;
  pkg: PkgId;
  x: number;
  y: number;
  rot: number;
  dx: number;
  dy: number;
  drot: number;
  placed: boolean;
  paste: number[];
  defect: Defect | null;
  fixed: boolean;
  fromDump: boolean;
}

export interface BoardInst {
  serial: string;
  jobId: number;
  parts: PlacedPart[];
  scorch: number;
  reflowed: boolean;
  aoiFlags: string[];
  lights: number;
  state: 'line' | 'rework' | 'shipped' | 'scrap';
  reworks: number;
  /** Bumps whenever something visual changes so renderers can refresh. */
  version: number;
}

export type Stage = 'printer' | 'px9in' | 'px9' | 'conv' | 'inspect' | 'ovenq' | 'oven' | 'aoi' | 'test' | 'done';

export interface Panel {
  id: number;
  jobId: number;
  nx: number;
  ny: number;
  boards: BoardInst[];
  stage: Stage;
  t: number;
  placedIdx: number;
  held: boolean;
  binned: boolean;
}

export interface Reel {
  ipn: string;
  label: string;
  count: number;
  labelCount: number;
  tuning: number;
  jam: boolean;
  source: 'stock' | 'alt' | 'unapproved' | 'dump';
}

export interface FeederSlot {
  index: number;
  kind: FeederKind;
  reel: Reel | null;
}
