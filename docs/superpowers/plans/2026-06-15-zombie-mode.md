# Zombie-Modus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den vorhandenen FLIR-Modus zu einem AC-130-Verteidigungsspiel ("Zombie-Modus") ausbauen: Zombies strömen aus den Wäldern auf Engensen zu, der Spieler bekämpft sie mit drei realistischen Bordwaffen, schützt die Einwohner.

**Architecture:** Reine Spiellogik (Waffen, Geschossphysik, Zombie-Bewegung/Drain) in testbaren Modulen unter `src/game/`; Three.js-/DOM-lastige Teile (InstancedMesh, Tracer, HUD, Orchestrierung) in eigenen Klassen, die pro Frame laufen wenn der Modus aktiv ist. Die vorhandene `FlirMode` (Orbit, Thermal-Shader, Gimbal) bleibt die Kamera/Anzeige; ein neuer `GameController` koppelt sich an deren An/Aus.

**Tech Stack:** TypeScript, Three.js 0.169, Vitest, Vite.

---

## File Structure

- `src/game/weapons.ts` — Waffendefinitionen + `Arsenal` (Munition, Feuerrate). Rein, testbar.
- `src/game/weapons.test.ts`
- `src/game/projectiles.ts` — Geschossphysik (`stepProjectile`, `splashTargets`) + `ProjectileManager` (Tracer-Visual).
- `src/game/projectiles.test.ts`
- `src/game/zombies.ts` — pure Helfer (`moveToward`, `drainRate`, `pickSpawn`, `buildForestSpawnPoints`) + `ZombieField` (InstancedMesh, State).
- `src/game/zombies.test.ts`
- `src/game/zombieMode.ts` — `GameController`: Orchestrierung (Spawn-Loop, Update, Kollision, Population, Win/Lose, HUD, Eingaben).
- `src/flir.ts` — erweitern: `onToggle`-Callback; Flüge ausblenden im Modus.
- `index.html`, `src/style.css` — Button-Umbenennung + Game-HUD.
- `src/main.ts` — `GameController` erzeugen, verdrahten, im Loop aktualisieren.

---

## Task 1: Waffen-Modul (Arsenal)

**Files:**
- Create: `src/game/weapons.ts`
- Test: `src/game/weapons.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/game/weapons.test.ts
import { describe, it, expect } from "vitest";
import { Arsenal, WEAPONS } from "./weapons";

describe("Arsenal", () => {
  it("startet mit echtem Munitionsvorrat", () => {
    const a = new Arsenal();
    expect(a.ammoOf("gatling")).toBe(3000);
    expect(a.ammoOf("bofors")).toBe(256);
    expect(a.ammoOf("howitzer")).toBe(100);
    expect(a.active).toBe("gatling");
  });

  it("feuern verbraucht Munition und erzwingt Feuerrate-Cooldown", () => {
    const a = new Arsenal();
    expect(a.fire(0)).toBe(true);
    expect(a.ammoOf("gatling")).toBe(2999);
    // sofortiges Nachfeuern blockiert (30/s → 0.0333s Intervall)
    expect(a.canFire(0.01)).toBe(false);
    expect(a.fire(0.01)).toBe(false);
    // nach Intervall wieder möglich
    expect(a.canFire(0.04)).toBe(true);
    expect(a.fire(0.04)).toBe(true);
    expect(a.ammoOf("gatling")).toBe(2998);
  });

  it("wechselt Waffe und meldet leeren Gesamtvorrat", () => {
    const a = new Arsenal();
    a.switchTo("howitzer");
    expect(a.active).toBe("howitzer");
    expect(a.spec().splashRadius).toBe(WEAPONS.howitzer.splashRadius);
    expect(a.allEmpty()).toBe(false);
  });

  it("canFire ist false bei leerer Munition", () => {
    const a = new Arsenal();
    // howitzer leeren
    let t = 0;
    for (let i = 0; i < 100; i++) { a.switchTo("howitzer"); a.fire(t); t += 10; }
    expect(a.ammoOf("howitzer")).toBe(0);
    expect(a.canFire(t + 10)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/weapons.test.ts`
Expected: FAIL — "Cannot find module './weapons'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/game/weapons.ts
export type WeaponId = "gatling" | "bofors" | "howitzer";

export interface WeaponSpec {
  id: WeaponId;
  name: string; // HUD-Kurzlabel, z.B. "25mm"
  fullName: string;
  maxAmmo: number;
  fireIntervalSec: number; // Kehrwert der Feuerrate
  muzzleVel: number; // m/s (Welt = Meter)
  damage: number;
  splashRadius: number; // m (horizontal)
  spreadRad: number; // Streuung (Halbwinkel)
  tracerColor: number;
}

// Echte AC-130U-Werte (Feuerrate als Intervall, Vorrat fix)
export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  gatling: {
    id: "gatling", name: "25mm", fullName: "25 mm GAU-12 Gatling",
    maxAmmo: 3000, fireIntervalSec: 1 / 30, muzzleVel: 1040,
    damage: 40, splashRadius: 0, spreadRad: 0.009, tracerColor: 0xffffff,
  },
  bofors: {
    id: "bofors", name: "40mm", fullName: "40 mm Bofors L/60",
    maxAmmo: 256, fireIntervalSec: 1 / 1.7, muzzleVel: 880,
    damage: 130, splashRadius: 9, spreadRad: 0.004, tracerColor: 0xffffff,
  },
  howitzer: {
    id: "howitzer", name: "105mm", fullName: "105 mm M102 Haubitze",
    maxAmmo: 100, fireIntervalSec: 7, muzzleVel: 494,
    damage: 600, splashRadius: 32, spreadRad: 0.002, tracerColor: 0xffffff,
  },
};

export const WEAPON_ORDER: WeaponId[] = ["gatling", "bofors", "howitzer"];

export class Arsenal {
  active: WeaponId = "gatling";
  private ammo: Record<WeaponId, number>;
  private lastShot: Record<WeaponId, number> = { gatling: -999, bofors: -999, howitzer: -999 };

  constructor() {
    this.ammo = { gatling: WEAPONS.gatling.maxAmmo, bofors: WEAPONS.bofors.maxAmmo, howitzer: WEAPONS.howitzer.maxAmmo };
  }

  spec(): WeaponSpec { return WEAPONS[this.active]; }
  ammoOf(id: WeaponId): number { return this.ammo[id]; }
  switchTo(id: WeaponId): void { this.active = id; }

  canFire(now: number): boolean {
    return this.ammo[this.active] > 0 && now - this.lastShot[this.active] >= WEAPONS[this.active].fireIntervalSec;
  }

  fire(now: number): boolean {
    if (!this.canFire(now)) return false;
    this.ammo[this.active] -= 1;
    this.lastShot[this.active] = now;
    return true;
  }

  allEmpty(): boolean {
    return WEAPON_ORDER.every((id) => this.ammo[id] <= 0);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/game/weapons.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/weapons.ts src/game/weapons.test.ts
git commit -m "feat(game): Waffen-Arsenal mit echten AC-130-Werten"
```

---

## Task 2: Geschossphysik (stepProjectile + splashTargets)

**Files:**
- Create: `src/game/projectiles.ts`
- Test: `src/game/projectiles.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/game/projectiles.test.ts
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { stepProjectile, splashTargets, GRAVITY, type ProjState } from "./projectiles";

describe("stepProjectile", () => {
  it("bewegt das Geschoss um vel*dt und zieht Schwerkraft ab", () => {
    const p: ProjState = {
      pos: new THREE.Vector3(0, 100, 0),
      vel: new THREE.Vector3(200, 0, 0),
      weapon: "gatling", life: 0,
    };
    stepProjectile(p, 0.5);
    expect(p.pos.x).toBeCloseTo(100, 3); // 200 * 0.5
    expect(p.vel.y).toBeCloseTo(-GRAVITY * 0.5, 3);
    // Höhe: y += vel.y(neu)*dt = -4.905*0.5
    expect(p.pos.y).toBeCloseTo(100 - GRAVITY * 0.5 * 0.5, 3);
    expect(p.life).toBeCloseTo(0.5, 6);
  });
});

describe("splashTargets", () => {
  it("liefert Indizes innerhalb des horizontalen Splash-Radius", () => {
    const impact = new THREE.Vector3(0, 0, 0);
    const positions = [
      new THREE.Vector3(5, 0, 0),   // 5 m → drin (r=10)
      new THREE.Vector3(0, 50, 9),  // 9 m horizontal → drin (Höhe ignoriert)
      new THREE.Vector3(20, 0, 0),  // 20 m → draußen
    ];
    expect(splashTargets(impact, 10, positions)).toEqual([0, 1]);
  });

  it("überspringt null-Einträge (tote Zombies)", () => {
    const impact = new THREE.Vector3(0, 0, 0);
    const positions = [null, new THREE.Vector3(1, 0, 0)] as (THREE.Vector3 | null)[];
    expect(splashTargets(impact, 5, positions)).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/projectiles.test.ts`
Expected: FAIL — "Cannot find module './projectiles'".

- [ ] **Step 3: Write minimal implementation**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/game/projectiles.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/projectiles.ts src/game/projectiles.test.ts
git commit -m "feat(game): Geschossphysik (Flugbahn + Splash-Trefferzone)"
```

---

## Task 3: Zombie-Logik (pure Helfer)

**Files:**
- Modify: `src/game/zombies.ts` (Create)
- Test: `src/game/zombies.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/game/zombies.test.ts
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { moveToward, drainRate, pickSpawn } from "./zombies";

describe("moveToward", () => {
  it("bewegt sich horizontal zum Ziel ohne zu überschießen", () => {
    const pos = new THREE.Vector3(0, 0, 0);
    moveToward(pos, new THREE.Vector3(10, 0, 0), 4, 1); // 4 m/s * 1s = 4 m
    expect(pos.x).toBeCloseTo(4, 6);
    moveToward(pos, new THREE.Vector3(10, 0, 0), 100, 1); // würde überschießen → kappt bei Ziel
    expect(pos.x).toBeCloseTo(10, 6);
  });
});

describe("drainRate", () => {
  it("skaliert linear mit Zombies im Ort", () => {
    expect(drainRate(0, 0.4)).toBe(0);
    expect(drainRate(10, 0.4)).toBeCloseTo(4, 6);
  });
});

describe("pickSpawn", () => {
  it("wählt deterministisch mit gegebenem RNG", () => {
    const pts = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(2, 0, 0)];
    expect(pickSpawn(pts, () => 0.0)!.x).toBe(1);
    expect(pickSpawn(pts, () => 0.99)!.x).toBe(2);
    expect(pickSpawn([], () => 0.5)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/zombies.test.ts`
Expected: FAIL — "Cannot find module './zombies'".

- [ ] **Step 3: Write minimal implementation**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/game/zombies.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/zombies.ts src/game/zombies.test.ts
git commit -m "feat(game): Zombie-Kernlogik (Bewegung, Drain, Spawnwahl)"
```

---

## Task 4: Spawnpunkte aus Waldflächen + Tests

**Files:**
- Modify: `src/game/zombies.ts`
- Test: `src/game/zombies.test.ts`

- [ ] **Step 1: Write the failing test (anhängen)**

```typescript
// am Ende von src/game/zombies.test.ts ergänzen:
import { buildForestSpawnPoints } from "./zombies";
import { Projection } from "../geo";
import type { FeatureCollection } from "../types";
import { FLAT_TERRAIN } from "../terrain";

describe("buildForestSpawnPoints", () => {
  it("erzeugt nur Punkte aus Wald-/Wood-Flächen im Distanzring", () => {
    const center = { lat: 52.5, lon: 9.94 };
    const proj = new Projection(center);
    // Polygon ~600 m östlich (außerhalb 250 m, innerhalb 2200 m)
    const east = 9.94 + 600 / proj.metersPerDegLon;
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { kind: "natural", value: "wood" },
          geometry: { type: "Polygon", coordinates: [[[east, 52.5], [east + 0.001, 52.5], [east + 0.001, 52.501], [east, 52.5]]] } },
        { type: "Feature", properties: { kind: "natural", value: "water" },
          geometry: { type: "Polygon", coordinates: [[[east, 52.5], [east + 0.001, 52.5], [east, 52.501], [east, 52.5]]] } },
      ],
    };
    const pts = buildForestSpawnPoints(fc, proj, FLAT_TERRAIN, 250, 2200);
    expect(pts.length).toBeGreaterThan(0);
    // alle aus Wald (Wasser ignoriert) und im Ring
    for (const p of pts) {
      const d = Math.hypot(p.x, p.z);
      expect(d).toBeGreaterThanOrEqual(250);
      expect(d).toBeLessThanOrEqual(2200);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/zombies.test.ts`
Expected: FAIL — "buildForestSpawnPoints is not a function".

- [ ] **Step 3: Write implementation (anhängen an `src/game/zombies.ts`)**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/game/zombies.test.ts`
Expected: PASS (alle, inkl. neuer Test).

- [ ] **Step 5: Commit**

```bash
git add src/game/zombies.ts src/game/zombies.test.ts
git commit -m "feat(game): Spawnpunkte aus OSM-Waldflächen"
```

---

## Task 5: ZombieField (InstancedMesh, dunkle Gestalten)

**Files:**
- Modify: `src/game/zombies.ts`

> Visuell/Integration — manuell verifiziert (kein Unit-Test, da WebGL).

- [ ] **Step 1: Implementierung anhängen an `src/game/zombies.ts`**

```typescript
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 3: Commit**

```bash
git add src/game/zombies.ts
git commit -m "feat(game): ZombieField (InstancedMesh, Bewegung, Schaden)"
```

---

## Task 6: ProjectileManager (Tracer-Visual + Einschlag)

**Files:**
- Modify: `src/game/projectiles.ts`

> Visuell/Integration — manuell verifiziert.

- [ ] **Step 1: Implementierung anhängen an `src/game/projectiles.ts`**

```typescript
import { WEAPONS, type WeaponSpec } from "./weapons";
import type { TerrainSampler } from "../terrain";
import { splashTargets } from "./projectiles"; // (selbe Datei – siehe unten, kein echter Import nötig)

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
```

> Hinweis: Der `import { splashTargets } from "./projectiles"` im obigen Block ist nur illustrativ — `splashTargets` ist bereits in derselben Datei definiert (Task 2) und direkt aufrufbar. Diese Importzeile beim Einbau **weglassen**. `WeaponId` ist über `./weapons` zu importieren (oben ergänzen).

- [ ] **Step 2: Importe oben in `projectiles.ts` sicherstellen**

```typescript
import type { WeaponId } from "./weapons";
import { WEAPONS, type WeaponSpec } from "./weapons";
import type { TerrainSampler } from "../terrain";
```
(`WEAPONS` ggf. ungenutzt → entfernen, falls tsc `noUnusedLocals` meckert.)

- [ ] **Step 3: Typecheck + Tests**

Run: `npx tsc --noEmit && npx vitest run src/game/projectiles.test.ts`
Expected: keine Fehler, Tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/game/projectiles.ts
git commit -m "feat(game): ProjectileManager (Tracer, Einschlag, Splash)"
```

---

## Task 7: Game-HUD (HTML + CSS) und Button-Umbenennung

**Files:**
- Modify: `index.html`
- Modify: `src/style.css`

- [ ] **Step 1: Button umbenennen in `index.html`**

Ersetze
```html
<button id="flir-toggle" title="Wärmebild (FLIR) ein/aus — Taste F">🎯 FLIR</button>
```
durch
```html
<button id="flir-toggle" title="Zombie-Modus (AC-130-Verteidigung) ein/aus — Taste F">🧟 Zombie-Modus</button>
```

- [ ] **Step 2: Game-HUD ins `#flir-hud` einfügen (vor `</div>` des HUD)**

```html
      <div class="fh game-top">
        <span id="game-pop">POP 1500</span>
        <span id="game-zombies">⛬ 0</span>
      </div>
      <div class="fh game-weapon">
        <span id="game-weapon">25mm</span>
        <span id="game-ammo">3000</span>
        <div id="game-reload"><i></i></div>
      </div>
      <div id="game-banner"></div>
```

- [ ] **Step 3: CSS in `src/style.css` ergänzen (im FLIR-Block)**

```css
.fh.game-top { top: 16px; left: 50%; transform: translateX(-50%); display: flex; gap: 22px; font-size: 16px; }
#game-pop { color: #eaeaea; }
#game-zombies { color: #cfcfcf; }
.fh.game-weapon { left: 50%; bottom: 54px; transform: translateX(-50%); text-align: center; display: flex; gap: 12px; align-items: center; }
#game-weapon { font-weight: 700; }
#game-reload { width: 90px; height: 5px; background: rgba(255,255,255,0.2); border-radius: 3px; overflow: hidden; }
#game-reload i { display: block; height: 100%; width: 100%; background: #fff; transform-origin: left; }
#game-banner {
  position: absolute; top: 42%; left: 50%; transform: translate(-50%,-50%);
  font-size: 40px; font-weight: 800; letter-spacing: 3px; text-align: center;
  display: none;
}
#game-banner.show { display: block; }
```

- [ ] **Step 4: Manuelle Sichtprüfung**

Run: `npm run dev`, Seite laden, FLIR/Zombie-Button prüfen (Label „🧟 Zombie-Modus"), Modus aktivieren — HUD-Elemente (POP/Waffe/Ammo) sichtbar.

- [ ] **Step 5: Commit**

```bash
git add index.html src/style.css
git commit -m "feat(game): Button-Umbenennung Zombie-Modus + Spiel-HUD"
```

---

## Task 8: FlirMode um onToggle-Callback + Flüge ausblenden erweitern

**Files:**
- Modify: `src/flir.ts`

- [ ] **Step 1: Callback-Feld + Aufruf ergänzen**

In `FlirMode` ein optionales Feld ergänzen:
```typescript
  onToggle?: (enabled: boolean) => void;
```
Am Ende von `toggle()` (nach dem if/else) aufrufen:
```typescript
    // Flüge im Modus ausblenden (wie POIs)
    const flights = this.scene.getObjectByName("flights");
    if (flights) flights.visible = !this.enabled;
    this.onToggle?.(this.enabled);
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 3: Commit**

```bash
git add src/flir.ts
git commit -m "feat(game): FlirMode onToggle-Hook + Flüge im Modus ausblenden"
```

---

## Task 9: GameController (Orchestrierung)

**Files:**
- Create: `src/game/zombieMode.ts`

> Integration — manuell verifiziert.

- [ ] **Step 1: Implementierung schreiben**

```typescript
// src/game/zombieMode.ts
import * as THREE from "three";
import { Arsenal, WEAPONS, WEAPON_ORDER, type WeaponId } from "./weapons";
import { ProjectileManager } from "./projectiles";
import { ZombieField, drainRate } from "./zombies";
import type { TerrainSampler } from "../terrain";

const HORDE_TOTAL = 300;          // endliche Invasion
const SPAWN_START = 1.0;          // s zwischen Spawns am Anfang
const SPAWN_MIN = 0.18;           // s am Ende (ansteigend)
const SPAWN_RAMP = 90;            // s bis zur Maximalrate
const START_POP = 1500;
const DRAIN_K = 0.5;              // Personen/s pro Zombie im Ort
const HIT_RADIUS = 4;            // m Direkttreffer-Radius am Zombie

export interface GameDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  terrain: TerrainSampler;
  spawnPoints: THREE.Vector3[];
  raycastTargets: THREE.Object3D[]; // Terrain-Mesh(e) für Zielpunkt
}

export class GameController {
  private active = false;
  private arsenal = new Arsenal();
  private projectiles: ProjectileManager;
  private zombies: ZombieField;
  private pop = START_POP;
  private spawned = 0;
  private spawnTimer = 0;
  private elapsed = 0;
  private firing = false;
  private over: "" | "win" | "lose" = "";
  private raycaster = new THREE.Raycaster();
  private center = new THREE.Vector3(0, 0, 0);

  constructor(private deps: GameDeps) {
    this.projectiles = new ProjectileManager(deps.scene, deps.terrain);
    this.zombies = new ZombieField(deps.scene, {
      center: this.center, spawnPoints: deps.spawnPoints, terrain: deps.terrain,
    });
    this.bindInput();
  }

  start(): void {
    this.active = true;
    this.firing = false;
    this.banner("");
  }
  stop(): void {
    this.active = false;
    this.firing = false;
  }

  private bindInput(): void {
    window.addEventListener("keydown", (e) => {
      if (!this.active) return;
      if (e.code === "Space") { this.firing = true; e.preventDefault(); }
      else if (e.key === "1") this.arsenal.switchTo("gatling");
      else if (e.key === "2") this.arsenal.switchTo("bofors");
      else if (e.key === "3") this.arsenal.switchTo("howitzer");
    });
    window.addEventListener("keyup", (e) => { if (e.code === "Space") this.firing = false; });
  }

  /** Zielpunkt = Schnittpunkt der Blickrichtung (Fadenkreuz) mit dem Gelände. */
  private aimPoint(): THREE.Vector3 {
    const dir = new THREE.Vector3();
    this.deps.camera.getWorldDirection(dir);
    this.raycaster.set(this.deps.camera.position, dir);
    const hits = this.raycaster.intersectObjects(this.deps.raycastTargets, false);
    if (hits.length) return hits[0].point.clone();
    return this.deps.camera.position.clone().addScaledVector(dir, 2000);
  }

  update(dt: number): void {
    if (!this.active || this.over) return;
    this.elapsed += dt;

    // Spawn-Loop (ansteigende Rate)
    if (this.spawned < HORDE_TOTAL) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.zombies.spawnOne(Math.random);
        this.spawned++;
        const t = Math.min(1, this.elapsed / SPAWN_RAMP);
        this.spawnTimer = SPAWN_START + (SPAWN_MIN - SPAWN_START) * t;
      }
    }

    // Feuern
    if (this.firing && this.arsenal.canFire(this.elapsed)) {
      if (this.arsenal.fire(this.elapsed)) {
        this.projectiles.spawn(this.deps.camera.position, this.aimPoint(), this.arsenal.spec());
      }
    }

    this.zombies.update(dt);

    // Direkttreffer: Geschoss nahe Zombie → Einschlag + Splash
    const zpos = this.zombies.positions;
    const projs = this.projectiles.positions();
    for (let i = projs.length - 1; i >= 0; i--) {
      const hit = this.zombies.positions.findIndex((z) => z && z.distanceTo(projs[i].pos) <= HIT_RADIUS);
      if (hit >= 0) {
        const spec = WEAPONS[projs[i].weapon];
        const info = this.projectiles.remove(i);
        const idx = spec.splashRadius > 0 ? this.projectiles.splash(info.point, spec.splashRadius, zpos) : [hit];
        this.zombies.damageAt(idx, spec.damage);
      }
    }
    // Bodeneinschläge (Splash)
    for (const imp of this.projectiles.update(dt)) {
      const spec = WEAPONS[imp.weapon];
      if (spec.splashRadius > 0) this.zombies.damageAt(this.projectiles.splash(imp.point, spec.splashRadius, zpos), spec.damage);
    }

    // Bevölkerungs-Drain
    this.pop = Math.max(0, this.pop - drainRate(this.zombies.inTownCount(), DRAIN_K) * dt);

    this.updateHud();
    this.checkEnd();
  }

  private checkEnd(): void {
    const alive = this.zombies.aliveCount();
    if (this.pop <= 0) this.finish("lose", "EINWOHNER VERLOREN");
    else if (this.spawned >= HORDE_TOTAL && alive === 0) this.finish("win", "ENGENSEN GERETTET");
    else if (this.arsenal.allEmpty() && alive > 0) this.finish("lose", "MUNITION LEER");
  }
  private finish(r: "win" | "lose", msg: string): void { this.over = r; this.banner(msg); }

  private updateHud(): void {
    const set = (id: string, v: string) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set("game-pop", `POP ${Math.ceil(this.pop)}`);
    set("game-zombies", `⛬ ${this.zombies.aliveCount()}`);
    set("game-weapon", this.arsenal.spec().name);
    set("game-ammo", String(this.arsenal.ammoOf(this.arsenal.active)));
    // Reload-Balken (105 mm)
    const bar = document.querySelector<HTMLElement>("#game-reload i");
    if (bar) {
      const spec = this.arsenal.spec();
      const since = this.elapsed - (this.arsenal as unknown as { lastShotPub?: number }).lastShotPub! ;
      bar.style.transform = `scaleX(${THREE.MathUtils.clamp(isFinite(since) ? since / spec.fireIntervalSec : 1, 0, 1)})`;
    }
  }

  private banner(msg: string): void {
    const el = document.getElementById("game-banner");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("show", !!msg);
  }
}
```

> Hinweis zum Reload-Balken: Statt auf private Felder von `Arsenal` zuzugreifen, in Task 1 eine kleine öffentliche Methode ergänzen: `lastShotOf(id: WeaponId): number { return this.lastShot[id]; }`. Im HUD dann `this.elapsed - this.arsenal.lastShotOf(this.arsenal.active)` verwenden. **Diese Methode jetzt in `weapons.ts` ergänzen** (und die `as unknown as`-Zeile entfernen).

- [ ] **Step 2: `lastShotOf` in `weapons.ts` ergänzen + HUD-Zeile korrigieren**

In `Arsenal`:
```typescript
  lastShotOf(id: WeaponId): number { return this.lastShot[id]; }
```
In `updateHud()` die `since`-Zeile ersetzen durch:
```typescript
      const since = this.elapsed - this.arsenal.lastShotOf(this.arsenal.active);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 4: Commit**

```bash
git add src/game/zombieMode.ts src/game/weapons.ts
git commit -m "feat(game): GameController (Spawn, Feuern, Kollision, Population, Win/Lose)"
```

---

## Task 10: Integration in main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Importe + Spawnpunkte + Controller anlegen**

Oben ergänzen:
```typescript
import { GameController } from "./game/zombieMode";
import { buildForestSpawnPoints } from "./game/zombies";
```

Nach dem Bau von Gelände/Flächen (es existiert `terrain`, `areasFC`, `proj`) und nach `const terrainMesh = buildTerrainMesh(...)` — dazu den Terrain-Mesh in einer Variable halten:
```typescript
const terrainMesh = buildTerrainMesh(terrain, 12000, 240);
scene.add(terrainMesh);
```
(ersetzt die bisherige `scene.add(buildTerrainMesh(...))`-Zeile.)

Nach Erzeugung von `flir`:
```typescript
const spawnPoints = buildForestSpawnPoints(areasFC, proj, terrain, 300, 2300);
const game = new GameController({
  scene, camera, terrain, spawnPoints, raycastTargets: [terrainMesh],
});
flir.onToggle = (on) => (on ? game.start() : game.stop());
```

- [ ] **Step 2: Im Render-Loop aktualisieren (nur im Modus)**

Im `animate()` innerhalb des `if (flir.enabled) { ... }`-Zweigs nach `flir.updateOrbit(dt);` ergänzen:
```typescript
        game.update(dt);
```

- [ ] **Step 3: Typecheck + Build**

Run: `npx tsc --noEmit && npx vite build`
Expected: keine Fehler, Build ok.

- [ ] **Step 4: Manueller Spieltest**

Run: `npm run dev`. Zombie-Modus aktivieren (Button/F). Erwartet: Kamera kreist im Wärmebild; dunkle Zombies erscheinen an Waldrändern und ziehen zum Ort; Maus-Drag zielt; Space feuert die aktive Waffe (Tracer); 1/2/3 wechselt Waffe; POP sinkt wenn Zombies im Ort; Sieg/Niederlage-Banner erscheint korrekt.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(game): Zombie-Modus in main verdrahtet"
```

---

## Task 11: Balancing-Pass (Spieltest)

**Files:**
- Modify: `src/game/zombieMode.ts`, `src/game/zombies.ts`, `src/game/weapons.ts` (nur Konstanten)

- [ ] **Step 1: Spielen und justieren**

`npm run dev`, mehrere Runden. Prüfen/justieren (nur Konstanten):
- Ist die Munition (3000/256/100) knapp genug, dass „Munition leer" real droht, aber Sieg möglich ist? Ggf. `HORDE_TOTAL`, `DRAIN_K`, `ZOMBIE_SPEED`, Schaden anpassen.
- Trifft man mit Vorhalt fair? Ggf. `muzzleVel`/`spreadRad` justieren.
- Treffer-/Splash-Radien sinnvoll?

- [ ] **Step 2: Werte committen**

```bash
git add src/game/
git commit -m "tune(game): Balancing nach Spieltest"
```

- [ ] **Step 3: Tests + Build absichern**

Run: `npx vitest run && npx tsc --noEmit && npx vite build`
Expected: alle Tests PASS, Build ok.

- [ ] **Step 4: Push (Auto-Deploy)**

```bash
git push origin main
```

---

## Self-Review-Ergebnis (vom Autor)

- **Spec-Abdeckung:** Wald-Spawn (T4), Bewegung zum Ort + Drain (T3/T5/T9), 3 Waffen mit echten Werten (T1), Ballistik+Splash+Tracer (T2/T6), Steuerung Space/1/2/3/Drag/Zoom (T9, Drag/Zoom bereits in flir.ts), dunkle Zombies (T5), HUD POP/Waffe/Ammo/Banner (T7/T9), Win/Lose (T9), Umbenennung (T7). ✓
- **Platzhalter:** keine „TBD"; Balancing-Konstanten sind bewusst in T11 justierbar, aber mit konkreten Startwerten definiert. ✓
- **Typ-Konsistenz:** `WeaponId`, `Arsenal` (inkl. `lastShotOf`), `ProjectileManager` (`spawn/update/positions/remove/splash`), `ZombieField` (`spawnOne/update/damageAt/aliveCount/inTownCount/positions`), `GameController` (`start/stop/update`) durchgängig. ✓
- **Hinweis:** Der illustrative Selbst-Import in T6 ist als „weglassen" markiert; `lastShotOf` in T9 nachgezogen.
