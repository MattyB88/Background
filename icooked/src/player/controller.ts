import * as THREE from 'three';
import { clamp, smooth } from '../core/util';
import type { Collider } from '../render/factory';

const EYE = 1.65;
const RADIUS = 0.3;

/** First-person walking controller with pointer lock and simple AABB collisions. */
export class PlayerController {
  yaw = Math.PI;
  pitch = -0.08;
  readonly pos = new THREE.Vector3(-4, 0, 1.2);
  private keys = new Set<string>();
  moving = 0;
  enabled = true;
  sensitivity = 0.0022;
  private tween: { from: THREE.Vector3; fromQ: THREE.Quaternion; to: THREE.Vector3; toQ: THREE.Quaternion; t: number; dur: number; done?: () => void } | null = null;
  /** When set, the camera is parked at a station view. */
  parked = false;

  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement, public colliders: Collider[]) {
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled || this.parked) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch = clamp(this.pitch - e.movementY * this.sensitivity, -1.35, 1.25);
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.dom;
  }

  lock() {
    if (!this.locked) this.dom.requestPointerLock?.()?.catch?.(() => undefined);
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  forward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Smoothly move the camera to a pose. */
  glideTo(pos: THREE.Vector3, look: THREE.Vector3, dur = 0.8, done?: () => void) {
    const m = new THREE.Matrix4().lookAt(pos, look, new THREE.Vector3(0, 1, 0));
    const toQ = new THREE.Quaternion().setFromRotationMatrix(m);
    this.tween = { from: this.camera.position.clone(), fromQ: this.camera.quaternion.clone(), to: pos.clone(), toQ, t: 0, dur, done };
  }

  glideBack(done?: () => void) {
    const eye = new THREE.Vector3(this.pos.x, EYE, this.pos.z);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    this.tween = { from: this.camera.position.clone(), fromQ: this.camera.quaternion.clone(), to: eye, toQ: q, t: 0, dur: 0.6, done: () => {
      this.parked = false;
      done?.();
    } };
  }

  faceTowards(p: THREE.Vector3) {
    const d = p.clone().sub(this.pos);
    this.yaw = Math.atan2(-d.x, -d.z);
  }

  private collide(p: THREE.Vector3) {
    for (const c of this.colliders) {
      const cx = clamp(p.x, c.minX, c.maxX);
      const cz = clamp(p.z, c.minZ, c.maxZ);
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < RADIUS * RADIUS) {
        const d = Math.sqrt(d2) || 0.0001;
        const push = RADIUS - d;
        if (d2 === 0) {
          p.z += RADIUS;
        } else {
          p.x += (dx / d) * push;
          p.z += (dz / d) * push;
        }
      }
    }
  }

  update(dt: number, stress: number) {
    if (this.tween) {
      const tw = this.tween;
      tw.t += dt / tw.dur;
      const k = smooth(clamp(tw.t, 0, 1));
      this.camera.position.lerpVectors(tw.from, tw.to, k);
      this.camera.quaternion.slerpQuaternions(tw.fromQ, tw.toQ, k);
      if (tw.t >= 1) {
        this.tween = null;
        tw.done?.();
      }
      this.moving = 0;
      return;
    }
    if (this.parked) {
      this.moving = 0;
      return;
    }
    let mx = 0;
    let mz = 0;
    if (this.enabled) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz -= 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    }
    const f = this.forward();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const move = f.multiplyScalar(mz).add(r.multiplyScalar(mx));
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = sprint ? 5.2 : 3.2;
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);
    this.moving = move.lengthSq() > 0 ? (sprint ? 1 : 0.6) : 0;
    this.pos.add(move);
    this.collide(this.pos);
    const bob = this.moving ? Math.sin(performance.now() / (sprint ? 90 : 130)) * 0.03 * this.moving : 0;
    this.camera.position.set(this.pos.x, EYE + bob, this.pos.z);
    // Stress makes it hard to hold a steady gaze.
    const jitter = stress > 0.6 ? (stress - 0.6) * 0.004 : 0;
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch + (Math.random() - 0.5) * jitter, this.yaw + (Math.random() - 0.5) * jitter, 0, 'YXZ'));
  }
}
