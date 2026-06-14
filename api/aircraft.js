/**
 * Server-seitiger Proxy für Flugzeug-Stammdaten (Typ, Hersteller, Kennung)
 * über hexdb.io, anhand der Mode-S/ICAO24-Adresse. Frei, ohne API-Key.
 * Läuft als Vercel-Function; im Dev übernimmt ein Vite-Plugin dieselbe Route.
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const icao = (req.query?.icao || "").toString().trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(icao)) {
    res.status(400).json({ error: "icao (6 Hex) fehlt" });
    return;
  }

  try {
    const upstream = await fetch(`https://hexdb.io/api/v1/aircraft/${icao}`);
    if (!upstream.ok) {
      res.status(200).json({}); // unbekannt → leer (kein harter Fehler)
      return;
    }
    const data = await upstream.json();
    // Stammdaten ändern sich praktisch nie → lange cachen
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800");
    res.status(200).json(data);
  } catch (err) {
    res.status(200).json({ error: `Lookup-Fehler: ${String(err)}` });
  }
}
