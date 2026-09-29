import * as THREE from 'three';
import { PACKAGES } from '../sim/parts';
import type { BoardDef, BoardInst, PlacedPart } from '../sim/types';
import { Station } from './base';

/** Shared close-up controls: zoom, pan, hover a part under the cursor. */
export abstract class BenchStation extends Station {
  closeup = true;
  protected hover: PlacedPart | null = null;
  protected ndc = new THREE.Vector2();
  private panning: { x: number; y: number } | null = null;
  private keys = new Set<string>();
  protected overlay!: HTMLElement;

  protected initBench() {
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = 'position:absolute;inset:0;pointer-events:auto';
    this.body.prepend(this.overlay);
    this.overlay.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.app.bench.zoom(e.deltaY);
    }, { passive: false });
    this.overlay.addEventListener('contextmenu', (e) => e.preventDefault());
    this.overlay.addEventListener('pointerdown', (e) => {
      if (e.button === 2 || e.button === 1) {
        this.panning = { x: e.clientX, y: e.clientY };
        this.overlay.setPointerCapture(e.pointerId);
        return;
      }
      this.onPress(e);
    });
    this.overlay.addEventListener('pointermove', (e) => {
      this.updateNdc(e);
      if (this.panning) {
        const k = this.app.bench.dist / window.innerHeight;
        this.app.bench.pan(-(e.clientX - this.panning.x) * k, -(e.clientY - this.panning.y) * k);
        this.panning = { x: e.clientX, y: e.clientY };
      }
    });
    window.addEventListener('pointerup', (e) => {
      this.panning = null;
      if (this.app.active === this) this.onRelease(e);
    });
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  protected updateNdc(e: PointerEvent) {
    this.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    this.app.bench.setNdc(this.ndc);
  }

  protected abstract onPress(e: PointerEvent): void;
  protected abstract onRelease(e: PointerEvent): void;

  /** Nearest part (placed or not) whose footprint is under the cursor. */
  protected partUnderCursor(b: BoardInst): PlacedPart | null {
    const c = this.app.bench.cursorBoard();
    let best: PlacedPart | null = null;
    let bd = Infinity;
    for (const p of b.parts) {
      const pkg = PACKAGES[p.pkg];
      const px = p.x + (p.placed ? p.dx : 0);
      const py = p.y + (p.placed ? p.dy : 0);
      const d = Math.hypot(c.x - px, c.y - py);
      const r = Math.max(pkg.w, pkg.h) / 2 + 0.6;
      if (d < r && d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  protected setBoard(def: BoardDef | null, b: BoardInst | null) {
    this.app.bench.setBoard(def, b);
  }

  update(dt: number) {
    const k = this.app.bench.dist * dt;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) this.app.bench.pan(-k, 0);
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) this.app.bench.pan(k, 0);
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) this.app.bench.pan(0, -k);
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) this.app.bench.pan(0, k);
    if (this.keys.has('Equal') || this.keys.has('NumpadAdd')) this.app.bench.zoom(-600 * dt);
    if (this.keys.has('Minus') || this.keys.has('NumpadSubtract')) this.app.bench.zoom(600 * dt);
    const b = this.app.bench.inst;
    this.hover = b ? this.partUnderCursor(b) : null;
    if (this.hover) {
      const pkg = PACKAGES[this.hover.pkg];
      this.app.bench.showHighlight(this.hover.x + (this.hover.placed ? this.hover.dx : 0), this.hover.y + (this.hover.placed ? this.hover.dy : 0), Math.max(pkg.w, pkg.h) / 2 + 0.8);
    } else this.app.bench.showHighlight(null);
  }

  leave() {
    this.keys.clear();
    this.app.bench.setTool(null);
    this.app.bench.showHighlight(null);
  }
}
