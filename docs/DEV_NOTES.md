# Engensen 3D — Entwickler-Notizen

Reines Geo-Daten-Experiment: 3D-Modell der Region um Engensen (PLZ 30938
Burgwedel) mit Live-Daten-Layern.

## Beziehung zum Spiel-Repo

Der frühere Zombie-/AC-130-Spielmodus wurde in ein eigenständiges Repo
ausgelagert: **`horde30938`** (privat, live unter https://horde30938.vercel.app).
Dieses Repo enthält bewusst **kein** Spiel/FLIR mehr — nur die Karte + Live-Daten.
Die Design-/Plan-Dokumente zur Trennung liegen unter
`docs/superpowers/specs/` und `docs/superpowers/plans/`.

## Geodaten (zur Build-Zeit gebacken, `public/data/`)

Reihenfolge wichtig — `fetch-osm` schreibt `meta.json` (bbox), die anderen lesen
sie:

```bash
npm run fetch-osm        # Overpass → *.geojson + meta.json   (RADIUS_M in scripts/fetch-osm.mjs)
npm run fetch-terrain    # Open-Meteo Höhen → terrain.json     (GRID in scripts/fetch-terrain.mjs)
npm run fetch-satellite  # Esri World Imagery → satellite.jpg  (einzelner Export, max 4096 px)
```

- Aktuell `RADIUS_M = 6000` (≈12 km Kante), Terrain `GRID = 64`. Größerer
  Radius ⇒ gröberes Luftbild (4096 px fix) → ggf. GRID anheben.
- `fetch-terrain` braucht wegen Open-Meteo-Rate-Limits mehrere Minuten
  (Retry eingebaut).
- Zentrum: `lat 52.5003028, lon 9.9442798`. Welt: x = Ost, **Norden = −Z**,
  y = Höhe (`geo.ts`).

## Aufbau

`main.ts` lädt die Daten, baut Gelände (Luftbild-Textur), Flächen/Straßen/
Wald-Instanzen, Gebäude (extrudiert mit Sattel-/Walmdächern, Fassaden-Textur),
und rendert über **PostFX** (SSAO/Bloom/SMAA). Live-Layer: `sky` (Sonnenstand/
Tag-Nacht + Nachtfenster), `clouds`, `flights`, `iss`, `weather`, `air`,
`solar`, `poi`, `interaction` (Gebäude-Info). Optionaler Zeitparameter
`?t=ISO` für Vorschau eines Sonnenstands.

## KI-Bildgenerierung (kie.ai)

Falls Texturen/Artwork gebraucht werden (z. B. Luftbild-Ersatz, Sprites):
**kie.ai**. API-Key liegt in `…/shooter/.env` als `KIE_API_KEY` (gitignored,
nicht hierher kopieren). Muster:

- **Flux-Kontext**: `POST api.kie.ai/api/v1/flux/kontext/generate`
  `{prompt, aspectRatio, outputFormat, model:"flux-kontext-max"}` → poll
  `…/record-info?taskId=` → `data.response.resultImageUrl`.
- **Jobs-API** (Nano-Banana/GPT-Image/Grok): `POST …/api/v1/jobs/createTask`
  `{model, input}` → poll `…/jobs/recordInfo` → `data.resultJson.resultUrls[0]`.
  Modelle: `google/nano-banana`, `gpt-image-2-text-to-image`,
  `grok-imagine/text-to-image`.

## Deploy (Vercel)

Bestehendes Projekt „engensen" (Verknüpfung in `.vercel/`, gitignored):
`vercel --prod`. Scope „holger's projects".
