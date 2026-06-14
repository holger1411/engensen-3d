import * as THREE from "three";

/**
 * Loop 4 — Wolken & Niederschlag.
 *
 * (a) Wolkendecke: prozedural erzeugt, Deckungsgrad live aus Open-Meteo
 *     (cloud_cover %), Drift in echte Windrichtung/-stärke.
 * (b) Niederschlagsradar: echte RainViewer-Radar-Tiles als Overhead-Layer.
 */

const CLOUD_Y = 640;
const RADAR_Y = 430;
const TILE_WORLD = 950; // Welt-Einheiten pro Radar-Kachel
const RADAR_Z = 8; // Zoomstufe der Radar-Kacheln

// --- Prozedurale Wolkentextur ------------------------------------------------
function makeCloudTexture(): THREE.Texture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);

  // Viele weiche, halbtransparente Blobs → wattige Wolken. Deterministisch.
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 220; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 18 + rand() * 64;
    const a = 0.05 + rand() * 0.16;
    // über die Ränder wiederholen → kachelbar
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

// --- Web-Mercator Kachel-Mathematik ------------------------------------------
function lonLatToTileF(lon: number, lat: number, z: number): { xf: number; yf: number } {
  const n = Math.pow(2, z);
  const xf = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { xf, yf };
}

export class CloudSystem {
  private cloudMat!: THREE.MeshBasicMaterial;
  private cloudTex!: THREE.Texture;
  private windEast = 0;
  private windNorth = 0;
  private radarGroup = new THREE.Group();

  constructor(private scene: THREE.Scene, private center: { lat: number; lon: number }) {}

  start(): void {
    this.buildCloudPlane();
    this.scene.add(this.radarGroup);
    this.refreshWeather();
    this.refreshRadar();
    setInterval(() => this.refreshWeather(), 10 * 60 * 1000);
    setInterval(() => this.refreshRadar(), 5 * 60 * 1000);
  }

  private buildCloudPlane(): void {
    this.cloudTex = makeCloudTexture();
    const geom = new THREE.PlaneGeometry(6000, 6000);
    geom.rotateX(-Math.PI / 2);
    this.cloudMat = new THREE.MeshBasicMaterial({
      map: this.cloudTex,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      fog: true,
    });
    const mesh = new THREE.Mesh(geom, this.cloudMat);
    mesh.position.y = CLOUD_Y;
    mesh.renderOrder = 5;
    this.scene.add(mesh);
  }

  /** Driftet die Wolken pro Frame in echte Windrichtung. */
  update(dt: number): void {
    if (!this.cloudTex) return;
    // UV-Versatz: kleiner Faktor, sonst zu schnell
    this.cloudTex.offset.x += this.windEast * dt * 0.00002;
    this.cloudTex.offset.y += this.windNorth * dt * 0.00002;
  }

  private async refreshWeather(): Promise<void> {
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${this.center.lat}&longitude=${this.center.lon}` +
        `&current=cloud_cover,wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const c = (await res.json()).current;
      const cover = c.cloud_cover as number; // %
      this.cloudMat.opacity = THREE.MathUtils.clamp((cover / 100) * 0.7 + 0.03, 0, 0.75);
      const dir = ((c.wind_direction_10m as number) * Math.PI) / 180; // woher der Wind kommt
      const spd = c.wind_speed_10m as number; // m/s
      // Bewegungsrichtung = entgegengesetzt zur Herkunft
      this.windEast = -Math.sin(dir) * spd;
      this.windNorth = -Math.cos(dir) * spd;
    } catch (err) {
      console.warn("Wolken (cloud_cover):", (err as Error).message);
    }
  }

  private async refreshRadar(): Promise<void> {
    try {
      const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const maps = await res.json();
      const past: { time: number; path: string }[] = maps.radar?.past || [];
      const frame = past[past.length - 1];
      if (!frame) return;
      this.buildRadarTiles(maps.host as string, frame.path);
    } catch (err) {
      console.warn("Radar (RainViewer):", (err as Error).message);
    }
  }

  private buildRadarTiles(host: string, path: string): void {
    // alte Tiles entfernen
    this.radarGroup.clear();
    const { xf, yf } = lonLatToTileF(this.center.lon, this.center.lat, RADAR_Z);
    const cx = Math.floor(xf);
    const cy = Math.floor(yf);
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");

    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const tx = cx + i;
        const ty = cy + j;
        // Radar-URL: /{size}/{z}/{x}/{y}/{colorscheme}/{options}.png
        const url = `${host}${path}/256/${RADAR_Z}/${tx}/${ty}/4/1_1.png`;
        const tex = loader.load(url);
        tex.colorSpace = THREE.SRGBColorSpace;
        const geom = new THREE.PlaneGeometry(TILE_WORLD, TILE_WORLD);
        geom.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({
          map: tex, transparent: true, opacity: 0.7, depthWrite: false, fog: true,
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(((tx + 0.5) - xf) * TILE_WORLD, RADAR_Y, ((ty + 0.5) - yf) * TILE_WORLD);
        mesh.renderOrder = 4;
        this.radarGroup.add(mesh);
      }
    }
  }
}
