#!/usr/bin/env node
/**
 * Holt ein Höhenraster (DGM) für die Engensen-Bounding-Box über die freie
 * Open-Meteo-Elevation-API und backt es nach public/data/terrain.json.
 * Liest die Box aus der von fetch-osm.mjs erzeugten meta.json.
 *
 *   npm run fetch-terrain
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "public", "data");

const GRID = 24; // 24×24 = 576 Stützpunkte
const API = "https://api.open-meteo.com/v1/elevation";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function batchElevations(lats, lons) {
  const out = [];
  const batches = Math.ceil(lats.length / 100);
  for (let i = 0; i < lats.length; i += 100) {
    const la = lats.slice(i, i + 100).join(",");
    const lo = lons.slice(i, i + 100).join(",");
    const url = `${API}?latitude=${la}&longitude=${lo}`;
    let ok = false;
    for (let attempt = 0; attempt < 6 && !ok; attempt++) {
      try {
        const res = await fetch(url);
        if (res.status === 429) throw new Error("HTTP 429 (Rate-Limit)");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!Array.isArray(json.elevation)) throw new Error("keine elevation");
        out.push(...json.elevation);
        ok = true;
      } catch (err) {
        const wait = 3000 * Math.pow(1.8, attempt);
        console.warn(`  Batch ${i / 100 + 1}/${batches} Versuch ${attempt + 1}: ${err.message} — warte ${Math.round(wait)}ms`);
        await sleep(wait);
      }
    }
    if (!ok) throw new Error("Elevation-Abruf endgültig fehlgeschlagen");
    await sleep(2500); // Abstand zwischen Batches gegen Rate-Limit
  }
  return out;
}

async function main() {
  const meta = JSON.parse(await readFile(join(DATA_DIR, "meta.json"), "utf8"));
  const { south, west, north, east } = meta.bbox;

  const lats = [];
  const lons = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      lats.push(+(south + ((north - south) * i) / (GRID - 1)).toFixed(6));
      lons.push(+(west + ((east - west) * j) / (GRID - 1)).toFixed(6));
    }
  }

  console.log(`→ Hole ${lats.length} Höhenpunkte (${GRID}×${GRID}) …`);
  const elevations = await batchElevations(lats, lons);

  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const center = elevations[Math.floor(elevations.length / 2)];
  console.log(`✓ Höhen: min ${min} m, max ${max} m, Zentrum ${center} m, Relief ${(max - min).toFixed(1)} m`);

  await writeFile(
    join(DATA_DIR, "terrain.json"),
    JSON.stringify({ grid: GRID, bbox: meta.bbox, base: center, min, max, elevations }),
  );
  console.log(`✓ Geschrieben: ${join(DATA_DIR, "terrain.json")}`);
}

main().catch((err) => {
  console.error("FEHLER:", err.message);
  process.exit(1);
});
