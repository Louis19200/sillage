// Rend chaque esquisse dans Chromium et assemble une planche.
// Usage (serveur Vite lancé dans art/ sur le port 5199) : node sketches/render.mjs [technique…]
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? "/opt/node22/lib/node_modules/playwright");

const ALL = [
  ["maree", "Marée (v1)", "bruit & champ de flux"],
  ["attracteur", "Attracteur", "chaos déterministe (Clifford)"],
  ["pelage", "Pelage", "réaction-diffusion (Gray-Scott)"],
  ["corail", "Corail", "croissance (colonisation de l'espace)"],
  ["harmonographe", "Harmonographe", "courbe paramétrique amortie"],
  ["vitrail", "Vitrail", "géométrie (Voronoï)"],
  ["constructif", "Constructif", "composition géométrique à règles"],
  ["reseau", "Réseau", "vie artificielle (physarum)"],
  ["hachures", "Hachures", "art du tracé (plotter)"],
  ["pixels", "Pixels", "glitch (tri de pixels)"],
];
const wanted = process.argv.slice(2);
const list = wanted.length ? ALL.filter(([k]) => wanted.includes(k)) : ALL;
if (wanted.includes("planche")) list.length = 0;
const out = new URL("./out/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
page.on("pageerror", (e) => console.error("  erreur page :", e.message));
for (const [key, label] of list) {
  await page.goto(`http://localhost:5199/sketches/?t=${key}`);
  await page.waitForFunction(() => window.done !== undefined, null, { timeout: 180_000 });
  const ms = await page.evaluate(() => window.done);
  await page.locator("canvas").screenshot({ path: `${out}${key}.png` });
  console.log(`${label.padEnd(14)} ${ms} ms`);
}
if (!wanted.length || wanted.includes("planche")) {
  const cards = ALL.map(([k, l, f]) => `<figure><img src="data:image/png;base64,${readFileSync(`${out}${k}.png`).toString("base64")}"><figcaption><b>${l}</b><span>${f}</span></figcaption></figure>`).join("");
  await page.setViewportSize({ width: 2400, height: 1300 });
  await page.setContent(`<html><body style="margin:0;background:#eee8dc;font-family:Georgia,serif;color:#1d1f2b">
    <header style="padding:40px 56px 8px"><div style="font-size:40px">Sillage · une journée, dix techniques</div>
    <div style="font:18px/1.5 sans-serif;color:#6b6457;margin-top:8px">14 juillet 2026 : 12 238 pas · 8 h 29 de sommeil · 14 commits · 19–28 °C, averse, vent d'ouest 22 km/h (météo inventée). Même palette partout : seule la technique change.</div></header>
    <main style="display:grid;grid-template-columns:repeat(5,1fr);gap:28px;padding:28px 56px 48px">${cards}</main>
    <style>figure{margin:0}img{width:100%;display:block;box-shadow:0 10px 30px rgba(0,0,0,.18)}figcaption{font:16px sans-serif;margin-top:12px;display:flex;flex-direction:column;gap:2px}figcaption span{color:#7b7466;font-size:14px}</style></body></html>`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}planche.png`, fullPage: true });
  console.log("planche : out/planche.png");
}
await browser.close();
