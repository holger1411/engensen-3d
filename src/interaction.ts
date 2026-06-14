import * as THREE from "three";
import type { BuildingInfo } from "./types";
import type { InfoPanel } from "./infoPanel";

const HOVER_EMISSIVE = 0x2a2a2a;
const SELECT_EMISSIVE = 0x5a4a1a;

/**
 * Raycasting auf Gebäude-Meshes: Hover hebt hervor, Klick wählt aus und zeigt
 * das Info-Panel. Verändert nur Material-Emissive, nichts an der Geometrie.
 */
export class Interaction {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private hovered: THREE.Mesh | null = null;
  private selected: THREE.Mesh | null = null;
  private moved = false;
  private downPos = new THREE.Vector2();

  constructor(
    private dom: HTMLCanvasElement,
    private camera: THREE.Camera,
    private meshes: THREE.Mesh[],
    private panel: InfoPanel,
  ) {
    dom.addEventListener("pointermove", this.onMove);
    dom.addEventListener("pointerdown", this.onDown);
    dom.addEventListener("pointerup", this.onUp);
  }

  private setPointer(e: PointerEvent): void {
    const r = this.dom.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  private pick(): THREE.Mesh | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.meshes, false);
    return hits.length ? (hits[0].object as THREE.Mesh) : null;
  }

  private emissiveOf(m: THREE.Mesh): THREE.Color {
    return (m.material as THREE.MeshStandardMaterial).emissive;
  }

  private onMove = (e: PointerEvent): void => {
    this.setPointer(e);
    if (this.downPos.distanceTo(this.pointer) > 0.01) this.moved = true;
    const hit = this.pick();
    if (hit === this.hovered) return;
    // alten Hover zurücksetzen (außer er ist ausgewählt)
    if (this.hovered && this.hovered !== this.selected) this.emissiveOf(this.hovered).setHex(0x000000);
    this.hovered = hit;
    if (hit && hit !== this.selected) this.emissiveOf(hit).setHex(HOVER_EMISSIVE);
    this.dom.style.cursor = hit ? "pointer" : "grab";
  };

  private onDown = (e: PointerEvent): void => {
    this.setPointer(e);
    this.downPos.copy(this.pointer);
    this.moved = false;
  };

  private onUp = (e: PointerEvent): void => {
    if (this.moved) return; // Drag (Kamera) → keine Auswahl
    this.setPointer(e);
    const hit = this.pick();
    // vorherige Auswahl zurücksetzen
    if (this.selected) this.emissiveOf(this.selected).setHex(0x000000);
    if (hit) {
      this.selected = hit;
      this.emissiveOf(hit).setHex(SELECT_EMISSIVE);
      this.panel.show(hit.userData.info as BuildingInfo);
    } else {
      this.selected = null;
      this.panel.hide();
    }
  };
}
