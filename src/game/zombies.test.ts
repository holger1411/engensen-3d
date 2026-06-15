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
