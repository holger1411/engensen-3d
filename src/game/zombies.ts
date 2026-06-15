// src/game/zombies.ts
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const HIP_Y = 6; // Hüfthöhe (Bein-Drehpunkt) der humanoiden Zombie-Figur

/** Quaderteil mit Bein-Markierung (aLeg/aLegSign) für die Vertex-Animation. */
function zombiePart(w: number, h: number, d: number, x: number, y: number, z: number, leg: number, sign: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const n = g.attributes.position.count;
  g.setAttribute("aLeg", new THREE.Float32BufferAttribute(new Array(n).fill(leg), 1));
  g.setAttribute("aLegSign", new THREE.Float32BufferAttribute(new Array(n).fill(sign), 1));
  return g;
}

/** Hagere Zombie-Figur: dünne Glieder, gebeugter Kopf, hängende Arme. */
function buildZombieGeometry(): THREE.BufferGeometry {
  const parts = [
    zombiePart(1.1, 6, 1.3, -1.1, 3, 0, 1, -1),     // linkes Bein (dünn, y 0..6)
    zombiePart(1.1, 6, 1.3, 1.1, 3, 0, 1, 1),       // rechtes Bein
    zombiePart(2.9, 5.4, 1.8, 0, 8.6, 0, 0, 0),     // schmaler Torso
    zombiePart(2.0, 2.3, 2.0, 0, 12.0, 0.6, 0, 0),  // Kopf, leicht nach vorn gebeugt
    zombiePart(0.85, 6.4, 0.85, -2.0, 8.0, 1.0, 0, 0), // linker Arm: dünn, lang, nach vorn hängend
    zombiePart(0.85, 6.4, 0.85, 2.0, 8.0, 1.0, 0, 0),  // rechter Arm
  ];
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  return merged;
}

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
  center: { x: number; z: number } = { x: 0, z: 0 },
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
      const d = Math.hypot(x - center.x, z - center.z); // Distanz zum Missionsort
      if (d < minDist || d > maxDist) continue;
      out.push(new THREE.Vector3(x, terrain.sample(x, z), z));
    }
  }
  return out;
}

/** Fallback: Spawnpunkte auf einem Ring um den Ort (wenn kaum Wald in der Nähe). */
export function buildRingSpawnPoints(
  center: { x: number; z: number },
  terrain: TerrainSampler,
  rMin: number,
  rMax: number,
  count: number,
  rng: () => number = Math.random,
): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.3;
    const r = rMin + rng() * (rMax - rMin);
    const x = center.x + Math.cos(a) * r;
    const z = center.z + Math.sin(a) * r;
    out.push(new THREE.Vector3(x, terrain.sample(x, z), z));
  }
  return out;
}

const TOWN_RADIUS = 360; // m: ab hier "im Ort" → Bevölkerungs-Drain
const ZOMBIE_HP = 100;
const ZOMBIE_SPEED = 8.5; // m/s (Basistempo)
const MAX_ZOMBIES = 1300; // InstancedMesh-Kapazität

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
  private time = 0;
  private speedMul = 1;
  private matShader: { uniforms: { uTime: { value: number } } } | null = null;

  constructor(scene: THREE.Scene, private opts: ZombieOpts) {
    // Humanoide, dunkle (kalte) Gestalt → im Wärmebild schwarz. Überhöht, damit
    // aus ~640 m Orbithöhe erkennbar. Beine werden im Vertex-Shader animiert.
    const geom = buildZombieGeometry();
    // Pro Instanz eine zufällige Gangphase (desynchronisierter Gang)
    const phases = new Float32Array(MAX_ZOMBIES);
    for (let i = 0; i < MAX_ZOMBIES; i++) phases[i] = Math.random() * Math.PI * 2;
    geom.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));

    const mat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uTime;\nattribute float aLeg;\nattribute float aLegSign;\nattribute float aPhase;",
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          if (aLeg > 0.5) {
            float ang = sin(uTime * 6.0 + aPhase) * 0.6 * aLegSign;
            float c = cos(ang); float s = sin(ang);
            float ry = transformed.y - ${HIP_Y.toFixed(1)};
            float rz = transformed.z;
            transformed.y = ${HIP_Y.toFixed(1)} + ry * c - rz * s;
            transformed.z = ry * s + rz * c;
          }`,
        );
      this.matShader = shader as unknown as { uniforms: { uTime: { value: number } } };
    };

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

  /** Spawnt eine Gruppe von `count` Zombies eng um einen gemeinsamen Waldpunkt. */
  spawnCluster(rng: () => number, count: number, spread: number): void {
    const base = pickSpawn(this.opts.spawnPoints as THREE.Vector3[], rng);
    if (!base) return;
    for (let k = 0; k < count; k++) {
      if (this.count >= MAX_ZOMBIES) break;
      const p = new THREE.Vector3(
        base.x + (rng() - 0.5) * 2 * spread,
        0,
        base.z + (rng() - 0.5) * 2 * spread,
      );
      p.y = this.opts.terrain.sample(p.x, p.z);
      this.positions.push(p);
      this.hp.push(ZOMBIE_HP);
      this.count++;
    }
    this.mesh.count = this.count;
  }

  /** Setzt das Feld für eine neue Mission zurück (neues Zentrum, Spawns, Tempo). */
  reset(center: THREE.Vector3, spawnPoints: THREE.Vector3[], speedMul: number): void {
    this.opts.center.copy(center);
    this.opts.spawnPoints = spawnPoints;
    this.speedMul = speedMul;
    this.positions = [];
    this.hp = [];
    this.count = 0;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Bewegt lebende Zombies Richtung Zentrum, animiert Beine, schreibt Matrizen. */
  update(dt: number): void {
    this.time += dt;
    if (this.matShader) this.matShader.uniforms.uTime.value = this.time;
    const c = this.opts.center;
    for (let i = 0; i < this.count; i++) {
      const p = this.positions[i];
      if (!p) continue;
      moveToward(p, c, ZOMBIE_SPEED * this.speedMul, dt);
      p.y = this.opts.terrain.sample(p.x, p.z);
      this.dummy.position.copy(p);
      this.dummy.rotation.y = Math.atan2(c.x - p.x, c.z - p.z); // Blick Richtung Ort
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
