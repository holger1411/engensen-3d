// src/game/zombieMode.ts
import * as THREE from "three";
import { Arsenal, WEAPONS, type WeaponId } from "./weapons";
import { ProjectileManager } from "./projectiles";
import { ZombieField, drainRate } from "./zombies";
import type { TerrainSampler } from "../terrain";
import type { Mission } from "./missions";

const SPAWN_START = 4.0;          // s zwischen Gruppen am Anfang
const SPAWN_MIN = 1.0;            // s am Ende (ansteigend)
const SPAWN_RAMP = 90;            // s bis zur Maximalrate
const DRAIN_K = 0.7;             // Basis: Personen/s pro Zombie im Ort
const HIT_RADIUS = 8;            // m Direkttreffer-Radius am Zombie (gegen Tunneln)

export interface MissionData {
  mission: Mission;
  center: THREE.Vector3;
  spawnPoints: THREE.Vector3[];
}

export interface GameDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  terrain: TerrainSampler;
  raycastTargets: THREE.Object3D[]; // Terrain-Mesh(e) für Zielpunkt
  missions: MissionData[];
  setOrbitCenter: (v: THREE.Vector3) => void;
}

export class GameController {
  private active = false;
  private arsenal = new Arsenal();
  private projectiles: ProjectileManager;
  private zombies: ZombieField;
  private center = new THREE.Vector3(0, 0, 0);
  private pop = 0;
  private hordeTotal = 0;
  private drainK = DRAIN_K;
  private currentName = "";
  private spawned = 0;
  private spawnTimer = 0;
  private elapsed = 0;
  private firing = false;
  private over: "" | "win" | "lose" = "";
  private raycaster = new THREE.Raycaster();
  // Waffen-Feedback
  private muzzle = 0;
  private flashWhite = 0;
  private shake = 0;
  private breachT = 0; // > 0 → Bevölkerung sinkt gerade (Durchbruch-Warnblinken)
  // Statistik
  private missionIndex = 0;
  private shots: Record<WeaponId, number> = { gatling: 0, bofors: 0, howitzer: 0 };
  private hits: Record<WeaponId, number> = { gatling: 0, bofors: 0, howitzer: 0 };
  private kills: Record<WeaponId, number> = { gatling: 0, bofors: 0, howitzer: 0 };
  private totalKills = 0;

  constructor(private deps: GameDeps) {
    this.projectiles = new ProjectileManager(deps.scene, deps.terrain);
    this.zombies = new ZombieField(deps.scene, {
      center: this.center, spawnPoints: deps.missions[0].spawnPoints, terrain: deps.terrain,
    });
    this.buildSelector();
    this.bindInput();
  }

  /** Modus betreten → Missionsauswahl zeigen (Spiel startet erst nach Wahl). */
  start(): void {
    this.firing = false;
    this.banner("");
    this.showSelector();
  }
  /** Modus verlassen. */
  stop(): void {
    this.active = false;
    this.firing = false;
    this.banner("");
    this.showSelector(false);
    document.getElementById("game-stats")?.classList.remove("show");
  }

  // --- Missionsauswahl -------------------------------------------------------
  private buildSelector(): void {
    const el = document.getElementById("game-missions");
    if (!el) return;
    el.replaceChildren();
    const title = document.createElement("div");
    title.className = "gm-title";
    title.textContent = "MISSION WÄHLEN";
    el.append(title);
    this.deps.missions.forEach((md, i) => {
      const b = document.createElement("button");
      b.className = "gm-btn";
      const stars = "★".repeat(i + 1) + "☆".repeat(this.deps.missions.length - i - 1);
      b.textContent = `${i + 1}. ${md.mission.name} — ${md.mission.pop} Einw. · ${md.mission.horde} Z · ${stars}`;
      b.addEventListener("click", () => this.startMission(i));
      el.append(b);
    });

    // Tastenbelegung
    const keys = document.createElement("div");
    keys.className = "gm-keys";
    const controls: [string, string][] = [
      ["Leertaste", "Feuern"],
      ["1 · 2 · 3", "25 / 40 / 105 mm"],
      ["Maus ziehen", "Zielen"],
      ["Mausrad", "Zoom"],
      ["V", "Wärmebild ↔ Farbe"],
      ["P", "Pause"],
      ["F", "Modus verlassen"],
    ];
    for (const [k, label] of controls) {
      const row = document.createElement("div");
      row.className = "gm-key";
      const kk = document.createElement("kbd");
      kk.textContent = k;
      const lab = document.createElement("span");
      lab.textContent = label;
      row.append(kk, lab);
      keys.append(row);
    }
    el.append(keys);
  }
  private showSelector(show = true): void {
    document.getElementById("game-missions")?.classList.toggle("show", show);
  }

  private startMission(i: number): void {
    const md = this.deps.missions[i];
    this.missionIndex = i;
    this.currentName = md.mission.name.toUpperCase();
    this.shots = { gatling: 0, bofors: 0, howitzer: 0 };
    this.hits = { gatling: 0, bofors: 0, howitzer: 0 };
    this.kills = { gatling: 0, bofors: 0, howitzer: 0 };
    this.totalKills = 0;
    document.getElementById("game-stats")?.classList.remove("show");
    this.hordeTotal = md.mission.horde;
    this.drainK = DRAIN_K * md.mission.drainMul;
    this.pop = md.mission.pop;
    this.zombies.reset(md.center, md.spawnPoints, md.mission.speedMul);
    this.projectiles.clear();
    this.arsenal = new Arsenal();
    this.deps.setOrbitCenter(md.center);
    this.elapsed = 0;
    this.spawned = 0;
    this.spawnTimer = 0;
    this.over = "";
    this.firing = false;
    this.muzzle = this.flashWhite = this.shake = 0;
    this.active = true;
    this.showSelector(false);
    this.banner("");
    this.updateHud();
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

  /** Gemischte Gruppengrößen: Einzelgänger, kleine Trupps, große Horden. */
  private groupSize(): number {
    const r = Math.random();
    if (r < 0.2) return 1 + Math.floor(Math.random() * 3);  // 1–3 Einzelgänger
    if (r < 0.6) return 5 + Math.floor(Math.random() * 7);  // 5–11 kleine Gruppe
    return 12 + Math.floor(Math.random() * 16);             // 12–27 große Horde
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

    // Spawn-Loop: Gruppen unterschiedlicher Größe (ansteigende Frequenz)
    if (this.spawned < this.hordeTotal) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        const size = this.groupSize();
        this.zombies.spawnCluster(Math.random, size, 9 + size * 1.1);
        this.spawned += size;
        const t = Math.min(1, this.elapsed / SPAWN_RAMP);
        this.spawnTimer = SPAWN_START + (SPAWN_MIN - SPAWN_START) * t;
      }
    }

    // Feuern
    if (this.firing && this.arsenal.canFire(this.elapsed)) {
      if (this.arsenal.fire(this.elapsed)) {
        this.projectiles.spawn(this.deps.camera.position, this.aimPoint(), this.arsenal.spec());
        this.triggerFire(this.arsenal.active);
        this.shots[this.arsenal.active]++;
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
        const killed = this.zombies.damageAt(idx, spec.damage);
        this.kills[w] += killed; this.totalKills += killed; this.hits[w]++;
        this.projectiles.boom(info.point, w);
      }
    }
    // Bodeneinschläge: jeder Einschlag detoniert sichtbar (auch Fehlschüsse) + Splash
    for (const imp of this.projectiles.update(dt)) {
      const spec = WEAPONS[imp.weapon];
      this.projectiles.boom(imp.point, imp.weapon);
      if (spec.splashRadius > 0) {
        const targets = this.projectiles.splash(imp.point, spec.splashRadius, zpos);
        const killed = this.zombies.damageAt(targets, spec.damage);
        this.kills[imp.weapon] += killed; this.totalKills += killed;
        if (targets.length > 0) this.hits[imp.weapon]++;
      }
    }

    // Bevölkerungs-Drain – nur wenn Zombies im Ort-Radius sind (sonst Rate 0)
    const popBefore = this.pop;
    this.pop = Math.max(0, this.pop - drainRate(this.zombies.inTownCount(), this.drainK) * dt);
    if (this.pop < popBefore - 1e-4) this.breachT = 0.9; // Durchbruch → Warnblinken
    this.breachT = Math.max(0, this.breachT - dt);

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
      this.flashWhite = 1;
      this.shake = Math.max(this.shake, 22);
    }
  }

  /** Klingt Feedback ab und wendet es an (DOM-Overlays + Kamera-Rütteln). */
  private applyFeedback(dt: number): void {
    this.muzzle = Math.max(0, this.muzzle - dt * 6);
    this.flashWhite = Math.max(0, this.flashWhite - dt * 8);
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
    if (this.pop <= 0) this.finish("lose", `${this.currentName} VERLOREN`);
    else if (this.spawned >= this.hordeTotal && alive === 0) this.finish("win", `${this.currentName} GERETTET`);
    else if (this.arsenal.allEmpty() && alive > 0) this.finish("lose", "MUNITION LEER");
  }
  private finish(r: "win" | "lose", msg: string): void {
    this.over = r;
    this.active = false;
    this.banner("");
    this.renderStats(r, msg);
    this.showSelector(); // nächste Mission wählbar
  }

  /** Auswertung nach der Mission: Score + Statistik je Waffe. */
  private renderStats(r: "win" | "lose", title: string): void {
    const el = document.getElementById("game-stats");
    if (!el) return;
    const totShots = this.shots.gatling + this.shots.bofors + this.shots.howitzer;
    const totHits = this.hits.gatling + this.hits.bofors + this.hits.howitzer;
    const acc = totShots ? totHits / totShots : 0;
    const diffMult = 1 + this.missionIndex * 0.5; // Engensen 1, Lahberg 1.5, Wettmar 2
    let score = this.totalKills * 10 + Math.round(this.pop) * 4 + Math.round(acc * 1500);
    if (r === "win") score += 3000;
    score = Math.round(score * diffMult);

    el.replaceChildren();
    const head = document.createElement("div");
    head.className = "gs-title " + r;
    head.textContent = title;
    const sc = document.createElement("div");
    sc.className = "gs-score";
    sc.textContent = `SCORE ${score.toLocaleString("de-DE")}`;
    const sub = document.createElement("div");
    sub.className = "gs-sub";
    sub.textContent = `Getötet ${this.totalKills} · Einwohner ${Math.ceil(this.pop)} · Genauigkeit ${Math.round(acc * 100)} %`;

    const table = document.createElement("table");
    table.className = "gs-table";
    const W: [WeaponId, string][] = [["gatling", "25 mm"], ["bofors", "40 mm"], ["howitzer", "105 mm"]];
    const rows: string[][] = [["Waffe", "Schuss", "Treffer", "Quote", "Kills"]];
    for (const [id, name] of W) {
      const s = this.shots[id], h = this.hits[id];
      rows.push([name, String(s), String(h), `${s ? Math.round((h / s) * 100) : 0} %`, String(this.kills[id])]);
    }
    rows.forEach((row, ri) => {
      const tr = document.createElement("tr");
      row.forEach((c) => { const cell = document.createElement(ri === 0 ? "th" : "td"); cell.textContent = c; tr.append(cell); });
      table.append(tr);
    });

    el.append(head, sc, sub, table);
    el.classList.add("show");
  }

  private updateHud(): void {
    const set = (id: string, v: string) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    const breach = this.breachT > 0;
    const popEl = document.getElementById("game-pop");
    if (popEl) {
      popEl.textContent = breach ? `⚠ DURCHBRUCH · POP ${Math.ceil(this.pop)}` : `POP ${Math.ceil(this.pop)}`;
      popEl.classList.toggle("breach", breach);
    }
    set("game-zombies", `⛬ ${this.zombies.aliveCount()}`);
    set("game-weapon", this.arsenal.spec().name);
    set("game-ammo", String(this.arsenal.ammoOf(this.arsenal.active)));
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
