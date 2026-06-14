/**
 * Geo-Projektion: Lon/Lat → lokale Meter-Koordinaten (equirektangulär um ein
 * Zentrum). Für einen Ortskern von ~1 km Ausdehnung ist die Verzerrung
 * vernachlässigbar.
 *
 * Konvention für die 3D-Welt:
 *   x = Ost (+),  Norden zeigt nach -Z, Höhe entlang +Y.
 * Die hier zurückgegebenen 2D-Punkte (x, y) liegen in der Footprint-Ebene,
 * wobei y = Nord-Richtung (positiv). Die Extrusion rotiert diese Ebene später
 * so, dass y → -Z wird.
 */

export const METERS_PER_DEG_LAT = 111320;

export interface LonLat {
  lon: number;
  lat: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export class Projection {
  readonly center: LonLat;
  readonly metersPerDegLon: number;

  constructor(center: LonLat) {
    this.center = center;
    this.metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180);
  }

  /** Projiziert [lon, lat] in lokale Meter. y zeigt nach Norden. */
  project(lon: number, lat: number): Vec2 {
    return {
      x: (lon - this.center.lon) * this.metersPerDegLon,
      y: (lat - this.center.lat) * METERS_PER_DEG_LAT,
    };
  }

  /** Projiziert einen GeoJSON-Ring ([[lon,lat], ...]) in lokale Meter-Punkte. */
  projectRing(ring: number[][]): Vec2[] {
    return ring.map(([lon, lat]) => this.project(lon, lat));
  }
}

/** Signierte Fläche eines 2D-Rings (Shoelace). Positiv = gegen den Uhrzeigersinn. */
export function signedArea(points: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Flächeninhalt (immer positiv) eines Rings in m². */
export function ringArea(points: Vec2[]): number {
  return Math.abs(signedArea(points));
}

/** Flächen-Schwerpunkt eines 2D-Rings. */
export function centroid(points: Vec2[]): Vec2 {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
    a += cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) {
    // Entartet: Mittelwert der Punkte
    const m = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: m.x / points.length, y: m.y / points.length };
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Deterministischer Pseudo-Zufall [0,1) aus einer Zahl — für reproduzierbare Höhen-Variation. */
export function hashNoise(seed: number): number {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
