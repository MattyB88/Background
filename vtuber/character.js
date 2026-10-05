import * as THREE from 'three';

// Placeholder avatar for Stage 1. Stage 2 replaces the meshes with a VRM model
// but keeps the same pose fields, so actions.js doesn't change.

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });

const SKIN = mat(0xffe0d2);
const HAIR = mat(0xc9a6ff, { side: THREE.DoubleSide });
const HOODIE = mat(0x2b2440);
const ACCENT = mat(0xff5cb8);
const SOCKS = mat(0x1a1a22);

export const STAND_HIPS = 0.62;
export const SIT_HIPS = 0.34;

export const BASE_POSE = {
  hipsY: STAND_HIPS, torsoX: 0, torsoZ: 0,
  headX: 0, headY: 0, headZ: 0,
  lShX: 0, lShZ: 0.12, lElX: 0,
  rShX: 0, rShZ: -0.12, rElX: 0,
  lHipX: 0, lKneeX: 0, rHipX: 0, rKneeX: 0,
};

function limb(radius, length, material) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), material);
  m.position.y = -length / 2;
  return m;
}

function pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

export class Character {
  constructor() {
    this.root = new THREE.Group();
    this.pose = { ...BASE_POSE };
    this.emotion = 'neutral';
    this.talking = false;
    this.typing = false;
    this.lookYawTarget = 0;
    this._lookYaw = 0;
    this._blinkAt = 2;
    this._blink = 0;
    this._build();
  }

  _build() {
    const j = this.joints = {};
    j.hips = pivot(this.root, 0, STAND_HIPS, 0);

    // Torso
    j.torso = pivot(j.hips, 0, 0, 0);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.42, 16), HOODIE);
    body.position.y = 0.21;
    j.torso.add(body);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.171, 0.171, 0.04, 16), ACCENT);
    stripe.position.y = 0.04;
    j.torso.add(stripe);
    const hood = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 8, 16), HOODIE);
    hood.rotation.x = Math.PI / 2;
    hood.position.y = 0.42;
    j.torso.add(hood);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.08, 8), SKIN);
    neck.position.y = 0.45;
    j.torso.add(neck);

    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.27, 0.2, 16, 1, true), mat(0x3a3a55, { side: THREE.DoubleSide }));
    skirt.position.y = -0.06;
    j.hips.add(skirt);

    // Head
    j.head = pivot(j.torso, 0, 0.47, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 24, 18), SKIN);
    head.position.y = 0.22;
    j.head.add(head);
    const face = this.face = new THREE.Group();
    face.position.y = 0.22;
    j.head.add(face);

    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 16, 0, Math.PI * 2, 0, 1.25), HAIR);
    cap.position.y = 0.23;
    j.head.add(cap);
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.272, 24, 16, Math.PI, Math.PI, 0, Math.PI * 0.75), HAIR);
    back.position.set(0, 0.23, -0.01);
    j.head.add(back);
    const longHair = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.45, 0.08), HAIR);
    longHair.position.set(0, 0.0, -0.2);
    j.head.add(longHair);
    for (const s of [-1, 1]) {
      const bang = limb(0.04, 0.16, HAIR);
      const bp = pivot(j.head, s * 0.21, 0.32, 0.12);
      bp.add(bang);
      const tail = limb(0.07, 0.42, HAIR);
      const tp = pivot(j.head, s * 0.26, 0.38, -0.05);
      tp.rotation.z = s * 0.35;
      tp.add(tail);
      const bow = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), ACCENT);
      bow.scale.set(1.4, 0.8, 0.8);
      bow.position.set(s * 0.26, 0.4, -0.05);
      j.head.add(bow);
    }

    // Face features (relative to head center)
    this.eyes = [];
    this.brows = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(s * 0.09, -0.02, 0.225);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), mat(0x6a3cc9));
      iris.scale.set(0.8, 1.25, 0.35);
      eye.add(iris);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), mat(0xffffff, { emissive: 0xffffff }));
      shine.position.set(s * -0.012, 0.025, 0.016);
      eye.add(shine);
      face.add(eye);
      this.eyes.push(eye);

      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.013, 0.012), mat(0x7a5cb0));
      brow.position.set(s * 0.09, 0.06, 0.236);
      brow.userData.side = s;
      face.add(brow);
      this.brows.push(brow);

      const blush = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), mat(0xff8fb0, { transparent: true, opacity: 0 }));
      blush.position.set(s * 0.15, -0.07, 0.19);
      blush.rotation.y = s * 0.67;
      face.add(blush);
      (this.blush ??= []).push(blush);
    }
    this.mouth = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), mat(0x8a2a3a));
    this.mouth.position.set(0, -0.1, 0.228);
    face.add(this.mouth);

    // Emotes
    this.angerMark = new THREE.Group();
    const red = mat(0xff2a2a, { emissive: 0xaa0000 });
    for (const r of [0.6, -0.6]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.025, 0.02), red);
      bar.rotation.z = r;
      this.angerMark.add(bar);
    }
    this.angerMark.position.set(0.2, 0.2, 0.12);
    face.add(this.angerMark);
    this.sweat = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), mat(0x7fd4ff, { emissive: 0x2a6a99 }));
    this.sweat.scale.y = 1.6;
    this.sweat.position.set(-0.24, 0.1, 0.12);
    face.add(this.sweat);

    // Arms (her left is +x since she faces +z)
    for (const [side, s] of [['l', 1], ['r', -1]]) {
      const sh = j[side + 'Sh'] = pivot(j.torso, s * 0.19, 0.38, 0);
      sh.add(limb(0.045, 0.2, HOODIE));
      const el = j[side + 'El'] = pivot(sh, 0, -0.22, 0);
      el.add(limb(0.04, 0.18, HOODIE));
      const hand = j[side + 'Hand'] = pivot(el, 0, -0.22, 0);
      hand.add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), SKIN));

      const hip = j[side + 'Hip'] = pivot(j.hips, s * 0.085, 0, 0);
      hip.add(limb(0.058, 0.3, SKIN));
      const knee = j[side + 'Knee'] = pivot(hip, 0, -0.3, 0);
      knee.add(limb(0.05, 0.28, SOCKS));
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.16), ACCENT);
      shoe.position.set(0, -0.29, 0.03);
      knee.add(shoe);
    }

    this.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  }

  headWorldPosition(target) {
    return this.joints.head.getWorldPosition(target).add(new THREE.Vector3(0, 0.55, 0));
  }

  update(dt, t) {
    const p = this.pose, j = this.joints;

    this._lookYaw += (this.lookYawTarget - this._lookYaw) * Math.min(1, dt * 4);
    const breathe = Math.sin(t * 2.2) * 0.012;

    j.hips.position.y = p.hipsY;
    j.torso.rotation.set(p.torsoX + breathe, 0, p.torsoZ);
    j.head.rotation.set(p.headX - breathe + (this.talking ? Math.sin(t * 7) * 0.04 : 0), p.headY + this._lookYaw, p.headZ);

    const type = this.typing ? 1 : 0;
    j.lSh.rotation.set(p.lShX, 0, p.lShZ);
    j.rSh.rotation.set(p.rShX, 0, p.rShZ);
    j.lEl.rotation.x = p.lElX + type * Math.sin(t * 19) * 0.06;
    j.rEl.rotation.x = p.rElX + type * Math.sin(t * 23 + 1) * 0.06;
    j.lHip.rotation.x = p.lHipX;
    j.rHip.rotation.x = p.rHipX;
    j.lKnee.rotation.x = p.lKneeX;
    j.rKnee.rotation.x = p.rKneeX;

    this._updateFace(dt, t);
  }

  _updateFace(dt, t) {
    // Blink
    this._blinkAt -= dt;
    if (this._blinkAt <= 0) { this._blink = 0.15; this._blinkAt = 2 + Math.random() * 3; }
    this._blink = Math.max(0, this._blink - dt);
    const e = this.emotion;
    let eyeY = this._blink > 0 ? 0.1 : 1;
    if (e === 'happy' && !this._blink) eyeY = 0.55;
    if (e === 'surprised' && !this._blink) eyeY = 1.25;
    for (const eye of this.eyes) eye.scale.set(e === 'surprised' ? 1.15 : 1, eyeY, 1);

    const browTilt = { angry: 0.45, sad: -0.4, surprised: 0, happy: -0.1, neutral: 0 }[e] ?? 0;
    const browLift = { surprised: 0.025, sad: 0.01, angry: -0.01 }[e] ?? 0;
    for (const b of this.brows) {
      b.rotation.z = b.userData.side === 1 ? browTilt : -browTilt;
      b.position.y = 0.06 + browLift;
    }

    const shapes = {
      neutral:   [1.0, 0.35],
      happy:     [1.5, 0.7],
      angry:     [1.7, 0.45],
      sad:       [0.9, 0.3],
      surprised: [0.8, 1.2],
    };
    const [mw, mh] = shapes[e] ?? shapes.neutral;
    const talk = this.talking ? Math.abs(Math.sin(t * 16)) * 0.9 + Math.abs(Math.sin(t * 9.3)) * 0.4 : 0;
    this.mouth.scale.set(mw, mh + talk, 0.4);

    const blushTarget = e === 'happy' || e === 'angry' ? 0.75 : 0;
    for (const b of this.blush) {
      b.material.opacity += (blushTarget - b.material.opacity) * Math.min(1, dt * 5);
      b.material.color.setHex(e === 'angry' ? 0xff4a4a : 0xff8fb0);
    }

    this.angerMark.visible = e === 'angry';
    if (this.angerMark.visible) this.angerMark.scale.setScalar(1 + Math.abs(Math.sin(t * 8)) * 0.35);
    this.sweat.visible = e === 'sad' || e === 'surprised';
    if (this.sweat.visible) this.sweat.position.y = 0.1 - ((t * 0.15) % 0.08);
  }
}
