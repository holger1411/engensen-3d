// src/game/projectiles.ts
import * as THREE from "three";
import type { WeaponId } from "./weapons";

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
