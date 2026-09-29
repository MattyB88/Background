import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export type Quality = 'high' | 'low';

const KEY = 'icooked.quality';

export function loadQuality(fallback: Quality): Quality {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'high' || v === 'low' ? v : fallback;
  } catch {
    return fallback;
  }
}

export function saveQuality(q: Quality) {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    /* ignore */
  }
}

/**
 * Post-processing chain: ambient occlusion (contact shadows under parts and machines),
 * a gentle bloom on emissives (stack lights, screens, the oven), then anti-aliasing.
 */
export class Post {
  private composer: EffectComposer;
  private gtao: GTAOPass | null = null;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, aoRadius: number, quality: Quality, bloom = 0.28) {
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    if (quality === 'high' && aoRadius > 0) {
      this.gtao = new GTAOPass(scene, camera, size.x, size.y);
      this.gtao.updateGtaoMaterial({ radius: aoRadius, distanceExponent: 1.4, thickness: aoRadius * 1.5, scale: 1.1 });
      this.gtao.blendIntensity = 0.85;
      this.composer.addPass(this.gtao);
    }
    if (quality === 'high' && bloom > 0) this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), bloom, 0.4, 0.96));
    this.composer.addPass(new OutputPass());
    if (quality === 'high') this.composer.addPass(new SMAAPass());
    this.composer.setPixelRatio(pr);
    this.composer.setSize(size.x, size.y);
  }

  setSize(w: number, h: number) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render(dt: number) {
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
  }
}
