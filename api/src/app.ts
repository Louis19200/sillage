/**
 * Application Hono, sans ouverture de port (voir server.ts) : testable telle quelle.
 * Contrat des routes : docs/API.md.
 *
 * Les autres agents montent leurs routes ici, une ligne chacun, dans la section
 * « Routes des autres zones » en bas de createApp.
 */
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ZodError } from "zod";
import { HealthIngestBody, IsoDate, MAX_RANGE_DAYS, type IngestResult, type RangeResponse } from "@sillage/shared";
import { bearerAuth } from "./auth";
import type { Db } from "./db";

export type AppDeps = {
  db: Db;
  ingestToken: string;
  /** Exige le token sur les routes de lecture (défaut : non). */
  protectReads?: boolean;
  /** Journal des erreurs serveur (défaut : console.error). */
  logError?: (msg: string, err?: unknown) => void;
};

type Issue = { path: string; message: string };

function formatIssues(err: ZodError): Issue[] {
  return err.issues.map((i) => ({ path: i.path.join(".") || "(racine)", message: i.message }));
}

function badRequest(c: Context, message: string, issues?: Issue[]) {
  return c.json({ error: "bad_request", message, ...(issues ? { issues } : {}) }, 400);
}

/** Nombre de jours calendaires entre deux dates `YYYY-MM-DD` valides, bornes incluses. */
export function inclusiveDayCount(from: string, to: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000) + 1;
}

export function createApp(deps: AppDeps): Hono {
  const { db } = deps;
  const logError = deps.logError ?? ((msg, err) => console.error(msg, err));
  const app = new Hono();
  const requireToken = bearerAuth(deps.ingestToken);

  /** Trace une ingestion sans jamais faire échouer la réponse si le journal échoue. */
  async function safeLog(entry: Parameters<Db["logIngest"]>[0]): Promise<void> {
    try {
      await db.logIngest(entry);
    } catch (err) {
      logError("ingest_log : écriture impossible", err);
    }
  }

  app.onError((err, c) => {
    logError("erreur non gérée", err);
    return c.json({ error: "internal_error" }, 500);
  });
  app.notFound((c) => c.json({ error: "not_found" }, 404));

  // --- Écriture -----------------------------------------------------------

  app.post(
    "/ingest/health",
    requireToken,
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => c.json({ error: "payload_too_large", message: "corps limité à 1 Mo" }, 413),
    }),
    async (c) => {
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        await safeLog({ source: "health", days_count: 0, first_date: null, last_date: null, ok: false, error: "JSON invalide" });
        return badRequest(c, "corps JSON invalide");
      }

      const parsed = HealthIngestBody.safeParse(raw);
      if (!parsed.success) {
        const issues = formatIssues(parsed.error);
        const rawDays = (raw as { days?: unknown } | null)?.days;
        await safeLog({
          source: "health",
          days_count: Array.isArray(rawDays) ? rawDays.length : 0,
          first_date: null,
          last_date: null,
          ok: false,
          error: `validation : ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`.slice(0, 2000),
        });
        return badRequest(c, "corps invalide", issues);
      }

      const days = parsed.data.days;
      const dates = days.map((d) => d.date).sort();
      const span = { days_count: days.length, first_date: dates[0] ?? null, last_date: dates[dates.length - 1] ?? null };

      try {
        const upserted = await db.upsertHealthDays(days);
        await safeLog({ source: "health", ...span, ok: true, error: null });
        return c.json({ upserted } satisfies IngestResult, 200);
      } catch (err) {
        logError("ingest/health : échec de l'écriture", err);
        await safeLog({ source: "health", ...span, ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 2000) });
        return c.json({ error: "internal_error", message: "écriture en base impossible" }, 500);
      }
    },
  );

  // --- Lecture ------------------------------------------------------------

  const read = new Hono();
  if (deps.protectReads) read.use("*", requireToken);

  read.get("/day/:date", async (c) => {
    const date = IsoDate.safeParse(c.req.param("date"));
    if (!date.success) return badRequest(c, "date invalide", formatIssues(date.error));
    const day = await db.getDay(date.data);
    if (!day) return c.json({ error: "not_found", message: `aucune donnée pour ${date.data}` }, 404);
    return c.json(day, 200);
  });

  read.get("/range", async (c) => {
    const issues: Issue[] = [];
    const from = IsoDate.safeParse(c.req.query("from") ?? "");
    const to = IsoDate.safeParse(c.req.query("to") ?? "");
    if (!from.success) issues.push(...formatIssues(from.error).map((i) => ({ ...i, path: "from" })));
    if (!to.success) issues.push(...formatIssues(to.error).map((i) => ({ ...i, path: "to" })));
    if (!from.success || !to.success) return badRequest(c, "paramètres from et to attendus au format YYYY-MM-DD", issues);

    if (from.data > to.data) return badRequest(c, "from doit être antérieur ou égal à to");
    const span = inclusiveDayCount(from.data, to.data);
    if (span > MAX_RANGE_DAYS) return badRequest(c, `plage trop longue : ${span} jours (maximum ${MAX_RANGE_DAYS})`);

    const days = await db.getRange(from.data, to.data);
    return c.json({ from: from.data, to: to.data, days } satisfies RangeResponse, 200);
  });

  app.route("/", read);

  // --- Routes des autres zones (une ligne par agent) ------------------------
  // ex. ops-reliability : app.route("/health", healthRoutes(deps));

  return app;
}
