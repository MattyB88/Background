import * as THREE from 'three';
import { clamp } from '../core/util';
import type { BoardDef, BoardInst } from '../sim/types';
import { Board3D } from './board3d';
import { makeTool, type ToolId } from './hands';

/**
 * Close-up scene for work on a single board (inspection, rework).
 * Units are millimetres. The board sits with its top surface at y = 0.
 */
export class BenchScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 1, 5000);
  board: Board3D | null = null;
  private boardInst: BoardInst | null = null;
  private target = new THREE.Vector3();
  private goalTarget = new THREE.Vector3();
  dist = 160;
  goalDist = 160;
  private tilt = 0.95;
  private tool: THREE.Group | null = null;
  private toolId: ToolId | null = null;
  readonly cursor = new THREE.Vector3();
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ringLight: THREE.PointLight;
  private highlight: THREE.Mesh;
  toolLift = 6;

  constructor(env: THREE.Texture) {
    this.scene.environment = env;
    this.scene.background = new THREE.Color(0x10151a);
    const mat = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshStandardMaterial({ color: 0x2f5f7c, roughness: 0.95 }),
    );
    mat.rotation.x = -Math.PI / 2;
    mat.position.y = -1.61;
    mat.receiveShadow = true;
    this.scene.add(mat);
    // Grid printed on the ESD mat
    const grid = new THREE.GridHelper(2000, 100, 0x4f7f9c, 0x3d6c89);
    grid.position.y = -1.6;
    this.scene.add(grid);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(-120, 300, 160);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera as THREE.OrthographicCamera;
    sc.left = -200;
    sc.right = 200;
    sc.top = 200;
    sc.bottom = -200;
    sc.near = 10;
    sc.far = 1000;
    key.shadow.bias = -0.0004;
    this.scene.add(key);
    this.ringLight = new THREE.PointLight(0xffffff, 3, 0, 0);
    this.scene.add(this.ringLight);
    this.highlight = new THREE.Mesh(new THREE.RingGeometry(1, 1.07, 48), new THREE.MeshBasicMaterial({ color: 0xffb21a, transparent: true, opacity: 0.55, depthTest: false }));
    this.highlight.rotation.x = -Math.PI / 2;
    this.highlight.renderOrder = 20;
    this.highlight.visible = false;
    this.scene.add(this.highlight);
  }

  setBoard(def: BoardDef | null, inst: BoardInst | null) {
    if (this.board && (!def || this.board.def !== def)) {
      this.scene.remove(this.board.group);
      this.board.dispose();
      this.board = null;
    }
    if (def && !this.board) {
      this.board = new Board3D(def);
      this.scene.add(this.board.group);
      this.goalTarget.set(def.w / 2, 0, -def.h / 2);
      this.target.copy(this.goalTarget);
      this.goalDist = this.dist = Math.max(def.w, def.h) * 1.9 + 20;
    }
    this.boardInst = inst;
    this.board?.setBoard(inst);
  }

  get inst(): BoardInst | null {
    return this.boardInst;
  }

  setTool(t: ToolId | null) {
    if (t === this.toolId) return;
    this.toolId = t;
    if (this.tool) this.scene.remove(this.tool);
    this.tool = null;
    if (t) {
      this.tool = makeTool(t);
      this.tool.scale.setScalar(1000);
      this.tool.traverse((o) => (o.castShadow = true));
      this.scene.add(this.tool);
    }
  }

  zoom(delta: number) {
    const def = this.board?.def;
    const max = def ? Math.max(def.w, def.h) * 2.4 + 30 : 400;
    this.goalDist = clamp(this.goalDist * Math.exp(delta * 0.0015), 14, max);
  }

  pan(dxMm: number, dyMm: number) {
    const def = this.board?.def;
    if (!def) return;
    this.goalTarget.x = clamp(this.goalTarget.x + dxMm, -10, def.w + 10);
    this.goalTarget.z = clamp(this.goalTarget.z + dyMm, -def.h - 10, 10);
  }

  focusOn(xMm: number, yMm: number, dist = 30) {
    this.goalTarget.set(xMm, 0, -yMm);
    this.goalDist = dist;
  }

  setNdc(ndc: THREE.Vector2) {
    this.ray.setFromCamera(ndc, this.camera);
    this.ray.ray.intersectPlane(this.plane, this.cursor);
  }

  pickPart(ndc: THREE.Vector2): number | null {
    if (!this.board) return null;
    this.ray.setFromCamera(ndc, this.camera);
    return this.board.pick(this.ray);
  }

  /** Board coordinates (mm, y up) under the cursor. */
  cursorBoard(): { x: number; y: number } {
    return { x: this.cursor.x, y: -this.cursor.z };
  }

  showHighlight(xMm: number | null, yMm = 0, r = 2) {
    this.highlight.visible = xMm !== null;
    if (xMm !== null) {
      this.highlight.position.set(xMm, 0.3, -yMm);
      this.highlight.scale.setScalar(r);
    }
  }

  update(dt: number, aspect: number, shake: THREE.Vector2) {
    this.target.lerp(this.goalTarget, clamp(dt * 8, 0, 1));
    this.dist += (this.goalDist - this.dist) * clamp(dt * 8, 0, 1);
    this.camera.aspect = aspect;
    this.camera.near = Math.max(0.5, this.dist * 0.02);
    this.camera.far = this.dist * 30;
    this.camera.updateProjectionMatrix();
    const off = new THREE.Vector3(0, Math.sin(this.tilt), Math.cos(this.tilt)).multiplyScalar(this.dist);
    this.camera.position.copy(this.target).add(off);
    this.camera.lookAt(this.target);
    this.ringLight.position.copy(this.camera.position);
    this.ringLight.intensity = 1.1;
    this.board?.update();
    if (this.tool) {
      // Tool tip follows the cursor, shaking with stress.
      this.tool.position.set(this.cursor.x + shake.x, this.toolLift + this.dist * 0.02, this.cursor.z + shake.y);
      this.tool.rotation.set(-0.9, 0.5, 0);
      const tipOffset = new THREE.Vector3(0, 0, -150).applyEuler(this.tool.rotation);
      this.tool.position.sub(tipOffset.multiplyScalar(1));
      this.tool.position.y = Math.max(this.tool.position.y, 1);
    }
  }
}
