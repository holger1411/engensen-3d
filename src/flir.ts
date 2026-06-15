import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/**
 * FLIR / Wärmebild-Modus — umschaltbarer Post-Processing-Effekt im Stil einer
 * Drohnen-/AC-130-/AH-64-Wärmebildkamera: Graustufen mit „heiß = hell",
 * Vegetation/Himmel/Wasser kühl (dunkel), Bildrauschen, Scanlines, Vignette.
 * Dazu ein HUD-Overlay (Fadenkreuz, AGL-Höhe, Heading, Uhr) über CSS.
 */

const ThermalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uWhiteHot: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uRes;
    uniform float uWhiteHot;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      // Vegetation (grün) und Himmel/Wasser (blau) erscheinen kühl = dunkel
      float green = clamp((c.g - max(c.r, c.b)) * 2.5, 0.0, 1.0);
      float blue  = clamp((c.b - max(c.r, c.g)) * 2.0, 0.0, 1.0);
      float heat = lum * 1.02 - green * 0.28 - blue * 0.34;
      heat = pow(clamp(heat, 0.0, 1.0), 0.85);
      float v = mix(1.0 - heat, heat, uWhiteHot);
      v = clamp((v - 0.5) * 1.12 + 0.5, 0.0, 1.0);          // Kontrast (moderat)
      v = v * 0.8 + 0.13;                                   // Grundhelligkeit, kein reines Schwarz
      float n = hash(vUv * uRes + uTime * 60.0);
      v += (n - 0.5) * 0.09;                                // Bildrauschen
      v *= 0.94 + 0.06 * sin(vUv.y * uRes.y * 0.7);         // Scanlines
      float vig = smoothstep(1.15, 0.5, length(vUv - 0.5) * 1.35);
      v *= mix(0.72, 1.0, vig);                             // Vignette
      gl_FragColor = vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);
    }
  `,
};

const COMPASS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];

export class FlirMode {
  enabled = false;
  private composer: EffectComposer;
  private pass: ShaderPass;
  private clock0 = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.pass = new ShaderPass(ThermalShader);
    this.composer.addPass(this.pass);
    const size = renderer.getSize(new THREE.Vector2());
    this.setSize(size.x, size.y);
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.pass.uniforms.uRes.value.set(w * pr, h * pr);
  }

  toggle(): void {
    this.enabled = !this.enabled;
    document.body.classList.toggle("flir", this.enabled);
    const pois = this.scene.getObjectByName("pois");
    if (pois) pois.visible = !this.enabled; // Labels stören die Wärmebild-Optik
    document.getElementById("flir-toggle")?.classList.toggle("active", this.enabled);
  }

  /** Rendert die Szene (im FLIR-Modus über den Composer) und aktualisiert das HUD. */
  render(elapsed: number): void {
    if (this.enabled) {
      this.pass.uniforms.uTime.value = elapsed;
      this.composer.render();
      this.updateHud(elapsed);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private updateHud(elapsed: number): void {
    if (this.clock0 === 0) this.clock0 = elapsed;
    // AGL-Höhe (Kamerahöhe über Grund, in Fuß)
    const agl = Math.max(0, Math.round((this.camera.position.y * 3.281) / 10) * 10);
    const aglEl = document.getElementById("flir-agl");
    if (aglEl) aglEl.textContent = `${agl} AGL`;
    // Heading aus Kamerablickrichtung
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    let hdg = (Math.atan2(dir.x, -dir.z) * 180) / Math.PI;
    if (hdg < 0) hdg += 360;
    const hdgEl = document.getElementById("flir-hdg");
    if (hdgEl) hdgEl.textContent = `${Math.round(hdg).toString().padStart(3, "0")} ${COMPASS[Math.round(hdg / 45) % 8]}`;
    // laufende Uhr
    const t = Math.floor(elapsed - this.clock0);
    const clockEl = document.getElementById("flir-clock");
    if (clockEl) clockEl.textContent = `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, "0")}`;
  }
}
