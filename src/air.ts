/**
 * Live-Luftqualität für Engensen über die Open-Meteo Air-Quality-API
 * (frei, ohne API-Key). Zeigt den europäischen AQI plus Feinstaub im Badge.
 */

interface AirCurrent {
  european_aqi: number;
  pm10: number;
  pm2_5: number;
  ozone: number;
}

interface Band {
  max: number;
  label: string;
  color: string;
}
const BANDS: Band[] = [
  { max: 20, label: "gut", color: "#50f0a0" },
  { max: 40, label: "ordentlich", color: "#a8e05a" },
  { max: 60, label: "mäßig", color: "#f0d050" },
  { max: 80, label: "schlecht", color: "#f09050" },
  { max: 100, label: "sehr schlecht", color: "#e05858" },
  { max: Infinity, label: "extrem schlecht", color: "#b05ad0" },
];
const band = (aqi: number) => BANDS.find((b) => aqi <= b.max) ?? BANDS[BANDS.length - 1];

async function fetchAir(lat: number, lon: number): Promise<AirCurrent> {
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    `&current=european_aqi,pm10,pm2_5,ozone&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Air-Quality HTTP ${res.status}`);
  const json = await res.json();
  return json.current as AirCurrent;
}

function render(c: AirCurrent): void {
  const el = document.getElementById("air-badge");
  if (!el) return;
  const b = band(c.european_aqi);
  el.replaceChildren();

  const dot = document.createElement("span");
  dot.style.cssText = `width:9px;height:9px;border-radius:50%;background:${b.color};box-shadow:0 0 7px ${b.color}`;

  const txt = document.createElement("span");
  txt.textContent = `AQI ${Math.round(c.european_aqi)} · ${b.label}`;

  const pm = document.createElement("span");
  pm.style.cssText = "color:var(--muted);font-size:11px";
  pm.textContent = `PM2.5 ${c.pm2_5}`;

  el.append(dot, txt, pm);
  el.title = `Luftqualität (Open-Meteo) — AQI ${Math.round(c.european_aqi)}, PM2.5 ${c.pm2_5} µg/m³, PM10 ${c.pm10} µg/m³, Ozon ${c.ozone} µg/m³`;
}

/** Startet den Luftqualitäts-Abruf und aktualisiert alle 15 Minuten. */
export function initAir(center: { lat: number; lon: number }): void {
  const load = () =>
    fetchAir(center.lat, center.lon)
      .then(render)
      .catch((err) => console.warn("Luftqualität:", err.message));
  load();
  setInterval(load, 15 * 60 * 1000);
}
