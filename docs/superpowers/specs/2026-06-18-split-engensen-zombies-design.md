# Design: Engensen-Geo-Experiment ↔ Zombie-Spiel trennen

**Datum:** 2026-06-18
**Status:** abgenommen (Design)

## Ziel

Das Geo-Daten-Experiment „Engensen" und den Zombie-/FLIR-Spielmodus in zwei
eigenständige Projekte trennen:

- **`engensen`** (bestehendes Repo) → zurück zum reinen 3D-Geo-Experiment mit
  Live-Daten.
- **`engensen-zombies`** (neues, privates Repo) → eigenständiges Spiel-Projekt,
  das ab hier unabhängig weiterentwickelt wird.

Beide Projekte werden getrennt gepflegt; das gemeinsame Karten-Fundament wird
**dupliziert**, nicht als geteiltes Package ausgelagert (bewusst kein Monorepo —
echte Eigenständigkeit ist gewünscht).

## Methode des „Fork"

Kein server-seitiger GitHub-Fork (würde Experiment-Ballast und verwobene History
mitschleppen). Stattdessen sauberer Neustart:

1. Aktuellen Arbeitsstand (ohne `.git`, `node_modules`, `.vercel`, `dist`) in ein
   neues Schwester-Verzeichnis `../engensen-zombies` kopieren.
2. Dort `git init`, Bereinigung + Rebranding (siehe unten), `npm install`,
   `tsc` + `vitest` + kurzer Browser-Check.
3. Erst nach erfolgreichem lokalen Bauen/Testen:
   `gh repo create holger1411/engensen-zombies --private --source=. --push`.

So hat das Spiel eine klare eigene History ab Initial-Commit.

## Gemeinsames Fundament (in beide Repos)

Wird in beiden Repos vorhanden sein und danach getrennt gepflegt:

`scene.ts · geo.ts · types.ts · terrain.ts · buildings.ts · layers.ts`
(inkl. Wald-Instanzen & Wasser-Shader) `· postfx.ts · public/data/*`
(inkl. `satellite.jpg`, `terrain.json`, GeoJSON).

## Repo `engensen-zombies` (neues Spiel)

**Behalten:** Fundament + `flir.ts` + `src/game/*` + **Atmosphäre**: `sky.ts`
(Tag/Nacht-Licht, Sonne, Nachtfenster-Glühen) und `clouds.ts`.

**Entfernen** (Module + Verdrahtung in `main.ts` + DOM in `index.html` + CSS):

- Live-Layer: `flights.ts`, `iss.ts`, `weather.ts`, `air.ts`, `solar.ts`
- zugehörige UI: `#flights-panel`, `#iss-badge`, `#solar-badge`, `#air-badge`,
  `#weather`
- Gebäude-Interaktion: `interaction.ts`, `infoPanel.ts`, `#info-panel`
- Geo-Labels: `poi.ts` (im FLIR ohnehin ausgeblendet, experiment-lastig)

**Rebranding:**

- `package.json`: `name` → `engensen-zombies`, spielorientierte `description`
- `index.html`: `<title>` → Spieltitel; Topbar-Titel anpassen
- `README.md`: neues Spiel-README
- `.vercel/` wird **nicht** mitkopiert (eigene Verknüpfung später)

**Tests:** `src/game/weapons.test.ts`, `projectiles.test.ts`, `zombies.test.ts`
ziehen mit um; `geo.test.ts` ebenfalls (Fundament).

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

- Vercel-Deployment für `engensen-zombies` (außenwirksam → vorher gesondert
  abstimmen).
- Auslagern eines geteilten Geo-Core-Packages (bewusst verworfen).

## Erfolgskriterien

- `engensen-zombies`: baut & testet grün, Spiel startet, Missionen wählbar,
  FLIR/Black-Hot funktioniert; keine toten Importe/DOM-Referenzen auf entfernte
  Module.
- `engensen`: baut & testet grün, 3D-Karte mit Live-Daten läuft, kein
  Wärmebild-/Spiel-Einstieg mehr, keine toten Referenzen.
- Beide Repos unabhängig lauffähig.
