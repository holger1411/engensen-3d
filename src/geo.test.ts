import { describe, it, expect } from "vitest";
import { Projection, signedArea, ringArea, centroid, METERS_PER_DEG_LAT } from "./geo";

const CENTER = { lon: 9.9442798, lat: 52.5003028 };

describe("Projection", () => {
  const proj = new Projection(CENTER);

  it("projiziert das Zentrum auf den Ursprung", () => {
    const p = proj.project(CENTER.lon, CENTER.lat);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it("ein Grad Breite ≈ 111320 m nach Norden (+y)", () => {
    const p = proj.project(CENTER.lon, CENTER.lat + 1);
    expect(p.y).toBeCloseTo(METERS_PER_DEG_LAT, 1);
    expect(p.x).toBeCloseTo(0, 6);
  });

  it("Längengrad-Meter sind durch cos(lat) gestaucht", () => {
    const expected = METERS_PER_DEG_LAT * Math.cos((CENTER.lat * Math.PI) / 180);
    expect(proj.metersPerDegLon).toBeCloseTo(expected, 1);
    // bei ~52.5° deutlich kleiner als an der Breite
    expect(proj.metersPerDegLon).toBeLessThan(METERS_PER_DEG_LAT);
  });

  it("Ost-Verschiebung ergibt positives x", () => {
    const p = proj.project(CENTER.lon + 0.01, CENTER.lat);
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeCloseTo(0.01 * proj.metersPerDegLon, 3);
  });

  it("eine bekannte ~100 m Distanz ist plausibel", () => {
    // 0.0009 Grad Breite ≈ 100 m
    const p = proj.project(CENTER.lon, CENTER.lat + 0.0009);
    expect(p.y).toBeGreaterThan(95);
    expect(p.y).toBeLessThan(105);
  });
});

describe("Ring-Geometrie", () => {
  // 10 m x 10 m Quadrat, gegen den Uhrzeigersinn
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("signedArea ist positiv für CCW", () => {
    expect(signedArea(square)).toBeCloseTo(100, 6);
  });

  it("signedArea ist negativ für CW", () => {
    expect(signedArea([...square].reverse())).toBeCloseTo(-100, 6);
  });

  it("ringArea liefert immer positiven Flächeninhalt", () => {
    expect(ringArea(square)).toBeCloseTo(100, 6);
    expect(ringArea([...square].reverse())).toBeCloseTo(100, 6);
  });

  it("centroid eines Quadrats liegt im Mittelpunkt", () => {
    const c = centroid(square);
    expect(c.x).toBeCloseTo(5, 6);
    expect(c.y).toBeCloseTo(5, 6);
  });

  it("centroid eines entarteten Rings stürzt nicht ab", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ];
    const c = centroid(line);
    expect(Number.isFinite(c.x)).toBe(true);
    expect(Number.isFinite(c.y)).toBe(true);
  });
});
