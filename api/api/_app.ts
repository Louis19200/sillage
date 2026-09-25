/**
 * Application servie par la fonction Vercel (zone `deploy`).
 *
 * Réutilise `createApp` tel quel, avec la même configuration que `src/server.ts`,
 * mais sans ouvrir de port ni démarrer `node-cron` : en serverless, les tâches
 * planifiées passent par les Vercel Cron Jobs (`vercel.json` → `GET /cron/:name`).
 *
 * Les fichiers de ce dossier commencent par `_` pour que Vercel ne les prenne
 * pas pour des fonctions : la fonction est construite par `_build.mjs`
 * (Build Output API), voir docs/DEPLOY.md.
 */
import type { Hono } from "hono";
import { createApp, depsFromEnv } from "../src/app";
import { getDb } from "../src/db";
import { EnvError, loadEnv } from "../src/env";

/**
 * Paramètre ajouté par la route de `.vercel/output/config.json`
 * (`/(.*)` → `/index?__path=/$1`). Il porte le chemin demandé par le client,
 * au cas où la plateforme transmettrait à la fonction l'URL réécrite plutôt
 * que l'URL d'origine.
 */
export const PATH_PARAM = "__path";

/** Remet dans l'URL le chemin demandé par le client, et retire le paramètre technique. */
export function originalUrl(raw: string): string {
  const url = new URL(raw);
  const forwarded = url.searchParams.get(PATH_PARAM);
  if (forwarded === null) return raw;
  url.searchParams.delete(PATH_PARAM);
  url.pathname = forwarded.startsWith("/") ? forwarded : `/${forwarded}`;
  return url.toString();
}

export type Fetch = (req: Request) => Promise<Response>;

/**
 * `fetch` de la fonction. L'application est construite à la première requête
 * (et gardée tant que l'instance vit) : une variable manquante donne une
 * réponse 500 lisible dans les journaux Vercel au lieu d'un plantage au chargement.
 */
export function createVercelFetch(build: () => Hono = buildFromEnv): Fetch {
  let app: Hono | undefined;
  return async (req) => {
    try {
      app ??= build();
    } catch (err) {
      console.error(err instanceof EnvError ? err.message : err);
      return Response.json({ error: "misconfigured", message: "variables d'environnement invalides, voir les journaux" }, { status: 500 });
    }
    const url = originalUrl(req.url);
    return app.fetch(url === req.url ? req : new Request(url, req));
  };
}

/**
 * Même configuration que `src/server.ts` (hors port et tâches `node-cron`) :
 * tokens, `PROTECT_READS`, `READ_TOKEN`, `CRON_SECRET`, `CORS_ORIGINS`.
 */
export function buildFromEnv(): Hono {
  return createApp(depsFromEnv(loadEnv(), getDb()));
}
