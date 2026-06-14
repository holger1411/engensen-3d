import * as THREE from "three";
import { Projection } from "./geo";
import type { Meta } from "./types";

/**
 * Live-Flüge über dem Ortskern via OpenSky Network (frei, anonym).
 * https://openskynetwork.github.io/opensky-api/rest.html
 *
 * Darstellung: Flugzeuge werden als „Schneekugel" über dem Modell gezeigt —
 * horizontale Richtung & relative Lage stimmen, Maßstab ist komprimiert, damit
 * der ganze nahe Luftraum sichtbar bleibt. Die Liste links ist maßstabsgetreu
 * (echte Distanz, Richtung, Höhe, Geschwindigkeit).
 */

const QUERY_RADIUS_KM = 60; // Umkreis für die OpenSky-Abfrage
const SKY_K = 0.022; // Meter → Welt-Einheiten (Horizontal-Kompression)
const ALT_BASE = 110; // Mindesthöhe der Marker
const ALT_SCALE = 0.06; // Höhen-Kompression (12000 m → ~720)
const BASE_INTERVAL = 20_000;
const MAX_INTERVAL = 120_000;

const COMPASS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
const compass = (deg: number) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];

const R_EARTH = 6371; // km
function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}
function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const la1 = (aLat * Math.PI) / 180, la2 = (bLat * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** Ein OpenSky-State-Vektor (relevante Felder). */
interface Flight {
  icao: string;
  callsign: string;
  country: string;
  lon: number;
  lat: number;
  altitude: number; // m (geometrisch, sonst baro)
  onGround: boolean;
  velocity: number; // m/s
  track: number; // ° (Kurs über Grund, 0=N)
  vertRate: number; // m/s
  distanceKm: number;
  bearing: number;
}

interface PlaneObj {
  group: THREE.Group;
  flight: Flight;
}

/** Erzeugt ein stilisiertes Flugzeug-Mesh (Nase zeigt nach Norden / -Z). */
function makePlane(color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.2 });

  const fuselage = new THREE.Mesh(new THREE.ConeGeometry(6, 34, 8), mat);
  fuselage.geometry.rotateX(-Math.PI / 2); // Nase → -Z (Norden)
  g.add(fuselage);

  const wings = new THREE.Mesh(new THREE.BoxGeometry(46, 2.5, 9), mat);
  wings.position.z = 3;
  g.add(wings);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(16, 2.5, 6), mat);
  tail.position.z = 13;
  g.add(tail);

  const fin = new THREE.Mesh(new THREE.BoxGeometry(2.5, 10, 8), mat);
  fin.position.set(0, 4, 14);
  g.add(fin);

  return g;
}

/** Text-Sprite für das Callsign über dem Flugzeug. */
function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const pad = 12;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 36px -apple-system, Arial, sans-serif";
  const w = ctx.measureText(text).width;
  canvas.width = w + pad * 2;
  canvas.height = 56;
  const c2 = canvas.getContext("2d")!;
  c2.font = "bold 36px -apple-system, Arial, sans-serif";
  c2.fillStyle = "rgba(15,18,24,0.78)";
  roundRect(c2, 0, 0, canvas.width, canvas.height, 12);
  c2.fill();
  c2.fillStyle = "#f2c14e";
  c2.textBaseline = "middle";
  c2.fillText(text, pad, canvas.height / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  const s = 0.16;
  sprite.scale.set(canvas.width * s, canvas.height * s, 1);
  sprite.position.y = 30;
  return sprite;
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class FlightLayer {
  private root = new THREE.Group();
  private planes = new Map<string, PlaneObj>();
  private interval = BASE_INTERVAL;
  private timer: number | undefined;
  private bbox: { lamin: number; lomin: number; lamax: number; lomax: number };

  constructor(scene: THREE.Scene, private proj: Projection, private meta: Meta) {
    this.root.name = "flights";
    scene.add(this.root);
    const dLat = QUERY_RADIUS_KM / 111;
    const dLon = QUERY_RADIUS_KM / (111 * Math.cos((meta.center.lat * Math.PI) / 180));
    this.bbox = {
      lamin: meta.center.lat - dLat,
      lomin: meta.center.lon - dLon,
      lamax: meta.center.lat + dLat,
      lomax: meta.center.lon + dLon,
    };
  }

  start(): void {
    void this.refresh();
  }

  /** Stoppt das Polling (z. B. beim Aufräumen). */
  stop(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
  }

  private async refresh(): Promise<void> {
    try {
      const flights = await this.fetchFlights();
      this.sync(flights);
      this.renderPanel(flights);
      this.interval = BASE_INTERVAL; // Erfolg → zurück auf schnelles Intervall
    } catch (err) {
      console.warn("OpenSky:", (err as Error).message);
      this.interval = Math.min(this.interval * 2, MAX_INTERVAL); // Backoff bei 429/Fehler
      this.renderPanelError();
    } finally {
      this.timer = window.setTimeout(() => void this.refresh(), this.interval);
    }
  }

  private async fetchFlights(): Promise<Flight[]> {
    const { lamin, lomin, lamax, lomax } = this.bbox;
    // Über den eigenen Proxy (umgeht CORS); funktioniert in Dev & auf Vercel.
    const url = `/api/flights?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const states: unknown[][] = json.states || [];
    const { lat: cLat, lon: cLon } = this.meta.center;

    return states
      .map((s): Flight | null => {
        const lon = s[5] as number | null;
        const lat = s[6] as number | null;
        if (lon == null || lat == null) return null;
        const altitude = (s[13] as number | null) ?? (s[7] as number | null) ?? 0;
        return {
          icao: (s[0] as string).trim(),
          callsign: ((s[1] as string) || "").trim() || "—",
          country: (s[2] as string) || "",
          lon,
          lat,
          altitude,
          onGround: Boolean(s[8]),
          velocity: (s[9] as number | null) ?? 0,
          track: (s[10] as number | null) ?? 0,
          vertRate: (s[11] as number | null) ?? 0,
          distanceKm: haversineKm(cLat, cLon, lat, lon),
          bearing: bearingDeg(cLat, cLon, lat, lon),
        };
      })
      .filter((f): f is Flight => f !== null)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  /** Welt-Position eines Flugs (komprimierte Schneekugel). */
  private worldPos(f: Flight): THREE.Vector3 {
    const p = this.proj.project(f.lon, f.lat); // {x: Ost, y: Nord} in m
    const y = f.onGround ? 6 : ALT_BASE + Math.max(0, f.altitude) * ALT_SCALE;
    return new THREE.Vector3(p.x * SKY_K, y, -p.y * SKY_K);
  }

  private sync(flights: Flight[]): void {
    const seen = new Set<string>();
    for (const f of flights) {
      seen.add(f.icao);
      let obj = this.planes.get(f.icao);
      if (!obj) {
        const group = makePlane(f.onGround ? 0x88909a : 0xffd23f);
        group.add(makeLabel(f.callsign === "—" ? f.icao.toUpperCase() : f.callsign));
        this.root.add(group);
        obj = { group, flight: f };
        this.planes.set(f.icao, obj);
      }
      obj.flight = f;
      obj.group.position.copy(this.worldPos(f));
      obj.group.rotation.y = -(f.track * Math.PI) / 180;
    }
    // verschwundene Flüge entfernen
    for (const [icao, obj] of this.planes) {
      if (!seen.has(icao)) {
        this.disposePlane(obj);
        this.planes.delete(icao);
      }
    }
  }

  /** Dead-Reckoning zwischen den Abrufen für flüssige Bewegung. */
  update(dt: number): void {
    for (const obj of this.planes.values()) {
      const f = obj.flight;
      if (f.onGround || f.velocity < 1) continue;
      const rad = (f.track * Math.PI) / 180;
      const east = Math.sin(rad) * f.velocity; // m/s
      const north = Math.cos(rad) * f.velocity;
      obj.group.position.x += east * SKY_K * dt;
      obj.group.position.z += -north * SKY_K * dt;
      obj.group.position.y += f.vertRate * ALT_SCALE * dt;
    }
  }

  private disposePlane(obj: PlaneObj): void {
    this.root.remove(obj.group);
    obj.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      } else if (o instanceof THREE.Sprite) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }

  // --- Panel -----------------------------------------------------------------
  private renderPanel(flights: Flight[]): void {
    const list = document.getElementById("flights-list");
    if (!list) return;
    list.replaceChildren();

    if (flights.length === 0) {
      const li = document.createElement("li");
      li.className = "flights-empty";
      li.textContent = "Gerade keine Flugzeuge in der Nähe.";
      list.append(li);
      return;
    }

    for (const f of flights.slice(0, 8)) {
      const li = document.createElement("li");

      const cs = document.createElement("div");
      cs.className = "fl-callsign";
      cs.textContent = f.callsign === "—" ? f.icao.toUpperCase() : f.callsign;

      const meta = document.createElement("div");
      meta.className = "fl-meta";
      const dist = document.createElement("span");
      dist.className = "fl-dist";
      dist.textContent = `${f.distanceKm.toFixed(1)} km ${compass(f.bearing)}`;
      const alt = document.createElement("span");
      alt.textContent = f.onGround ? "am Boden" : `${Math.round(f.altitude)} m`;
      const spd = document.createElement("span");
      spd.textContent = `${Math.round(f.velocity * 3.6)} km/h`;
      const hdg = document.createElement("span");
      hdg.textContent = `Kurs ${compass(f.track)}`;
      meta.append(dist, alt, spd, hdg);

      if (f.country) {
        const ctry = document.createElement("div");
        ctry.className = "fl-meta";
        ctry.textContent = f.country;
        li.append(cs, meta, ctry);
      } else {
        li.append(cs, meta);
      }
      list.append(li);
    }
  }

  private renderPanelError(): void {
    const list = document.getElementById("flights-list");
    if (!list || this.planes.size > 0) return; // bestehende Anzeige behalten
    list.replaceChildren();
    const li = document.createElement("li");
    li.className = "flights-empty";
    li.textContent = "Flugdaten gerade nicht verfügbar (Rate-Limit). Neuer Versuch folgt …";
    list.append(li);
  }
}
