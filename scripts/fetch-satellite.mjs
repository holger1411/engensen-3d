#!/usr/bin/env node
/**
 * Holt ein Luftbild (Orthofoto) für die Engensen-Bounding-Box über den frei
 * nutzbaren ArcGIS-„World Imagery"-Export-Endpunkt und legt es als
 * public/data/satellite.jpg ab. Liest die Box aus meta.json (von fetch-osm).
 *
 *   npm run fetch-satellite
 *
 * Das Bild wird im selben linearen lon/lat-Raster wie das Gelände erzeugt
 * (Grad-Rechteck → quadratisches Bild), sodass es in terrain.ts per Standard-
 * UV exakt auf das quadratische Gelände-Mesh passt.
 *
 * Quelle: Esri World Imagery (Maxar, Earthstar Geographics u. a.).
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "public", "data");

const SIZE = 4096; // Kantenlänge in Pixel (ArcGIS-Maximum) → ~1.7 m/px bei 7 km
const SERVICE =
  "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export";

async function main() {
  const meta = JSON.parse(await readFile(join(DATA_DIR, "meta.json"), "utf8"));
  const { south, west, north, east } = meta.bbox;

  // ArcGIS-bbox-Reihenfolge bei SR 4326: xmin,ymin,xmax,ymax = west,south,east,north
  const params = new URLSearchParams({
    bbox: `${west},${south},${east},${north}`,
    bboxSR: "4326",
    imageSR: "4326",
    size: `${SIZE},${SIZE}`,
    format: "jpg",
    f: "image",
  });
  const url = `${SERVICE}?${params}`;

  console.log(`→ Hole Luftbild ${SIZE}×${SIZE} für bbox ${params.get("bbox")} …`);
  let buf = null;
  for (let attempt = 0; attempt < 5 && !buf; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get("content-type") || "";
      const ab = await res.arrayBuffer();
      if (!type.includes("image") || ab.byteLength < 10000) {
        throw new Error(`keine Bilddaten (type=${type}, ${ab.byteLength} B)`);
      }
      buf = Buffer.from(ab);
    } catch (err) {
      const wait = 2000 * Math.pow(1.8, attempt);
      console.warn(`  Versuch ${attempt + 1}: ${err.message} — warte ${Math.round(wait)}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  if (!buf) throw new Error("Luftbild-Abruf endgültig fehlgeschlagen");

  const out = join(DATA_DIR, "satellite.jpg");
  await writeFile(out, buf);
  console.log(`✓ Geschrieben: ${out} (${(buf.length / 1024).toFixed(0)} kB)`);
}

main().catch((err) => {
  console.error("Fehler:", err.message);
  process.exit(1);
});
