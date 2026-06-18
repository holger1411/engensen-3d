import * as THREE from "three";
import { METERS_PER_DEG_LAT } from "./geo";

/**
 * Geländemodell aus dem gebackenen Höhenraster (terrain.json).
 * Liefert für jeden Welt-Punkt (x = Ost, z = -Nord) eine Höhe in Welt-Einheiten.
 * Engensen ist flach (~17 m Relief), daher wird die Höhe überhöht dargestellt,
 * damit die Erhebungen sichtbar werden.
 */

const VERT_EXAG = 2.4; // Überhöhung, damit geringe Erhebungen sichtbar sind

export interface TerrainData {
  grid: number;
  bbox: { south: number; west: number; north: number; east: number };
  base: number;
  min: number;
  max: number;
  elevations: number[];
}

export interface TerrainSampler {
  sample(x: number, z: number): number;
  readonly reliefM: number;
}

/** Flaches Fallback-Gelände, falls keine Höhendaten geladen werden konnten. */
export const FLAT_TERRAIN: TerrainSampler = { sample: () => 0, reliefM: 0 };

class GridTerrain implements TerrainSampler {
  readonly reliefM: number;
  private G: number;
  private el: number[];
  private base: number;
  private clat: number;
  private clon: number;
  private mPerLon: number;
  private south: number;
  private west: number;
  private dLat: number;
  private dLon: number;

  constructor(d: TerrainData, center: { lat: number; lon: number }) {
    this.G = d.grid;
    this.el = d.elevations;
    this.base = d.base;
    this.reliefM = d.max - d.min;
    this.clat = center.lat;
    this.clon = center.lon;
    this.mPerLon = METERS_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180);
    this.south = d.bbox.south;
    this.west = d.bbox.west;
    this.dLat = d.bbox.north - d.bbox.south;
    this.dLon = d.bbox.east - d.bbox.west;
  }

  sample(x: number, z: number): number {
    // Welt → geographische Koordinaten (Umkehrung der Projektion)
    const lon = this.clon + x / this.mPerLon;
    const lat = this.clat - z / METERS_PER_DEG_LAT;

    // → Rasterindizes (u = Längen-, v = Breitenindex)
    let u = ((lon - this.west) / this.dLon) * (this.G - 1);
    let v = ((lat - this.south) / this.dLat) * (this.G - 1);
    u = Math.max(0, Math.min(this.G - 1, u));
    v = Math.max(0, Math.min(this.G - 1, v));

    const j0 = Math.floor(u);
    const i0 = Math.floor(v);
    const j1 = Math.min(j0 + 1, this.G - 1);
    const i1 = Math.min(i0 + 1, this.G - 1);
    const fu = u - j0;
    const fv = v - i0;

    const e00 = this.el[i0 * this.G + j0];
    const e01 = this.el[i0 * this.G + j1];
    const e10 = this.el[i1 * this.G + j0];
    const e11 = this.el[i1 * this.G + j1];
    const top = e00 + (e01 - e00) * fu;
    const bot = e10 + (e11 - e10) * fu;
    const elev = top + (bot - top) * fv;

    return (elev - this.base) * VERT_EXAG;
  }
}

export function makeTerrain(d: TerrainData, center: { lat: number; lon: number }): TerrainSampler {
  return new GridTerrain(d, center);
}

export interface TerrainMeshOptions {
  /** Luftbild-Textur (optional). */
  texture?: THREE.Texture | null;
  /** Kantenlänge des vom Luftbild abgedeckten Bereichs in Metern (= 2·Radius). */
  textureExtent?: number;
}

/** Erzeugt das sichtbare Gelände-Mesh (überhöht, mit Luftbild oder Volltonfarbe). */
export function buildTerrainMesh(
  sampler: TerrainSampler,
  size = 3000,
  segments = 160,
  opts: TerrainMeshOptions = {},
): THREE.Mesh {
  const geom = new THREE.PlaneGeometry(size, size, segments, segments);
  geom.rotateX(-Math.PI / 2);
  const pos = geom.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, sampler.sample(x, z) - 0.4); // minimal unter den Flächen
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();

  let mat: THREE.MeshStandardMaterial;
  if (opts.texture) {
    // UV so legen, dass das Luftbild exakt den abgedeckten Bereich (textureExtent)
    // mittig auf dem (größeren) Mesh abbildet; außerhalb wird der Rand geklemmt.
    const ext = opts.textureExtent ?? size;
    const uv = geom.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      uv.setXY(i, (x + ext / 2) / ext, (-z + ext / 2) / ext); // v: +Nord (−z) nach oben
    }
    uv.needsUpdate = true;
    opts.texture.wrapS = opts.texture.wrapT = THREE.ClampToEdgeWrapping;
    opts.texture.colorSpace = THREE.SRGBColorSpace;
    opts.texture.anisotropy = 8;
    mat = new THREE.MeshStandardMaterial({ map: opts.texture, color: 0xb9bdb0, roughness: 1, metalness: 0 });
  } else {
    mat = new THREE.MeshStandardMaterial({ color: 0x86a05c, roughness: 1, metalness: 0 });
  }
  const mesh = new THREE.Mesh(geom, mat);
  mesh.receiveShadow = true;
  mesh.name = "terrain";
  return mesh;
}
