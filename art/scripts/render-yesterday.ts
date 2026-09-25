/**
 * Génère l'œuvre de la veille (ou d'une date donnée) dans `art/exports/` :
 * `YYYY-MM-DD.svg` et `YYYY-MM-DD.png` (4000 px, 300 dpi par défaut).
 *
 *   pnpm --filter @sillage/art render:yesterday                        # fixtures, veille locale
 *   TZ=Europe/Paris SILLAGE_API_URL=https://… SILLAGE_READ_TOKEN=… \
 *     pnpm --filter @sillage/art render:yesterday
 *   pnpm --filter @sillage/art render:yesterday --date 2026-07-14 --size 2000 --out /tmp/sillage
 *
 * Source : l'API si `SILLAGE_API_URL` (ou `VITE_API_URL`) est défini, sinon les fixtures.
 * Jeton : `SILLAGE_READ_TOKEN` (ou `VITE_API_TOKEN`), un jeton de lecture seule suffit.
 *
 * Codes de sortie : 0 écrit ; 1 erreur ; 3 la journée n'a aucune donnée en base
 * (rien n'est écrit, sauf avec `--allow-empty`) : relancer plus tard, le téléphone n'a pas encore synchronisé.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createApiSource, createFixturesSource } from "../src/data";
import { isIsoDate } from "../src/engine";
import { localYesterday, renderDay } from "./render-day";

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<number> {
  // `pnpm run x -- --date …` transmet le « -- » tel quel : on l'ignore.
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const { values } = parseArgs({
    args,
    options: {
      date: { type: "string" },
      size: { type: "string", default: "4000" },
      dpi: { type: "string", default: "300" },
      out: { type: "string", default: join(here, "..", "exports") },
      "allow-empty": { type: "boolean", default: false },
    },
  });
  const date = values.date ?? localYesterday();
  if (!isIsoDate(date)) throw new Error(`--date invalide : ${date}`);
  const size = Number(values.size);
  const dpi = Number(values.dpi);
  if (!Number.isInteger(size) || size < 16 || size > 16000) throw new Error(`--size invalide : ${values.size}`);
  if (!Number.isFinite(dpi) || dpi <= 0) throw new Error(`--dpi invalide : ${values.dpi}`);

  const apiUrl = process.env.SILLAGE_API_URL || process.env.VITE_API_URL;
  const token = process.env.SILLAGE_READ_TOKEN || process.env.VITE_API_TOKEN;
  const source = apiUrl ? createApiSource({ baseUrl: apiUrl, token }) : createFixturesSource();

  const t0 = performance.now();
  const day = await renderDay(source, date, size, dpi);
  if (!day.hasData && !values["allow-empty"]) {
    console.error(`${date} : aucune donnée (source ${source.kind}). Rien n'est écrit ; --allow-empty pour rendre la brume quand même.`);
    return 3;
  }
  const outDir = resolve(values.out!);
  await mkdir(outDir, { recursive: true });
  const svgPath = join(outDir, `${date}.svg`);
  const pngPath = join(outDir, `${date}.png`);
  await writeFile(svgPath, day.svg);
  await writeFile(pngPath, day.png);
  const ms = Math.round(performance.now() - t0);
  const missing = day.scene.meta.missing.length ? ` · absent : ${day.scene.meta.missing.join(", ")}` : "";
  console.log(`${date} (source ${source.kind}${missing}) → ${svgPath}, ${pngPath} (${size} px, ${dpi} dpi) en ${ms} ms`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
