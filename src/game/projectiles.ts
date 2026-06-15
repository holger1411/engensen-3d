// src/game/projectiles.ts
import * as THREE from "three";
import type { WeaponId } from "./weapons";
import { type WeaponSpec } from "./weapons";
import type { TerrainSampler } from "../terrain";

export const GRAVITY = 9.81;

export interface ProjState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  weapon: WeaponId;
  life: number;
}

/** Ein Simulationsschritt: Schwerkraft auf vel, dann Position fortschreiben. */
export function stepProjectile(p: ProjState, dt: number, g = GRAVITY): void {
  p.vel.y -= g * dt;
  p.pos.addScaledVector(p.vel, dt);
  p.life += dt;
}

/** Indizes der Positionen innerhalb des horizontalen (XZ-)Splash-Radius. */
export function splashTargets(
  impact: THREE.Vector3,
  radius: number,
  positions: (THREE.Vector3 | null)[],
): number[] {
  const r2 = radius * radius;
  const out: number[] = [];
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    if (!p) continue;
    const dx = p.x - impact.x;
    const dz = p.z - impact.z;
    if (dx * dx + dz * dz <= r2) out.push(i);
  }
  return out;
}

const MAX_TRACERS = 400;

export interface ImpactInfo { point: THREE.Vector3; weapon: WeaponId; }

export class ProjectileManager {
  private projectiles: ProjState[] = [];
  private lines: THREE.Line[] = [];
  private group = new THREE.Group();

  constructor(scene: THREE.Scene, private terrain: TerrainSampler) {
    this.group.name = "projectiles";
    scene.add(this.group);
  }

  /** Feuert ein Geschoss von origin Richtung aim (mit Streuung). */
  spawn(origin: THREE.Vector3, aim: THREE.Vector3, spec: WeaponSpec): void {
    if (this.projectiles.length >= MAX_TRACERS) return;
    const dir = aim.clone().sub(origin).normalize();
    // Streuung: kleine zufällige Winkelabweichung
    dir.x += (Math.random() - 0.5) * spec.spreadRad * 2;
    dir.y += (Math.random() - 0.5) * spec.spreadRad * 2;
    dir.z += (Math.random() - 0.5) * spec.spreadRad * 2;
    dir.normalize();
    const p: ProjState = { pos: origin.clone(), vel: dir.multiplyScalar(spec.muzzleVel), weapon: spec.id, life: 0 };
    this.projectiles.push(p);

    const geom = new THREE.BufferGeometry().setFromPoints([p.pos.clone(), p.pos.clone()]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false });
    const line = new THREE.Line(geom, mat);
    line.frustumCulled = false;
    this.group.add(line);
    this.lines.push(line);
  }

  /**
   * Simuliert alle Geschosse; liefert Einschläge (Boden- oder Lebensdauer-Ende).
   * Treffer an Zombies werden vom Aufrufer über splashTargets aufgelöst.
   */
  update(dt: number): ImpactInfo[] {
    const impacts: ImpactInfo[] = [];
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const prev = p.pos.clone();
      stepProjectile(p, dt);
      const ground = this.terrain.sample(p.pos.x, p.pos.z);
      const hitGround = p.pos.y <= ground;
      const expired = p.life > 6;
      // Tracer aktualisieren (kurzes helles Segment)
      const line = this.lines[i];
      (line.geometry as THREE.BufferGeometry).setFromPoints([prev, p.pos.clone()]);
      if (hitGround || expired) {
        if (hitGround) { p.pos.y = ground; impacts.push({ point: p.pos.clone(), weapon: p.weapon }); }
        this.group.remove(line);
        (line.geometry as THREE.BufferGeometry).dispose();
        (line.material as THREE.Material).dispose();
        this.projectiles.splice(i, 1);
        this.lines.splice(i, 1);
      }
    }
    return impacts;
  }

  /** Aktuelle Geschosspositionen (für Direkttreffer-Prüfung). */
  positions(): { pos: THREE.Vector3; weapon: WeaponId }[] {
    return this.projectiles.map((p) => ({ pos: p.pos, weapon: p.weapon }));
  }

  remove(index: number): ImpactInfo {
    const p = this.projectiles[index];
    const info: ImpactInfo = { point: p.pos.clone(), weapon: p.weapon };
    const line = this.lines[index];
    this.group.remove(line);
    (line.geometry as THREE.BufferGeometry).dispose();
    (line.material as THREE.Material).dispose();
    this.projectiles.splice(index, 1);
    this.lines.splice(index, 1);
    return info;
  }

  splash(point: THREE.Vector3, radius: number, zombiePositions: (THREE.Vector3 | null)[]): number[] {
    return splashTargets(point, radius, zombiePositions);
  }
}
