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
        // OpenSky-Flugdaten
        server.middlewares.use("/api/flights", async (req, res) => {
          const qs = (req.originalUrl || req.url || "").split("?")[1] || "";
          const target = `https://opensky-network.org/api/states/all?${qs}`;
          try {
            const upstream = await fetch(target);
            const body = await upstream.text();
            res.setHeader("Content-Type", "application/json");
            res.statusCode = upstream.status;
            res.end(body);
          } catch (err) {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: `Proxy-Fehler: ${String(err)}` }));
          }
        });
        // Flugzeug-Stammdaten (Typ)
        server.middlewares.use("/api/aircraft", async (req, res) => {
          const qs = new URLSearchParams((req.originalUrl || req.url || "").split("?")[1] || "");
          const icao = (qs.get("icao") || "").toLowerCase();
          res.setHeader("Content-Type", "application/json");
          if (!/^[0-9a-f]{6}$/.test(icao)) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "icao fehlt" }));
            return;
          }
          try {
            const upstream = await fetch(`https://hexdb.io/api/v1/aircraft/${icao}`);
            res.statusCode = 200;
            res.end(upstream.ok ? await upstream.text() : "{}");
          } catch {
            res.end("{}");
          }
        });
      },
    },
  ],
});
