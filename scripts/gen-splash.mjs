// Generiert das Splash-/Titelbild für „Horde30938" via kie.ai Flux-Kontext:
// eine AC-130-„Spectre" über einem Dorf, im Computerspiel-Key-Art-Stil.
//
//   node scripts/gen-splash.mjs
//
// Der kie.ai-API-Key wird aus der Umgebung (KIE_API_KEY) oder – als Fallback –
// aus dem Shooter-Projekt gelesen (dort liegt er in .env, per .gitignore
// ausgeschlossen). Er wird NICHT in dieses Repo geschrieben.

import fs from "node:fs/promises";
import path from "node:path";

async function loadKey() {
  if (process.env.KIE_API_KEY) return process.env.KIE_API_KEY.trim();
  const envPath = "/Users/holger.koenemann/Documents/claude/shooter/.env";
  const env = await fs.readFile(envPath, "utf8");
  const key = env.match(/^KIE_API_KEY=(.+)$/m)?.[1]?.trim();
  if (!key) throw new Error("KIE_API_KEY weder in env noch in shooter/.env gefunden");
  return key;
}

const FLUX = "https://api.kie.ai/api/v1/flux/kontext";
const OUT = path.join(new URL("../public/", import.meta.url).pathname, "splash.jpg");

const PROMPT =
  "Epic video game key art splash screen, dramatic cinematic digital painting: " +
  "an AC-130 Spectre gunship banking in a slow left orbit high above a small " +
  "North-German village at dusk, viewed from a heroic low cinematic angle. " +
  "Glowing engines and side-mounted cannon muzzle flashes light up the clouds, " +
  "red and orange tracer fire streaking down toward the village rooftops, " +
  "faint green thermal FLIR glow, drifting smoke, moody atmospheric storm sky, " +
  "volumetric god rays, highly detailed, dark heroic mood, zombie-defense game " +
  "cover art, ultra sharp 8k, wide composition with empty darker sky area at the " +
  "top for a title. No text, no letters, no watermark, no logo, no UI, no HUD.";

const headers = (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" });

async function main() {
  const key = await loadKey();
  console.log("→ Flux-Kontext: Splash-Generierung einreichen …");
  let res = await fetch(`${FLUX}/generate`, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({
      prompt: PROMPT,
      aspectRatio: "16:9",
      outputFormat: "jpeg",
      model: "flux-kontext-max",
      promptUpsampling: false,
    }),
  });
  let data = await res.json();
  if (data.code !== 200) throw new Error(`Submit-Fehler: ${JSON.stringify(data)}`);
  const taskId = data.data.taskId;
  console.log(`  taskId=${taskId}`);

  let url = null;
  for (let i = 0; i < 80 && !url; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const r2 = await fetch(`${FLUX}/record-info?taskId=${encodeURIComponent(taskId)}`, { headers: headers(key) });
    const d = (await r2.json()).data || {};
    if (d.successFlag === 1) {
      url = d.response?.resultImageUrl || d.resultImageUrl;
      if (!url) throw new Error("Erfolg, aber keine Bild-URL");
    } else if (d.successFlag === 2 || d.successFlag === 3) {
      throw new Error(`Task fehlgeschlagen: ${d.errorCode} ${d.errorMessage}`);
    } else {
      process.stdout.write(`  · warte (${(i + 1) * 3}s)\r`);
    }
  }
  if (!url) throw new Error("Timeout");
  console.log(`\n  ✓ fertig: ${url}`);

  const dl = await fetch(url);
  if (!dl.ok) throw new Error(`Download-Fehler ${dl.status}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  await fs.writeFile(OUT, buf);
  console.log(`  ✓ ${OUT}  (${(buf.length / 1024).toFixed(0)} kB)`);
}

main().catch((e) => {
  console.error("Fehler:", e.message);
  process.exit(1);
});
