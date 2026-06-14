/**
 * Live-Solarstrahlung & geschätzter PV-Ertrag für Engensen über Open-Meteo
 * (frei, ohne API-Key). Verzahnt mit der sichtbaren Sonne / dem Tag-Nacht-System.
 */

interface SolarCurrent {
  shortwave_radiation: number; // GHI, W/m²
  direct_radiation: number;
  diffuse_radiation: number;
  sunshine_duration: number; // s im letzten Intervall
}

const PV_KWP = 5; // angenommene Hausanlage
const PV_PR = 0.85; // Performance Ratio

function category(ghi: number): { label: string; color: string } {
  if (ghi < 5) return { label: "Nacht", color: "#5a6172" };
  if (ghi < 100) return { label: "gering", color: "#8a93a5" };
  if (ghi < 300) return { label: "mäßig", color: "#e0c24a" };
  if (ghi < 600) return { label: "gut", color: "#f0a23a" };
  return { label: "sehr gut", color: "#ff8b2a" };
}

async function fetchSolar(lat: number, lon: number): Promise<{ cur: SolarCurrent; daySumKWh: number | null }> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=shortwave_radiation,direct_radiation,diffuse_radiation,sunshine_duration` +
    `&daily=shortwave_radiation_sum&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const json = await res.json();
  const sumMJ = json.daily?.shortwave_radiation_sum?.[0];
  return { cur: json.current as SolarCurrent, daySumKWh: sumMJ != null ? sumMJ / 3.6 : null };
}

function render(cur: SolarCurrent, daySumKWh: number | null): void {
  const el = document.getElementById("solar-badge");
  if (!el) return;
  const ghi = Math.round(cur.shortwave_radiation);
  const cat = category(ghi);
  const pvKw = (cur.shortwave_radiation / 1000) * PV_KWP * PV_PR;
  el.replaceChildren();

  const dot = document.createElement("span");
  dot.style.cssText = `width:9px;height:9px;border-radius:50%;background:${cat.color};box-shadow:0 0 7px ${cat.color}`;

  const main = document.createElement("span");
  main.textContent = `${ghi} W/m²`;

  const pv = document.createElement("span");
  pv.style.cssText = "color:var(--muted);font-size:11px";
  pv.textContent = `≈ ${pvKw.toFixed(1)} kW`;

  el.append(dot, main, pv);
  el.title =
    `Solarstrahlung (Open-Meteo): ${ghi} W/m² — ${cat.label}\n` +
    `direkt ${Math.round(cur.direct_radiation)} / diffus ${Math.round(cur.diffuse_radiation)} W/m²\n` +
    `geschätzter PV-Ertrag jetzt: ${pvKw.toFixed(2)} kW (${PV_KWP}-kWp-Anlage, PR ${PV_PR})` +
    (daySumKWh != null ? `\nTagessumme: ${daySumKWh.toFixed(1)} kWh/m²` : "");
}

/** Startet den Solar-Abruf und aktualisiert alle 10 Minuten. */
export function initSolar(center: { lat: number; lon: number }): void {
  const load = () =>
    fetchSolar(center.lat, center.lon)
      .then(({ cur, daySumKWh }) => render(cur, daySumKWh))
      .catch((err) => console.warn("Solar:", err.message));
  load();
  setInterval(load, 10 * 60 * 1000);
}
