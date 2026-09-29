import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { AudioEngine } from './audio/audio';
import { clamp, el } from './core/util';
import { PlayerController } from './player/controller';
import { BenchScene } from './render/bench';
import { buildFactory, STATIONS, type Factory, type StationId } from './render/factory';
import { Hands, TOOL_NAMES, makeTool, type ToolId } from './render/hands';
import { LineView } from './render/lineview';
import { Game, type Ending } from './sim/game';
import type { Station } from './stations/base';
import { makeStations } from './stations';
import { Hud } from './ui/hud';
import { EndScreen, PauseMenu, TitleScreen, loadBest } from './ui/screens';

const TICK = 0.05;

export class App {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.03, 90);
  readonly audio = new AudioEngine();
  readonly hud = new Hud();
  readonly ui: HTMLElement;
  factory!: Factory;
  bench!: BenchScene;
  player!: PlayerController;
  hands!: Hands;
  game!: Game;
  lineView!: LineView;
  stations = new Map<StationId, Station>();
  active: Station | null = null;
  toolAt: Record<ToolId, 'pocket' | StationId> = { tweezers: 'pocket', syringe: 'pocket', iron: 'pocket', scraper: 'pocket' };
  selectedTool: ToolId | null = null;
  private toolMeshes = new Map<ToolId, THREE.Object3D>();
  private acc = 0;
  private last = performance.now();
  mode: 'title' | 'play' | 'ending' | 'over' = 'title';
  private endingT = 0;
  private notes: HTMLElement | null = null;
  private pause: PauseMenu;
  private title: TitleScreen;
  private near: Station | null = null;
  private env: THREE.Texture;
  readonly stationNames: Record<string, string> = Object.fromEntries(STATIONS.map((s) => [s.id, s.name]));
  mouseNdc = new THREE.Vector2();
  pointerDown = false;
  seed = Math.floor(Math.random() * 1e9);

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.ui = ui;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.35;
    this.scene.background = new THREE.Color(0x202328);
    this.scene.fog = new THREE.Fog(0x202328, 18, 42);
    this.scene.add(this.camera);
    ui.append(this.hud.root);
    this.pause = new PauseMenu(this);
    this.title = new TitleScreen(this);
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.newGame(this.seed, false);
    ui.append(this.title.root);
    this.hud.root.style.display = 'none';
    requestAnimationFrame(() => this.frame());
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  newGame(seed: number, start: boolean) {
    this.seed = seed;
    if (this.factory) {
      this.scene.remove(this.factory.root);
      this.factory.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    this.active?.leave();
    this.active?.root.remove();
    this.active = null;
    this.game = new Game(seed);
    this.factory = buildFactory(this.scene);
    this.lineView = new LineView(this.game, this.factory, this.factory.root);
    this.bench = new BenchScene(this.env);
    if (!this.player) this.player = new PlayerController(this.camera, this.renderer.domElement, this.factory.colliders);
    else {
      this.player.colliders = this.factory.colliders;
      this.player.parked = false;
    }
    if (!this.hands) this.hands = new Hands(this.camera);
    this.toolAt = { tweezers: 'pocket', syringe: 'pocket', iron: 'pocket', scraper: 'pocket' };
    this.selectedTool = null;
    this.toolMeshes.clear();
    this.stations = makeStations(this);
    this.game.events.on('toast', (t) => this.hud.toast(t.text, t.kind, t.from));
    this.game.events.on('sfx', (s) => this.audio.play(s.name));
    this.game.events.on('over', (e) => this.beginEnding(e.ending));
    this.player.pos.set(-4, 0, 1.4);
    this.player.yaw = 0.35;
    this.player.pitch = -0.1;
    this.player.update(0, 0);
    this.mode = start ? 'play' : 'title';
    this.hud.fade.classList.remove('on');
    this.factory.ceilingLights.forEach((m) => (m.emissiveIntensity = 1.6));
    if (start) {
      this.hud.root.style.display = '';
      this.hud.toast('Morning. Sales has "great news". Check the schedule at the Programming Desk.', 'sales', 'Sales');
      this.hud.toast('Tip: the in-house job is already programmed. Load feeders, set up the printer, start the PX-9.', 'info');
    }
  }

  startRun(seed?: number) {
    this.audio.start();
    this.title.root.remove();
    this.newGame(seed ?? Math.floor(Math.random() * 1e9), true);
    this.player.lock();
  }

  // ------------------------------------------------------------------ tools

  putDownTool(t: ToolId, at: StationId) {
    this.toolAt[t] = at;
    if (this.selectedTool === t) this.selectedTool = null;
    this.placeToolMesh(t);
    this.audio.play('click');
  }

  pickUpTool(t: ToolId) {
    this.toolAt[t] = 'pocket';
    this.placeToolMesh(t);
    this.audio.play('click');
  }

  /** A mini-game wants tool t here. Puts it down from your pocket if needed. */
  useTool(t: ToolId): boolean {
    const here = this.active?.spot.id;
    if (!here) return false;
    if (this.toolAt[t] === here) return true;
    if (this.toolAt[t] === 'pocket') {
      this.putDownTool(t, here);
      this.active?.refreshTools();
      return true;
    }
    this.hud.toast(`Your ${TOOL_NAMES[t]} is at the ${this.stationNames[this.toolAt[t]]}. Go and get it.`, 'warn');
    this.audio.play('bad');
    return false;
  }

  private placeToolMesh(t: ToolId) {
    const old = this.toolMeshes.get(t);
    if (old) this.factory.root.remove(old);
    this.toolMeshes.delete(t);
    const where = this.toolAt[t];
    if (where === 'pocket') return;
    const spot = STATIONS.find((s) => s.id === where)!;
    const m = makeTool(t);
    const idx = (Object.keys(TOOL_NAMES) as ToolId[]).indexOf(t);
    m.position.copy(spot.toolSpot).add(new THREE.Vector3(idx * 0.06 - 0.09, 0.012, 0));
    m.rotation.set(Math.PI / 2, 0, 0.3 + idx * 0.4);
    m.rotation.x = 0;
    m.rotation.y = 0.4 + idx * 0.5;
    this.factory.root.add(m);
    this.toolMeshes.set(t, m);
  }

  // ------------------------------------------------------------------ stations

  enterStation(s: Station) {
    if (this.active || this.mode !== 'play') return;
    this.active = s;
    this.player.parked = true;
    this.player.unlock();
    this.hud.setWalking(false);
    this.hud.prompt.style.display = 'none';
    this.audio.play('ui');
    this.player.glideTo(s.spot.viewPos, s.spot.viewLook, 0.7, () => {
      if (this.active !== s) return;
      const show = () => {
        this.hud.setInStation(true);
        this.ui.insertBefore(s.root, this.hud.root.nextSibling);
        s.refreshTools();
        s.enter();
      };
      if (s.closeup) {
        this.hud.fade.classList.add('on');
        setTimeout(() => {
          show();
          this.hud.fade.classList.remove('on');
        }, 220);
      } else show();
    });
  }

  leaveStation() {
    const s = this.active;
    if (!s) return;
    const left = (Object.keys(TOOL_NAMES) as ToolId[]).filter((t) => this.toolAt[t] === s.spot.id);
    if (left.length) this.hud.toast(`You left your ${left.map((t) => TOOL_NAMES[t]).join(' and ')} at the ${s.spot.name}.`, 'warn');
    s.leave();
    s.root.remove();
    this.hud.setInStation(false);
    this.active = null;
    this.audio.play('ui');
    this.player.glideBack(() => {
      this.hud.setWalking(true);
      this.player.lock();
    });
  }

  // ------------------------------------------------------------------ input

  private bindInput() {
    const dom = this.renderer.domElement;
    dom.addEventListener('click', () => {
      if (this.mode === 'play' && !this.active && !this.player.locked) this.player.lock();
    });
    document.addEventListener('pointerlockchange', () => {
      if (this.mode !== 'play') return;
      if (!this.player.locked && !this.active && !this.player.parked) this.pause.show();
      else this.pause.hide();
    });
    window.addEventListener('pointerdown', () => (this.pointerDown = true), true);
    window.addEventListener('pointerup', () => setTimeout(() => (this.pointerDown = false), 0), true);
    window.addEventListener('mousemove', (e) => {
      this.mouseNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    });
    window.addEventListener('keydown', (e) => {
      if (this.mode !== 'play') return;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (typing) {
        if (e.code === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.code === 'KeyE' && !this.active && this.near) this.enterStation(this.near);
      else if ((e.code === 'KeyQ' || e.code === 'Escape') && this.active) this.leaveStation();
      else if (e.code === 'KeyN') this.toggleNotes();
      else if (e.code.startsWith('Digit')) {
        const i = Number(e.code.slice(5)) - 1;
        const t = (Object.keys(TOOL_NAMES) as ToolId[])[i];
        if (t && this.toolAt[t] === 'pocket') this.selectedTool = this.selectedTool === t ? null : t;
      }
    });
  }

  toggleNotes() {
    if (this.notes) {
      this.notes.remove();
      this.notes = null;
      if (!this.active && this.mode === 'play') this.player.lock();
      return;
    }
    const ta = el('textarea', { placeholder: 'e.g. AA001 used dump-bin part on C3, S/N 0012' }) as HTMLTextAreaElement;
    ta.value = this.game.notes;
    ta.oninput = () => (this.game.notes = ta.value);
    const close = el('button', { class: 'btn', style: 'margin-left:auto;padding:0 8px' }, '×');
    close.onclick = () => this.toggleNotes();
    this.notes = el('div', { class: 'notes-panel note-paper' }, el('header', {}, '📝 Notes (N)', close), ta);
    this.ui.append(this.notes);
    this.player.unlock();
    setTimeout(() => ta.focus(), 30);
  }

  // ------------------------------------------------------------------ ending

  private beginEnding(e: Ending) {
    this.mode = 'ending';
    this.endingT = 0;
    if (this.active) {
      this.active.leave();
      this.active.root.remove();
      this.active = null;
    }
    this.hud.setInStation(false);
    this.notes?.remove();
    this.notes = null;
    this.player.unlock();
    this.player.parked = true;
    this.hud.setWalking(false);
    this.hud.prompt.style.display = 'none';
    if (e === 'fire') {
      this.audio.play('fire');
      this.player.glideTo(new THREE.Vector3(-1.5, 2.2, 2.5), new THREE.Vector3(0.5, 1.2, -3), 2.2);
      this.hud.toast('THE OVEN IS ON FIRE', 'bad', 'Everyone');
    } else if (e === 'bankrupt') {
      this.audio.play('lightsout');
      this.hud.toast('The power company would like a word.', 'bad', 'Accounts');
    } else {
      this.audio.play('phone');
      this.hud.toast('Can you pop into my office? Bring your badge.', 'bad', 'Operations Director');
    }
  }

  private updateEnding(dt: number) {
    this.endingT += dt;
    const g = this.game;
    if (g.over === 'bankrupt') {
      const k = clamp(1 - this.endingT / 2.5, 0, 1);
      this.factory.ceilingLights.forEach((m) => (m.emissiveIntensity = 1.6 * k * (Math.random() < 0.1 ? 0.2 : 1)));
      this.factory.lights.forEach((l) => (l.intensity = (l.userData.base ??= l.intensity) * k));
    }
    if (this.endingT > (g.over === 'fire' ? 5 : 3.5) && this.mode === 'ending') {
      this.mode = 'over';
      const best = loadBest();
      new EndScreen(this, g.over!, best);
    }
  }

  // ------------------------------------------------------------------ loop

  private frame() {
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const g = this.game;
    if (this.mode === 'play') {
      this.acc += dt;
      while (this.acc >= TICK) {
        g.tick(TICK);
        this.acc -= TICK;
      }
    } else if (this.mode === 'title') {
      // Attract mode: the camera drifts along the line.
      const t = now / 1000;
      this.camera.position.set(-2 + Math.sin(t * 0.07) * 7, 2.6, 2.6 + Math.cos(t * 0.05) * 0.8);
      this.camera.lookAt(-2 + Math.sin(t * 0.07 + 0.4) * 5, 0.9, -3);
    }
    if (this.mode === 'ending') this.updateEnding(dt);
    if (this.mode !== 'title') this.player.update(dt, g.stress);
    this.audio.intensity = this.mode === 'title' ? 0.1 : g.stress;
    this.audio.update(dt);
    this.lineView.update(dt, now / 1000);
    this.hands.shake = g.stress;
    const walking = this.mode === 'play' && !this.active && !this.player.parked;
    this.hands.setTool(this.selectedTool);
    this.hands.update(dt, this.player.moving, walking);
    if (this.mode === 'play') {
      this.updatePrompt();
      this.hud.update(g, this.toolAt, this.selectedTool, this.stationNames);
      this.hud.setObjective(this.objective());
      if (this.player.moving) {
        this.stepT -= dt * (1 + this.player.moving);
        if (this.stepT <= 0) {
          this.stepT = 0.42;
          this.audio.play('step');
        }
      }
      this.active?.update(dt);
    }
    if (this.active?.closeup) {
      const shake = new THREE.Vector2(
        (Math.sin(now / 37) + Math.sin(now / 13)) * g.stress * 0.35,
        (Math.cos(now / 29) + Math.sin(now / 17)) * g.stress * 0.35,
      );
      this.bench.update(dt, this.camera.aspect, shake);
      this.renderer.render(this.bench.scene, this.bench.camera);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private stepT = 0;

  /** What should the player probably do next? Helps new players, ignorable by veterans. */
  objective(): string {
    const g = this.game;
    const L = g.line;
    if (g.heat > 80) return 'The oven is dangerously hot. Stop the feed and service it at the Reflow Oven.';
    if (L.px9Alarm) return `PX-9 stopped (${L.px9Alarm}). Fix it at the Feeder Cart.`;
    const j = g.activeJob;
    if (j) {
      const miss = Object.entries(j.program!.setup).filter(([ipn, s]) => g.slots[s].reel?.label !== ipn).length;
      if (miss) return `Load ${miss} feeder(s) for ${j.product.asmIpn} at the Feeder Cart.`;
      if (!j.printProfile) return `Set up the print for ${j.product.asmIpn} at the Stencil Printer.`;
    }
    const idle = !j || j.panelsStarted * g.boardsPerPanel(j) >= j.qty;
    if (idle && g.jobs.some((x) => x.status === 'ready')) return 'The line is idle. Load the next job at the PX-9.';
    if (g.rework.length >= 4) return `${g.rework.length} boards waiting at the Rework Bench.`;
    if (g.jobs.some((x) => x.status === 'offered')) return 'New contract offer. Accept or decline it at the Programming Desk.';
    if (g.jobs.some((x) => x.status === 'accepted')) return 'Program the accepted contract at the Programming Desk.';
    if (g.heat > 60) return 'The oven is warming up. Plan a service before it gets critical.';
    if (idle) return 'Nothing to run. Take a contract at the Programming Desk.';
    return 'The line is running. Inspect panels, clear the rework rack, and keep an eye on the oven.';
  }

  private updatePrompt() {
    if (this.active || this.player.parked) {
      this.near = null;
      return;
    }
    let best: Station | null = null;
    let bd = 1.6;
    const f = this.player.forward();
    for (const s of this.stations.values()) {
      const d = s.spot.at.distanceTo(new THREE.Vector3(this.player.pos.x, 0, this.player.pos.z));
      const to = s.spot.viewLook.clone().sub(this.player.pos).setY(0).normalize();
      if (d < bd && f.dot(to) > 0.2) {
        bd = d;
        best = s;
      }
    }
    this.near = best;
    const p = this.hud.prompt;
    if (best) {
      const st = best.status();
      p.style.display = '';
      p.replaceChildren(el('kbd', {}, 'E'), ` ${best.spot.name}`);
      if (st) p.append(el('div', { class: 'sub' }, st));
    } else p.style.display = 'none';
  }
}
