import * as THREE from "three";
import { Projection, hashNoise, ringArea, type Vec2 } from "./geo";
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

// Belag-Farbe je highway-Typ → Bündel mit gemeinsamer Farbe.
const ASPHALT = 0x44474e; // Asphalt (Haupt-/Wohnstraßen)
const SERVICE_COLOR = 0x55585f; // Erschließung
const TRACK_COLOR = 0x9a875f; // Feldweg (Erde)
const PATH_COLOR = 0xb59a6e; // Fuß-/Radweg (heller Kies)
const LINE_COLOR = 0xd8d2bf; // Mittel-/Randlinie

const MAJOR = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);

/** Baut Straßenbänder aus LineStrings, auf das Gelände drapiert. */
export function buildRoads(fc: FeatureCollection, proj: Projection, terrain: TerrainSampler): THREE.Group {
  const group = new THREE.Group();
  group.name = "roads";

  // Positionen nach Belag bündeln (wenige Draw-Calls).
  const asphalt: number[] = [];
  const service: number[] = [];
  const track: number[] = [];
  const path: number[] = [];
  const centerLines: number[] = [];

  for (const f of fc.features) {
    if (f.geometry.type !== "LineString") continue;
    const pts = proj.projectRing(f.geometry.coordinates as number[][]).map(toWorld);
    if (pts.length < 2) continue;
    const hw = f.properties.highway || "";
    const half = roadWidth(hw) / 2;
    let target = asphalt;
    if (hw === "footway" || hw === "path" || hw === "cycleway") target = path;
    else if (hw === "track") target = track;
    else if (hw === "service" || hw === "living_street") target = service;
    emitRibbon(pts, half, target);
    // Mittellinie für größere Straßen
    if (MAJOR.has(hw)) emitRibbon(pts, 0.22, centerLines);
  }

  if (asphalt.length) group.add(ribbonMesh(asphalt, ASPHALT, 0.5, -4, terrain));
  if (service.length) group.add(ribbonMesh(service, SERVICE_COLOR, 0.5, -4, terrain));
  if (track.length) group.add(ribbonMesh(track, TRACK_COLOR, 0.45, -3, terrain));
  if (path.length) group.add(ribbonMesh(path, PATH_COLOR, 0.45, -3, terrain));
  if (centerLines.length) {
    const line = ribbonMesh(centerLines, LINE_COLOR, 0.75, -6, terrain);
    line.renderOrder = 3;
    group.add(line);
  }
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
  parking: 0x9a9690, // Parkplatz
  horse_riding: 0xb39a6a, quarry: 0xcbbd96, // Reitplatz, Sandgrube (Satellitenbild)
  golf_course: 0x6fa85a, fairway: 0x6fb35a, green: 0x57a84e, // Golfplatz Burgwedel
};

// Flächen sind halbtransparente Tönungen ÜBER dem Luftbild (mehr Farbe/Struktur,
// Bild scheint durch). Manche bewirtschafteten Flächen etwas kräftiger.
const AREA_OPACITY: Record<string, number> = {
  forest: 0.5, wood: 0.5, water: 1, pitch: 0.7, sports_centre: 0.7,
  green: 0.7, fairway: 0.6, golf_course: 0.5, cemetery: 0.5, parking: 0.7,
};
const areaOpacity = (key: string) => AREA_OPACITY[key] ?? 0.34;

/**
 * Animiertes Wasser: Fresnel-aufgehellte Tiefe + wandernde Glitzer-Wellen.
 * uTime wird per onBeforeRender selbst aktualisiert (keine Loop-Verdrahtung).
 */
function makeWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(0x274b63) },
        uShallow: { value: new THREE.Color(0x4a86a8) },
        uSky: { value: new THREE.Color(0xbfe0f5) },
      },
    ]),
    side: THREE.DoubleSide,
    fog: true,
    transparent: true,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormalW;
      #include <fog_pars_vertex>
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform vec3 uDeep, uShallow, uSky;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      #include <fog_pars_fragment>
      float wave(vec2 p){
        return sin(p.x*0.35 + uTime*1.1) * 0.5 + sin(p.y*0.27 - uTime*0.8) * 0.5
             + sin((p.x+p.y)*0.5 + uTime*1.7) * 0.4;
      }
      void main(){
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - clamp(dot(viewDir, vNormalW), 0.0, 1.0), 3.0);
        vec3 base = mix(uDeep, uShallow, 0.4 + 0.25 * sin(vWorld.x*0.05));
        vec3 col = mix(base, uSky, clamp(fres*1.3, 0.0, 0.85));
        float w = wave(vWorld.xz);
        float spark = smoothstep(1.1, 1.45, w);          // helle Glitzerkämme
        col += spark * 0.35;
        gl_FragColor = vec4(col, 0.9);
        #include <fog_fragment>
      }
    `,
  });
}

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

    let mesh: THREE.Mesh;
    if (isWater) {
      const mat = makeWaterMaterial();
      mesh = new THREE.Mesh(geom, mat);
      mesh.onBeforeRender = () => { mat.uniforms.uTime.value = performance.now() / 1000; };
    } else {
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.95,
        metalness: 0,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: areaOpacity(key),
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      mesh = new THREE.Mesh(geom, mat);
    }
    mesh.renderOrder = 1;
    mesh.receiveShadow = !isWater;
    group.add(mesh);
    i++;
  }

  return group;
}

// --- Wald: gestreute Baum-Instanzen (InstancedMesh) --------------------------

/** Punkt-in-Polygon (Ray-Casting) im XZ-Raum. */
function pointInRing(x: number, z: number, ring: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, zi = ring[i].y, xj = ring[j].x, zj = ring[j].y;
    if (((zi > z) !== (zj > z)) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

const FOREST_KEYS = new Set(["forest", "wood"]);

/**
 * Streut Bäume als zwei InstancedMeshes (Stamm + Krone) in Wald-Polygone.
 * Dichte ~1 Baum / 220 m², gedeckelt für Performance.
 */
export function buildForestTrees(fc: FeatureCollection, proj: Projection, terrain: TerrainSampler, maxTrees = 9000): THREE.Group {
  const group = new THREE.Group();
  group.name = "forest";

  type Inst = { x: number; z: number; y: number; s: number; rot: number };
  const insts: Inst[] = [];

  for (const f of fc.features) {
    if (f.geometry.type !== "Polygon") continue;
    const key = (f.properties.value || f.properties.kind || "") as string;
    if (!FOREST_KEYS.has(key)) continue;
    const rings = (f.geometry.coordinates as number[][][]).map((r) => proj.projectRing(r).map(toWorld));
    const outer = rings[0];
    if (!outer || outer.length < 3) continue;
    const holes = rings.slice(1);

    // Bounding-Box → Raster mit jitter, Punkt-in-Polygon-Test
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const p of outer) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); minz = Math.min(minz, p.y); maxz = Math.max(maxz, p.y); }
    const area = ringArea(outer);
    const want = Math.min(900, Math.floor(area / 220));
    const step = Math.max(7, Math.sqrt((area / Math.max(1, want))));
    let seed = minx * 0.13 + minz * 0.71;
    for (let x = minx; x < maxx; x += step) {
      for (let z = minz; z < maxz; z += step) {
        seed += 1;
        const jx = x + (hashNoise(seed) - 0.5) * step * 0.9;
        const jz = z + (hashNoise(seed * 1.7) - 0.5) * step * 0.9;
        if (!pointInRing(jx, jz, outer)) continue;
        if (holes.some((h) => pointInRing(jx, jz, h))) continue;
        insts.push({ x: jx, z: jz, y: terrain.sample(jx, -jz), s: 0.7 + hashNoise(seed * 2.3) * 0.8, rot: hashNoise(seed * 3.1) * Math.PI * 2 });
        if (insts.length >= maxTrees) break;
      }
      if (insts.length >= maxTrees) break;
    }
    if (insts.length >= maxTrees) break;
  }

  if (insts.length === 0) return group;

  const trunkGeom = new THREE.CylinderGeometry(0.22, 0.32, 2.4, 5);
  trunkGeom.translate(0, 1.2, 0);
  const crownGeom = new THREE.ConeGeometry(2.2, 6.0, 7);
  crownGeom.translate(0, 5.2, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5e4326, roughness: 1 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x3f6a35, roughness: 0.95 });

  const trunks = new THREE.InstancedMesh(trunkGeom, trunkMat, insts.length);
  const crowns = new THREE.InstancedMesh(crownGeom, crownMat, insts.length);
  trunks.castShadow = crowns.castShadow = true;
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const posv = new THREE.Vector3();
  const crownTint = new THREE.Color();
  for (let i = 0; i < insts.length; i++) {
    const t = insts[i];
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
    scl.set(t.s, t.s, t.s);
    posv.set(t.x, t.y, t.z);
    mtx.compose(posv, q, scl);
    trunks.setMatrixAt(i, mtx);
    crowns.setMatrixAt(i, mtx);
    crownTint.setHSL(0.27 + (hashNoise(i * 5.5) - 0.5) * 0.04, 0.4, 0.3 + hashNoise(i * 7.3) * 0.12);
    crowns.setColorAt(i, crownTint);
  }
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  group.add(trunks, crowns);
  return group;
}

// --- Details: Bäume & Barrieren (Hecken/Mauern/Zäune) ------------------------
const BARRIER_STYLE: Record<string, { color: number; height: number; half: number }> = {
  hedge: { color: 0x4f7a3a, height: 1.6, half: 0.5 },
  wall: { color: 0x9a958c, height: 1.8, half: 0.35 },
  fence: { color: 0x8a7a5c, height: 1.1, half: 0.15 },
  retaining_wall: { color: 0x8f8a80, height: 1.4, half: 0.4 },
};
const barrierStyle = (b?: string) => BARRIER_STYLE[b || ""] ?? { color: 0x8a8a80, height: 1.2, half: 0.25 };

/** Baut Bäume (Kegel) und Barrieren (niedrige vertikale Streifen) auf dem Gelände. */
export function buildDetails(fc: FeatureCollection, proj: Projection, terrain: TerrainSampler): THREE.Group {
  const group = new THREE.Group();
  group.name = "details";

  const trunkGeom = new THREE.CylinderGeometry(0.28, 0.34, 2.2, 6);
  const foliageGeom = new THREE.ConeGeometry(2.6, 5.5, 8);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 1 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x4d7a3e, roughness: 0.95 });

  for (const f of fc.features) {
    if (f.geometry.type === "Point" && f.properties.kind === "tree") {
      const c = f.geometry.coordinates as unknown as number[];
      const p = proj.project(c[0], c[1]);
      const base = terrain.sample(p.x, -p.y);
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeom, trunkMat);
      trunk.position.y = 1.1;
      trunk.castShadow = true;
      const foliage = new THREE.Mesh(foliageGeom, foliageMat);
      foliage.position.y = 4.6;
      foliage.castShadow = true;
      tree.add(trunk, foliage);
      tree.position.set(p.x, base, -p.y);
      group.add(tree);
    } else if (f.geometry.type === "LineString" && f.properties.kind === "barrier") {
      const style = barrierStyle(f.properties.barrier);
      const pts = proj.projectRing(f.geometry.coordinates as number[][]).map(toWorld);
      const mesh = barrierStrip(pts, style, terrain);
      if (mesh) group.add(mesh);
    }
  }
  return group;
}

/** Vertikaler Streifen entlang einer Linie (Hecke/Mauer/Zaun), auf Gelände. */
function barrierStrip(pts: THREE.Vector2[], style: { color: number; height: number }, terrain: TerrainSampler): THREE.Mesh | null {
  if (pts.length < 2) return null;
  const pos: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const ya = terrain.sample(a.x, a.y);
    const yb = terrain.sample(b.x, b.y);
    const h = style.height;
    pos.push(a.x, ya, a.y, a.x, ya + h, a.y, b.x, yb, b.y);
    pos.push(b.x, yb, b.y, a.x, ya + h, a.y, b.x, yb + h, b.y);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geom.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: style.color, roughness: 0.95, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
