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
