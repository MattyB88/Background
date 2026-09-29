import * as THREE from 'three';
import { el } from '../core/util';
import { PART_BY_IPN } from '../sim/parts';
import { StoresRack, type RackItem } from '../render/storesrack';
import { Station } from './base';

/**
 * The stores rack. Reels stand on their edge like CDs, grouped in labelled sections
 * (somewhat in order). Click one to pull it out and read the label, then take it or put it back.
 */
export class StoresStation extends Station {
  rack!: StoresRack;
  private side!: HTMLElement;
  private overlay!: HTMLElement;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private hover: RackItem | null = null;
  private camX = 0;
  private t = 0;
  private keys = new Set<string>();

  build() {
    this.rack = new StoresRack(this.app.factory.storesRoot, this.app.game);
    this.overlay = el('div', { style: 'position:absolute;inset:0;touch-action:none;cursor:pointer' });
    this.side = el('div', { class: 'side right' });
    this.body.append(this.overlay, this.side);
    this.overlay.addEventListener('pointermove', (e) => this.setNdc(e));
    this.overlay.addEventListener('pointerdown', (e) => {
      this.setNdc(e);
      this.click();
    });
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    this.rack.sync();
  }

  status(): string {
    const g = this.app.game;
    return `Trolley ${g.carried.length}/${g.carryMax}`;
  }

  private setNdc(e: PointerEvent) {
    this.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  }

  enter() {
    this.camX = 0.5;
    this.rack.sync();
    this.render();
  }

  leave() {
    this.rack.pull(null);
    this.rack.highlight(null);
    this.keys.clear();
  }

  private click() {
    this.ray.setFromCamera(this.ndc, this.app.camera);
    const it = this.rack.pick(this.ray);
    if (!it) return;
    this.rack.pull(this.rack.current === it ? null : it);
    this.app.audio.play('feeder');
    this.render();
  }

  update(dt: number) {
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.camX = Math.max(-1.5, this.camX - dt * 1.2);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.camX = Math.min(1.5, this.camX + dt * 1.2);
    const cam = this.app.camera;
    const sp = this.spot;
    cam.position.x += (sp.viewPos.x + this.camX - cam.position.x) * Math.min(1, dt * 6);
    cam.lookAt(cam.position.x, sp.viewLook.y, sp.viewLook.z);
    this.rack.sync();
    this.ray.setFromCamera(this.ndc, cam);
    this.hover = this.rack.pick(this.ray);
    this.rack.highlight(this.hover);
    this.rack.update(dt);
    this.t -= dt;
    if (this.t <= 0 && this.canRefresh()) {
      this.t = 0.5;
      this.render();
    }
  }

  private render() {
    const g = this.app.game;
    const nodes: Node[] = [el('h3', {}, 'Stores rack')];
    const cur = this.rack.current;
    if (cur) {
      const p = PART_BY_IPN.get(cur.ipn)!;
      nodes.push(el('div', { class: 'kv', style: 'margin-bottom:8px' },
        el('span', {}, 'IPN'), el('b', {}, cur.ipn),
        el('span', {}, 'Part'), el('span', {}, p.desc),
        el('span', {}, 'In stores'), el('span', {}, String(g.stores.get(cur.ipn) ?? 0))));
      const take = el('button', { class: 'btn primary' }, 'Take it (onto trolley)');
      take.onclick = () => {
        const err = g.takeReel(cur.ipn);
        if (err) this.app.hud.toast(err, 'warn', 'Stores');
        this.rack.pull(null);
        this.render();
      };
      const back = el('button', { class: 'btn' }, 'Put it back');
      back.onclick = () => {
        this.rack.pull(null);
        this.render();
      };
      nodes.push(el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px' }, take, back));
    } else {
      nodes.push(el('p', { style: 'color:#aab' }, 'Reels are stored on edge. Click one to pull it out and read its label. A/D or the arrows slide along the rack.'));
    }
    const nav = el('div', { style: 'display:flex;gap:6px;margin-bottom:10px' });
    for (const [label, d] of [['◀ Slide left', -0.6], ['Slide right ▶', 0.6]] as const) {
      const b = el('button', { class: 'btn' }, label);
      b.onclick = () => (this.camX = Math.max(-1.5, Math.min(1.5, this.camX + d)));
      nav.append(b);
    }
    nodes.push(nav);
    // What the clipboard says you need.
    const need = this.shoppingList();
    if (need.length) {
      nodes.push(el('h3', {}, 'Work card: parts to collect'));
      for (const n of need) nodes.push(el('div', { class: `list-item${n.have ? '' : ' bad'}` }, `${n.have ? '✓' : '·'} ${n.ipn}  ${n.desc}`));
    } else nodes.push(el('p', { style: 'color:#aab' }, 'No work card on your clipboard. Print one at the desk and grab it from the office printer.'));
    nodes.push(el('h3', { style: 'margin-top:12px' }, `Trolley ${g.carried.length}/${g.carryMax}`));
    g.carried.forEach((r, i) => {
      const b = el('button', { class: 'btn', style: 'margin-left:6px;padding:2px 8px' }, 'return');
      b.onclick = () => {
        g.returnReel(i);
        this.render();
      };
      nodes.push(el('div', { class: 'list-item' }, `${r.label}  ${PART_BY_IPN.get(r.ipn)?.desc ?? ''}`, b));
    });
    this.side.replaceChildren(...nodes);
  }

  /** Parts on the held work cards, and whether you've got them (trolley or machine). */
  private shoppingList(): { ipn: string; desc: string; have: boolean }[] {
    const g = this.app.game;
    const cards = g.jobs.filter((j) => j.card === 'held' && j.program && j.status !== 'finished');
    const seen = new Set<string>();
    const out: { ipn: string; desc: string; have: boolean }[] = [];
    for (const j of cards) {
      for (const ipn of g.requiredIpns(j)) {
        if (seen.has(ipn)) continue;
        seen.add(ipn);
        const have = g.carried.some((r) => r.label === ipn) || g.slots.some((s) => s.reel?.label === ipn);
        out.push({ ipn, desc: PART_BY_IPN.get(ipn)!.desc, have });
      }
    }
    return out;
  }
}
