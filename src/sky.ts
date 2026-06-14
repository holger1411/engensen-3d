import * as THREE from "three";
import type { SceneBundle } from "./scene";

/**
 * Echter Sonnenstand für Engensen aus der aktuellen Uhrzeit (live) — steuert
 * Lichtrichtung, -farbe, -intensität sowie Himmel-/Nebelfarbe und Tag/Nacht.
 * Sonnenpositions-Algorithmus nach SunCalc (V. Agafonkin, Public Domain).
 */

const rad = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const e = rad * 23.4397; // Ekliptik-Schiefe

const toDays = (date: Date) => date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
const declination = (l: number, b: number) =>
  Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
const rightAscension = (l: number, b: number) =>
  Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
const siderealTime = (d: number, lw: number) => rad * (280.16 + 360.9856235 * d) - lw;
const solarMeanAnomaly = (d: number) => rad * (357.5291 + 0.98560028 * d);
function eclipticLongitude(M: number): number {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + rad * 102.9372 + Math.PI;
}

interface SunPos {
  azimuthFromNorth: number; // rad, 0 = Nord, im Uhrzeigersinn
  altitude: number; // rad über Horizont
}

function sunPosition(date: Date, lat: number, lon: number): SunPos {
  const lw = rad * -lon;
  const phi = rad * lat;
  const d = toDays(date);
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  const dec = declination(L, 0);
  const ra = rightAscension(L, 0);
  const H = siderealTime(d, lw) - ra;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  // SunCalc-Azimut: von Süden, im Uhrzeigersinn nach Westen → in „von Norden" umrechnen
  const azS = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { azimuthFromNorth: azS + Math.PI, altitude };
}

// --- Sonnenauf-/-untergang (SunCalc getTimes) --------------------------------
const J0 = 0.0009;
const fromDays = (d: number) => new Date((d + J2000 + 0.5 - J1970) * DAY_MS);
const solarTransitJ = (ds: number, M: number, L: number) => ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
function hourAngle(h: number, phi: number, dec: number): number {
  return Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
}
function sunTimes(date: Date, lat: number, lon: number): { sunrise: Date | null; sunset: Date | null } {
  const lw = rad * -lon;
  const phi = rad * lat;
  const d = toDays(date);
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + (0 + lw) / (2 * Math.PI) + n;
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L, 0);
  const Jnoon = solarTransitJ(ds, M, L);
  const h0 = -0.833 * rad; // Sonnenober­rand am Horizont
  const cosH = (Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosH > 1 || cosH < -1) return { sunrise: null, sunset: null }; // Polartag/-nacht
  const w = hourAngle(h0, phi, dec);
  const a = J0 + (w + lw) / (2 * Math.PI) + n;
  const Jset = solarTransitJ(a, M, L);
  const Jrise = Jnoon - (Jset - Jnoon);
  return { sunrise: fromDays(Jrise), sunset: fromDays(Jset) };
}
const hhmm = (d: Date | null) =>
  d ? `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}` : "—";

const lerpColor = (a: number, b: number, t: number) =>
  new THREE.Color(a).lerp(new THREE.Color(b), THREE.MathUtils.clamp(t, 0, 1));

// Farbpaletten
const SKY_DAY = 0x9fc4e8;
const SKY_GOLDEN = 0xe7b072;
const SKY_DUSK = 0x46506e;
const SKY_NIGHT = 0x0a0f1c;
const SUN_WARM = 0xffca69;
const SUN_WHITE = 0xfff4dd;

const WINDOW_WARM = new THREE.Color(0xff9a3c);

/** Leuchtende Sonnenscheibe (Sprite mit weichem Schein). */
function makeSunSprite(): THREE.Sprite {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, "rgba(255,250,230,1)");
  g.addColorStop(0.18, "rgba(255,240,190,1)");
  g.addColorStop(0.4, "rgba(255,210,120,0.55)");
  g.addColorStop(1.0, "rgba(255,200,110,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(3200);
  return sprite;
}

export class SolarSky {
  /** Optionale feste Vorschauzeit (?t=ISO); sonst Echtzeit. */
  private simTime: Date | null;

  private sunSprite = makeSunSprite();

  constructor(
    private bundle: SceneBundle,
    private center: { lat: number; lon: number },
    private buildings: THREE.Mesh[] = [],
    simTime?: Date | null,
  ) {
    this.simTime = simTime ?? null;
    bundle.scene.add(this.sunSprite);
  }

  start(): void {
    this.update();
    setInterval(() => this.update(), 60 * 1000); // jede Minute
  }

  private now(): Date {
    return this.simTime ?? new Date();
  }

  private update(): void {
    const { sun, hemi, ambient, scene } = this.bundle;
    const date = this.now();
    const pos = sunPosition(date, this.center.lat, this.center.lon);
    const alt = pos.altitude;
    const az = pos.azimuthFromNorth;

    // Lichtrichtung (Welt: x=Ost, z=-Nord, y=hoch)
    const horiz = Math.cos(alt);
    const dir = new THREE.Vector3(horiz * Math.sin(az), Math.max(Math.sin(alt), -0.2), -horiz * Math.cos(az));
    sun.position.copy(dir.clone().multiplyScalar(900));
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();

    // Sichtbare Sonnenscheibe an der echten Sonnenposition (nachts ausblenden)
    const sunUnit = new THREE.Vector3(horiz * Math.sin(az), Math.sin(alt), -horiz * Math.cos(az));
    this.sunSprite.position.copy(sunUnit.multiplyScalar(20000));
    this.sunSprite.visible = alt > -0.05;

    const altDeg = (alt * 180) / Math.PI;

    if (alt > 0) {
      // Tag: Intensität & Farbe nach Sonnenhöhe
      const high = THREE.MathUtils.clamp(altDeg / 50, 0, 1); // 0 = Horizont, 1 = hoch
      sun.intensity = 0.5 + high * 1.8;
      sun.color.copy(lerpColor(SUN_WARM, SUN_WHITE, high));
      hemi.intensity = 0.5 + high * 0.5;
      ambient.intensity = 0.2 + high * 0.15;

      const skyT = THREE.MathUtils.clamp(altDeg / 12, 0, 1); // golden bis ~12°
      const sky = lerpColor(SKY_GOLDEN, SKY_DAY, skyT);
      this.applySky(scene, sky, 0xbfd9f2, 0x6b6f55);
    } else if (altDeg > -8) {
      // Dämmerung
      const t = THREE.MathUtils.clamp((altDeg + 8) / 8, 0, 1); // -8°..0°
      sun.intensity = 0.15 * t;
      sun.color.copy(new THREE.Color(SUN_WARM));
      hemi.intensity = 0.25 + t * 0.25;
      ambient.intensity = 0.18;
      const sky = lerpColor(SKY_DUSK, SKY_GOLDEN, t);
      this.applySky(scene, sky, 0x6a78a0, 0x3a3c40);
    } else {
      // Nacht
      sun.intensity = 0;
      hemi.intensity = 0.2;
      ambient.intensity = 0.16;
      this.applySky(scene, new THREE.Color(SKY_NIGHT), 0x223052, 0x0a0e16);
    }

    // Nachtbeleuchtung: Fensterlicht je nach Dunkelheit (0 = Tag, 1 = Nacht).
    const darkness = THREE.MathUtils.clamp((2 - altDeg) / 8, 0, 1);
    this.applyNightLights(darkness);

    this.updateBadge(altDeg, az, date);
  }

  /** Lässt einen Teil der Gebäude bei Dunkelheit warm leuchten. */
  private applyNightLights(darkness: number): void {
    for (const mesh of this.buildings) {
      if (!mesh.userData.lit) continue;
      const glow = mesh.userData.glow as THREE.Color;
      glow.copy(WINDOW_WARM).multiplyScalar(darkness * 0.55);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) (m as THREE.MeshStandardMaterial).emissive.copy(glow);
    }
  }

  private applySky(scene: THREE.Scene, sky: THREE.Color, hemiSky: number, hemiGround: number): void {
    (scene.background as THREE.Color).copy(sky);
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(sky);
    this.bundle.hemi.color.setHex(hemiSky);
    this.bundle.hemi.groundColor.setHex(hemiGround);
  }

  private updateBadge(altDeg: number, az: number, date: Date): void {
    const el = document.getElementById("sun-badge");
    if (!el) return;
    const compass = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
    const dir = compass[Math.round((((az * 180) / Math.PI) % 360) / 45) % 8];
    const icon = altDeg > 0 ? "☀️" : altDeg > -8 ? "🌅" : "🌙";
    el.textContent = `${icon} ${altDeg > 0 ? `${Math.round(altDeg)}° ${dir}` : altDeg > -8 ? "Dämmerung" : "Nacht"}`;
    const t = sunTimes(date, this.center.lat, this.center.lon);
    el.title = `Sonnenstand ${Math.round(altDeg)}° (live) · 🌅 ${hhmm(t.sunrise)} · 🌇 ${hhmm(t.sunset)}`;
  }
}
