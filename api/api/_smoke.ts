/**
 * Vérification de bout en bout de la fonction Vercel, sans compte Vercel :
 *
 *   pnpm --filter @sillage/api vercel:check
 *
 * 1. démarre un Postgres PGlite en mémoire (protocole Postgres, vrai driver) ;
 * 2. lance `_build.mjs` avec `SILLAGE_MIGRATE=1` : migrations + bundle, comme sur Vercel ;
 * 3. charge `.vercel/output/functions/index.func/index.mjs` (le fichier déployé),
 *    le sert avec `node:http` et rejoue les appels de docs/DEPLOY.md.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { Hono } from "hono";
import { createVercelFetch, originalUrl } from "./_app";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const TOKEN = "s".repeat(32) + "-smoke";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

// --- Fonctions pures ---------------------------------------------------------

check("originalUrl : sans paramètre, URL inchangée", originalUrl("https://x.dev/range?from=a") === "https://x.dev/range?from=a");
check(
  "originalUrl : chemin repris de __path, autres paramètres gardés",
  originalUrl("https://x.dev/index?__path=/range&from=a&to=b") === "https://x.dev/range?from=a&to=b",
  originalUrl("https://x.dev/index?__path=/range&from=a&to=b"),
);
{
  const broken = createVercelFetch(() => {
    throw new Error("variable manquante (test)");
  });
  const origError = console.error;
  console.error = () => {};
  const res = await broken(new Request("https://x.dev/range"));
  console.error = origError;
  check("configuration invalide → 500 misconfigured", res.status === 500 && (await res.json()).error === "misconfigured");
}
{
  const app = new Hono().get("/day/:d", (c) => c.text(c.req.param("d")));
  const f = createVercelFetch(() => app);
  const res = await f(new Request("https://x.dev/index?__path=/day/2026-09-23"));
  check("réécriture /index?__path=/day/… → route /day/:date", (await res.text()) === "2026-09-23");
}

// --- Base PGlite + build ----------------------------------------------------

const port = 55_000 + Math.floor(Math.random() * 5_000);
const pg = new PGlite();
const pgServer = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 10 });
await pgServer.start();
const DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;

// Asynchrone : PGlite tourne dans ce processus, un appel bloquant l'empêcherait de répondre.
const build = await new Promise<{ status: number | null; stdout: string }>((done) => {
  const child = spawn(process.execPath, [join(here, "_build.mjs")], {
    cwd: apiRoot,
    env: { ...process.env, SILLAGE_MIGRATE: "1", DATABASE_URL, DATABASE_URL_UNPOOLED: "" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
    process.stdout.write(chunk);
  });
  child.on("close", (status) => done({ status, stdout }));
});
check("build (migrations + bundle) réussi", build.status === 0);
check("migration 001 appliquée pendant le build", /migration appliquée : 001_/.test(build.stdout));
if (build.status !== 0) {
  await pgServer.stop();
  process.exit(1);
}

const config = JSON.parse(readFileSync(join(apiRoot, ".vercel/output/config.json"), "utf8"));
check("config.json : toutes les URL vers la fonction index", config.routes?.[0]?.dest === "/index?__path=/$1");
const vc = JSON.parse(readFileSync(join(apiRoot, ".vercel/output/functions/index.func/.vc-config.json"), "utf8"));
check("fonction : runtime Node 22", vc.runtime === "nodejs22.x" && vc.handler === "index.mjs");

// --- Le fichier déployé, servi en HTTP --------------------------------------

Object.assign(process.env, { DATABASE_URL, INGEST_TOKEN: TOKEN, PROTECT_READS: "true", NODE_ENV: "production" });
const mod = (await import(pathToFileURL(join(apiRoot, ".vercel/output/functions/index.func/index.mjs")).href)) as {
  default: RequestListener;
};
const server = createServer(mod.default);
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const auth = { authorization: `Bearer ${TOKEN}` };

const ingest = await fetch(`${base}/ingest/health`, {
  method: "POST",
  headers: { ...auth, "content-type": "application/json" },
  body: JSON.stringify({ days: [{ date: "2026-09-23", steps: 0, sleep_minutes: 412 }] }),
});
check("POST /ingest/health → 200 { upserted: 1 }", ingest.status === 200 && (await ingest.json()).upserted === 1);

const range = await fetch(`${base}/range?from=2026-09-01&to=2026-09-30`, { headers: auth });
const rangeBody = (await range.json()) as { days: { steps: number | null; commits: number | null }[] };
check(
  "GET /range avec token → 200, steps 0 conservé, commits null",
  range.status === 200 && rangeBody.days.length === 1 && rangeBody.days[0]?.steps === 0 && rangeBody.days[0]?.commits === null,
  rangeBody,
);

const rewritten = await fetch(`${base}/index?__path=/range&from=2026-09-01&to=2026-09-30`, { headers: auth });
check("GET /index?__path=/range&… (forme réécrite) → 200", rewritten.status === 200 && ((await rewritten.json()) as { days: unknown[] }).days.length === 1);

const day = await fetch(`${base}/day/2026-09-23`, { headers: auth });
check("GET /day/2026-09-23 → 200", day.status === 200 && ((await day.json()) as { sleep_minutes: number }).sleep_minutes === 412);

const anon = await fetch(`${base}/range?from=2026-09-01&to=2026-09-30`);
check("GET /range sans token → 401 (PROTECT_READS=true)", anon.status === 401);

const bad = await fetch(`${base}/range?from=2026-09-01&to=2026-09-30`, { headers: { authorization: "Bearer mauvais" } });
check("GET /range avec un mauvais token → 401", bad.status === 401);

const unknown = await fetch(`${base}/nope`, { headers: auth });
check("route inconnue → 404", unknown.status === 404);

server.close();
await pgServer.stop();
await pg.close();

console.log(failures === 0 ? "\nfonction Vercel : tout est bon" : `\n${failures} vérification(s) en échec`);
process.exit(failures === 0 ? 0 : 1);
