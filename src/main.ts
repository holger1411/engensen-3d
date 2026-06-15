import * as THREE from "three";
import { createScene } from "./scene";
import { Projection } from "./geo";
import { buildBuildings } from "./buildings";
import { buildRoads, buildAreas, buildDetails } from "./layers";
import { buildPois } from "./poi";
import { makeTerrain, buildTerrainMesh, FLAT_TERRAIN, type TerrainData, type TerrainSampler } from "./terrain";
import { InfoPanel } from "./infoPanel";
import { Interaction } from "./interaction";
import { initWeather } from "./weather";
import { initAir } from "./air";
import { initSolar } from "./solar";
import { FlightLayer } from "./flights";
import { SolarSky } from "./sky";
import { CloudSystem } from "./clouds";
import { IssLayer } from "./iss";
import { FlirMode } from "./flir";
import { GameController } from "./game/zombieMode";
import { buildForestSpawnPoints, buildRingSpawnPoints } from "./game/zombies";
import { MISSIONS } from "./game/missions";
import type { FeatureCollection, Meta } from "./types";

const BASE = import.meta.env.BASE_URL;

async function loadJSON<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`Laden fehlgeschlagen: ${path} (${res.status})`);
  return res.json() as Promise<T>;
}

function setStatus(msg: string, done = false): void {
  const el = document.getElementById("loading");
  if (!el) return;
  if (done) {
    el.classList.add("hidden");
    return;
  }
  const t = el.querySelector(".loading-text");
  if (t) t.textContent = msg;
}

async function main(): Promise<void> {
  const container = document.getElementById("app")!;
  const bundle = createScene(container);
  const { renderer, scene, camera, controls } = bundle;
  const homePos = camera.position.clone();
  const homeTarget = controls.target.clone();

  // FLIR / Wärmebildmodus (Taste F oder Button)
  const flir = new FlirMode(renderer, scene, camera, controls);
  document.getElementById("flir-toggle")?.addEventListener("click", () => flir.toggle());
  window.addEventListener("keydown", (e) => {
    if (e.key === "f" || e.key === "F") flir.toggle();
  });
  window.addEventListener("resize", () => flir.setSize(container.clientWidth, container.clientHeight));

  // --- Tastatursteuerung: Pfeiltasten (und WASD) bewegen die Kamera über die Karte ---
  const pressed = new Set<string>();
  const MOVE_KEYS = new Set([
    "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
    "w", "a", "s", "d", "W", "A", "S", "D",
  ]);
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();
  /** Verschiebt Kamera und Blickziel gemeinsam in der Horizontalebene. */
  function applyMove(fb: number, lr: number, dist: number): void {
    if ((fb === 0 && lr === 0) || dist === 0) return;
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    right.set(-fwd.z, 0, fwd.x); // 90° nach rechts
    move.set(0, 0, 0).addScaledVector(fwd, fb).addScaledVector(right, lr).normalize().multiplyScalar(dist);
    camera.position.add(move);
    controls.target.add(move);
  }
  const fbFromKeys = () =>
    (pressed.has("ArrowUp") || pressed.has("w") || pressed.has("W") ? 1 : 0) -
    (pressed.has("ArrowDown") || pressed.has("s") || pressed.has("S") ? 1 : 0);
  const lrFromKeys = () =>
    (pressed.has("ArrowRight") || pressed.has("d") || pressed.has("D") ? 1 : 0) -
    (pressed.has("ArrowLeft") || pressed.has("a") || pressed.has("A") ? 1 : 0);
  const nudge = () => THREE.MathUtils.clamp(controls.getDistance() * 0.14, 12, 2000);

  window.addEventListener("keydown", (e) => {
    if (!MOVE_KEYS.has(e.key)) return;
    pressed.add(e.key);
    e.preventDefault();
    // sofortiger Schritt pro Tastendruck (auch für kurze Tipps spürbar)
    const fb = (e.key === "ArrowUp" || e.key === "w" || e.key === "W" ? 1 : 0) - (e.key === "ArrowDown" || e.key === "s" || e.key === "S" ? 1 : 0);
    const lr = (e.key === "ArrowRight" || e.key === "d" || e.key === "D" ? 1 : 0) - (e.key === "ArrowLeft" || e.key === "a" || e.key === "A" ? 1 : 0);
    applyMove(fb, lr, nudge());
  });
  window.addEventListener("keyup", (e) => pressed.delete(e.key));

  /** Dauerbewegung beim Halten der Taste. */
  function panFromKeys(dt: number): void {
    if (pressed.size === 0) return;
    const speed = THREE.MathUtils.clamp(controls.getDistance() * 0.9, 80, 12000);
    applyMove(fbFromKeys(), lrFromKeys(), speed * dt);
  }

  try {
    setStatus("Lade Geodaten …");
    const [meta, buildingsFC, roadsFC, areasFC] = await Promise.all([
      loadJSON<Meta>("data/meta.json"),
      loadJSON<FeatureCollection>("data/buildings.geojson"),
      loadJSON<FeatureCollection>("data/roads.geojson"),
      loadJSON<FeatureCollection>("data/areas.geojson"),
    ]);

    const proj = new Projection(meta.center);

    setStatus("Baue Gelände …");
    let terrain: TerrainSampler = FLAT_TERRAIN;
    try {
      const td = await loadJSON<TerrainData>("data/terrain.json");
      terrain = makeTerrain(td, meta.center);
    } catch (e) {
      console.warn("Kein Gelände geladen, nutze flachen Boden:", (e as Error).message);
    }
    const terrainMesh = buildTerrainMesh(terrain, 12000, 240);
    scene.add(terrainMesh);

    // Zombie-Modus: pro Mission Zentrum + Wald-Spawnpunkte vorberechnen
    const missionData = MISSIONS.map((m) => {
      const pr = proj.project(m.lon, m.lat);
      const center = new THREE.Vector3(pr.x, terrain.sample(pr.x, -pr.y), -pr.y);
      let spawnPoints = buildForestSpawnPoints(areasFC, proj, terrain, 400, 2600, { x: center.x, z: center.z });
      // Fallback: zu wenig Wald in der Nähe → Ring um den Ort
      if (spawnPoints.length < 16) {
        spawnPoints = spawnPoints.concat(buildRingSpawnPoints({ x: center.x, z: center.z }, terrain, 850, 1500, 32));
      }
      return { mission: m, center, spawnPoints };
    });
    const game = new GameController({
      scene, camera, terrain, raycastTargets: [terrainMesh],
      missions: missionData,
      setOrbitCenter: (v) => flir.setOrbitCenter(v),
    });
    flir.onToggle = (on) => (on ? game.start() : game.stop());
    if (flir.enabled) game.start(); // Modus evtl. schon vor Spiel-Init aktiviert

    scene.add(buildAreas(areasFC, proj, terrain));
    scene.add(buildRoads(roadsFC, proj, terrain));

    setStatus(`Baue ${meta.counts.buildings} Gebäude …`);
    const { group, meshes } = buildBuildings(buildingsFC, proj, terrain);
    scene.add(group);

    // Details (Bäume/Hecken) und POIs (Geschäfte/wichtige Punkte)
    try {
      const detailsFC = await loadJSON<FeatureCollection>("data/details.geojson");
      scene.add(buildDetails(detailsFC, proj, terrain));
    } catch (e) {
      console.warn("Keine Details geladen:", (e as Error).message);
    }
    try {
      const poisFC = await loadJSON<FeatureCollection>("data/pois.geojson");
      scene.add(buildPois(poisFC, proj, terrain));
    } catch (e) {
      console.warn("Keine POIs geladen:", (e as Error).message);
    }

    // Interaktion
    const panel = new InfoPanel();
    new Interaction(renderer.domElement, camera, meshes, panel);

    // Live-Layer: Sonnenstand/Himmel (mit Nachtbeleuchtung), Wetter, Flüge
    // Optionaler Vorschau-Zeitparameter ?t=ISO (z. B. ?t=2026-06-14T23:00), sonst Echtzeit.
    const tParam = new URLSearchParams(location.search).get("t");
    const simTime = tParam && !isNaN(Date.parse(tParam)) ? new Date(tParam) : null;
    new SolarSky(bundle, meta.center, meshes, simTime).start();
    initWeather(meta.center);
    initAir(meta.center);
    initSolar(meta.center);
    const clouds = new CloudSystem(scene, meta.center);
    clouds.start();
    new IssLayer(scene, meta.center).start();
    const flights = new FlightLayer(scene, proj, meta, camera, controls);
    flights.start();

    document.getElementById("reset-view")?.addEventListener("click", () => {
      flights.resetView(homePos, homeTarget);
    });

    // Statistik unten links
    const stats = document.getElementById("stats");
    if (stats) {
      stats.textContent = `Engensen · ${meta.counts.buildings} Gebäude · ${meta.counts.roads} Wege`;
    }

    setStatus("", true);

    // Render-Loop
    const clock = new THREE.Clock();
    function animate(): void {
      requestAnimationFrame(animate);
      const dt = clock.getDelta();
      if (flir.enabled) {
        flir.updateOrbit(dt); // AC-130-Orbit um Engensen
        game.update(dt);
      } else {
        panFromKeys(dt);
        controls.update();
      }
      flights.update(dt);
      clouds.update(dt);
      flir.render(clock.elapsedTime); // rendert normal ODER im Wärmebildmodus
    }
    animate();
  } catch (err) {
    console.error(err);
    setStatus(`Fehler: ${(err as Error).message}`);
  }
}

main();
