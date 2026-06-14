/**
 * Aktuelles Wetter für Engensen über Open-Meteo (frei, ohne API-Key).
 * https://open-meteo.com/
 */

interface OpenMeteoCurrent {
  temperature_2m: number;
  relative_humidity_2m: number;
  weather_code: number;
  wind_speed_10m: number;
  wind_direction_10m: number;
}

/** WMO-Wettercode → Emoji + deutsche Kurzbeschreibung. */
function describe(code: number): { icon: string; text: string } {
  const map: Record<number, [string, string]> = {
    0: ["☀️", "Klar"],
    1: ["🌤️", "Überwiegend klar"],
    2: ["⛅", "Teils bewölkt"],
    3: ["☁️", "Bewölkt"],
    45: ["🌫️", "Nebel"],
    48: ["🌫️", "Reifnebel"],
    51: ["🌦️", "Leichter Niesel"],
    53: ["🌦️", "Niesel"],
    55: ["🌧️", "Starker Niesel"],
    61: ["🌦️", "Leichter Regen"],
    63: ["🌧️", "Regen"],
    65: ["🌧️", "Starker Regen"],
    71: ["🌨️", "Leichter Schnee"],
    73: ["🌨️", "Schnee"],
    75: ["❄️", "Starker Schnee"],
    77: ["🌨️", "Schneegriesel"],
    80: ["🌦️", "Schauer"],
    81: ["🌧️", "Schauer"],
    82: ["⛈️", "Heftige Schauer"],
    85: ["🌨️", "Schneeschauer"],
    86: ["❄️", "Schneeschauer"],
    95: ["⛈️", "Gewitter"],
    96: ["⛈️", "Gewitter mit Hagel"],
    99: ["⛈️", "Schweres Gewitter"],
  };
  return { icon: (map[code]?.[0]) ?? "🌡️", text: (map[code]?.[1]) ?? "—" };
}

const COMPASS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8];

async function fetchWeather(lat: number, lon: number): Promise<OpenMeteoCurrent> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m` +
    `&wind_speed_unit=kmh&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const json = await res.json();
  return json.current as OpenMeteoCurrent;
}

function render(c: OpenMeteoCurrent): void {
  const el = document.getElementById("weather");
  if (!el) return;
  const d = describe(c.weather_code);
  el.replaceChildren();

  const icon = document.createElement("span");
  icon.className = "w-icon";
  icon.textContent = d.icon;

  const temp = document.createElement("span");
  temp.className = "w-temp";
  temp.textContent = `${Math.round(c.temperature_2m)}°`;

  const meta = document.createElement("span");
  meta.className = "w-meta";
  meta.textContent = `${d.text} · 💨 ${Math.round(c.wind_speed_10m)} km/h ${compass(c.wind_direction_10m)} · 💧 ${c.relative_humidity_2m}%`;

  el.append(icon, temp, meta);
}

function renderError(): void {
  const el = document.getElementById("weather");
  if (el) {
    el.replaceChildren();
    const s = document.createElement("span");
    s.className = "w-meta";
    s.textContent = "Wetter nicht verfügbar";
    el.append(s);
  }
}

/** Startet den Wetter-Abruf und aktualisiert alle 10 Minuten. */
export function initWeather(center: { lat: number; lon: number }): void {
  const load = () =>
    fetchWeather(center.lat, center.lon)
      .then(render)
      .catch((err) => {
        console.warn("Wetter:", err.message);
        renderError();
      });
  load();
  setInterval(load, 10 * 60 * 1000);
}
