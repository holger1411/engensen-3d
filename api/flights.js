/**
 * Server-seitiger Proxy für die OpenSky-Flugdaten (umgeht die CORS-Beschränkung
 * der OpenSky-API, die nur die eigene Domain erlaubt). Läuft als Vercel-Function.
 *
 * Optional: Mit den Umgebungsvariablen OPENSKY_USER / OPENSKY_PASS wird ein
 * höheres Rate-Limit genutzt; ohne sie funktioniert der anonyme Zugriff.
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { lamin, lomin, lamax, lomax } = req.query || {};
  if (!lamin || !lomin || !lamax || !lomax) {
    res.status(400).json({ error: "bbox fehlt (lamin,lomin,lamax,lomax)" });
    return;
  }

  const url =
    `https://opensky-network.org/api/states/all` +
    `?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;

  const headers = {};
  if (process.env.OPENSKY_USER && process.env.OPENSKY_PASS) {
    const token = Buffer.from(`${process.env.OPENSKY_USER}:${process.env.OPENSKY_PASS}`).toString("base64");
    headers.Authorization = `Basic ${token}`;
  }

  try {
    const upstream = await fetch(url, { headers });
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `OpenSky HTTP ${upstream.status}` });
      return;
    }
    const data = await upstream.json();
    // CDN-Caching: mehrere Besucher teilen sich einen Abruf → schont das Rate-Limit
    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=20");
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: `Proxy-Fehler: ${String(err)}` });
  }
}
