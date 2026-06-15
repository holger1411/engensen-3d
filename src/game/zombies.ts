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

import { Projection } from "../geo";
import type { FeatureCollection } from "../types";
import type { TerrainSampler } from "../terrain";

const FOREST_VALUES = new Set(["wood", "forest", "scrub", "heath"]);

/** Sammelt Spawnpunkte aus Wald-/Gehölzflächen im Distanzring um das Zentrum. */
export function buildForestSpawnPoints(
  fc: FeatureCollection,
  proj: Projection,
  terrain: TerrainSampler,
  minDist: number,
  maxDist: number,
): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const f of fc.features) {
    if (f.geometry.type !== "Polygon") continue;
    const val = (f.properties.value || f.properties.kind || "") as string;
    if (!FOREST_VALUES.has(val)) continue;
    const ring = (f.geometry.coordinates as number[][][])[0];
    for (const [lon, lat] of ring) {
      const p = proj.project(lon, lat); // {x: Ost, y: Nord}
      const x = p.x, z = -p.y; // Welt: Nord → -Z
      const d = Math.hypot(x, z);
      if (d < minDist || d > maxDist) continue;
      out.push(new THREE.Vector3(x, terrain.sample(x, z), z));
    }
  }
  return out;
}
