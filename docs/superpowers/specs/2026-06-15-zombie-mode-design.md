# Zombie-Modus — AC-130-Verteidigung von Engensen (Design)

**Datum:** 2026-06-15
**Status:** In Abstimmung

## Idee

Ein Tower-Defense-/Gunship-Spiel im bestehenden 3D-Modell: Der Spieler sitzt im
Sensor-/Waffenstand einer **AC-130** die im Linkskreis um Engensen fliegt, sieht
alles im **Wärmebild** (FLIR) und verteidigt den echten Wohnort gegen eine
**Zombie-Invasion** aus den umliegenden Wäldern.

Baut auf dem vorhandenen FLIR-Modus auf (Orbit-Kamera, Thermal-Shader, frei
schwenkbarer Gimbal). Der bisherige **FLIR-Button wird zu „🧟 Zombie-Modus"**.

## Entscheidungen (aus Brainstorming)

- **Ballistik:** realistisch-aber-spielbar (Geschossflugzeit + Vorhalt nötig,
  leichte Streuung, Splash je Kaliber; kein Wind).
- **Zahlen-Basis:** echte Werte (s. u.), feinjustierbar.
- **Steuerung:** Maus-Drag = Gimbal zielen · **Leertaste = feuern** · **1/2/3** =
  Waffe wechseln · Scrollen = Zoom. (Klare Trennung Drag ↔ Feuern.)
- **Umfang:** spielbarer Prototyp zuerst (Ansatz A).
- **Ansatz A:** geradliniger Schwarm + ballistische Geschosse, InstancedMesh.
  (Straßen-Pathfinding = späteres v2-Upgrade.)

## Echte Daten (Recherche)

- **Engensen Einwohner:** 1.479 (2020, mit Lahberg) → **Start-Population 1.500**.
- **AC-130U „Spooky"** fliegt im Einsatz einen Linkskreis (pylon turn) um das
  Ziel — entspricht unserem Orbit. Bewaffnung (authentisch, 105 mm statt 120 mm):

| Taste | Waffe | Feuerrate | Vorrat | Wirkung |
|---|---|---|---|---|
| 1 | 25 mm GAU-12 Gatling | 1.800/min (30/s) | 3.000 | Einzeltreffer, minimaler Splash, schnell |
| 2 | 40 mm Bofors L/60 | ~100/min (1,7/s) | 256 | mittlerer Splash |
| 3 | 105 mm M102 Haubitze | 6–10/min (~1 alle 7 s) | 100 | großer Splash + Blitz |

Vorrat ist **fix** (kein Nachladen im Flug). „Nachladezeit" = Kehrwert der
Feuerrate (bei 105 mm sichtbarer Reload-Balken).

## Visuelle Darstellung (Wärmebild, WHOT)

- **Zombies = tot = kalt → dunkle/schwarze Gestalten** (dunkles Material →
  Thermal-Shader rendert sie schwarz). Sichtbar als bewegte dunkle Punkte/Figuren
  gegen den mittelgrauen Boden.
- **Lebende Einwohner = weiß-glühend** — *erst in späterer Ausbaustufe* als
  Figuren simuliert; im Prototyp ist die Bevölkerung nur ein Zähler.
- Geschosse mit **Leuchtspur** (hell), Mündungsfeuer, Einschlag-Flash.

## Spielablauf

1. **Spawn:** Eine endliche Horde (Strom, ansteigende Spawnrate) erscheint an den
   **Waldrändern** (echte OSM-Wald-/Forstflächen aus `areas.geojson`), außerhalb
   des Ortes.
2. **Anmarsch:** Zombies bewegen sich (leicht gestreut) Richtung Ortsmitte.
3. **Bedrohung:** Befinden sich Zombies im Ortsbereich (Radius um Zentrum), sinkt
   die **Einwohnerzahl**; die Drain-Rate steigt mit der Zahl der Zombies im Ort
   (beschleunigt).
4. **Abwehr:** Spieler zielt per Gimbal, feuert (Space) die aktive Waffe.
   Geschosse fliegen vom Flugzeug zum Bodenpunkt unter dem Fadenkreuz →
   bewegliche Ziele müssen **vorgehalten** werden (Flugzeit).
5. **Treffer:** Schaden + Splash je Kaliber tötet Zombies (HP-Modell).

## Ende-Bedingungen

- 🏆 **Sieg:** alle Zombies besiegt **und** Einwohner > 0.
- 💀 **Niederlage:** Einwohner = 0 **oder** gesamte Munition (alle 3 Waffen) leer,
  solange noch Zombies leben.

## HUD-Ergänzungen (im Thermal-HUD)

- `POP 1483` (Einwohnerzahl), Drain visuell hervorgehoben wenn fallend.
- Aktive Waffe + Munition (`25mm 2940` / `40mm 256` / `105mm 100`), Reload-Balken
  für 105 mm.
- Zombies übrig / im Ort.
- Sieg-/Niederlage-Banner + Neustart.

## Architektur (neue Module, isoliert & testbar)

- `src/game/weapons.ts` — Waffendefinitionen (Feuerrate, Munition, Mündungs­ge­
  schwindigkeit, Schaden, Splash-Radius, Streuung); Feuer-/Munitionslogik.
- `src/game/projectiles.ts` — Geschoss-Pool: Simulation (Flugzeit, leichter Fall,
  Tracer-Visual), Einschlag-Erkennung gegen Zombies + Boden, Splash-Schaden.
- `src/game/zombies.ts` — Spawn an Waldrändern, Bewegung zur Ortsmitte
  (InstancedMesh, dunkle Figuren), HP, Treffer, Bevölkerungs-Drain.
- `src/game/zombieMode.ts` — Orchestrierung: Spawn-Loop, Frame-Update (Zombies,
  Geschosse, Kollision, Population, Win/Lose), HUD, Eingaben (Space/1/2/3).
  Nutzt den vorhandenen FLIR-Render/Orbit/Gimbal aus `flir.ts`.

Die FLIR-Sicht (Orbit, Thermal-Shader, Gimbal) bleibt die „Kamera/Anzeige"; die
Spiel-Logik sind getrennte Systeme, die pro Frame laufen, wenn der Modus aktiv ist.

## Datenfluss

`areas.geojson` (Wald) → Spawnpunkte · pro Frame: Zombies bewegen → Population-
Drain · Eingabe (Space) → Waffe feuert → Geschoss → Einschlag → Splash → Zombie-
HP → Tod/POP-Update → HUD · Endbedingung prüfen.

## Balancing (Startwerte, justierbar)

- Population 1.500; Horde-Gesamtzahl ~250–400 (so dass mit Munition + Splash
  schaffbar). Drain-Faktor K: Zombies_im_Ort × K Personen/s.
- Zombie-HP so, dass 25 mm mehrere Treffer braucht, 40 mm 1 Treffer + kleiner
  Splash, 105 mm großflächig tötet. Konkrete Werte im Plan, im Spieltest getunt.

## Fehlerbehandlung

- Fehlende/zu wenige Waldflächen → Fallback-Spawn auf Ring um den Ort.
- Performance: InstancedMesh für Zombies, gepoolte Geschosse; harte Obergrenzen.

## Tests

- `weapons`: Feuerrate-Taktung, Munition runter, leer-Zustand.
- `projectiles`: Flugzeit/Position über Zeit, Vorhalt-Plausibilität, Splash-Radius.
- `zombies`: Spawn in Waldnähe, Bewegung Richtung Zentrum, Drain-Mathematik.
- Manuelles Spielen (Balancing, Steuerungsgefühl).

## Bewusst später (YAGNI)

Straßen-Pathfinding, lebende Einwohner als Figuren (weiß-glühend), Wellen/
Highscore/Statistik, Sound, mehrere Zombie-Typen, Mehrspieler.
