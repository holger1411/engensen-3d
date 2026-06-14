import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Projection } from "./geo";
import type { Meta } from "./types";

/**
 * Live-Flüge im Nahbereich von Engensen über adsb.lol (frei, ohne Key).
 *
 * Anders als zuvor werden Flugzeuge in ECHTER Position und Höhe dargestellt
 * (1 Welt-Einheit = 1 Meter). Nur der Nahbereich (~18 km) wird gezeigt, damit
 * z. B. am 20 km entfernten Flughafen stehende Maschinen NICHT im Dorf landen.
 * Für jeden Flug wird geprüft, ob er Engensen vermutlich überfliegt.
 * Klick auf einen Listeneintrag schwenkt die Kamera zum Flugzeug.
 */

const QUERY_NM = 32; // ~59 km Abfrageradius (Kontext für Überflug-Vorhersage)
const DISPLAY_RADIUS_KM = 50; // Nahbereich für Anzeige & Liste
const PLANE_SCALE = 7; // Markergröße überhöht, damit aus km Entfernung sichtbar
const OVERFLY_DIST_M = 3000; // „über Engensen", wenn die Bahn näher heranführt
const OVERFLY_MAX_SEC = 1800; // Vorhersage bis 30 min voraus
const BASE_INTERVAL = 15_000;
const MAX_INTERVAL = 90_000;
const FT_TO_M = 0.3048;
const KT_TO_MS = 0.514444;

const COMPASS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
const compass = (deg: number) => COMPASS[Math.round(((((deg % 360) + 360) % 360) / 45)) % 8];

interface Flight {
  icao: string;
  callsign: string;
  typeCode: string;
  reg: string;
  altitudeM: number;
  onGround: boolean;
  velocityMs: number;
  track: number;
  lat: number;
  lon: number;
  distanceKm: number;
  bearing: number;
  vertRateMs: number;
  military: boolean;
}

interface Overfly {
  willOverfly: boolean;
  etaSec: number;
  minDistM: number;
}

interface PlaneObj {
  group: THREE.Group;
  flight: Flight;
}

interface Tween {
  t: number;
  dur: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromCam: THREE.Vector3;
  toCam: THREE.Vector3;
}

function makePlane(color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.5, metalness: 0.2 });
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
  g.scale.setScalar(PLANE_SCALE);
  return g;
}

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
  c2.fillStyle = "rgba(15,18,24,0.8)";
  roundRect(c2, 0, 0, canvas.width, canvas.height, 12);
  c2.fill();
  c2.fillStyle = "#f2c14e";
  c2.textBaseline = "middle";
  c2.fillText(text, pad, canvas.height / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(canvas.width * 1.1, canvas.height * 1.1, 1);
  sprite.position.y = 60 * PLANE_SCALE * 0.5;
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

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class FlightLayer {
  private root = new THREE.Group();
  private planes = new Map<string, PlaneObj>();
  private typeCache = new Map<string, string>();
  private photoCache = new Map<string, { thumb?: string; link?: string; photographer?: string }>();
  private interval = BASE_INTERVAL;
  private timer: number | undefined;
  private tween: Tween | null = null;
  private selectedIcao: string | null = null;
  private trajLine: THREE.Line | null = null;
  private trajMarker: THREE.Mesh | null = null;

  constructor(
    scene: THREE.Scene,
    private proj: Projection,
    private meta: Meta,
    private camera: THREE.PerspectiveCamera,
    private controls: OrbitControls,
  ) {
    this.root.name = "flights";
    scene.add(this.root);
  }

  start(): void {
    void this.refresh();
  }

  stop(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
  }

  private async refresh(): Promise<void> {
    try {
      const flights = await this.fetchFlights();
      const shown = flights.filter((f) => this.shouldShow(f));
      this.sync(shown);
      this.renderPanel(shown);
      this.interval = BASE_INTERVAL;
    } catch (err) {
      console.warn("adsb.lol:", (err as Error).message);
      this.interval = Math.min(this.interval * 2, MAX_INTERVAL);
      this.renderPanelError();
    } finally {
      this.timer = window.setTimeout(() => void this.refresh(), this.interval);
    }
  }

  private async fetchFlights(): Promise<Flight[]> {
    const { lat, lon } = this.meta.center;
    const res = await fetch(`/api/flights?lat=${lat}&lon=${lon}&dist=${QUERY_NM}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const ac: Record<string, unknown>[] = json.ac || [];

    return ac
      .map((a): Flight | null => {
        if (a.lat == null || a.lon == null) return null;
        const onGround = a.alt_baro === "ground";
        const altFt = onGround ? 0 : typeof a.alt_baro === "number" ? a.alt_baro : (a.alt_geom as number) || 0;
        const rate = ((a.baro_rate as number) ?? (a.geom_rate as number) ?? 0) / 60; // ft/min → ft/s
        const dbFlags = (a.dbFlags as number) || 0;
        return {
          icao: (a.hex as string).trim(),
          callsign: ((a.flight as string) || "").trim() || (a.r as string) || (a.hex as string).toUpperCase(),
          typeCode: (a.t as string) || "",
          reg: (a.r as string) || "",
          altitudeM: altFt * FT_TO_M,
          onGround,
          velocityMs: ((a.gs as number) || 0) * KT_TO_MS,
          track: (a.track as number) ?? (a.true_heading as number) ?? 0,
          lat: a.lat as number,
          lon: a.lon as number,
          distanceKm: ((a.dst as number) || 0) * 1.852,
          bearing: (a.dir as number) ?? 0,
          vertRateMs: rate * FT_TO_M,
          military: (dbFlags & 1) === 1,
        };
      })
      .filter((f): f is Flight => f !== null)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  /** Anzeigen, wenn im Nahbereich ODER Engensen demnächst überflogen wird. */
  private shouldShow(f: Flight): boolean {
    return f.distanceKm <= DISPLAY_RADIUS_KM || this.overfly(f).willOverfly;
  }

  /** Welt-Position in echten Metern (x=Ost, y=Höhe, z=-Nord). */
  private worldPos(f: Flight): THREE.Vector3 {
    const p = this.proj.project(f.lon, f.lat);
    const y = f.onGround ? 4 : Math.max(4, f.altitudeM);
    return new THREE.Vector3(p.x, y, -p.y);
  }

  /** Schätzt, ob & wann der Flug Engensen (Ursprung) überfliegt. */
  private overfly(f: Flight): Overfly {
    if (f.onGround || f.velocityMs < 5) return { willOverfly: false, etaSec: 0, minDistM: Infinity };
    const p = this.proj.project(f.lon, f.lat); // {x:Ost, y:Nord} in m
    const rad = (f.track * Math.PI) / 180;
    const vx = Math.sin(rad) * f.velocityMs; // Ost
    const vy = Math.cos(rad) * f.velocityMs; // Nord
    const vv = vx * vx + vy * vy;
    if (vv < 1e-6) return { willOverfly: false, etaSec: 0, minDistM: Infinity };
    const tStar = -(p.x * vx + p.y * vy) / vv; // Zeit zum nächsten Punkt zum Ursprung
    const cx = p.x + vx * tStar;
    const cy = p.y + vy * tStar;
    const minDist = Math.hypot(cx, cy);
    const willOverfly = tStar > 0 && tStar <= OVERFLY_MAX_SEC && minDist < OVERFLY_DIST_M;
    return { willOverfly, etaSec: tStar, minDistM: minDist };
  }

  private sync(flights: Flight[]): void {
    const seen = new Set<string>();
    for (const f of flights) {
      seen.add(f.icao);
      let obj = this.planes.get(f.icao);
      const color = f.military ? 0x7a8b3a : f.onGround ? 0x88909a : 0xffd23f;
      if (!obj) {
        const group = makePlane(color);
        group.add(makeLabel(f.callsign));
        this.root.add(group);
        obj = { group, flight: f };
        this.planes.set(f.icao, obj);
      } else {
        const mat = (obj.group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.color.setHex(color);
        mat.emissive.setHex(color);
      }
      obj.flight = f;
      obj.group.position.copy(this.worldPos(f));
      obj.group.rotation.y = -(f.track * Math.PI) / 180;
      obj.group.scale.setScalar(f.icao === this.selectedIcao ? PLANE_SCALE * 1.6 : PLANE_SCALE);
    }
    for (const [icao, obj] of this.planes) {
      if (!seen.has(icao)) {
        this.disposePlane(obj);
        this.planes.delete(icao);
      }
    }
    // Flugbahn des gewählten Flugs mitführen / aufräumen
    if (this.selectedIcao) {
      const sel = this.planes.get(this.selectedIcao);
      if (sel) this.buildTrajectory(sel.flight);
      else {
        this.selectedIcao = null;
        this.clearTrajectory();
      }
    }
  }

  /** Dead-Reckoning (echte Geschwindigkeit) + Kamera-Tween. */
  update(dt: number): void {
    for (const obj of this.planes.values()) {
      const f = obj.flight;
      if (f.onGround || f.velocityMs < 1) continue;
      const rad = (f.track * Math.PI) / 180;
      obj.group.position.x += Math.sin(rad) * f.velocityMs * dt;
      obj.group.position.z += -Math.cos(rad) * f.velocityMs * dt;
      obj.group.position.y += f.vertRateMs * dt;
    }
    if (this.tween) {
      this.tween.t += dt / this.tween.dur;
      const e = easeInOut(Math.min(this.tween.t, 1));
      this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, e);
      this.camera.position.lerpVectors(this.tween.fromCam, this.tween.toCam, e);
      if (this.tween.t >= 1) this.tween = null;
    }
  }

  /**
   * Dreht die Kamera (um den bestehenden Mittelpunkt = Engensen) so, dass das
   * Flugzeug in Blickrichtung liegt — OHNE zum Flugzeug zu springen oder den
   * Abstand zu ändern. Engensen bleibt Anker und sichtbar. Zeigt die Flugbahn.
   */
  private focus(icao: string): void {
    const obj = this.planes.get(icao);
    if (!obj) return;
    this.selectedIcao = icao;
    this.buildTrajectory(obj.flight);

    // Blickziel = Mittelpunkt zwischen Engensen und Flugzeug → beide im Bild,
    // Engensen bleibt als Referenz sichtbar, die Sicht schwenkt klar zum Objekt.
    const engensen = new THREE.Vector3(0, 0, 0);
    const plane = obj.group.position.clone();
    const toTarget = engensen.clone().lerp(plane, 0.5);

    const dx = plane.x - engensen.x;
    const dy = plane.y - engensen.y;
    const dz = plane.z - engensen.z;
    let horizDist = Math.hypot(dx, dz);
    let hx = dx, hz = dz;
    if (horizDist < 1) { hx = this.camera.position.x; hz = this.camera.position.z; horizDist = Math.hypot(hx, hz) || 1; }
    hx /= horizDist; hz /= horizDist;
    // Abstand so, dass Engensen↔Flugzeug komplett ins Bild passen
    const span = Math.hypot(horizDist, dy);
    const newD = THREE.MathUtils.clamp(span * 0.85, 1200, 26000);
    const elev = THREE.MathUtils.clamp(Math.atan2(dy, horizDist) * 0.5 + 0.18, 0.12, 1.2);
    const toCam = new THREE.Vector3(
      toTarget.x - hx * Math.cos(elev) * newD,
      toTarget.y + Math.sin(elev) * newD,
      toTarget.z - hz * Math.cos(elev) * newD,
    );

    this.tween = {
      t: 0,
      dur: 1.2,
      fromTarget: this.controls.target.clone(),
      toTarget,
      fromCam: this.camera.position.clone(),
      toCam,
    };
  }

  /** Zeichnet die vermutliche Flugbahn (Dead-Reckoning) des gewählten Flugs. */
  private buildTrajectory(f: Flight): void {
    this.clearTrajectory();
    if (f.onGround || f.velocityMs < 5) return;
    const rad = (f.track * Math.PI) / 180;
    const start = this.worldPos(f);
    const pts: THREE.Vector3[] = [];
    for (let t = -90; t <= 480; t += 15) {
      const east = Math.sin(rad) * f.velocityMs * t;
      const north = Math.cos(rad) * f.velocityMs * t;
      const y = Math.max(4, start.y + f.vertRateMs * t);
      pts.push(new THREE.Vector3(start.x + east, y, start.z - north));
    }
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0x35d0ff, transparent: true, opacity: 0.9 });
    this.trajLine = new THREE.Line(geom, mat);
    this.root.add(this.trajLine);

    // Marker am dichtesten Punkt zu Engensen (wenn Überflug wahrscheinlich)
    const of = this.overfly(f);
    if (of.willOverfly) {
      const p = this.proj.project(f.lon, f.lat);
      const cx = p.x + Math.sin(rad) * f.velocityMs * of.etaSec;
      const cy = p.y + Math.cos(rad) * f.velocityMs * of.etaSec;
      const yc = Math.max(4, start.y + f.vertRateMs * of.etaSec);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(60, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0x35d0ff, transparent: true, opacity: 0.8 }),
      );
      marker.position.set(cx, yc, -cy);
      this.root.add(marker);
      this.trajMarker = marker;
    }
  }

  private clearTrajectory(): void {
    if (this.trajLine) {
      this.root.remove(this.trajLine);
      this.trajLine.geometry.dispose();
      (this.trajLine.material as THREE.Material).dispose();
      this.trajLine = null;
    }
    if (this.trajMarker) {
      this.root.remove(this.trajMarker);
      this.trajMarker.geometry.dispose();
      (this.trajMarker.material as THREE.Material).dispose();
      this.trajMarker = null;
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
      li.textContent = `Gerade kein Flugzeug im Umkreis von ${DISPLAY_RADIUS_KM} km (und keiner im Anflug auf Engensen).`;
      list.append(li);
      return;
    }

    for (const f of flights.slice(0, 10)) {
      const li = document.createElement("li");
      li.className = "fl-item" + (f.military ? " fl-mil" : "");
      li.title = "Zum Flugzeug schwenken";
      li.addEventListener("click", () => this.focus(f.icao));

      // Foto
      const img = document.createElement("img");
      img.className = "fl-photo";
      img.alt = "";
      this.ensurePhoto(f.icao, img);

      const body = document.createElement("div");
      body.className = "fl-body";

      const cs = document.createElement("div");
      cs.className = "fl-callsign";
      cs.textContent = (f.military ? "🪖 " : "") + f.callsign;

      const typeEl = document.createElement("div");
      typeEl.className = "fl-type";
      const cached = this.typeCache.get(f.icao);
      const initial = [f.typeCode, f.reg].filter(Boolean).join(" · ");
      typeEl.textContent = cached ? `✈ ${cached}` : initial ? `✈ ${initial}` : "";
      if (!cached) void this.ensureType(f.icao, typeEl, f);

      const meta = document.createElement("div");
      meta.className = "fl-meta";
      const dist = document.createElement("span");
      dist.className = "fl-dist";
      dist.textContent = `${f.distanceKm.toFixed(1)} km ${compass(f.bearing)}`;
      const alt = document.createElement("span");
      alt.textContent = f.onGround ? "am Boden" : `${Math.round(f.altitudeM)} m`;
      const spd = document.createElement("span");
      spd.textContent = `${Math.round(f.velocityMs * 3.6)} km/h`;
      const hdg = document.createElement("span");
      hdg.textContent = `Kurs ${compass(f.track)} (${Math.round(f.track)}°)`;
      meta.append(dist, alt, spd, hdg);

      body.append(cs, typeEl, meta);

      // Überflug-Vorhersage
      const of = this.overfly(f);
      if (of.willOverfly) {
        const over = document.createElement("div");
        over.className = "fl-over";
        over.textContent = `↗ überfliegt Engensen in ~${Math.max(1, Math.round(of.etaSec / 60))} min`;
        body.append(over);
      }

      li.append(img, body);
      list.append(li);
    }
  }

  private async ensureType(icao: string, el: HTMLElement, f: Flight): Promise<void> {
    try {
      const res = await fetch(`/api/aircraft?icao=${icao}`);
      if (!res.ok) return;
      const j = await res.json();
      const parts: string[] = [];
      if (j.Manufacturer) parts.push(j.Manufacturer);
      if (j.Type) parts.push(j.Type);
      let label = parts.join(" ") || f.typeCode;
      const reg = j.Registration || f.reg;
      if (reg) label += label ? ` · ${reg}` : reg;
      if (label) {
        this.typeCache.set(icao, label);
        el.textContent = `✈ ${label}`;
      }
    } catch {
      /* Typcode bleibt stehen */
    }
  }

  private async ensurePhoto(icao: string, img: HTMLImageElement): Promise<void> {
    const cached = this.photoCache.get(icao);
    if (cached) {
      if (cached.thumb) { img.src = cached.thumb; img.title = `Foto: ${cached.photographer || ""} (planespotters.net)`; }
      return;
    }
    try {
      const res = await fetch(`/api/photo?icao=${icao}`);
      const j = await res.json();
      this.photoCache.set(icao, j);
      if (j.thumb) {
        img.src = j.thumb;
        img.title = `Foto: ${j.photographer || ""} (planespotters.net)`;
      }
    } catch {
      /* kein Foto */
    }
  }

  private renderPanelError(): void {
    const list = document.getElementById("flights-list");
    if (!list || this.planes.size > 0) return;
    list.replaceChildren();
    const li = document.createElement("li");
    li.className = "flights-empty";
    li.textContent = "Flugdaten gerade nicht verfügbar. Neuer Versuch folgt …";
    list.append(li);
  }
}
