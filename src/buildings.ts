import * as THREE from "three";
import { Projection, hashNoise, ringArea, type Vec2 } from "./geo";
import type { FeatureCollection, BuildingInfo } from "./types";

const LEVEL_HEIGHT = 3; // m pro Stockwerk
const MIN_FOOTPRINT_AREA = 4; // m² — winzige Artefakte verwerfen

/** Kategorie eines Gebäudes anhand von OSM-Tags. */
type Category = "worship" | "fire" | "public" | "farm" | "outbuilding" | "residential";

function categorize(p: Record<string, string | undefined>): Category {
  const b = (p.building || "").toLowerCase();
  if (p.religion || p.building === "chapel" || p.building === "church" || p.amenity === "place_of_worship") return "worship";
  if (b === "fire_station" || p.amenity === "fire_station") return "fire";
  if (p.amenity === "school" || p.amenity === "townhall" || b === "public" || b === "civic" || /halle/i.test(p.name || "")) return "public";
  if (["farm", "farm_auxiliary", "barn", "cowshed", "stable", "greenhouse"].includes(b)) return "farm";
  if (["garage", "garages", "carport", "roof", "shed", "hut"].includes(b)) return "outbuilding";
  return "residential";
}

/** Menschlich lesbares deutsches Label je Kategorie. */
const CATEGORY_LABEL: Record<Category, string> = {
  worship: "Kapelle / Kirche",
  fire: "Feuerwehr",
  public: "Öffentliches Gebäude",
  farm: "Hof / Scheune",
  outbuilding: "Nebengebäude",
  residential: "Wohnhaus",
};

/** Basis-Höhe (m) je Kategorie, wenn keine OSM-Höhe vorliegt. */
const BASE_HEIGHT: Record<Category, number> = {
  worship: 11,
  fire: 8,
  public: 8,
  farm: 6,
  outbuilding: 3,
  residential: 6.5,
};

/** Grundfarben je Kategorie. */
const BASE_COLOR: Record<Category, number> = {
  worship: 0x9c8466, // Sandstein
  fire: 0xb23b34, // Rot
  public: 0xc9b06a, // Sandgelb
  farm: 0xa6906a, // Lehm
  outbuilding: 0x9a9489, // Grau
  residential: 0xc9a98a, // warmer Putz
};

function parseHeight(raw?: string): number | undefined {
  if (!raw) return undefined;
  const m = raw.match(/[\d.]+/);
  if (!m) return undefined;
  const v = parseFloat(m[0]);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

function resolveHeight(p: Record<string, string | undefined>, cat: Category, seed: number): number {
  const explicit = parseHeight(p.height);
  if (explicit) return explicit;
  const levels = p["building:levels"] ? parseInt(p["building:levels"], 10) : undefined;
  if (levels && Number.isFinite(levels) && levels > 0) return levels * LEVEL_HEIGHT + 1;
  // Default je Kategorie + deterministische Variation (±15 %) für lebendiges Bild
  const base = BASE_HEIGHT[cat];
  const variation = (hashNoise(seed) - 0.5) * 0.3 * base;
  return Math.max(2.5, base + variation);
}

/** Leicht variierte Farbe für mehr Tiefe (deterministisch). */
function shadeColor(base: number, seed: number): THREE.Color {
  const c = new THREE.Color(base);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  hsl.l = THREE.MathUtils.clamp(hsl.l + (hashNoise(seed * 1.7) - 0.5) * 0.12, 0.15, 0.85);
  c.setHSL(hsl.h, hsl.s, hsl.l);
  return c;
}

function buildingInfo(p: Record<string, string | undefined>, cat: Category, height: number): BuildingInfo {
  const levels = p["building:levels"] ? parseInt(p["building:levels"], 10) : undefined;
  const addr =
    p["addr:street"] && p["addr:housenumber"]
      ? `${p["addr:street"]} ${p["addr:housenumber"]}, ${p["addr:postcode"] || ""} ${p["addr:city"] || ""}`.trim()
      : undefined;
  return {
    name: p.name || CATEGORY_LABEL[cat],
    type: CATEGORY_LABEL[cat],
    levels: Number.isFinite(levels as number) ? levels : undefined,
    height: Math.round(height * 10) / 10,
    address: addr,
  };
}

/** Erzeugt eine THREE.Shape aus projizierten Ringen (outer + Löcher). */
function shapeFromRings(rings: Vec2[][]): THREE.Shape | null {
  const [outer, ...holes] = rings;
  if (!outer || outer.length < 3) return null;
  const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x, p.y)));
  for (const hole of holes) {
    if (hole.length >= 3) shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y))));
  }
  return shape;
}

export interface BuildingsResult {
  group: THREE.Group;
  meshes: THREE.Mesh[];
}

/**
 * Baut aus der Gebäude-FeatureCollection eine Gruppe extrudierter Meshes.
 * Jedes Gebäude ist ein eigenes Mesh (für Picking), trägt seine Info in userData.
 */
export function buildBuildings(fc: FeatureCollection, proj: Projection): BuildingsResult {
  const group = new THREE.Group();
  group.name = "buildings";
  const meshes: THREE.Mesh[] = [];

  for (const f of fc.features) {
    if (f.geometry.type !== "Polygon") continue;
    const rings = f.geometry.coordinates as number[][][];
    const projected = rings.map((r) => proj.projectRing(r));
    if (projected.length === 0 || ringArea(projected[0]) < MIN_FOOTPRINT_AREA) continue;

    const shape = shapeFromRings(projected);
    if (!shape) continue;

    const seed = projected[0][0].x + projected[0][0].y * 3.3;
    const cat = categorize(f.properties);
    const height = resolveHeight(f.properties, cat, seed);

    let geom: THREE.ExtrudeGeometry;
    try {
      geom = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1 });
    } catch {
      continue; // defekte Geometrie überspringen statt crashen
    }
    geom.rotateX(-Math.PI / 2); // Footprint-Ebene → XZ, Höhe entlang +Y, Norden → -Z
    geom.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: shadeColor(BASE_COLOR[cat], seed),
      roughness: 0.85,
      metalness: 0.0,
      flatShading: false,
    });

    const mesh = new THREE.Mesh(geom, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.info = buildingInfo(f.properties, cat, height);
    mesh.userData.baseColor = (material.color as THREE.Color).getHex();
    group.add(mesh);
    meshes.push(mesh);
  }

  return { group, meshes };
}
