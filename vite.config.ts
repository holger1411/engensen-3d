import { defineConfig } from "vite";

/**
 * Dev-Server-Proxy: bildet im lokalen Betrieb dieselbe Route `/api/flights`
 * nach wie die Vercel-Function in Produktion — holt OpenSky-Daten server-seitig
 * und umgeht so die CORS-Sperre der OpenSky-API.
 */
export default defineConfig({
  plugins: [
    {
      name: "opensky-dev-proxy",
      configureServer(server) {
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
      },
    },
  ],
});
