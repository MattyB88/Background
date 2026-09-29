import { Rng } from '../core/rng';
import { PACKAGES, PART_BY_IPN, type Pad } from '../sim/parts';
import type { BoardDef, BoardInst, Placement, PlacedPart } from '../sim/types';

/** Rotate a part-local point (mm) by rot degrees CCW and offset to board coordinates. */
export function toBoard(px: number, py: number, x: number, y: number, rot: number): [number, number] {
  const r = (rot * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [x + px * c - py * s, y + px * s + py * c];
}

export function padsOf(pl: Placement | PlacedPart): Pad[] {
  const pkg = 'pkg' in pl ? pl.pkg : PART_BY_IPN.get(pl.ipn)!.pkg;
  return PACKAGES[pkg].pads;
}

const COPPER_FINISH = { enig: '#d8b25a', hasl: '#c9ccd0' };

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
  return `rgb(${r},${g},${b})`;
}

/**
 * Paint the bare board (mask, traces, pads, silkscreen) into ctx.
 * Canvas origin is the top-left of the board; board y is flipped.
 */
export function paintBareBoard(ctx: CanvasRenderingContext2D, def: BoardDef, s: number, ox = 0, oy = 0) {
  const H = def.h;
  const X = (x: number) => ox + x * s;
  const Y = (y: number) => oy + (H - y) * s;
  const rng = new Rng(def.seed);

  // Laminate + mask with a subtle gradient so it doesn't look flat.
  const g = ctx.createLinearGradient(X(0), Y(H), X(def.w), Y(0));
  g.addColorStop(0, shade(def.mask, 1.12));
  g.addColorStop(1, shade(def.mask, 0.9));
  ctx.fillStyle = g;
  roundRect(ctx, X(0), Y(H), def.w * s, H * s, 1.2 * s);
  ctx.fill();

  // Copper under mask: a ground pour hatch and traces.
  const copperUnder = shade(def.mask, def.mask === '#f1f1ee' ? 0.9 : 1.35);
  ctx.strokeStyle = copperUnder;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const allPads: [number, number][] = [];
  for (const pl of def.placements) {
    for (const pad of padsOf(pl)) allPads.push(toBoard(pad.x, pad.y, pl.x, pl.y, pl.rot));
  }
  ctx.lineWidth = Math.max(1, 0.25 * s);
  for (let i = 0; i < allPads.length; i++) {
    if (!rng.chance(0.7)) continue;
    const [ax, ay] = allPads[i];
    let best = -1;
    let bd = Infinity;
    for (let k = 0; k < 6; k++) {
      const j = rng.int(0, allPads.length - 1);
      const d = Math.hypot(allPads[j][0] - ax, allPads[j][1] - ay);
      if (j !== i && d < bd && d > 1.5) {
        bd = d;
        best = j;
      }
    }
    if (best < 0 || bd > 30) {
      // Stub to a via.
      const vx = ax + rng.range(-4, 4);
      const vy = ay + rng.range(-4, 4);
      ctx.beginPath();
      ctx.moveTo(X(ax), Y(ay));
      ctx.lineTo(X(vx), Y(ay));
      ctx.lineTo(X(vx), Y(vy));
      ctx.stroke();
      via(ctx, X(vx), Y(vy), s, copperUnder);
      continue;
    }
    const [bx, by] = allPads[best];
    const dx = bx - ax;
    const dy = by - ay;
    const diag = Math.min(Math.abs(dx), Math.abs(dy));
    ctx.beginPath();
    ctx.moveTo(X(ax), Y(ay));
    if (Math.abs(dx) > Math.abs(dy)) {
      const mx = ax + Math.sign(dx) * (Math.abs(dx) - diag) / 2;
      ctx.lineTo(X(mx), Y(ay));
      ctx.lineTo(X(mx + Math.sign(dx) * diag), Y(by));
    } else {
      const my = ay + Math.sign(dy) * (Math.abs(dy) - diag) / 2;
      ctx.lineTo(X(ax), Y(my));
      ctx.lineTo(X(bx), Y(my + Math.sign(dy) * diag));
    }
    ctx.lineTo(X(bx), Y(by));
    ctx.stroke();
  }
  for (let i = 0; i < def.w * H * 0.012; i++) via(ctx, X(rng.range(2, def.w - 2)), Y(rng.range(2, H - 2)), s, copperUnder);

  // Pads.
  ctx.fillStyle = COPPER_FINISH[def.finish];
  for (const pl of def.placements) {
    for (const pad of padsOf(pl)) drawPad(ctx, pl.x, pl.y, pl.rot, pad, X, Y, s, 1);
  }

  // Fiducials: bare copper dot in a mask opening.
  for (const f of def.fids) {
    const cx = X(f.x);
    const cy = Y(f.y);
    ctx.fillStyle = shade(def.mask, 0.55 + 0.4 * (1 - f.contrast));
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = f.contrast > 0.5 ? COPPER_FINISH[def.finish] : shade(COPPER_FINISH[def.finish], 0.6 + f.contrast * 0.5);
    if (f.shape === 'round') {
      ctx.beginPath();
      ctx.arc(cx, cy, 0.5 * s, 0, Math.PI * 2);
      ctx.fill();
    } else if (f.shape === 'cross') {
      ctx.fillRect(cx - 0.6 * s, cy - 0.15 * s, 1.2 * s, 0.3 * s);
      ctx.fillRect(cx - 0.15 * s, cy - 0.6 * s, 0.3 * s, 1.2 * s);
    } else {
      ctx.fillRect(cx - 0.45 * s, cy - 0.45 * s, 0.9 * s, 0.9 * s);
    }
  }

  // Silkscreen: outlines + designators + board label.
  ctx.strokeStyle = def.silk;
  ctx.fillStyle = def.silk;
  ctx.lineWidth = Math.max(0.6, 0.15 * s);
  const fontPx = Math.max(5, 0.9 * s);
  ctx.font = `600 ${fontPx}px "Roboto Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const pl of def.placements) {
    const pkg = PACKAGES[PART_BY_IPN.get(pl.ipn)!.pkg];
    const hw = pkg.w / 2 + 0.35;
    const hh = pkg.h / 2 + 0.35;
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([a, b]) => toBoard(a, b, pl.x, pl.y, pl.rot));
    if (pkg.kind !== 'chip') {
      ctx.beginPath();
      corners.forEach(([a, b], i) => (i ? ctx.lineTo(X(a), Y(b)) : ctx.moveTo(X(a), Y(b))));
      ctx.closePath();
      ctx.stroke();
      if (pkg.kind === 'ic' || pkg.kind === 'tant' || pkg.kind === 'led') {
        const [dx, dy] = toBoard(-hw - 0.5, -hh - 0.2, pl.x, pl.y, pl.rot);
        ctx.beginPath();
        ctx.arc(X(dx), Y(dy), 0.3 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (s >= 4) {
      const [tx, ty] = toBoard(0, (pl.rot % 180 === 0 ? hh : hw) + 0.8, pl.x, pl.y, pl.rot % 180 === 0 ? 0 : pl.rot);
      ctx.fillText(pl.des, X(pl.rot % 180 === 0 ? pl.x : tx), Y(pl.rot % 180 === 0 ? pl.y + hh + 0.75 : ty));
    }
  }
  ctx.font = `700 ${Math.max(6, 1.4 * s)}px "Roboto Mono", monospace`;
  ctx.textAlign = 'left';
  ctx.fillText(def.pcbIpn, X(8), Y(2.2));
}

function via(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, col: string) {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(x, y, 0.35 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(x, y, 0.15 * s, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPad(
  ctx: CanvasRenderingContext2D, x: number, y: number, rot: number, pad: Pad,
  X: (v: number) => number, Y: (v: number) => number, s: number, scale: number,
) {
  const [cx, cy] = toBoard(pad.x, pad.y, x, y, rot);
  const swap = rot % 180 !== 0;
  const w = (swap ? pad.h : pad.w) * scale;
  const h = (swap ? pad.w : pad.h) * scale;
  ctx.fillRect(X(cx) - (w * s) / 2, Y(cy) - (h * s) / 2, w * s, h * s);
}

/** Paint paste/solder and 2D parts on top of a bare board (for baked, far-away views). */
export function paintBoardState(ctx: CanvasRenderingContext2D, def: BoardDef, b: BoardInst, s: number, ox = 0, oy = 0) {
  const H = def.h;
  const X = (x: number) => ox + x * s;
  const Y = (y: number) => oy + (H - y) * s;
  for (const p of b.parts) {
    const pads = PACKAGES[p.pkg].pads;
    pads.forEach((pad, i) => {
      const v = p.paste[i] ?? 1;
      if (v < 0.1) return;
      ctx.fillStyle = b.reflowed ? '#e4e7ea' : '#8f9296';
      ctx.globalAlpha = b.reflowed ? 1 : Math.min(1, 0.4 + v * 0.5);
      drawPad(ctx, p.x, p.y, p.rot, pad, X, Y, s, Math.min(1.25, 0.6 + v * 0.35));
    });
    ctx.globalAlpha = 1;
  }
  for (const p of b.parts) {
    if (!p.placed) continue;
    drawPart2D(ctx, p, X, Y, s);
  }
  if (b.scorch > 0) {
    ctx.fillStyle = `rgba(60,30,5,${Math.min(0.75, b.scorch * 0.8)})`;
    ctx.fillRect(X(0), Y(H), def.w * s, H * s);
  }
}

function drawPart2D(ctx: CanvasRenderingContext2D, p: PlacedPart, X: (v: number) => number, Y: (v: number) => number, s: number) {
  const pkg = PACKAGES[p.pkg];
  const erp = p.ipn ? PART_BY_IPN.get(p.ipn) : undefined;
  const body = erp?.body ?? '#222';
  const cx = X(p.x + p.dx);
  const cy = Y(p.y + p.dy);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-(p.rot + p.drot) * Math.PI) / 180);
  let w = pkg.w * s;
  const h = pkg.h * s;
  if (p.defect === 'tombstone') {
    ctx.translate((pkg.w / 2 - pkg.height / 2) * s, 0);
    w = pkg.height * s * 1.3;
  }
  if (pkg.kind === 'elec') {
    ctx.fillStyle = '#c9ccd2';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 0, (w / 2) * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d6d9de';
    ctx.beginPath();
    ctx.arc(0, 0, (w / 2) * 0.72, 0, Math.PI * 2);
    ctx.fill();
  } else if (pkg.kind === 'ic') {
    ctx.fillStyle = '#c4c7cc';
    for (const pad of pkg.pads) {
      if (pad.w > 2) continue;
      ctx.fillRect((pad.x - pad.w * 0.35) * s, (-pad.y - pad.h * 0.35) * s, pad.w * 0.7 * s, pad.h * 0.7 * s);
    }
    ctx.fillStyle = body;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = '#444';
    ctx.beginPath();
    ctx.arc(-w / 2 + 0.6 * s, h / 2 - 0.6 * s, 0.25 * s, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = body;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    if (pkg.kind === 'chip' || pkg.kind === 'led' || pkg.kind === 'tant') {
      ctx.fillStyle = '#d7dade';
      const cap = Math.min(w * 0.22, 0.45 * s);
      ctx.fillRect(-w / 2, -h / 2, cap, h);
      ctx.fillRect(w / 2 - cap, -h / 2, cap, h);
    }
  }
  if (erp?.marking && s >= 6 && p.defect !== 'tombstone') {
    ctx.fillStyle = pkg.kind === 'ic' ? '#9a9da2' : '#e9e9e9';
    ctx.font = `600 ${Math.max(4, Math.min(h * 0.55, w / (erp.marking.length * 0.62)))}px "Roboto Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(erp.marking, 0, 0);
  }
  ctx.restore();
}

/** Panel geometry in mm: rails top/bottom with tooling holes. */
export const RAIL = 6;

export function panelSize(def: BoardDef, nx: number, ny: number): { w: number; h: number } {
  return { w: nx * def.w + (nx - 1) * 4 + 6, h: ny * def.h + (ny - 1) * 4 + RAIL * 2 };
}

export function boardOrigin(def: BoardDef, i: number, nx: number): { x: number; y: number } {
  const col = i % nx;
  const row = Math.floor(i / nx);
  return { x: 3 + col * (def.w + 4), y: RAIL + row * (def.h + 4) };
}

/** Bake a whole panel into a canvas (used on the line where detail is far away). */
export function bakePanel(def: BoardDef, nx: number, ny: number, boards: BoardInst[] | null, pxPerMm: number, canvas?: HTMLCanvasElement): HTMLCanvasElement {
  const size = panelSize(def, nx, ny);
  const c = canvas ?? document.createElement('canvas');
  c.width = Math.ceil(size.w * pxPerMm);
  c.height = Math.ceil(size.h * pxPerMm);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = shade(def.mask, 0.95);
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#e9e3cf';
  for (const yy of [RAIL / 2, size.h - RAIL / 2]) {
    for (const xx of [4, size.w - 4]) {
      ctx.beginPath();
      ctx.arc(xx * pxPerMm, yy * pxPerMm, 1.5 * pxPerMm, 0, Math.PI * 2);
      ctx.fillStyle = '#222';
      ctx.fill();
    }
  }
  for (let i = 0; i < nx * ny; i++) {
    const o = boardOrigin(def, i, nx);
    // Canvas y grows downward; the panel's board rows start at the bottom.
    const oy = (size.h - o.y - def.h) * pxPerMm;
    paintBareBoard(ctx, def, pxPerMm, o.x * pxPerMm, oy);
    const b = boards?.[i];
    if (b) paintBoardState(ctx, def, b, pxPerMm, o.x * pxPerMm, oy);
  }
  return c;
}
