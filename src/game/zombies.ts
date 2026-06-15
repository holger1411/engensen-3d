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

const TOWN_RADIUS = 360; // m: ab hier "im Ort" → Bevölkerungs-Drain
const ZOMBIE_HP = 100;
const ZOMBIE_SPEED = 6.5; // m/s
const MAX_ZOMBIES = 600; // InstancedMesh-Kapazität

export interface ZombieOpts {
  center: THREE.Vector3;
  spawnPoints: THREE.Vector3[];
  terrain: TerrainSampler;
}

export class ZombieField {
  positions: (THREE.Vector3 | null)[] = [];
  private hp: number[] = [];
  private mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private count = 0;

  constructor(scene: THREE.Scene, private opts: ZombieOpts) {
    // Dunkle (kalte) Gestalt: Kapsel, fast schwarzes Material → im Wärmebild schwarz
    const geom = new THREE.CapsuleGeometry(1.6, 3.2, 4, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(geom, mat, MAX_ZOMBIES);
    this.mesh.name = "zombies";
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  spawnOne(rng: () => number): void {
    if (this.count >= MAX_ZOMBIES) return;
    const sp = pickSpawn(this.opts.spawnPoints as THREE.Vector3[], rng);
    if (!sp) return;
    this.positions.push(sp);
    this.hp.push(ZOMBIE_HP);
    this.count++;
    this.mesh.count = this.count;
  }

  /** Bewegt lebende Zombies Richtung Zentrum, schreibt Instanz-Matrizen. */
  update(dt: number): void {
    const c = this.opts.center;
    for (let i = 0; i < this.count; i++) {
      const p = this.positions[i];
      if (!p) continue;
      moveToward(p, c, ZOMBIE_SPEED, dt);
      p.y = this.opts.terrain.sample(p.x, p.z) + 3;
      this.dummy.position.copy(p);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Schaden auf eine Indexliste; tötet bei HP<=0 (versteckt Instanz). */
  damageAt(indices: number[], dmg: number): number {
    let killed = 0;
    for (const i of indices) {
      if (!this.positions[i]) continue;
      this.hp[i] -= dmg;
      if (this.hp[i] <= 0) {
        this.positions[i] = null;
        this.dummy.position.set(0, -10000, 0); // aus dem Bild
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        killed++;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    return killed;
  }

  aliveCount(): number {
    let n = 0;
    for (const p of this.positions) if (p) n++;
    return n;
  }

  inTownCount(): number {
    const c = this.opts.center;
    let n = 0;
    for (const p of this.positions) {
      if (!p) continue;
      if (Math.hypot(p.x - c.x, p.z - c.z) <= TOWN_RADIUS) n++;
    }
    return n;
  }
}
