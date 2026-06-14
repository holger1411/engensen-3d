/**
 * Server-seitiger Proxy für Live-Flugdaten über adsb.lol (frei, ohne Key).
 * Radius-Abfrage um einen Punkt — liefert Distanz, Richtung, Typ, Kennung,
 * Höhe, Kurs und ein Militär-Flag (dbFlags) direkt mit.
 * Läuft als Vercel-Function; im Dev übernimmt ein Vite-Plugin dieselbe Route.
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { lat, lon, dist } = req.query || {};
  if (!lat || !lon) {
    res.status(400).json({ error: "lat/lon fehlt" });
    return;
  }
  const nm = Math.min(Math.max(parseInt(dist, 10) || 30, 1), 250);
  const url = `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${nm}`;

  try {
    const upstream = await fetch(url, {
      headers: { "User-Agent": "engensen3d/1.0 (+https://github.com/; flight overlay)" },
    });
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `adsb.lol HTTP ${upstream.status}` });
      return;
    }
    const data = await upstream.json();
    res.setHeader("Cache-Control", "s-maxage=5, stale-while-revalidate=15");
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: `Proxy-Fehler: ${String(err)}` });
  }
}
