import * as THREE from 'three';
import { BASE_POSE, SIT_HIPS, STAND_HIPS } from './character.js';
import { SPOTS, THROW_AREA, PLUSH_DESK_POS } from './scene.js';

// Command format (same one the AI brain will send in Stage 4):
//   { action: 'sit'|'stand'|'walk'|'jump'|'angry'|'throw'|'wave'|'idle',
//     emotion: 'neutral'|'happy'|'angry'|'sad'|'surprised',
//     say: 'text for the speech bubble' }
export const ACTIONS = ['sit', 'stand', 'walk', 'jump', 'angry', 'throw', 'wave', 'idle'];
export const EMOTIONS = ['neutral', 'happy', 'angry', 'sad', 'surprised'];

const MAX_QUEUE = 3;
const EMOTION_HOLD = 6;
const WALK_SPEED = 1.3;
const MONITOR_YAW = 0.6;

const easeInOut = k => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
const linear = k => k;
const wait = s => new Promise(r => setTimeout(r, s * 1000));
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

const SIT_POSE = {
  hipsY: SIT_HIPS, lHipX: -1.5, rHipX: -1.5, lKneeX: 1.5, rKneeX: 1.5,
  lShX: -0.75, rShX: -0.75, lShZ: 0.15, rShZ: -0.15, lElX: -0.75, rElX: -0.75,
  torsoX: 0.05,
};
const STAND_POSE = { ...BASE_POSE };

class Animator {
  constructor() { this.tweens = []; }

  tween(dur, fn, ease = easeInOut) {
    return new Promise(resolve => this.tweens.push({ t: 0, dur, fn, ease, resolve }));
  }

  update(dt) {
    for (const tw of [...this.tweens]) {
      tw.t = Math.min(tw.dur, tw.t + dt);
      const k = tw.dur > 0 ? tw.t / tw.dur : 1;
      tw.fn(tw.ease(k), k);
      if (k >= 1) {
        this.tweens.splice(this.tweens.indexOf(tw), 1);
        tw.resolve();
      }
    }
  }
}

export class Director {
  constructor({ character, scene, desk, plush, onSay }) {
    this.char = character;
    this.scene = scene;
    this.desk = desk;
    this.plush = plush;
    this.onSay = onSay;
    this.anim = new Animator();
    this.queue = [];
    this.busy = false;
    this.sitting = false;
    this.plushAt = 'desk';
    this._emotionTimer = 0;

    scene.add(plush);
    plush.position.copy(PLUSH_DESK_POS);
    this._placeAt(SPOTS.chair);
    Object.assign(character.pose, SIT_POSE);
    this.sitting = true;
  }

  command(cmd) {
    const c = {
      action: ACTIONS.includes(cmd.action) ? cmd.action : 'idle',
      emotion: EMOTIONS.includes(cmd.emotion) ? cmd.emotion : null,
      say: typeof cmd.say === 'string' ? cmd.say.trim().slice(0, 240) : '',
    };
    this.queue.push(c);
    while (this.queue.length > MAX_QUEUE) this.queue.shift();
    this._pump();
  }

  update(dt) {
    this.anim.update(dt);
    const ch = this.char;
    ch.typing = this.sitting && !this.busy && !ch.talking;
    ch.lookYawTarget = this.sitting && !ch.talking && !this.busy ? MONITOR_YAW : 0;
    if (!this.busy && ch.emotion !== 'neutral') {
      this._emotionTimer -= dt;
      if (this._emotionTimer <= 0) ch.emotion = 'neutral';
    }
  }

  async _pump() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) {
      const c = this.queue.shift();
      if (c.emotion) this.char.emotion = c.emotion;
      const talk = c.say ? this._say(c.say) : Promise.resolve();
      try {
        await this[`_${c.action}`]();
      } catch (err) {
        console.error('action failed', c, err);
      }
      await talk;
      this._emotionTimer = EMOTION_HOLD;
    }
    this.busy = false;
  }

  async _say(text) {
    const secs = Math.min(8, Math.max(1.5, text.length * 0.06));
    this.char.talking = true;
    this.onSay(text);
    await wait(secs);
    this.char.talking = false;
    this.onSay('');
  }

  // ---------- pose helpers ----------

  to(targets, dur, ease = easeInOut) {
    const p = this.char.pose;
    const start = {};
    for (const k in targets) start[k] = p[k];
    return this.anim.tween(dur, e => {
      for (const k in targets) p[k] = start[k] + (targets[k] - start[k]) * e;
    }, ease);
  }

  _placeAt(spot) {
    this.char.root.position.set(spot.x, 0, spot.z);
    this.char.root.rotation.y = spot.face ?? 0;
  }

  turnTo(yaw, dur = 0.25) {
    const r = this.char.root.rotation;
    const from = r.y;
    const delta = wrapAngle(yaw - from);
    return this.anim.tween(dur, e => { r.y = from + delta * e; });
  }

  faceToward(x, z) {
    const p = this.char.root.position;
    return this.turnTo(Math.atan2(x - p.x, z - p.z));
  }

  _crossesDesk(ax, az, bx, bz) {
    for (let i = 0; i <= 20; i++) {
      const x = ax + (bx - ax) * i / 20, z = az + (bz - az) * i / 20;
      if (Math.abs(x) < 1.0 && z > -1.0 && z < -0.2) return true;
    }
    return false;
  }

  async walkTo(x, z) {
    const p = this.char.root.position;
    const path = [];
    if (this._crossesDesk(p.x, p.z, x, z)) {
      const side = p.x + x >= 0 ? 1.3 : -1.3;
      path.push([side, p.z], [side, z]);
    }
    path.push([x, z]);
    for (const [tx, tz] of path) await this._walkSegment(tx, tz);
    await this.to({ lHipX: 0, rHipX: 0, lKneeX: 0, rKneeX: 0, lShX: 0, rShX: 0, lElX: 0, rElX: 0 }, 0.2);
  }

  async _walkSegment(x, z) {
    const root = this.char.root.position;
    const sx = root.x, sz = root.z;
    const dist = Math.hypot(x - sx, z - sz);
    if (dist < 0.02) return;
    await this.faceToward(x, z);
    const p = this.char.pose;
    await this.anim.tween(dist / WALK_SPEED, e => {
      root.x = sx + (x - sx) * e;
      root.z = sz + (z - sz) * e;
      const ph = (dist * e / 0.32) * Math.PI;
      const s = Math.sin(ph);
      p.lHipX = s * 0.55;
      p.rHipX = -s * 0.55;
      p.lKneeX = Math.max(0, -s) * 0.7;
      p.rKneeX = Math.max(0, s) * 0.7;
      p.lShX = -s * 0.45;
      p.rShX = s * 0.45;
      p.lElX = p.rElX = -0.3;
      p.hipsY = STAND_HIPS + Math.abs(Math.cos(ph)) * 0.025;
    }, linear);
  }

  async _ensureStanding() {
    if (!this.sitting) return;
    this.sitting = false;
    await this.turnTo(0, 0.15);
    await this.to(STAND_POSE, 0.45);
  }

  _handOffset() {
    return new THREE.Vector3(0, -0.06, 0.05);
  }

  async _grabPlush() {
    const { plush } = this;
    this.char.joints.rHand.attach(plush);
    const from = plush.position.clone();
    const to = this._handOffset();
    await this.anim.tween(0.25, e => plush.position.lerpVectors(from, to, e));
    this.plushAt = 'hand';
  }

  // ---------- actions ----------

  async _idle() {
    await wait(0.5);
  }

  async _sit() {
    if (this.sitting) return;
    const c = SPOTS.chair;
    await this.walkTo(c.x, c.z);
    await this.turnTo(0);
    if (this.plushAt === 'hand') {
      await this.to({ rShX: -1.2, rElX: -0.3 }, 0.3);
      this.scene.attach(this.plush);
      const from = this.plush.position.clone();
      await this.anim.tween(0.3, e => this.plush.position.lerpVectors(from, PLUSH_DESK_POS, e));
      this.plush.rotation.set(0, 0, 0);
      this.plushAt = 'desk';
    }
    await this.to(SIT_POSE, 0.5);
    this.sitting = true;
  }

  async _stand() {
    await this._ensureStanding();
  }

  async _walk() {
    await this._ensureStanding();
    const choices = ['center', 'window', 'shelf', 'front'].map(k => SPOTS[k]);
    const p = this.char.root.position;
    const options = choices.filter(s => Math.hypot(s.x - p.x, s.z - p.z) > 0.5);
    const s = options[Math.floor(Math.random() * options.length)];
    await this.walkTo(s.x, s.z);
    await this.turnTo(0.6);
  }

  async _jump() {
    await this._ensureStanding();
    await this.turnTo(0.6);
    for (let i = 0; i < 3; i++) {
      await this.to({ hipsY: STAND_HIPS - 0.08, lHipX: -0.35, rHipX: -0.35, lKneeX: 0.7, rKneeX: 0.7, lShZ: 0.3, rShZ: -0.3 }, 0.12);
      await this.to({ hipsY: STAND_HIPS + 0.38, lHipX: 0, rHipX: 0, lKneeX: 0.2, rKneeX: 0.2, lShZ: 2.6, rShZ: -2.6, headX: -0.2 }, 0.22,
        k => 1 - (1 - k) ** 2);
      await this.to({ hipsY: STAND_HIPS, lKneeX: 0, rKneeX: 0, lShZ: 1.8, rShZ: -1.8, headX: 0 }, 0.22, k => k * k);
    }
    await this.to(STAND_POSE, 0.25);
  }

  async _angry() {
    if (this.sitting) return this._deskSlam();
    await this.turnTo(0.6);
    await this.to({ lShZ: 0.5, rShZ: -0.5, lElX: -1.2, rElX: -1.2, lShX: -0.3, rShX: -0.3 }, 0.15);
    for (let i = 0; i < 4; i++) {
      const left = i % 2 === 0;
      const hip = left ? 'lHipX' : 'rHipX', knee = left ? 'lKneeX' : 'rKneeX';
      await this.to({ [hip]: -0.8, [knee]: 1.0, torsoZ: left ? -0.08 : 0.08 }, 0.14);
      await this.to({ [hip]: 0, [knee]: 0, hipsY: STAND_HIPS - 0.03 }, 0.08, k => k * k);
      await this.to({ hipsY: STAND_HIPS }, 0.08);
    }
    await this.to(STAND_POSE, 0.3);
  }

  async _deskSlam() {
    const desk = this.desk;
    for (let i = 0; i < 2; i++) {
      await this.to({ lShX: -2.4, rShX: -2.4, lElX: -0.4, rElX: -0.4, torsoX: -0.1 }, 0.2);
      await this.to({ lShX: -0.9, rShX: -0.9, lElX: -0.4, rElX: -0.4, torsoX: 0.25 }, 0.1, k => k * k);
      await this.anim.tween(0.25, (e, k) => { desk.position.y = Math.sin(k * Math.PI * 4) * 0.02 * (1 - k); });
    }
    desk.position.y = 0;
    await this.to(SIT_POSE, 0.3);
  }

  async _wave() {
    const base = { ...this.char.pose };
    await this.turnTo(this.sitting ? 0 : 0.6);
    await this.to({ rShZ: -2.5, rShX: -0.2, rElX: -0.3, headZ: 0.12 }, 0.25);
    for (let i = 0; i < 3; i++) {
      await this.to({ rShZ: -2.8 }, 0.16);
      await this.to({ rShZ: -2.3 }, 0.16);
    }
    await this.to({ rShZ: base.rShZ, rShX: base.rShX, rElX: base.rElX, headZ: 0 }, 0.3);
  }

  async _throw() {
    await this._ensureStanding();
    const { plush } = this;

    if (this.plushAt === 'desk') {
      if (Math.hypot(this.char.root.position.x - SPOTS.chair.x, this.char.root.position.z - SPOTS.chair.z) > 0.1) {
        await this.walkTo(SPOTS.chair.x, SPOTS.chair.z);
      }
      await this.turnTo(0);
      await this.to({ rShX: -1.2, rShZ: -0.35, rElX: -0.2 }, 0.3);
      await this._grabPlush();
    } else if (this.plushAt === 'floor') {
      await this._pickUp();
    }

    const tx = THREE.MathUtils.lerp(THROW_AREA.minX, THROW_AREA.maxX, Math.random());
    const tz = THREE.MathUtils.lerp(THROW_AREA.minZ, THROW_AREA.maxZ, Math.random());
    await this.faceToward(tx, tz);

    // Wind up, release
    await this.to({ rShX: -2.7, rShZ: -0.2, rElX: -0.6, torsoX: -0.2, torsoZ: 0.1 }, 0.3);
    await this.to({ rShX: -1.0, rElX: 0, torsoX: 0.25, torsoZ: -0.05 }, 0.12, k => k * k);
    this.scene.attach(plush);
    this.plushAt = 'flying';
    const from = plush.position.clone();
    const land = new THREE.Vector3(tx, 0.09, tz);
    const flight = Math.max(0.45, from.distanceTo(land) * 0.28);
    await Promise.all([
      this.to(STAND_POSE, 0.4),
      this.anim.tween(flight, k => {
        plush.position.lerpVectors(from, land, k);
        plush.position.y += Math.sin(k * Math.PI) * 0.9;
        plush.rotation.x = k * 9;
        plush.rotation.z = k * 4;
      }, linear),
    ]);
    // Bounce
    await this.anim.tween(0.3, k => { plush.position.y = 0.09 + Math.sin(k * Math.PI) * 0.12; }, linear);
    plush.rotation.set(0, Math.random() * 6, 0.4);
    this.plushAt = 'floor';

    await wait(0.4);
    await this._pickUp();
  }

  async _pickUp() {
    const target = this.plush.position;
    const root = this.char.root.position;
    const dx = target.x - root.x, dz = target.z - root.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.4) await this.walkTo(target.x - (dx / d) * 0.32, target.z - (dz / d) * 0.32);
    await this.faceToward(target.x, target.z);
    await this.to({ torsoX: 0.8, hipsY: STAND_HIPS - 0.12, lHipX: -0.5, rHipX: -0.5, lKneeX: 0.8, rKneeX: 0.8, rShX: -0.9, rElX: 0 }, 0.35);
    await this._grabPlush();
    await this.to({ ...STAND_POSE, rShX: -0.5, rElX: -0.9 }, 0.35);
  }
}
