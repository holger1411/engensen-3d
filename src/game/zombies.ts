// src/game/zombies.ts
import * as THREE from "three";

/** Bewegt pos horizontal Richtung target, ohne zu überschießen. */
export function moveToward(pos: THREE.Vector3, target: THREE.Vector3, speed: number, dt: number): void {
  const dx = target.x - pos.x;
  const dz = target.z - pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) return;
  const step = Math.min(speed * dt, d);
  pos.x += (dx / d) * step;
  pos.z += (dz / d) * step;
}

/** Bevölkerungs-Schwund pro Sekunde: linear in der Zahl der Zombies im Ort. */
export function drainRate(zombiesInTown: number, k: number): number {
  return zombiesInTown * k;
}

/** Wählt einen Spawnpunkt aus der Liste anhand eines RNG (0..1). */
export function pickSpawn(points: THREE.Vector3[], rng: () => number): THREE.Vector3 | null {
  if (points.length === 0) return null;
  return points[Math.min(points.length - 1, Math.floor(rng() * points.length))].clone();
}
