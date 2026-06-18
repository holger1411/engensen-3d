# Design: Engensen-Geo-Experiment ↔ Zombie-Spiel trennen

**Datum:** 2026-06-18
**Status:** abgenommen (Design)

## Ziel

Das Geo-Daten-Experiment „Engensen" und den Zombie-/FLIR-Spielmodus in zwei
eigenständige Projekte trennen:

- **`engensen`** (bestehendes Repo) → zurück zum reinen 3D-Geo-Experiment mit
  Live-Daten.
- **`horde30938`** (neues, privates Repo) → eigenständiges Spiel-Projekt
  **„Horde30938"**, das ab hier unabhängig weiterentwickelt wird.

**Spieltitel:** Horde30938
**Hintergrundstory:** Eine große Horde von Zombies überfällt das PLZ-Gebiet
30938 (Burgwedel) — die Dörfer Engensen, Thönse, Oldhorst, Wettmar und Lahberg.
Aus einer AC-130-„Spectre" verteidigst du die Bevölkerung gegen die anrückende
Horde.

Beide Projekte werden getrennt gepflegt; das gemeinsame Karten-Fundament wird
**dupliziert**, nicht als geteiltes Package ausgelagert (bewusst kein Monorepo —
echte Eigenständigkeit ist gewünscht).

## Methode des „Fork"

Kein server-seitiger GitHub-Fork (würde Experiment-Ballast und verwobene History
mitschleppen). Stattdessen sauberer Neustart:

1. Aktuellen Arbeitsstand (ohne `.git`, `node_modules`, `.vercel`, `dist`) in ein
   neues Schwester-Verzeichnis `../horde30938` kopieren.
2. Dort `git init`, Bereinigung + Rebranding (siehe unten), `npm install`,
   `tsc` + `vitest` + kurzer Browser-Check.
3. Erst nach erfolgreichem lokalen Bauen/Testen:
   `gh repo create holger1411/horde30938 --private --source=. --push`.

So hat das Spiel eine klare eigene History ab Initial-Commit.

## Gemeinsames Fundament (in beide Repos)

Wird in beiden Repos vorhanden sein und danach getrennt gepflegt:

`scene.ts · geo.ts · types.ts · terrain.ts · buildings.ts · layers.ts`
(inkl. Wald-Instanzen & Wasser-Shader) `· postfx.ts · public/data/*`
(inkl. `satellite.jpg`, `terrain.json`, GeoJSON).

## Repo `horde30938` (neues Spiel)

**Behalten:** Fundament + `flir.ts` + `src/game/*` + **Atmosphäre**: `sky.ts`
(Tag/Nacht-Licht, Sonne, Nachtfenster-Glühen) und `clouds.ts`.

**Entfernen** (Module + Verdrahtung in `main.ts` + DOM in `index.html` + CSS):

- Live-Layer: `flights.ts`, `iss.ts`, `weather.ts`, `air.ts`, `solar.ts`
- zugehörige UI: `#flights-panel`, `#iss-badge`, `#solar-badge`, `#air-badge`,
  `#weather`
- Gebäude-Interaktion: `interaction.ts`, `infoPanel.ts`, `#info-panel`
- Geo-Labels: `poi.ts` (im FLIR ohnehin ausgeblendet, experiment-lastig)

**Rebranding:**

- `package.json`: `name` → `horde30938`, `description` mit Story (Horde im
  PLZ-Gebiet 30938)
- `index.html`: `<title>` → „Horde30938"; Topbar-Titel auf den Spielnamen
  (+ knappe Story-Zeile) anpassen
- `README.md`: neues Spiel-README
- `.vercel/` wird **nicht** mitkopiert (eigene Verknüpfung später)

**Tests:** `src/game/weapons.test.ts`, `projectiles.test.ts`, `zombies.test.ts`
ziehen mit um; `geo.test.ts` ebenfalls (Fundament).

**Spiel-eigene Assets:** `public/splash.jpg` (KI-generiertes Titelbild via
kie.ai Flux-Kontext) und `scripts/gen-splash.mjs` (Regenerierung). Diese liegen
aktuell im `engensen`-Arbeitsbaum und werden beim Split ins Spiel-Repo
übernommen und im Original wieder entfernt.

## Splash-/Titelscreen (Horde30938)

Beim Laden des Spiels erscheint ein Vollbild-Titelscreen:

- Hintergrund: `public/splash.jpg` (AC-130 über dem Dorf).
- Titel „HORDE30938" + kurze Story-Zeile (Horde überfällt PLZ-Gebiet 30938).
- „Spiel starten"-Button. Klick blendet den Splash aus und betritt den
  Spielmodus (FLIR + Missionsauswahl) — ersetzt den bisherigen Umweg über den
  „Zombie-Modus"-Button als primären Einstieg.
- Eigenes DOM-Overlay (`#splash`) + CSS; Logik in `main.ts` (oder kleinem
  `splash.ts`). Kein Einfluss auf die Spiellogik.

## Datengebiet & Endlevel Großburgwedel

**Gebietserweiterung:** Großburgwedel (Zentrum ≈ 52.4928, 9.8736) liegt
~4,9 km vom Engensen-Zentrum entfernt — außerhalb des aktuellen 3500-m-Radius.
Für das Endlevel wird das Datengebiet erweitert:

- `scripts/fetch-osm.mjs`: `RADIUS_M` 3500 → **6000** (Großburgwedel komplett
  abgedeckt, ~12 km Kantenlänge). Danach `npm run fetch-osm`,
  `fetch-terrain`, `fetch-satellite` neu backen.
- Tradeoff: Bei gleichem 4096-px-Luftbild sinkt die Auflösung auf ~3 m/px;
  Terrain-Raster `GRID` 48 → **64** anheben, um die Auflösung zu halten. Aus
  AC-130-Orbithöhe ist die gröbere Luftbildauflösung akzeptabel.
- Die größere Datenmenge (mehr Gebäude) wird in beiden Repos dupliziert; das
  reine `engensen`-Experiment profitiert ebenfalls vom größeren Gebiet.

**Mission Großburgwedel (Endlevel):**

- Neue Mission `grossburgwedel`, ~10 000 Einwohner, größte Horde, höchste
  Schwierigkeit — als letzter Eintrag in `MISSIONS`.
- **Freischaltung:** erst spielbar, wenn die fünf kleineren Missionen
  (Engensen, Thönse, Lahberg, Wettmar, Oldhorst) gewonnen wurden.
- **Fortschritt persistent** via `localStorage` (gewonnene Missions-IDs). Im
  Auswahlbildschirm wird Großburgwedel bis dahin als „🔒 gesperrt" angezeigt
  (Button deaktiviert, Hinweis „Erst alle Dörfer retten").
- Beim Gewinn einer Mission wird ihre ID gespeichert; sobald alle fünf erledigt
  sind, entsperrt sich das Endlevel.

## Repo `engensen` (Original, bereinigt)

**Entfernen:**

- `src/game/*`, `src/flir.ts`
- Spiel-/FLIR-UI in `index.html`: Wärmebild-Button (`#flir-toggle`),
  `#flir-hud`, `#game-missions`, `#game-stats`, `#game-banner`, `#game-flash`,
  `#game-muzzle`, `#pause-overlay` + zugehöriges CSS
- in `main.ts`: FLIR-/Game-Verdrahtung und die Tasten `F` / `V` / `P`
- Spiel-Tests

**Anpassen:**

- `main.ts` rendert direkt über `postfx` (PostFX bleibt — verbessert die
  Kartenqualität allgemein; war zuvor via `flir.renderBase` eingehängt).
- Pfeil-/WASD-Steuerung, Live-Layer, Tag/Nacht, Wolken, Gebäude-Info bleiben →
  wieder das pure Geo-Experiment.
- `geo.test.ts` bleibt.

## Reihenfolge & Sicherheit

1. **Zuerst** das neue Spiel-Repo erstellen und lokal grün bekommen
   (`tsc --noEmit`, `vitest run`, kurzer Browser-Check des Spiels) — **dann**
   nach GitHub pushen.
2. **Danach** das Original bereinigen, `tsc`/`vitest`/Browser-Check, committen,
   pushen.
3. Reihenfolge stellt sicher: solange das Spiel-Repo nicht verifiziert ist, wird
   am Original nichts entfernt.

## Nicht im Scope (optionale Folgeschritte)

- Vercel-Deployment für `horde30938` (außenwirksam → vorher gesondert
  abstimmen).
- Auslagern eines geteilten Geo-Core-Packages (bewusst verworfen).

## Erfolgskriterien

- `horde30938`: baut & testet grün, Titelscreen erscheint und startet ins
  Spiel, Missionen wählbar, FLIR/Black-Hot funktioniert; Großburgwedel ist als
  Endlevel vorhanden und erst nach den fünf Dörfern freigeschaltet (Fortschritt
  übersteht Reload); keine toten Importe/DOM-Referenzen auf entfernte Module.
- `engensen`: baut & testet grün, 3D-Karte mit Live-Daten läuft, kein
  Wärmebild-/Spiel-Einstieg mehr, keine toten Referenzen.
- Beide Repos unabhängig lauffähig.
