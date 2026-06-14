# Interaktives 3D-Modell Engensen (Ortskern) — Design

**Datum:** 2026-06-14
**Status:** Genehmigt

## Ziel

Ein im Browser laufendes, frei navigierbares 3D-Modell des Ortskerns von
Engensen (30938 Burgwedel). Gebäude werden aus OpenStreetMap-Grundrissen
extrudiert. Klick auf ein Gebäude öffnet ein Info-Panel mit Name, Typ,
Stockwerken und Adresse.

## Entscheidungen (aus Brainstorming)

- **Detailgrad/Datenquelle:** OSM-„Klötzchenstadt" — extrudierte Gebäudegrundrisse.
- **Umfang:** Ortskern (Zentrum Engensen, Radius ~600 m).
- **Zweck:** Interaktiv mit Infos (anklickbare Gebäude, Popups).
- **Tech:** Three.js + Vite + TypeScript. Statisches Deployment (Vercel).

## Geodaten-Anker

- Zentrum Engensen: **lat 52.5003028, lon 9.9442798** (Nominatim, OSM node 414161264).
- Bounding-Box: quadratisch ~1200 m Kantenlänge um das Zentrum.

## Architektur — zwei Stufen

### 1. Daten-Pipeline (Build-Zeit, einmalig)

`scripts/fetch-osm.mjs`:
- Fragt die **Overpass-API** für die Bounding-Box ab.
- Holt: Gebäude (`building`, `building:levels`, `height`, `name`, `amenity`,
  `addr:*`), Straßen (`highway`), Grünflächen (`landuse`, `leisure`, `natural`),
  Wasser (`natural=water`, `water`).
- Konvertiert OSM ways/relations → GeoJSON-FeatureCollections.
- Speichert nach `public/data/buildings.geojson`, `roads.geojson`,
  `areas.geojson` plus `meta.json` (Zentrum, bbox).
- Robustheit: Retry mit Backoff, Validierung auf nicht-leeres Ergebnis,
  lauter Abbruch bei Fehler.

### 2. Frontend (Three.js)

Lädt GeoJSON, projiziert Lon/Lat → lokale Meter (equirektangulär um Zentrum),
baut die Szene.

**Module:**
- `geo.ts` — Projektion Lon/Lat → Meter; Ring-Fläche/Schwerpunkt. (+ Unit-Tests)
- `buildings.ts` — Footprints via `ExtrudeGeometry`. Höhe = `height`-Tag, sonst
  `levels × 3 m`, sonst Default 6 m. Farbe nach Typ.
- `layers.ts` — Straßen als flache Bänder, Grün-/Wasserflächen als Flächen,
  Bodenplatte.
- `scene.ts` — Renderer, Licht (Ambient + Sonne mit Schatten), Himmel/Fog,
  `OrbitControls`.
- `interaction.ts` — Raycasting: Hover-Highlight, Klick → Info-Panel.
- `infoPanel.ts` — HTML-Overlay mit Eigenschaften.
- `main.ts` — Setup + Render-Loop.

Gelände bleibt flach (Engensen topografisch flach → YAGNI).

## Datenfluss

Overpass → GeoJSON (gebacken in `public/data/`) → fetch im Browser → Projektion
→ Three-Meshes → Render. Klick → Raycast → Properties → Panel.

## Fehlerbehandlung

- Fetch-Skript: Retry/Backoff, Leer-Check, lauter Abbruch.
- Frontend: fehlende Höhen → Defaults; defekte/leere Geometrien werden
  übersprungen, nicht gecrasht.

## Testing

- Unit-Tests `geo.ts`: bekannte Koordinaten → erwartete Meter/Distanzen.
- Geometrie: Footprint → plausible Fläche / Vertexzahl.
- Daten-Validierung: gebackenes GeoJSON >0 Gebäude mit Pflichtfeldern.
- Visuelle Kontrolle im Browser.

## Deployment

Statischer Vite-Build, deploybar auf Vercel.

## Bewusst weggelassen (YAGNI)

- Echte Topografie/Gelände.
- Fotorealistische Texturen/Google 3D Tiles.
- Bäume/Straßenmöblierung (optionale spätere Erweiterung).
