import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";

/**
 * Postprocessing für den normalen (Nicht-FLIR-)Modus:
 *  • SSAO — Kontaktschatten in Gassen/an Fassaden
 *  • UnrealBloom — dezenter Schein um helle Quellen (Fensterlicht nachts, Sonne)
 *  • OutputPass — Tonemapping (ACES) + sRGB
 *  • SMAA — kantenglättung (ersetzt das im Composer fehlende MSAA)
 */
export class PostFX {
  readonly composer: EffectComposer;
  private ssao: SSAOPass;
  private bloom: UnrealBloomPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.ssao = new SSAOPass(scene, camera, size.x, size.y);
    this.ssao.kernelRadius = 6; // Weltmeter — kleine Fugen/Fassaden
    this.ssao.minDistance = 0.0006;
    this.ssao.maxDistance = 0.05;
    this.composer.addPass(this.ssao);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.6, 0.5, 0.82);
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());
    this.composer.addPass(new SMAAPass(size.x, size.y));
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  render(): void {
    this.composer.render();
  }
}
