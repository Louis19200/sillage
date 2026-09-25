/**
 * Zone extensions (phase 8, contexte de la journée), montée par une seule ligne
 * au début de `createApp` (app.ts), **avant** les routes de lecture (Hono exécute
 * les middlewares dans l'ordre d'enregistrement) :
 *
 *  - `POST /ingest/location` (INGEST_TOKEN) : position quotidienne envoyée par le
 *    téléphone, arrondie ici à 2 décimales (~1 km) avant d'être écrite ;
 *  - `GET /day/:date` et `GET /range` : ajoute `context` à chaque journée renvoyée
 *    (objet `DayContext`, ou `null` si rien n'est stocké pour ce jour). Les
 *    handlers d'origine ne changent pas : le corps JSON est complété après coup,
 *    seulement pour une réponse 200.
 *
 * Contrat : docs/API.md, `packages/shared/src/context.ts`.
 */
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { LocationIngestBody, roundCoord, type IngestResult } from "@sillage/shared";
import type { AppDeps } from "../app";
import { bearerAuth } from "../auth";
import type { Db } from "../db";
import { getContexts, upsertLocations } from "./store";

export const LOCATION_SOURCE = "location";

type JsonObject = Record<string, unknown>;

async function readJson(c: Context): Promise<JsonObject | null> {
  if (c.res.status !== 200 || !(c.res.headers.get("content-type") ?? "").includes("application/json")) return null;
  try {
    const body: unknown = await c.res.clone().json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as JsonObject) : null;
  } catch {
    return null;
  }
}

/** Remplace le corps JSON de la réponse en gardant statut et en-têtes (CORS, cache…). */
function replaceJson(c: Context, body: JsonObject): void {
  const headers = new Headers(c.res.headers);
  headers.delete("content-length");
  const res = new Response(JSON.stringify(body), { status: c.res.status, headers });
  c.res = undefined; // sinon Hono recopierait l'ancien Content-Length
  c.res = res;
}

export function mountContext(app: Hono, deps: AppDeps): void {
  const db: Db = deps.db;
  const logError = deps.logError ?? ((msg: string, err?: unknown) => console.error(msg, err));

  async function safeLog(entry: Parameters<Db["logIngest"]>[0]): Promise<void> {
    try {
      await db.logIngest(entry);
    } catch (err) {
      logError("ingest_log : écriture impossible", err);
    }
  }

  // --- Enrichissement des routes de lecture -------------------------------------
  // En cas d'échec de lecture du contexte, la réponse d'origine part telle quelle.
  app.use("/day/*", async (c, next) => {
    await next();
    const body = await readJson(c);
    if (!body || typeof body.date !== "string") return;
    try {
      const ctx = await getContexts(db.executor, body.date, body.date);
      replaceJson(c, { ...body, context: ctx.get(body.date) ?? null });
    } catch (err) {
      logError("context : lecture impossible (GET /day)", err);
    }
  });

  app.use("/range", async (c, next) => {
    await next();
    const body = await readJson(c);
    if (!body || typeof body.from !== "string" || typeof body.to !== "string" || !Array.isArray(body.days)) return;
    try {
      const ctx = await getContexts(db.executor, body.from, body.to);
      const days = (body.days as unknown[]).map((d) => {
        if (!d || typeof d !== "object") return d;
        const day = d as JsonObject;
        return { ...day, context: typeof day.date === "string" ? (ctx.get(day.date) ?? null) : null };
      });
      replaceJson(c, { ...body, days });
    } catch (err) {
      logError("context : lecture impossible (GET /range)", err);
    }
  });

  // --- POST /ingest/location ---------------------------------------------------
  app.post(
    "/ingest/location",
    bearerAuth(deps.ingestToken),
    bodyLimit({
      maxSize: 256 * 1024,
      onError: (c) => c.json({ error: "payload_too_large", message: "corps limité à 256 Ko" }, 413),
    }),
    async (c) => {
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        await safeLog({ source: LOCATION_SOURCE, days_count: 0, first_date: null, last_date: null, ok: false, error: "JSON invalide" });
        return c.json({ error: "bad_request", message: "corps JSON invalide" }, 400);
      }

      const parsed = LocationIngestBody.safeParse(raw);
      if (!parsed.success) {
        // Chemins et messages zod seulement : jamais les valeurs reçues (coordonnées).
        const issues = parsed.error.issues.map((i) => ({ path: i.path.join(".") || "(racine)", message: i.message }));
        const rawDays = (raw as { days?: unknown } | null)?.days;
        await safeLog({
          source: LOCATION_SOURCE,
          days_count: Array.isArray(rawDays) ? rawDays.length : 0,
          first_date: null,
          last_date: null,
          ok: false,
          error: `validation : ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`.slice(0, 2000),
        });
        return c.json({ error: "bad_request", message: "corps invalide", issues }, 400);
      }

      // Arrondi à 2 décimales (~1 km) : rien de plus précis n'est jamais écrit.
      const rows = parsed.data.days.map((d) => ({ date: d.date, lat: roundCoord(d.lat), lon: roundCoord(d.lon) }));
      const dates = rows.map((r) => r.date).sort();
      const span = { days_count: rows.length, first_date: dates[0] ?? null, last_date: dates.at(-1) ?? null };
      try {
        const upserted = await upsertLocations(db.executor, rows);
        await safeLog({ source: LOCATION_SOURCE, ...span, ok: true, error: null });
        return c.json({ upserted } satisfies IngestResult, 200);
      } catch (err) {
        logError("ingest/location : échec de l'écriture", err);
        await safeLog({ source: LOCATION_SOURCE, ...span, ok: false, error: "écriture en base impossible" });
        return c.json({ error: "internal_error", message: "écriture en base impossible" }, 500);
      }
    },
  );
}
