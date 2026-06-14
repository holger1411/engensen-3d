# Engensen 3D

Interaktives 3D-Modell des Ortskerns von **Engensen** (30938 Burgwedel),
direkt im Browser. Gebäude werden aus OpenStreetMap-Grundrissen extrudiert,
dazu Straßen, Grün- und Wasserflächen. Live-Layer zeigen **aktuelle Flüge** in
der Umgebung und das **aktuelle Wetter**.

## Features

- 🏘️ **Echtes 3D-Modell** des Ortskerns aus OSM-Daten (737 Gebäude), mit
  Schatten, Himmel und freier Kamera (drehen / zoomen / schwenken).
- 🖱️ **Klickbare Gebäude** — Info-Panel mit Typ, Höhe, Stockwerken und Adresse.
- ✈️ **Live-Flüge** über OpenSky Network: 3D-Marker am Himmel (Richtung nach
  Kurs, Höhe komprimiert) + maßstabsgetreue Liste mit Distanz, Richtung, Höhe,
  Geschwindigkeit und Land.
- 🌦️ **Live-Wetter** über Open-Meteo (Temperatur, Zustand, Wind, Luftfeuchte).
- 🎨 Farbcodierte Gebäudetypen (Wohnhaus, Hof/Scheune, Feuerwehr, Kapelle …).

## Schnellstart

```bash
npm install
npm run fetch-osm   # OSM-Daten holen und nach public/data/ backen (einmalig)
npm run dev         # Dev-Server auf http://localhost:5173
```

> Die gebackenen GeoJSON-Dateien liegen bereits unter `public/data/`. `fetch-osm`
> ist nur nötig, um sie zu aktualisieren.

### Build & Deploy

```bash
npm run build       # Typecheck + Produktions-Build nach dist/
npm run preview     # Build lokal ansehen
```

Deploybar als statische Seite auf **Vercel**. Der Ordner `api/` enthält eine
Serverless-Function (`/api/flights`), die die OpenSky-Daten server-seitig holt
und so die CORS-Sperre der OpenSky-API umgeht. Im Dev übernimmt ein
Vite-Plugin dieselbe Route.

## Architektur

```
scripts/fetch-osm.mjs   Overpass-API → public/data/*.geojson (Build-Zeit)
api/flights.js          Vercel-Function: OpenSky-Proxy (CORS)
vite.config.ts          Dev-Proxy für /api/flights
src/
  geo.ts                Lon/Lat → lokale Meter-Projektion (+ Tests)
  buildings.ts          Footprints → extrudierte Meshes
  layers.ts             Straßen, Flächen, Boden
  scene.ts              Renderer, Licht, Kamera, Steuerung
  interaction.ts        Raycasting: Hover + Klick
  infoPanel.ts          Gebäude-Info-Overlay
  weather.ts            Open-Meteo-Anbindung
  flights.ts            OpenSky-Anbindung + 3D-Marker
  main.ts               Zusammenbau & Render-Loop
```

### Optional: höheres OpenSky-Limit

Anonym erlaubt OpenSky ~400 Abrufe/Tag. Mit einem (kostenlosen) Konto lässt sich
das erhöhen — als Vercel-Umgebungsvariablen setzen:

```
OPENSKY_USER=...
OPENSKY_PASS=...
```

## Datenquellen & Lizenzen

- **Gebäude/Straßen/Flächen:** © OpenStreetMap-Mitwirkende, [ODbL 1.0](https://www.openstreetmap.org/copyright)
- **Flüge:** [OpenSky Network](https://opensky-network.org/)
- **Wetter:** [Open-Meteo](https://open-meteo.com/) (CC BY 4.0)

## Tests

```bash
npm test            # Vitest: Projektion & Ring-Geometrie
```
