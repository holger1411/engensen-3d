import * as THREE from "three";
import { Projection, hashNoise, ringArea, centroid, type Vec2 } from "./geo";
import type { FeatureCollection, BuildingInfo } from "./types";
import type { TerrainSampler } from "./terrain";

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

// --- Farben: OSM-Tags wo vorhanden, sonst regional korrekte Palette ----------

/** Übliche CSS-/OSM-Farbnamen → Hex. */
const NAMED_COLOR: Record<string, number> = {
  red: 0xb0392a, brown: 0x6b4a2f, grey: 0x6a6a6e, gray: 0x6a6a6e,
  white: 0xeeece4, black: 0x33343a, darkred: 0x7d2a20, maroon: 0x6e241c,
  green: 0x4e6b3a, blue: 0x3d5a80, beige: 0xddd0b8, cream: 0xeae0cd,
  sandstone: 0xcdb892, yellow: 0xd8c46a, orange: 0xc26a34, terracotta: 0xa85a3c,
  silver: 0xb8bcc0, anthracite: 0x3a3c42,
};

/** Parst eine OSM-/CSS-Farbe (Hex oder Name). Liefert null bei Unbekannt. */
function parseCssColor(v?: string): THREE.Color | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(s)) return new THREE.Color(s);
  if (s in NAMED_COLOR) return new THREE.Color(NAMED_COLOR[s]);
  return null;
}

/** Dachfarbe aus roof:colour / roof:material, sonst regionale Palette. */
const ROOF_MATERIAL_COLOR: Record<string, number> = {
  tile: 0x9c4a32, tiles: 0x9c4a32, roof_tiles: 0x9c4a32, clay: 0x9c4a32, clay_tile: 0x9c4a32,
  metal: 0x5a5b60, tin: 0x5a5b60, zinc: 0x6a6c72, steel: 0x5e6066,
  slate: 0x3f4248, concrete: 0x7a786f, tar_paper: 0x44444a, asphalt: 0x44444a,
  bitumen: 0x44444a, thatch: 0xb89a5a, eternit: 0x8a8c8f, glass: 0x9fb8cf,
  copper: 0x4e8a72, grass: 0x6f9a4e, gravel: 0x8a8576,
};
const CLAY_ROOFS = [0x9c4a32, 0x8f4530, 0xa85a3c, 0x7d3a2a, 0xb5613f, 0x96492f];
const GREY_ROOFS = [0x55565a, 0x4a4b4f, 0x646468];
const pickFrom = (arr: number[], seed: number) => arr[Math.floor(hashNoise(seed) * arr.length) % arr.length];

function roofColor(p: Record<string, string | undefined>, cat: Category, seed: number): THREE.Color {
  const tagged = parseCssColor(p["roof:colour"]);
  if (tagged) return tagged;
  const mat = p["roof:material"]?.toLowerCase();
  if (mat && ROOF_MATERIAL_COLOR[mat] != null) return shadeColor(ROOF_MATERIAL_COLOR[mat], seed);
  if (cat === "worship") return shadeColor(0x4a4d55, seed); // Schiefer/dunkel
  if (cat === "outbuilding") return shadeColor(pickFrom(GREY_ROOFS, seed * 3.1), seed); // meist Flachdach
  // Norddeutschland: überwiegend rote Tonziegel, ~20 % grau (Metall/Schiefer)
  const base = hashNoise(seed * 3.1) < 0.8 ? pickFrom(CLAY_ROOFS, seed * 4.3) : pickFrom(GREY_ROOFS, seed * 5.7);
  return shadeColor(base, seed * 1.3);
}

const BRICK_WALLS = [0x9c5a44, 0xa86a52, 0x8c4f3c, 0xab6b4a];
const PLASTER_WALLS = [0xe3d9c8, 0xd8cdbb, 0xeae3d6, 0xc9bda6, 0xf0ece3];

function wallColor(p: Record<string, string | undefined>, cat: Category, seed: number): THREE.Color {
  const tagged = parseCssColor(p["building:colour"]);
  if (tagged) return tagged;
  if (cat === "residential" || cat === "farm") {
    // ~35 % Klinker/Backstein, sonst heller Putz
    const palette = hashNoise(seed * 5.1) < 0.35 ? BRICK_WALLS : PLASTER_WALLS;
    return shadeColor(pickFrom(palette, seed * 7.7), seed);
  }
  return shadeColor(BASE_COLOR[cat], seed);
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
export function buildBuildings(fc: FeatureCollection, proj: Projection, terrain: TerrainSampler): BuildingsResult {
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

    // ExtrudeGeometry hat zwei Material-Gruppen: 0 = Deckel (Dach/Boden), 1 = Seiten (Wand).
    const roofMat = new THREE.MeshStandardMaterial({
      color: roofColor(f.properties, cat, seed),
      roughness: 0.6,
      metalness: 0.05,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      color: wallColor(f.properties, cat, seed),
      roughness: 0.88,
      metalness: 0.0,
    });

    const mesh = new THREE.Mesh(geom, [roofMat, wallMat]);
    // Auf die Geländehöhe des Schwerpunkts setzen (Welt-z = -Nord).
    const c = centroid(projected[0]);
    mesh.position.y = terrain.sample(c.x, -c.y) - 0.3; // leicht einsenken, kein Schweben
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.info = buildingInfo(f.properties, cat, height);
    // Nachtbeleuchtung: ~58 % der bewohnbaren Gebäude bekommen warmes Fensterlicht.
    mesh.userData.lit = cat !== "outbuilding" && hashNoise(seed * 9.4) < 0.58;
    mesh.userData.glow = new THREE.Color(0, 0, 0); // aktueller Nacht-Emissivwert
    group.add(mesh);
    meshes.push(mesh);
  }

  return { group, meshes };
}
