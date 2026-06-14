import * as THREE from "three";
import { createScene } from "./scene";
import { Projection } from "./geo";
import { buildBuildings } from "./buildings";
import { buildRoads, buildAreas } from "./layers";
import { makeTerrain, buildTerrainMesh, FLAT_TERRAIN, type TerrainData, type TerrainSampler } from "./terrain";
import { InfoPanel } from "./infoPanel";
import { Interaction } from "./interaction";
import { initWeather } from "./weather";
import { FlightLayer } from "./flights";
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
  const { renderer, scene, camera, controls, sun } = createScene(container);

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
    scene.add(buildTerrainMesh(terrain));
    scene.add(buildAreas(areasFC, proj, terrain));
    scene.add(buildRoads(roadsFC, proj, terrain));

    setStatus(`Baue ${meta.counts.buildings} Gebäude …`);
    const { group, meshes } = buildBuildings(buildingsFC, proj, terrain);
    scene.add(group);

    // Richte das Sonnen-Target auf das Zentrum
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();

    // Interaktion
    const panel = new InfoPanel();
    new Interaction(renderer.domElement, camera, meshes, panel);

    // Live-Layer: Wetter + Flüge
    initWeather(meta.center);
    const flights = new FlightLayer(scene, proj, meta);
    flights.start();

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
      controls.update();
      flights.update(dt);
      renderer.render(scene, camera);
    }
    animate();
  } catch (err) {
    console.error(err);
    setStatus(`Fehler: ${(err as Error).message}`);
  }
}

main();
