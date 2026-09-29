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
    this.overlay.style.cssText = 'position:absolute;inset:0;pointer-events:auto;touch-action:none';
    this.body.prepend(this.overlay);
    this.overlay.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.app.bench.zoom(e.deltaY);
    }, { passive: false });
    this.overlay.addEventListener('contextmenu', (e) => e.preventDefault());
    // Touch: one finger uses the tool, two fingers pinch-zoom and pan.
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; mx: number; my: number } | null = null;
    const measure = () => {
      const [a, b] = [...touches.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };
    const endTouch = (e: PointerEvent) => {
      if (!touches.delete(e.pointerId)) return;
      if (touches.size < 2) pinch = null;
    };
    this.overlay.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) {
          this.onRelease(e);
          pinch = measure();
          return;
        }
        if (touches.size > 2) return;
        this.updateNdc(e);
        this.refreshHover();
        this.onPress(e);
        return;
      }
      if (e.button === 2) {
        this.updateNdc(e);
        this.onGrip();
        return;
      }
      if (e.button === 1 || e.shiftKey) {
        this.panning = { x: e.clientX, y: e.clientY };
        this.overlay.setPointerCapture(e.pointerId);
        return;
      }
      this.onPress(e);
    });
    this.overlay.addEventListener('pointermove', (e) => {
      if (touches.has(e.pointerId)) {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && touches.size === 2) {
          const m = measure();
          if (m.d > 10 && pinch.d > 10) this.app.bench.zoom(Math.log(pinch.d / m.d) / 0.0015);
          const k = this.app.bench.dist / window.innerHeight;
          this.app.bench.pan(-(m.mx - pinch.mx) * k, -(m.my - pinch.my) * k);
          pinch = m;
          return;
        }
      }
      this.updateNdc(e);
      if (this.panning) {
        const k = this.app.bench.dist / window.innerHeight;
        this.app.bench.pan(-(e.clientX - this.panning.x) * k, -(e.clientY - this.panning.y) * k);
        this.panning = { x: e.clientX, y: e.clientY };
      }
    });
    window.addEventListener('pointercancel', endTouch);
    window.addEventListener('pointerup', (e) => {
      endTouch(e);
      this.panning = null;
      if (this.app.active === this) this.onRelease(e);
    });
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space' && this.app.active === this) {
        e.preventDefault();
        this.onGrip();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  protected refreshHover() {
    const b = this.app.bench.inst;
    this.hover = b ? this.partUnderCursor(b) : null;
  }

  protected updateNdc(e: PointerEvent) {
    this.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    this.app.bench.setNdc(this.ndc);
  }

  /** Close / open the tweezers (right click, Space, or the Grip button). */
  protected onGrip(): void {}
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
    this.refreshHover();
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
