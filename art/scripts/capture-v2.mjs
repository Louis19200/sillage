// Moteur v2 : captures et vérifications dans Chromium (Playwright global, sans `playwright install`).
//
//   pnpm --filter @sillage/art exec vite --port 5231 --strictPort &   # serveur de dev (fixtures)
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node art/scripts/capture-v2.mjs [http://localhost:5231]
//
// 1. Déterminisme : chaque technique est rendue deux fois dans deux chargements de page ; les
//    empreintes des pixels doivent être identiques.
// 2. Sélecteur v1/v2 mémorisé (localStorage) d'une page à l'autre.
// 3. Captures dans art/docs/previews/v2/ : page du jour avec la fiche dépliée, galerie mois et année.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? "/opt/node22/lib/node_modules/playwright");

const base = process.argv[2] ?? "http://localhost:5231";
const out = new URL("../docs/previews/v2/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();

async function hashes() {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("  erreur page :", e.message));
  await page.goto(`${base}/?date=2026-07-14`);
  await page.waitForFunction(() => document.body.dataset.ready);
  const res = await page.evaluate(async () => {
    const v2 = await import("/src/engine-v2/index.ts");
    const { renderDirect } = await import("/src/engine-v2/render.ts");
    const { createFixturesSource } = await import("/src/data/fixtures.ts");
    const days = await createFixturesSource().getRange("2026-01-01", "2026-12-31");
    const out = {};
    for (const t of v2.ALL_TECHNIQUES) {
      const input = v2.buildTechniqueInput("2026-07-14", days, t.id);
      const run = async () => {
        const c = document.createElement("canvas");
        c.width = c.height = 300;
        const ctx = c.getContext("2d");
        await renderDirect(ctx, 300, input);
        const d = ctx.getImageData(0, 0, 300, 300).data;
        let h = 2166136261;
        for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619) >>> 0;
        return h.toString(16);
      };
      out[t.id] = [await run(), await run()];
    }
    return out;
  });
  await page.close();
  return res;
}

const a = await hashes();
const b = await hashes();
for (const id of Object.keys(a)) {
  check(`${id} : même image deux fois de suite et après rechargement`, a[id][0] === a[id][1] && a[id][0] === b[id][0], { a: a[id], b: b[id] });
}

// Sélecteur mémorisé.
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${base}/gallery/?month=2026-07`);
  await page.waitForFunction(() => document.body.dataset.ready);
  check("première visite : v2 par défaut", (await page.evaluate(() => document.body.dataset.engine)) === "v2");
  await page.goto(`${base}/?date=2026-07-14&engine=v1`);
  await page.waitForFunction(() => document.body.dataset.ready);
  await page.goto(`${base}/gallery/?month=2026-07`);
  await page.waitForFunction(() => document.body.dataset.ready);
  check("choix v1 mémorisé dans la galerie", (await page.evaluate(() => document.body.dataset.engine)) === "v1");
  await ctx.close();
}

async function shot(url, file, viewport, { full = true, open = null } = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("  erreur page :", e.message));
  await page.goto(`${base}${url}`);
  await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 120_000 });
  if (open) await page.evaluate(open);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}${file}`, fullPage: full, type: file.endsWith(".jpg") ? "jpeg" : "png", ...(file.endsWith(".jpg") ? { quality: 86 } : {}) });
  const info = await page.evaluate(() => window.__v2 ?? window.__gallery?.stats ?? null);
  console.log(`capture ${file} ${JSON.stringify(info)}`);
  await page.close();
}

await shot("/?date=2026-07-09&fiche", "day-v2-attracteur-fiche.jpg", { width: 1100, height: 1300 });
await shot("/?date=2026-06-06&fiche", "day-v2-maree-fiche.jpg", { width: 1100, height: 1300 });
await shot("/?date=2026-07-14&fiche", "day-v2-provisoire-fiche.jpg", { width: 1100, height: 1300 });
await shot("/?date=2026-07-09&fiche", "day-v2-mobile.jpg", { width: 390, height: 844 });
await shot("/gallery/?month=2026-07", "gallery-v2-month.jpg", { width: 1200, height: 1100 });
await shot("/gallery/?year=2026", "gallery-v2-year.jpg", { width: 1200, height: 1100 });

await browser.close();
console.log(failures === 0 ? "\nmoteur v2 : tout est bon" : `\n${failures} vérification(s) en échec`);
process.exit(failures === 0 ? 0 : 1);
