import * as THREE from "three";

/**
 * Live-Überflug der ISS über Engensen.
 * Position von wheretheiss.at (frei, ohne Key). Aus der ISS-Position und dem
 * Standort Engensen werden Azimut & Elevation berechnet; steht die ISS über
 * dem Horizont, erscheint ein Marker am Himmel. Badge zeigt immer den Status.
 */

const R_EARTH = 6371; // km
const DEG = Math.PI / 180;
const DOME = 48000; // Darstellungsdistanz des Markers (innerhalb der Sichtweite)
const POLL_MS = 4000;

interface IssState {
  lat: number;
  lon: number;
  altKm: number;
  velocity: number; // km/h
}

interface Topo {
  azimuth: number; // rad, von Norden im Uhrzeigersinn
  elevation: number; // rad über Horizont
  rangeKm: number;
}

const COMPASS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
const compass = (deg: number) => COMPASS[Math.round(((((deg % 360) + 360) % 360) / 45)) % 8];

/** Geozentrische ECEF-Koordinaten (Kugelnäherung genügt zur Visualisierung). */
function ecef(latDeg: number, lonDeg: number, altKm: number): [number, number, number] {
  const lat = latDeg * DEG, lon = lonDeg * DEG;
  const r = R_EARTH + altKm;
  return [r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat)];
}

/** Azimut/Elevation/Distanz der ISS vom Beobachter (Engensen). */
function topocentric(obs: { lat: number; lon: number }, iss: IssState): Topo {
  const o = ecef(obs.lat, obs.lon, 0.06);
  const s = ecef(iss.lat, iss.lon, iss.altKm);
  const d = [s[0] - o[0], s[1] - o[1], s[2] - o[2]];
  const lat = obs.lat * DEG, lon = obs.lon * DEG;
  const east = -Math.sin(lon) * d[0] + Math.cos(lon) * d[1];
  const north = -Math.sin(lat) * Math.cos(lon) * d[0] - Math.sin(lat) * Math.sin(lon) * d[1] + Math.cos(lat) * d[2];
  const up = Math.cos(lat) * Math.cos(lon) * d[0] + Math.cos(lat) * Math.sin(lon) * d[1] + Math.sin(lat) * d[2];
  const range = Math.hypot(d[0], d[1], d[2]);
  return { azimuth: Math.atan2(east, north), elevation: Math.asin(up / range), rangeKm: range };
}

function makeIssSprite(): THREE.Sprite {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(180,230,255,1)");
  g.addColorStop(0.3, "rgba(120,200,255,0.7)");
  g.addColorStop(1, "rgba(120,200,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.font = "64px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🛰️", size / 2, size / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(4200);
  sprite.renderOrder = 7;
  return sprite;
}

export class IssLayer {
  private sprite = makeIssSprite();

  constructor(scene: THREE.Scene, private center: { lat: number; lon: number }) {
    this.sprite.visible = false;
    scene.add(this.sprite);
  }

  start(): void {
    void this.refresh();
    setInterval(() => void this.refresh(), POLL_MS);
  }

  private async refresh(): Promise<void> {
    try {
      const res = await fetch("https://api.wheretheiss.at/v1/satellites/25544");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const iss: IssState = { lat: j.latitude, lon: j.longitude, altKm: j.altitude, velocity: j.velocity };
      const t = topocentric(this.center, iss);
      this.updateMarker(t);
      this.updateBadge(t, iss);
    } catch (err) {
      console.warn("ISS:", (err as Error).message);
    }
  }

  private updateMarker(t: Topo): void {
    if (t.elevation <= 0) {
      this.sprite.visible = false;
      return;
    }
    const az = t.azimuth, el = t.elevation;
    const h = Math.cos(el);
    this.sprite.position.set(h * Math.sin(az) * DOME, Math.sin(el) * DOME, -h * Math.cos(az) * DOME);
    this.sprite.visible = true;
  }

  private updateBadge(t: Topo, iss: IssState): void {
    const el = document.getElementById("iss-badge");
    if (!el) return;
    el.replaceChildren();
    const elevDeg = (t.elevation * 180) / Math.PI;
    const azDeg = (t.azimuth * 180) / Math.PI;
    const visible = elevDeg > 0;

    const icon = document.createElement("span");
    icon.textContent = "🛰️";
    const txt = document.createElement("span");
    txt.textContent = visible
      ? `ISS ${Math.round(elevDeg)}° ${compass(azDeg)}`
      : `ISS ${Math.round(t.rangeKm)} km`;
    const sub = document.createElement("span");
    sub.style.cssText = "color:var(--muted);font-size:11px";
    sub.textContent = visible ? "über dem Horizont 🔭" : `Höhe ${Math.round(iss.altKm)} km`;
    el.append(icon, txt, sub);
    el.title =
      `ISS (wheretheiss.at): ${visible ? "über dem Horizont — evtl. sichtbar" : "unter dem Horizont"}\n` +
      `Distanz ${Math.round(t.rangeKm)} km · Bahnhöhe ${Math.round(iss.altKm)} km · ${Math.round(iss.velocity)} km/h\n` +
      `Position: ${iss.lat.toFixed(1)}°, ${iss.lon.toFixed(1)}°`;
  }
}
