/**
 * Client HTTP de `POST /ingest/health` (voir docs/API.md).
 *
 * Module pur : `fetch` est injecté, ce qui permet de le tester avec jest sans réseau.
 * Le token n'apparaît que dans l'en-tête `Authorization` : il n'est jamais loggué ni
 * recopié dans un message d'erreur (tout message est nettoyé par `redact`).
 */
import { HealthIngestBody, IngestResult, type HealthDay } from "@sillage/shared";

/** Délai par défaut : un backfill de 30 jours est un petit corps, 20 s laissent la place au réveil d'un serveur froid. */
export const DEFAULT_TIMEOUT_MS = 20_000;

export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export type IngestErrorKind =
  | "config" // URL ou token absents / mal formés, rien n'a été envoyé
  | "invalid-body" // les journées calculées ne respectent pas HealthIngestBody, rien n'a été envoyé
  | "bad-request" // 400 : l'API a refusé le corps
  | "unauthorized" // 401 : token absent ou faux
  | "http" // autre statut (404, 413, 500…)
  | "bad-response" // 200 mais réponse non conforme à IngestResult
  | "network" // pas de réseau, hôte injoignable, HTTP en clair bloqué…
  | "timeout"; // pas de réponse dans le délai

export type IngestOutcome =
  | { ok: true; upserted: number }
  | {
      ok: false;
      kind: IngestErrorKind;
      /** Message lisible, en français, sans le token. */
      message: string;
      /** Détails (chemins zod renvoyés par l'API pour un 400). */
      details: string[];
      status?: number;
    };

export interface IngestRequest {
  baseUrl: string;
  token: string;
  days: readonly HealthDay[];
  fetch: FetchLike;
  timeoutMs?: number;
}

/**
 * Normalise l'URL de base saisie par l'utilisateur : espaces et `/` finaux retirés,
 * `http://` ou `https://` obligatoire. Renvoie `null` si elle est inutilisable.
 */
export function normalizeBaseUrl(raw: string): string | null {
  const url = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(url)) return null;
  return url;
}

/** Vrai si l'URL est en HTTP en clair vers autre chose que la machine locale (Android le bloque hors debug). */
export function isInsecureRemoteUrl(baseUrl: string): boolean {
  const m = /^http:\/\/([^/:]+|\[[^\]]+\])/i.exec(baseUrl);
  if (!m) return false;
  const host = (m[1] ?? "").toLowerCase();
  return !(host === "localhost" || host === "127.0.0.1" || host === "[::1]");
}

function redact(text: string, token: string): string {
  return token.length > 0 ? text.split(token).join("***") : text;
}

function fail(
  kind: IngestErrorKind,
  message: string,
  token: string,
  extra: { details?: string[]; status?: number } = {}
): IngestOutcome {
  return {
    ok: false,
    kind,
    message: redact(message, token),
    details: (extra.details ?? []).map((d) => redact(d, token)),
    ...(extra.status !== undefined ? { status: extra.status } : {}),
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Détails d'une réponse d'erreur de l'API : `{ error, message, issues: [{ path, message }] }`. */
function apiErrorDetails(json: unknown): { message: string | null; details: string[] } {
  if (typeof json !== "object" || json === null) return { message: null, details: [] };
  const obj = json as { message?: unknown; issues?: unknown };
  const message = typeof obj.message === "string" ? obj.message : null;
  const details: string[] = [];
  if (Array.isArray(obj.issues)) {
    for (const issue of obj.issues) {
      if (typeof issue === "object" && issue !== null) {
        const { path, message: m } = issue as { path?: unknown; message?: unknown };
        details.push(`${typeof path === "string" ? path : "?"} : ${typeof m === "string" ? m : "?"}`);
      }
    }
  }
  return { message, details };
}

function snippet(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 200 ? `${t.slice(0, 200)}…` : t;
}

/**
 * Envoie les journées en un seul appel. Ne lève jamais : toute erreur est renvoyée
 * dans un `IngestOutcome` affichable tel quel.
 */
export async function ingestHealthDays(req: IngestRequest): Promise<IngestOutcome> {
  const token = req.token.trim();
  const baseUrl = normalizeBaseUrl(req.baseUrl);
  if (!baseUrl) {
    return fail("config", "URL de l'API manquante ou invalide (http:// ou https:// attendu).", token);
  }
  if (token.length === 0) {
    return fail("config", "Token manquant : renseigne INGEST_TOKEN dans les réglages.", token);
  }

  const body = HealthIngestBody.safeParse({ days: req.days });
  if (!body.success) {
    return fail("invalid-body", "Les journées calculées sont invalides, rien n'a été envoyé.", token, {
      details: body.error.issues.map((i) => `${i.path.join(".") || "(racine)"} : ${i.message}`),
    });
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let status: number;
  let ok: boolean;
  let text: string;
  try {
    const res = await req.fetch(`${baseUrl}/ingest/health`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body.data),
      signal: controller.signal,
    });
    status = res.status;
    ok = res.ok;
    text = await res.text();
  } catch (e) {
    if (timedOut) {
      return fail("timeout", `Pas de réponse de l'API après ${Math.round(timeoutMs / 1000)} s.`, token);
    }
    const reason = e instanceof Error ? e.message : String(e);
    return fail(
      "network",
      `API injoignable (${reason}). Réseau coupé, URL fausse, ou HTTP en clair bloqué par Android ?`,
      token
    );
  } finally {
    clearTimeout(timer);
  }

  const json = parseJson(text);

  if (status === 401) {
    return fail("unauthorized", "Token refusé par l'API (401) : vérifie INGEST_TOKEN.", token, { status });
  }
  if (status === 400) {
    const { message, details } = apiErrorDetails(json);
    return fail("bad-request", `Corps refusé par l'API (400)${message ? ` : ${message}` : ""}.`, token, {
      status,
      details,
    });
  }
  if (!ok) {
    const { message } = apiErrorDetails(json);
    const why = message ?? (text ? snippet(text) : "");
    return fail("http", `Erreur de l'API (${status})${why ? ` : ${why}` : ""}.`, token, { status });
  }

  const result = IngestResult.safeParse(json);
  if (!result.success) {
    return fail(
      "bad-response",
      `Réponse inattendue de l'API (${status}) : ${text ? snippet(text) : "vide"}. Est-ce bien l'URL de l'API Sillage ?`,
      token,
      { status }
    );
  }
  return { ok: true, upserted: result.data.upserted };
}
