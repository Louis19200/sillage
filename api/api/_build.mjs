#!/usr/bin/env node
/**
 * Commande de build du projet Vercel de l'API (`buildCommand` de api/vercel.json).
 *
 * 1. Migrations : `src/migrate.ts` sur la base, **avant** que le nouveau code
 *    soit servi. Par défaut seulement pour un déploiement de production
 *    (`VERCEL_ENV=production`). `SILLAGE_MIGRATE=1` force, `SILLAGE_MIGRATE=0`
 *    désactive. Connexion directe (`DATABASE_URL_UNPOOLED`, posée par
 *    l'intégration Neon) si elle existe, sinon `DATABASE_URL`.
 * 2. Regroupe `_handler.ts` et ses dépendances (src/, @sillage/shared, hono,
 *    postgres, zod…) en un seul fichier ESM avec esbuild. Nécessaire : le
 *    code de l'API importe ses modules sans extension (`./db`), ce que Node
 *    refuse en ESM ; et `@sillage/shared` est publié en TypeScript.
 * 3. Écrit la sortie au format Build Output API v3 (`.vercel/output/`) :
 *    une fonction `index` qui reçoit toutes les URL. Les crons ne sont pas
 *    écrits ici : Vercel ajoute lui-même ceux de `vercel.json` à
 *    `config.json` (vérifié avec `vercel build --prod`).
 *
 * Local : `node api/_build.mjs` depuis `api/` (sans migration hors production).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const outRoot = join(apiRoot, ".vercel", "output");
const funcDir = join(outRoot, "functions", "index.func");

const log = (msg) => console.log(`[sillage build] ${msg}`);

// --- 1. Migrations ---------------------------------------------------------

function shouldMigrate(env) {
  if (env.SILLAGE_MIGRATE === "1" || env.SILLAGE_MIGRATE === "true") return true;
  if (env.SILLAGE_MIGRATE === "0" || env.SILLAGE_MIGRATE === "false") return false;
  return env.VERCEL_ENV === "production";
}

if (shouldMigrate(process.env)) {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    console.error("[sillage build] migrations demandées mais ni DATABASE_URL_UNPOOLED ni DATABASE_URL n'est défini.");
    console.error("[sillage build] Liez la base Neon au projet (onglet Storage) ou posez SILLAGE_MIGRATE=0.");
    process.exit(1);
  }
  log(`migrations (${process.env.DATABASE_URL_UNPOOLED ? "connexion directe" : "DATABASE_URL"})…`);
  const res = spawnSync(process.execPath, ["--import", "tsx", "src/migrate.ts"], {
    cwd: apiRoot,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
  if (res.status !== 0) {
    console.error("[sillage build] échec des migrations : déploiement annulé, l'ancienne version reste en ligne.");
    process.exit(res.status ?? 1);
  }
} else {
  log(`migrations ignorées (VERCEL_ENV=${process.env.VERCEL_ENV ?? "non défini"}, SILLAGE_MIGRATE=${process.env.SILLAGE_MIGRATE ?? "non défini"})`);
}

// --- 2. Bundle -------------------------------------------------------------

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(funcDir, { recursive: true });

await build({
  entryPoints: [join(here, "_handler.ts")],
  outfile: join(funcDir, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: "linked",
  legalComments: "none",
  logLevel: "warning",
  // Certaines dépendances CommonJS appellent `require` : on le fournit en ESM.
  banner: { js: 'import { createRequire as __sillageCreateRequire } from "node:module"; const require = __sillageCreateRequire(import.meta.url);' },
});
log("fonction regroupée : .vercel/output/functions/index.func/index.mjs");

// --- 3. Build Output API v3 ------------------------------------------------

writeFileSync(join(funcDir, "package.json"), JSON.stringify({ type: "module" }, null, 2) + "\n");
writeFileSync(
  join(funcDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false,
      shouldAddSourcemapSupport: true,
    },
    null,
    2,
  ) + "\n",
);

const config = {
  version: 3,
  routes: [
    // Toutes les URL vont à la fonction ; le chemin d'origine voyage aussi en
    // paramètre (voir PATH_PARAM dans _app.ts). La redirection HTTP → HTTPS
    // est faite par Vercel avant d'arriver ici.
    { src: "^/(.*)$", dest: "/index?__path=/$1" },
  ],
};
writeFileSync(join(outRoot, "config.json"), JSON.stringify(config, null, 2) + "\n");
log("config.json écrit (les crons de vercel.json y sont ajoutés par Vercel)");
