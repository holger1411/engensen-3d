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

const MAX_FX = 240;

// Heißes Glühen (radialer Gradient) — additiv → im Wärmebild weißglühend.
let HOT_TEX: THREE.Texture | null = null;
function hotTexture(): THREE.Texture {
  if (HOT_TEX) return HOT_TEX;
  const s = 64;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,0.75)");
  g.addColorStop(0.3, "rgba(255,244,206,0.6)");
  g.addColorStop(0.7, "rgba(255,206,140,0.25)");
  g.addColorStop(1, "rgba(255,180,120,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  HOT_TEX = new THREE.CanvasTexture(c);
  return HOT_TEX;
}
function hotSprite(scale: number): THREE.Sprite {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: hotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  sp.scale.setScalar(scale);
  return sp;
}

// Glühender Geschosskopf je Waffe (m) und Einschlag-Blitzgröße je Waffe (m).
const HEAD_SIZE: Record<WeaponId, number> = { gatling: 5, bofors: 8, howitzer: 13 };
const BOOM_SIZE: Record<WeaponId, number> = { gatling: 10, bofors: 24, howitzer: 55 };
const BOOM_DUR: Record<WeaponId, number> = { gatling: 0.16, bofors: 0.28, howitzer: 0.5 };

interface Fx { sprite: THREE.Sprite; life: number; dur: number; size: number; }

export class ProjectileManager {
  private projectiles: ProjState[] = [];
  private lines: THREE.Line[] = [];
  private heads: THREE.Sprite[] = [];
  private fx: Fx[] = [];
  private group = new THREE.Group();

  constructor(scene: THREE.Scene, private terrain: TerrainSampler) {
    this.group.name = "projectiles";
    scene.add(this.group);
  }

  /** Feuert ein Geschoss von origin Richtung aim (mit Streuung). */
  spawn(origin: THREE.Vector3, aim: THREE.Vector3, spec: WeaponSpec): void {
    if (this.projectiles.length >= MAX_TRACERS) return;
    const dir = aim.clone().sub(origin).normalize();
    dir.x += (Math.random() - 0.5) * spec.spreadRad * 2;
    dir.y += (Math.random() - 0.5) * spec.spreadRad * 2;
    dir.z += (Math.random() - 0.5) * spec.spreadRad * 2;
    dir.normalize();
    const p: ProjState = { pos: origin.clone(), vel: dir.multiplyScalar(spec.muzzleVel), weapon: spec.id, life: 0 };
    this.projectiles.push(p);

    // heiße Leuchtspur (additive Linie)
    const geom = new THREE.BufferGeometry().setFromPoints([p.pos.clone(), p.pos.clone()]);
    const mat = new THREE.LineBasicMaterial({ color: 0xfff0c4, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
    const line = new THREE.Line(geom, mat);
    line.frustumCulled = false;
    this.group.add(line);
    this.lines.push(line);

    // glühender Kopf
    const head = hotSprite(HEAD_SIZE[spec.id]);
    head.position.copy(p.pos);
    this.group.add(head);
    this.heads.push(head);
  }

  /** Simuliert Geschosse, animiert Einschlag-Effekte; liefert Bodeneinschläge. */
  update(dt: number): ImpactInfo[] {
    const impacts: ImpactInfo[] = [];
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const prev = p.pos.clone();
      stepProjectile(p, dt);
      const ground = this.terrain.sample(p.pos.x, p.pos.z);
      const hitGround = p.pos.y <= ground;
      const expired = p.life > 6;
      (this.lines[i].geometry as THREE.BufferGeometry).setFromPoints([prev, p.pos.clone()]);
      this.heads[i].position.copy(p.pos);
      if (hitGround || expired) {
        if (hitGround) { p.pos.y = ground; impacts.push({ point: p.pos.clone(), weapon: p.weapon }); }
        this.disposeProj(i);
      }
    }
    this.updateFx(dt);
    return impacts;
  }

  private disposeProj(i: number): void {
    const line = this.lines[i];
    this.group.remove(line);
    (line.geometry as THREE.BufferGeometry).dispose();
    (line.material as THREE.Material).dispose();
    const head = this.heads[i];
    this.group.remove(head);
    head.material.dispose();
    this.projectiles.splice(i, 1);
    this.lines.splice(i, 1);
    this.heads.splice(i, 1);
  }

  /** Aktuelle Geschosspositionen (für Direkttreffer-Prüfung). */
  positions(): { pos: THREE.Vector3; weapon: WeaponId }[] {
    return this.projectiles.map((p) => ({ pos: p.pos, weapon: p.weapon }));
  }

  remove(index: number): ImpactInfo {
    const p = this.projectiles[index];
    const info: ImpactInfo = { point: p.pos.clone(), weapon: p.weapon };
    this.disposeProj(index);
    return info;
  }

  splash(point: THREE.Vector3, radius: number, zombiePositions: (THREE.Vector3 | null)[]): number[] {
    return splashTargets(point, radius, zombiePositions);
  }

  /** Sichtbare Einschlag-Explosion (heißer Blitz) am Punkt, Größe je Waffe. */
  boom(point: THREE.Vector3, weapon: WeaponId): void {
    if (this.fx.length >= MAX_FX) return;
    const sp = hotSprite(BOOM_SIZE[weapon] * 0.45);
    sp.position.copy(point);
    sp.position.y += 3;
    this.group.add(sp);
    this.fx.push({ sprite: sp, life: 0, dur: BOOM_DUR[weapon], size: BOOM_SIZE[weapon] });
  }

  private updateFx(dt: number): void {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life += dt;
      const t = f.life / f.dur;
      if (t >= 1) {
        this.group.remove(f.sprite);
        f.sprite.material.dispose();
        this.fx.splice(i, 1);
        continue;
      }
      f.sprite.scale.setScalar(f.size * (0.4 + 1.5 * t)); // schnell aufblühen
      (f.sprite.material as THREE.SpriteMaterial).opacity = 1 - t; // verblassen
    }
  }
}
