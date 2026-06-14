import * as THREE from "three";
import { Projection, hashNoise, type Vec2 } from "./geo";
import type { FeatureCollection } from "./types";
import type { TerrainSampler } from "./terrain";

/** Wandelt einen projizierten 2D-Punkt (y=Nord) in Welt-XZ um (Norden → -Z). */
const toWorld = (p: Vec2): THREE.Vector2 => new THREE.Vector2(p.x, -p.y);

// --- Straßenbreiten je highway-Typ -------------------------------------------
const ROAD_WIDTH: Record<string, number> = {
  motorway: 12, trunk: 11, primary: 9, secondary: 8, tertiary: 7,
  unclassified: 5, residential: 5, living_street: 4.5, service: 3.5,
  track: 3, footway: 1.6, path: 1.4, cycleway: 2, pedestrian: 4,
};
const roadWidth = (t?: string) => ROAD_WIDTH[t || ""] ?? 4;

const ROAD_COLOR = 0x40434a;
const PATH_COLOR = 0x8a7a5c;

/** Baut Straßenbänder aus LineStrings, auf das Gelände drapiert. */
export function buildRoads(fc: FeatureCollection, proj: Projection, terrain: TerrainSampler): THREE.Group {
  const group = new THREE.Group();
  group.name = "roads";

  const positions: number[] = [];
  const pathPositions: number[] = [];

  for (const f of fc.features) {
    if (f.geometry.type !== "LineString") continue;
    const pts = proj.projectRing(f.geometry.coordinates as number[][]).map(toWorld);
    if (pts.length < 2) continue;
    const hw = f.properties.highway;
    const isPath = hw === "footway" || hw === "path" || hw === "cycleway" || hw === "track";
    const half = roadWidth(hw) / 2;
    const target = isPath ? pathPositions : positions;
    emitRibbon(pts, half, target);
  }

  if (positions.length) group.add(ribbonMesh(positions, ROAD_COLOR, 0.5, -4, terrain));
  if (pathPositions.length) group.add(ribbonMesh(pathPositions, PATH_COLOR, 0.45, -3, terrain));
  return group;
}

/** Erzeugt Dreiecke für ein Band entlang eines Polylinienzugs. */
function emitRibbon(pts: THREE.Vector2[], half: number, out: number[]): void {
  // Pro Segment ein Quad mit konstanter Breite (einfaches, robustes Verfahren).
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 1e-4) continue;
    dir.divideScalar(len);
    const nrm = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(half);
    const a1 = a.clone().add(nrm), a2 = a.clone().sub(nrm);
    const b1 = b.clone().add(nrm), b2 = b.clone().sub(nrm);
    // zwei Dreiecke (a1,a2,b1) (b1,a2,b2)
    pushXZ(out, a1); pushXZ(out, a2); pushXZ(out, b1);
    pushXZ(out, b1); pushXZ(out, a2); pushXZ(out, b2);
  }
}
const pushXZ = (out: number[], v: THREE.Vector2) => out.push(v.x, 0, v.y);

function ribbonMesh(positions: number[], color: number, y: number, offset: number, terrain: TerrainSampler): THREE.Mesh {
  // Höhe pro Vertex aus dem Gelände sampeln, damit Straßen den Hügeln folgen.
  for (let k = 0; k < positions.length; k += 3) {
    positions[k + 1] = terrain.sample(positions[k], positions[k + 2]) + y;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.95, metalness: 0, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = 2;
  mesh.receiveShadow = true;
  return mesh;
}

// --- Flächen (Grün / Wasser / Wald) ------------------------------------------
// Bewusst ohne großflächige „Slab"-Flächen (residential/farmyard/construction),
// die unter dem ganzen Ort liegen und Z-Fighting verursachen.
const AREA_COLORS: Record<string, number> = {
  forest: 0x4a6b3a, wood: 0x4a6b3a, scrub: 0x6e7d4a, grass: 0x7faa56,
  meadow: 0x86b35a, farmland: 0xc9b772, orchard: 0x6f9a4e,
  cemetery: 0x6f8a5f, recreation_ground: 0x7faa56, village_green: 0x86b35a,
  pitch: 0x5b9e5b, playground: 0xb88a4a, sports_centre: 0x5b9e5b,
  park: 0x7faa56, garden: 0x86b35a, water: 0x4a7fb0, heath: 0x9a8f5a,
};

/** Baut eingefärbte Flächen aus Polygonen, auf das Gelände drapiert. */
export function buildAreas(fc: FeatureCollection, proj: Projection, terrain: TerrainSampler): THREE.Group {
  const group = new THREE.Group();
  group.name = "areas";

  let i = 0;
  for (const f of fc.features) {
    if (f.geometry.type !== "Polygon") continue;
    const key = (f.properties.value || f.properties.kind || "") as string;
    const color = AREA_COLORS[key];
    if (color == null) continue;

    const rings = (f.geometry.coordinates as number[][][]).map((r) => proj.projectRing(r).map(toWorld));
    const [outer, ...holes] = rings;
    if (!outer || outer.length < 3) continue;

    const shape = new THREE.Shape(outer);
    for (const h of holes) if (h.length >= 3) shape.holes.push(new THREE.Path(h));

    let geom: THREE.ShapeGeometry;
    try {
      geom = new THREE.ShapeGeometry(shape);
    } catch {
      continue;
    }
    geom.rotateX(Math.PI / 2); // Shape liegt in XY → in XZ-Ebene drehen
    const isWater = key === "water";
    // Höhe pro Vertex aus dem Gelände + kleiner deterministischer Versatz gegen Z-Fighting.
    const yOff = 0.05 + hashNoise(i * 2.3) * 0.4 + (isWater ? 0.2 : 0);
    const pos = geom.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) {
      pos.setY(v, terrain.sample(pos.getX(v), pos.getZ(v)) + yOff);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: isWater ? 0.3 : 0.95,
      metalness: isWater ? 0.1 : 0,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = 1;
    mesh.receiveShadow = true;
    group.add(mesh);
    i++;
  }

  return group;
}
