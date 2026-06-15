// src/game/zombieMode.ts
import * as THREE from "three";
import { Arsenal, WEAPONS, type WeaponId } from "./weapons";
import { ProjectileManager } from "./projectiles";
import { ZombieField, drainRate } from "./zombies";
import type { TerrainSampler } from "../terrain";

const HORDE_TOTAL = 300;          // endliche Invasion
const SPAWN_START = 1.0;          // s zwischen Spawns am Anfang
const SPAWN_MIN = 0.18;           // s am Ende (ansteigend)
const SPAWN_RAMP = 90;            // s bis zur Maximalrate
const START_POP = 1500;
const DRAIN_K = 0.5;              // Personen/s pro Zombie im Ort
const HIT_RADIUS = 8;            // m Direkttreffer-Radius am Zombie (gegen Tunneln)

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
  // Waffen-Feedback: Mündungsfeuer, Vollbild-Weißblitz, Rückstoß-Rütteln
  private muzzle = 0;
  private flashWhite = 0;
  private shake = 0;

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
        this.triggerFire(this.arsenal.active);
      }
    }

    this.zombies.update(dt);

    // Direkttreffer: Geschoss nahe Zombie → Einschlag + Splash
    const zpos = this.zombies.positions;
    const projs = this.projectiles.positions();
    for (let i = projs.length - 1; i >= 0; i--) {
      const hit = this.zombies.positions.findIndex((z) => z && z.distanceTo(projs[i].pos) <= HIT_RADIUS);
      if (hit >= 0) {
        const w = projs[i].weapon;
        const spec = WEAPONS[w];
        const info = this.projectiles.remove(i);
        const idx = spec.splashRadius > 0 ? this.projectiles.splash(info.point, spec.splashRadius, zpos) : [hit];
        this.zombies.damageAt(idx, spec.damage);
        this.projectiles.boom(info.point, w); // sichtbarer Einschlag
      }
    }
    // Bodeneinschläge: jeder Einschlag detoniert sichtbar (auch Fehlschüsse) + Splash
    for (const imp of this.projectiles.update(dt)) {
      const spec = WEAPONS[imp.weapon];
      this.projectiles.boom(imp.point, imp.weapon);
      if (spec.splashRadius > 0) this.zombies.damageAt(this.projectiles.splash(imp.point, spec.splashRadius, zpos), spec.damage);
    }

    // Bevölkerungs-Drain
    this.pop = Math.max(0, this.pop - drainRate(this.zombies.inTownCount(), DRAIN_K) * dt);

    this.applyFeedback(dt);
    this.updateHud();
    this.checkEnd();
  }

  /** Setzt Mündungsfeuer/Weißblitz/Rückstoß je Waffe beim Schuss. */
  private triggerFire(w: WeaponId): void {
    if (w === "gatling") {
      this.muzzle = 0.45;
      this.shake = Math.max(this.shake, 1.5);
    } else if (w === "bofors") {
      this.muzzle = 0.7;
      this.flashWhite = Math.max(this.flashWhite, 0.16);
      this.shake = Math.max(this.shake, 9);
    } else {
      this.muzzle = 0.9;
      this.flashWhite = 1; // extrem kurzer Vollbild-Weißblitz
      this.shake = Math.max(this.shake, 22);
    }
  }

  /** Klingt Feedback ab und wendet es an (DOM-Overlays + Kamera-Rütteln). */
  private applyFeedback(dt: number): void {
    this.muzzle = Math.max(0, this.muzzle - dt * 6);
    this.flashWhite = Math.max(0, this.flashWhite - dt * 8); // sehr kurz
    this.shake = Math.max(0, this.shake - dt * 36);
    const m = document.getElementById("game-muzzle");
    if (m) m.style.opacity = this.muzzle.toFixed(3);
    const fl = document.getElementById("game-flash");
    if (fl) fl.style.opacity = this.flashWhite.toFixed(3);
    if (this.shake > 0.02) {
      const s = this.shake;
      const p = this.deps.camera.position;
      p.x += (Math.random() - 0.5) * s;
      p.y += (Math.random() - 0.5) * s;
      p.z += (Math.random() - 0.5) * s;
    }
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
      const since = this.elapsed - this.arsenal.lastShotOf(this.arsenal.active);
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
