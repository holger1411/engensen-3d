#!/usr/bin/env node
/**
 * Holt OpenStreetMap-Daten für den Ortskern von Engensen über die Overpass-API
 * und backt sie als GeoJSON in public/data/. Einmalig zur Build-Zeit auszuführen.
 *
 *   npm run fetch-osm
 *
 * Quelle: © OpenStreetMap-Mitwirkende, ODbL 1.0 (https://www.openstreetmap.org/copyright)
 */
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "data");

// Zentrum Engensen (Nominatim, OSM node 414161264)
const CENTER = { lat: 52.5003028, lon: 9.9442798 };
const RADIUS_M = 2500; // Ort + umgebende Landschaft (Wettmar, Rand Großburgwedel)

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// --- Bounding-Box berechnen ---------------------------------------------------
const dLat = RADIUS_M / 111320;
const dLon = RADIUS_M / (111320 * Math.cos((CENTER.lat * Math.PI) / 180));
const bbox = {
  south: CENTER.lat - dLat,
  west: CENTER.lon - dLon,
  north: CENTER.lat + dLat,
  east: CENTER.lon + dLon,
};
const BBOX = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;

const QUERY = `
[out:json][timeout:120];
(
  way["building"](${BBOX});
  relation["building"](${BBOX});
  way["highway"](${BBOX});
  way["railway"](${BBOX});
  way["landuse"](${BBOX});
  relation["landuse"](${BBOX});
  way["leisure"](${BBOX});
  way["natural"](${BBOX});
  relation["natural"](${BBOX});
  way["amenity"="parking"](${BBOX});
  way["waterway"](${BBOX});
  way["barrier"](${BBOX});
  node["natural"="tree"](${BBOX});
  node["shop"](${BBOX});
  node["amenity"](${BBOX});
  node["tourism"](${BBOX});
  node["office"](${BBOX});
  node["craft"](${BBOX});
  node["healthcare"](${BBOX});
  node["historic"](${BBOX});
  node["leisure"](${BBOX});
  way["shop"](${BBOX});
  way["amenity"](${BBOX});
  way["tourism"](${BBOX});
  way["leisure"]["name"](${BBOX});
);
out geom tags;
`;

// --- Overpass mit Retry/Failover ---------------------------------------------
async function fetchOverpass() {
  let lastErr;
  for (let attempt = 0; attempt < ENDPOINTS.length * 2; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      console.log(`→ Overpass-Abfrage (Versuch ${attempt + 1}) via ${url}`);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "engensen-3d-build/1.0 (OSM data baker)",
        },
        body: "data=" + encodeURIComponent(QUERY),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const json = await res.json();
      if (!json.elements || json.elements.length === 0) {
        throw new Error("Leeres Ergebnis von Overpass");
      }
      console.log(`✓ ${json.elements.length} OSM-Elemente erhalten`);
      return json;
    } catch (err) {
      lastErr = err;
      const wait = 2000 * (attempt + 1);
      console.warn(`✗ Fehlgeschlagen: ${err.message} — warte ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error(`Overpass nicht erreichbar: ${lastErr?.message}`);
}

// --- Geometrie-Helfer ---------------------------------------------------------
const ring = (geometry) => geometry.map((p) => [p.lon, p.lat]); // [lon,lat]
const isClosed = (g) => g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;

/** Stitcht Segment-Listen (aus Multipolygon-Membern) zu geschlossenen Ringen. */
function stitchRings(segments) {
  const rings = [];
  const remaining = segments.map((s) => s.slice());
  while (remaining.length) {
    let current = remaining.shift();
    let extended = true;
    while (extended && !pointsEqual(current[0], current[current.length - 1])) {
      extended = false;
      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i];
        const end = current[current.length - 1];
        if (pointsEqual(end, seg[0])) {
          current = current.concat(seg.slice(1));
          remaining.splice(i, 1); extended = true; break;
        } else if (pointsEqual(end, seg[seg.length - 1])) {
          current = current.concat(seg.slice().reverse().slice(1));
          remaining.splice(i, 1); extended = true; break;
        }
      }
    }
    if (current.length >= 4 && pointsEqual(current[0], current[current.length - 1])) {
      rings.push(current);
    }
  }
  return rings;
}
const pointsEqual = (a, b) => a.lat === b.lat && a.lon === b.lon;

// --- Tag-Auswahl --------------------------------------------------------------
const KEEP_BUILDING = [
  "name", "building", "building:levels", "height", "min_height", "roof:shape",
  "amenity", "shop", "tourism", "religion", "denomination", "historic",
  "addr:street", "addr:housenumber", "addr:postcode", "addr:city",
];
const pick = (tags, keys) => {
  const out = {};
  for (const k of keys) if (tags[k] != null) out[k] = tags[k];
  return out;
};

// --- Klassifizierung & Konvertierung -----------------------------------------
const POI_KEYS = ["shop", "amenity", "tourism", "office", "craft", "healthcare", "historic"];
const SKIP_AMENITY = new Set([
  "parking", "bench", "waste_basket", "recycling", "bicycle_parking", "vending_machine",
  "bbq", "drinking_water", "fountain", "grit_bin", "parking_space", "shelter",
  "hunting_stand", "parking_entrance", "bicycle_repair_station", "telephone", "clock",
]);
const NOTABLE_AMENITY = new Set([
  "place_of_worship", "school", "kindergarten", "fire_station", "restaurant", "cafe",
  "pub", "bar", "fast_food", "bank", "pharmacy", "fuel", "doctors", "dentist",
  "post_office", "townhall", "community_centre", "hospital", "clinic", "library", "veterinary",
]);

/** Extrahiert einen POI (Geschäft / wichtiger Punkt) aus Node oder Way. */
function makePoi(el, tags) {
  let cat = null, val = null;
  for (const k of POI_KEYS) if (tags[k]) { cat = k; val = tags[k]; break; }
  if (!cat && tags.leisure && tags.name) { cat = "leisure"; val = tags.leisure; }
  if (!cat) return null;
  if (cat === "amenity" && SKIP_AMENITY.has(val)) return null;
  // Unbenannte nur behalten, wenn es ein klar wichtiger Amenity-Typ ist
  // (Feuerwehr etc.). Geschäfte/Tourismus/Historic ohne Namen werden verworfen.
  const keepUnnamed = cat === "amenity" && NOTABLE_AMENITY.has(val);
  if (!tags.name && !keepUnnamed) return null;

  let lon, lat;
  if (el.type === "node") { lon = el.lon; lat = el.lat; }
  else if (el.bounds) { lon = (el.bounds.minlon + el.bounds.maxlon) / 2; lat = (el.bounds.minlat + el.bounds.maxlat) / 2; }
  else if (el.geometry && el.geometry.length) { lon = el.geometry[0].lon; lat = el.geometry[0].lat; }
  else return null;

  return feature("Point", [lon, lat], { name: tags.name || "", cat, value: val });
}

function convert(osm) {
  const buildings = [];
  const roads = [];
  const areas = [];
  const details = []; // Bäume (Point), Hecken/Mauern/Zäune (LineString)
  const pois = [];
  const poiSeen = new Set();

  for (const el of osm.elements) {
    const tags = el.tags || {};

    // POIs (Geschäfte / wichtige Punkte) aus Nodes und Ways
    const poi = makePoi(el, tags);
    if (poi) {
      // Dedup: benannte POIs nach Name, unbenannte nach Typ+Position
      const key = poi.properties.name
        ? `n:${poi.properties.name.toLowerCase()}`
        : `${poi.properties.value}|${poi.geometry.coordinates[0].toFixed(3)}|${poi.geometry.coordinates[1].toFixed(3)}`;
      if (!poiSeen.has(key)) { poiSeen.add(key); pois.push(poi); }
    }

    // Bäume → Punkt
    if (el.type === "node" && tags.natural === "tree") {
      details.push(feature("Point", [el.lon, el.lat], { kind: "tree" }));
      continue;
    }
    if (el.type === "node") continue; // Nodes tragen sonst nur POIs/Bäume bei

    // Gebäude: geschlossene ways oder multipolygon-relations
    if (tags.building) {
      const polys = polygonsFromElement(el);
      for (const coords of polys) {
        buildings.push(feature("Polygon", coords, pick(tags, KEEP_BUILDING)));
      }
      continue;
    }

    // Barrieren (Hecke, Mauer, Zaun) → LineString
    if (el.type === "way" && tags.barrier && el.geometry) {
      details.push(feature("LineString", ring(el.geometry), { kind: "barrier", barrier: tags.barrier }));
      continue;
    }

    // Straßen / Wege / Schienen → LineString
    if (el.type === "way" && (tags.highway || tags.railway) && el.geometry) {
      roads.push(feature("LineString", ring(el.geometry), {
        highway: tags.highway, railway: tags.railway, name: tags.name,
      }));
      continue;
    }

    // Wasserwege → LineString
    if (el.type === "way" && tags.waterway && el.geometry) {
      areas.push(feature("LineString", ring(el.geometry), {
        kind: "waterway", waterway: tags.waterway, name: tags.name,
      }));
      continue;
    }

    // Parkplätze → Fläche
    if (tags.amenity === "parking") {
      for (const coords of polygonsFromElement(el)) {
        areas.push(feature("Polygon", coords, { kind: "amenity", value: "parking", name: tags.name }));
      }
      continue;
    }

    // Flächen: landuse / leisure / natural → Polygon
    const areaKind = tags.landuse ? "landuse" : tags.leisure ? "leisure" : tags.natural ? "natural" : null;
    if (areaKind) {
      const polys = polygonsFromElement(el);
      for (const coords of polys) {
        areas.push(feature("Polygon", coords, {
          kind: areaKind, value: tags[areaKind], name: tags.name,
        }));
      }
    }
  }

  return { buildings, roads, areas, details, pois };
}

/** Liefert eine Liste von Polygon-Koordinaten ([ [ [lon,lat]... ] ]) für ein Element. */
function polygonsFromElement(el) {
  if (el.type === "way" && el.geometry && isClosed(el.geometry)) {
    return [[ring(el.geometry)]];
  }
  if (el.type === "relation" && Array.isArray(el.members)) {
    const outerSegs = el.members
      .filter((m) => m.role !== "inner" && m.geometry)
      .map((m) => m.geometry);
    const innerSegs = el.members
      .filter((m) => m.role === "inner" && m.geometry)
      .map((m) => m.geometry);
    const outerRings = stitchRings(outerSegs);
    const innerRings = stitchRings(innerSegs);
    // Jede äußere Ring wird zu einem Polygon; innere Ringe als Löcher anhängen
    return outerRings.map((outer) => {
      const poly = [ring(outer)];
      for (const inner of innerRings) poly.push(ring(inner));
      return poly;
    });
  }
  return [];
}

function feature(type, coordinates, properties) {
  return { type: "Feature", properties, geometry: { type, coordinates } };
}
const collection = (features) => ({ type: "FeatureCollection", features });

// --- Hauptprogramm ------------------------------------------------------------
async function main() {
  const osm = await fetchOverpass();
  const { buildings, roads, areas, details, pois } = convert(osm);

  if (buildings.length === 0) {
    throw new Error("Keine Gebäude gefunden — Abbruch (Daten unbrauchbar).");
  }
  const trees = details.filter((d) => d.properties.kind === "tree").length;
  console.log(`✓ Konvertiert: ${buildings.length} Gebäude, ${roads.length} Wege, ${areas.length} Flächen, ${details.length} Details (${trees} Bäume), ${pois.length} POIs`);
  const named = pois.filter((p) => p.properties.name).slice(0, 20).map((p) => p.properties.name);
  console.log(`  POI-Beispiele: ${named.join(", ")}`);

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "buildings.geojson"), JSON.stringify(collection(buildings)));
  await writeFile(join(OUT_DIR, "roads.geojson"), JSON.stringify(collection(roads)));
  await writeFile(join(OUT_DIR, "areas.geojson"), JSON.stringify(collection(areas)));
  await writeFile(join(OUT_DIR, "details.geojson"), JSON.stringify(collection(details)));
  await writeFile(join(OUT_DIR, "pois.geojson"), JSON.stringify(collection(pois)));
  await writeFile(join(OUT_DIR, "meta.json"), JSON.stringify({
    center: CENTER, bbox, radius_m: RADIUS_M,
    generated: "build-time",
    source: "© OpenStreetMap contributors, ODbL 1.0",
    counts: { buildings: buildings.length, roads: roads.length, areas: areas.length, details: details.length, trees, pois: pois.length },
  }, null, 2));

  console.log(`✓ Geschrieben nach ${OUT_DIR}`);
}

main().catch((err) => {
  console.error("FEHLER:", err.message);
  process.exit(1);
});
