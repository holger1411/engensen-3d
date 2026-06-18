import * as THREE from "three";
import { Projection, hashNoise, ringArea, centroid, type Vec2 } from "./geo";
import type { FeatureCollection, BuildingInfo } from "./types";
import type { TerrainSampler } from "./terrain";

const LEVEL_HEIGHT = 3; // m pro Stockwerk
const MIN_FOOTPRINT_AREA = 4; // m² — winzige Artefakte verwerfen
const FACADE_TILE_W = 3.4; // m je Fenster-Achse (horizontale Kachelung)
const FACADE_TILE_H = 3.0; // m je Stockwerk (vertikale Kachelung)

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

// --- Fassaden-Texturen (Fenster/Türen) ---------------------------------------
// Eine geteilte, kachelbare Kachel (eine Fenster-Achse × ein Stockwerk).
// Die hellen Wandflächen werden mit der Gebäude-Grundfarbe multipliziert; das
// Glas erscheint dunkel-recessed. Eine zweite Maske leuchtet nachts nur im Glas.
let FACADE_CACHE: { facade: THREE.Texture; mask: THREE.Texture; black: THREE.Texture } | null = null;

function makeFacadeTextures(): { facade: THREE.Texture; mask: THREE.Texture; black: THREE.Texture } {
  if (FACADE_CACHE) return FACADE_CACHE;
  const S = 128;
  // Fenster-Geometrie innerhalb der Kachel (0..1)
  const wx0 = 0.26, wx1 = 0.74, wy0 = 0.22, wy1 = 0.82; // Glasfläche
  const fr = 0.035; // Rahmenbreite

  // 1) Fassade (Farb-Map): helle Wand + dunkles Glas + heller Rahmen + Sprosse
  const fc = document.createElement("canvas");
  fc.width = fc.height = S;
  const g = fc.getContext("2d")!;
  g.fillStyle = "#d2cdc2"; // helle Wand (wird mit Gebäudefarbe multipliziert)
  g.fillRect(0, 0, S, S);
  g.fillStyle = "#ece7dc"; // Rahmen
  g.fillRect(wx0 * S, wy0 * S, (wx1 - wx0) * S, (wy1 - wy0) * S);
  g.fillStyle = "#33414f"; // Glas (kühl, dunkel)
  g.fillRect((wx0 + fr) * S, (wy0 + fr) * S, (wx1 - wx0 - 2 * fr) * S, (wy1 - wy0 - 2 * fr) * S);
  g.strokeStyle = "#dcd6ca"; // Sprosse (Kreuz)
  g.lineWidth = Math.max(1, S * 0.012);
  g.beginPath();
  g.moveTo(((wx0 + wx1) / 2) * S, (wy0 + fr) * S);
  g.lineTo(((wx0 + wx1) / 2) * S, (wy1 - fr) * S);
  g.moveTo((wx0 + fr) * S, ((wy0 + wy1) / 2) * S);
  g.lineTo((wx1 - fr) * S, ((wy0 + wy1) / 2) * S);
  g.stroke();
  const facade = new THREE.CanvasTexture(fc);
  facade.colorSpace = THREE.SRGBColorSpace;

  // 2) Fenstermaske (Emissive-Map): nur Glas hell → leuchtet nachts
  const mc = document.createElement("canvas");
  mc.width = mc.height = S;
  const m = mc.getContext("2d")!;
  m.fillStyle = "#000000";
  m.fillRect(0, 0, S, S);
  m.fillStyle = "#fff2d8"; // warmes Fensterlicht
  m.fillRect((wx0 + fr) * S, (wy0 + fr) * S, (wx1 - wx0 - 2 * fr) * S, (wy1 - wy0 - 2 * fr) * S);
  const mask = new THREE.CanvasTexture(mc);
  mask.colorSpace = THREE.SRGBColorSpace;

  // 3) 1×1 schwarz (Dach bekommt keine Emissive-Glut)
  const bc = document.createElement("canvas");
  bc.width = bc.height = 1;
  const b = bc.getContext("2d")!;
  b.fillStyle = "#000000";
  b.fillRect(0, 0, 1, 1);
  const black = new THREE.CanvasTexture(bc);

  for (const t of [facade, mask]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  FACADE_CACHE = { facade, mask, black };
  return FACADE_CACHE;
}

// --- Geometrie: Wände + geneigte Dächer --------------------------------------

/** Footprint-Punkt (y=Nord) → Welt-XZ (Norden → −Z). */
const worldXZ = (p: Vec2): THREE.Vector2 => new THREE.Vector2(p.x, -p.y);

interface MeshArrays {
  pos: number[];
  uv: number[];
}
const tri = (a: number[], b: number[], c: number[], out: MeshArrays, uvA: number[], uvB: number[], uvC: number[]) => {
  out.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  out.uv.push(uvA[0], uvA[1], uvB[0], uvB[1], uvC[0], uvC[1]);
};

/** Senkrechte Wandflächen entlang eines geschlossenen Rings (0 → eaveH). */
function emitWalls(ring: THREE.Vector2[], eaveH: number, out: MeshArrays): void {
  let cum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = a.distanceTo(b);
    if (len < 1e-4) continue;
    const u0 = cum / FACADE_TILE_W;
    const u1 = (cum + len) / FACADE_TILE_W;
    const v1 = eaveH / FACADE_TILE_H;
    const a0 = [a.x, 0, a.y], b0 = [b.x, 0, b.y];
    const a1 = [a.x, eaveH, a.y], b1 = [b.x, eaveH, b.y];
    tri(a0, b0, b1, out, [u0, 0], [u1, 0], [u1, v1]);
    tri(a0, b1, a1, out, [u0, 0], [u1, v1], [u0, v1]);
    cum += len;
  }
}

/** Orientiertes Bounding-Rechteck (Min-Fläche) über Winkel-Abtastung. */
function obb(ring: THREE.Vector2[]): { c: THREE.Vector2; u: THREE.Vector2; v: THREE.Vector2; hu: number; hv: number; fill: number } {
  let best = { area: Infinity, ang: 0, minx: 0, maxx: 0, miny: 0, maxy: 0 };
  for (let k = 0; k < 30; k++) {
    const ang = (k / 30) * (Math.PI / 2);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const p of ring) {
      const x = p.x * ca + p.y * sa;
      const y = -p.x * sa + p.y * ca;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
    const area = (maxx - minx) * (maxy - miny);
    if (area < best.area) best = { area, ang, minx, maxx, miny, maxy };
  }
  const ca = Math.cos(best.ang), sa = Math.sin(best.ang);
  // Rück-Rotation der Achsen in Weltkoordinaten: lokal→Welt = R(+ang)
  const ux = ca, uy = sa; // lokale +x-Achse in Welt
  const vx = -sa, vy = ca; // lokale +y-Achse in Welt
  const cxLocal = (best.minx + best.maxx) / 2;
  const cyLocal = (best.miny + best.maxy) / 2;
  const c = new THREE.Vector2(cxLocal * ca - cyLocal * sa, cxLocal * sa + cyLocal * ca);
  let w = best.maxx - best.minx;
  let h = best.maxy - best.miny;
  // u = lange Achse
  let u = new THREE.Vector2(ux, uy), v = new THREE.Vector2(vx, vy), hu = w / 2, hv = h / 2;
  if (h > w) { u = new THREE.Vector2(vx, vy); v = new THREE.Vector2(ux, uy); hu = h / 2; hv = w / 2; }
  return { c, u, v, hu, hv, fill: best.area > 0 ? ringArea(ring) / best.area : 0 };
}

type RoofShape = "flat" | "gabled" | "hipped";

function roofShape(p: Record<string, string | undefined>, cat: Category, fill: number): RoofShape {
  const tag = (p["roof:shape"] || "").toLowerCase();
  if (tag === "flat") return "flat";
  if (["gabled", "gambrel", "round", "skillion", "saltbox"].includes(tag)) return "gabled";
  if (["hipped", "half-hipped", "pyramidal", "mansard", "dome", "conical"].includes(tag)) return "hipped";
  if (cat === "outbuilding") return "flat";
  if (cat === "worship") return "hipped"; // Spitzdach/Turm
  // ohne Tag: rechteckig → Satteldach, sonst Walmdach
  return fill > 0.72 ? "gabled" : "hipped";
}

/** Satteldach über dem orientierten Rechteck (mit kleinem Überstand). */
function emitGableRoof(o: ReturnType<typeof obb>, eaveH: number, rh: number, out: MeshArrays): void {
  const ov = 0.4; // Dachüberstand m
  const hu = o.hu + ov, hv = o.hv + ov;
  const C = o.c, u = o.u, v = o.v;
  const P = (su: number, sv: number, y: number) => [C.x + u.x * hu * su + v.x * hv * sv, y, C.y + u.y * hu * su + v.y * hv * sv];
  const ridgeY = eaveH + rh;
  const Pmp = P(-1, 1, eaveH), Ppp = P(1, 1, eaveH), Pmm = P(-1, -1, eaveH), Ppm = P(1, -1, eaveH);
  const Rp = [C.x + u.x * hu, ridgeY, C.y + u.y * hu];
  const Rm = [C.x - u.x * hu, ridgeY, C.y - u.y * hu];
  const z: number[] = [0, 0];
  // Traufseiten (+v / −v)
  tri(Pmp, Ppp, Rp, out, z, z, z); tri(Pmp, Rp, Rm, out, z, z, z);
  tri(Ppm, Pmm, Rm, out, z, z, z); tri(Ppm, Rm, Rp, out, z, z, z);
  // Giebel (+u / −u)
  tri(Ppp, Ppm, Rp, out, z, z, z);
  tri(Pmm, Pmp, Rm, out, z, z, z);
}

/** Walmdach/Pyramide: jede Außenkante zur Firstspitze über dem Schwerpunkt. */
function emitHipRoof(ring: THREE.Vector2[], cWorld: THREE.Vector2, eaveH: number, rh: number, out: MeshArrays): void {
  const apex = [cWorld.x, eaveH + rh, cWorld.y];
  const z: number[] = [0, 0];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    tri([a.x, eaveH, a.y], [b.x, eaveH, b.y], apex, out, z, z, z);
  }
}

/** Flaches Dach (Deckel) als Triangle-Fan über dem Ring. */
function emitFlatRoof(ring: THREE.Vector2[], cWorld: THREE.Vector2, eaveH: number, out: MeshArrays): void {
  const ctr = [cWorld.x, eaveH, cWorld.y];
  const z: number[] = [0, 0];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    tri([a.x, eaveH, a.y], [b.x, eaveH, b.y], ctr, out, z, z, z);
  }
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
  const tex = makeFacadeTextures();

  for (const f of fc.features) {
    if (f.geometry.type !== "Polygon") continue;
    const rings = f.geometry.coordinates as number[][][];
    const projected = rings.map((r) => proj.projectRing(r));
    if (projected.length === 0 || ringArea(projected[0]) < MIN_FOOTPRINT_AREA) continue;

    // Ringe → Welt-XZ; Außenring konsistent orientieren (für saubere Dächer).
    const worldRings = projected.map((r) => r.map(worldXZ));
    const outer = worldRings[0];
    if (outer.length < 3) continue;

    const seed = projected[0][0].x + projected[0][0].y * 3.3;
    const cat = categorize(f.properties);
    const eaveH = resolveHeight(f.properties, cat, seed);

    // --- Wände (Außenring + Innenhöfe) ---
    const arr: MeshArrays = { pos: [], uv: [] };
    for (const ring of worldRings) if (ring.length >= 3) emitWalls(ring, eaveH, arr);
    const wallVertCount = arr.pos.length / 3;

    // --- Dach ---
    const o = obb(outer);
    const shape = roofShape(f.properties, cat, o.fill);
    const cWorld = new THREE.Vector2(outer.reduce((s, p) => s + p.x, 0) / outer.length, outer.reduce((s, p) => s + p.y, 0) / outer.length);
    if (shape === "flat") {
      emitFlatRoof(outer, cWorld, eaveH, arr);
    } else if (shape === "gabled") {
      const rh = THREE.MathUtils.clamp(o.hv * Math.tan(THREE.MathUtils.degToRad(34)), 1.6, 5.5);
      emitGableRoof(o, eaveH, rh, arr);
    } else {
      const minHalf = Math.min(o.hu, o.hv);
      const steep = cat === "worship" ? 1.0 : 0.55; // Kirchturm steiler
      const rh = THREE.MathUtils.clamp(minHalf * steep, 1.4, cat === "worship" ? 14 : 5);
      emitHipRoof(outer, cWorld, eaveH, rh, arr);
    }
    const roofVertCount = arr.pos.length / 3 - wallVertCount;
    if (wallVertCount + roofVertCount < 3) continue;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(arr.pos, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(arr.uv, 2));
    geom.computeVertexNormals();
    // Materialgruppen: 0 = Dach, 1 = Wand (Reihenfolge wie Material-Array).
    geom.addGroup(0, wallVertCount, 1);
    geom.addGroup(wallVertCount, roofVertCount, 0);

    const roofMat = new THREE.MeshStandardMaterial({
      color: roofColor(f.properties, cat, seed),
      roughness: 0.62,
      metalness: 0.05,
      emissiveMap: tex.black, // Dach glüht nachts NICHT
      side: THREE.DoubleSide,
    });
    const plainWall = cat === "outbuilding";
    const wallMat = new THREE.MeshStandardMaterial({
      color: wallColor(f.properties, cat, seed),
      roughness: 0.9,
      metalness: 0.0,
      map: plainWall ? null : tex.facade,
      emissiveMap: plainWall ? tex.black : tex.mask, // nur Fenster leuchten nachts
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geom, [roofMat, wallMat]);
    const c = centroid(projected[0]);
    mesh.position.y = terrain.sample(c.x, -c.y) - 0.3;
    const near = Math.hypot(c.x, c.y) < 1500;
    mesh.castShadow = near;
    mesh.receiveShadow = near;
    mesh.userData.info = buildingInfo(f.properties, cat, eaveH);
    mesh.userData.lit = !plainWall && hashNoise(seed * 9.4) < 0.62;
    mesh.userData.glow = new THREE.Color(0, 0, 0);
    group.add(mesh);
    meshes.push(mesh);
  }

  return { group, meshes };
}
