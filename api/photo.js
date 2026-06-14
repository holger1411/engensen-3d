/**
 * Server-seitiger Proxy für Flugzeug-Fotos über die planespotters.net-API.
 * Diese verlangt einen beschreibenden User-Agent (im Browser nicht setzbar),
 * daher der Server-Proxy. Liefert Thumbnail-URL, Fotograf und Link zurück.
 * Nutzung gemäß planespotters-Bedingungen mit Quellenangabe.
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const icao = (req.query?.icao || "").toString().trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(icao)) {
    res.status(400).json({ error: "icao (6 Hex) fehlt" });
    return;
  }

  try {
    const upstream = await fetch(`https://api.planespotters.net/pub/photos/hex/${icao}`, {
      headers: { "User-Agent": "engensen3d/1.0 (+https://github.com/; contact holger1411@googlemail.com)" },
    });
    if (!upstream.ok) {
      res.status(200).json({});
      return;
    }
    const data = await upstream.json();
    const p = (data.photos || [])[0];
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800");
    res.status(200).json(
      p
        ? { thumb: p.thumbnail?.src, large: p.thumbnail_large?.src, link: p.link, photographer: p.photographer }
        : {},
    );
  } catch (err) {
    res.status(200).json({ error: `Foto-Proxy-Fehler: ${String(err)}` });
  }
}
