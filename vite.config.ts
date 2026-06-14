import { defineConfig } from "vite";

/**
 * Dev-Server-Proxy: bildet im lokalen Betrieb dieselbe Route `/api/flights`
 * nach wie die Vercel-Function in Produktion — holt OpenSky-Daten server-seitig
 * und umgeht so die CORS-Sperre der OpenSky-API.
 */
export default defineConfig({
  plugins: [
    {
      name: "live-data-dev-proxy",
      configureServer(server) {
        const query = (req) => new URLSearchParams((req.originalUrl || req.url || "").split("?")[1] || "");
        const UA = "engensen3d/1.0 (+https://github.com/; contact holger1411@googlemail.com)";

        // Flugdaten (adsb.lol Radius-Abfrage)
        server.middlewares.use("/api/flights", async (req, res) => {
          const q = query(req);
          const lat = q.get("lat"), lon = q.get("lon");
          const nm = Math.min(Math.max(parseInt(q.get("dist") || "30", 10), 1), 250);
          res.setHeader("Content-Type", "application/json");
          if (!lat || !lon) { res.statusCode = 400; res.end(JSON.stringify({ error: "lat/lon fehlt" })); return; }
          try {
            const upstream = await fetch(`https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${nm}`, { headers: { "User-Agent": UA } });
            res.statusCode = upstream.status;
            res.end(await upstream.text());
          } catch (err) {
            res.statusCode = 502; res.end(JSON.stringify({ error: String(err) }));
          }
        });

        // Flugzeug-Stammdaten (Typ) via hexdb.io
        server.middlewares.use("/api/aircraft", async (req, res) => {
          const icao = (query(req).get("icao") || "").toLowerCase();
          res.setHeader("Content-Type", "application/json");
          if (!/^[0-9a-f]{6}$/.test(icao)) { res.statusCode = 400; res.end(JSON.stringify({ error: "icao fehlt" })); return; }
          try {
            const upstream = await fetch(`https://hexdb.io/api/v1/aircraft/${icao}`);
            res.statusCode = 200;
            res.end(upstream.ok ? await upstream.text() : "{}");
          } catch { res.end("{}"); }
        });

        // Flugzeug-Foto via planespotters (braucht beschreibenden User-Agent)
        server.middlewares.use("/api/photo", async (req, res) => {
          const icao = (query(req).get("icao") || "").toLowerCase();
          res.setHeader("Content-Type", "application/json");
          if (!/^[0-9a-f]{6}$/.test(icao)) { res.statusCode = 400; res.end(JSON.stringify({ error: "icao fehlt" })); return; }
          try {
            const upstream = await fetch(`https://api.planespotters.net/pub/photos/hex/${icao}`, { headers: { "User-Agent": UA } });
            const j = upstream.ok ? await upstream.json() : {};
            const p = (j.photos || [])[0];
            res.statusCode = 200;
            res.end(JSON.stringify(p ? { thumb: p.thumbnail?.src, large: p.thumbnail_large?.src, link: p.link, photographer: p.photographer } : {}));
          } catch { res.end("{}"); }
        });
      },
    },
  ],
});
