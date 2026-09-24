/**
 * Client GraphQL GitHub : contributions par jour (`contributionsCollection`).
 *
 * - Les dates `contributionDays.date` sont calculées par GitHub dans le fuseau
 *   du profil GitHub : on les reprend telles quelles, sans jamais les recalculer.
 * - `contributionCount` compte toutes les contributions (commits, PR, issues,
 *   revues) : c'est la valeur stockée dans `commits` en v1.
 * - Une requête couvre au plus un an : les plages plus longues sont découpées.
 * - Le token n'apparaît jamais dans un message d'erreur ou un log.
 */
import { IsoDate } from "@sillage/shared";

export const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

export const CONTRIBUTIONS_QUERY = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar { weeks { contributionDays { date contributionCount } } }
    }
  }
}`;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Durée maximale d'une requête (GitHub refuse plus d'un an ; marge de sécurité). */
export const MAX_SPAN_MS = 364 * DAY_MS;
/**
 * Recouvrement entre deux requêtes consécutives et marge ajoutée avant `from`.
 * 48 h contiennent toujours au moins une journée complète, quel que soit le
 * fuseau du profil : voir `planChunks`.
 */
export const OVERLAP_MS = 2 * DAY_MS;

export type ContributionDay = { date: string; commits: number };

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type GithubClientOptions = {
  token: string;
  login: string;
  fetch?: FetchLike;
};

export type GithubErrorKind = "auth" | "forbidden" | "rate_limit" | "not_found" | "http" | "graphql" | "invalid_response";

export class GithubError extends Error {
  constructor(
    readonly kind: GithubErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GithubError";
  }
}

export type Chunk = {
  from: Date;
  to: Date;
  /** Écarter la première journée renvoyée (bord de requête, potentiellement partielle). */
  dropFirst: boolean;
  /** Écarter la dernière journée renvoyée (bord de requête intermédiaire). */
  dropLast: boolean;
};

/**
 * Découpe [from, to] en requêtes d'au plus `MAX_SPAN_MS`.
 *
 * GitHub raisonne en journées de son fuseau de profil, que l'on ne connaît pas :
 * une journée coupée par une borne de requête pourrait n'être comptée qu'en
 * partie. Pour ne jamais écrire une journée partielle :
 *  - la première requête commence `OVERLAP_MS` avant `from` et sa première
 *    journée est écartée ;
 *  - deux requêtes consécutives se recouvrent de `OVERLAP_MS` ; la dernière
 *    journée de l'une et la première de la suivante sont écartées. Chaque
 *    journée du recouvrement est donc lue en entier par au moins une requête.
 *  - la dernière journée de la dernière requête est gardée : c'est en général
 *    aujourd'hui (journée en cours, réécrite par les synchros suivantes).
 */
export function planChunks(from: Date, to: Date): Chunk[] {
  const start = from.getTime() - OVERLAP_MS;
  const end = to.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("plage GitHub invalide : date illisible");
  if (end <= from.getTime()) throw new Error(`plage GitHub invalide : from (${from.toISOString()}) doit précéder to (${to.toISOString()})`);

  const chunks: Chunk[] = [];
  let s = start;
  for (;;) {
    const e = Math.min(s + MAX_SPAN_MS, end);
    const last = e === end;
    chunks.push({ from: new Date(s), to: new Date(e), dropFirst: true, dropLast: !last });
    if (last) return chunks;
    s = e - OVERLAP_MS;
  }
}

type RawDay = { date?: unknown; contributionCount?: unknown };

/** Extrait les journées d'une réponse GraphQL (sans les recalculer). */
export function parseCalendar(body: unknown): ContributionDay[] {
  const user = (body as { data?: { user?: unknown } } | null)?.data?.user;
  if (user === null) throw new GithubError("not_found", "utilisateur GitHub introuvable (GITHUB_LOGIN ?)");
  const weeks = (user as { contributionsCollection?: { contributionCalendar?: { weeks?: unknown } } } | undefined)
    ?.contributionsCollection?.contributionCalendar?.weeks;
  if (!Array.isArray(weeks)) throw new GithubError("invalid_response", "réponse GitHub inattendue : contributionCalendar.weeks absent");

  const days: ContributionDay[] = [];
  for (const w of weeks as { contributionDays?: unknown }[]) {
    if (!Array.isArray(w?.contributionDays)) throw new GithubError("invalid_response", "réponse GitHub inattendue : contributionDays absent");
    for (const d of w.contributionDays as RawDay[]) {
      if (typeof d?.date !== "string" || !IsoDate.safeParse(d.date).success) {
        throw new GithubError("invalid_response", `réponse GitHub inattendue : date ${JSON.stringify(d?.date)}`);
      }
      if (typeof d.contributionCount !== "number" || !Number.isInteger(d.contributionCount) || d.contributionCount < 0) {
        throw new GithubError("invalid_response", `réponse GitHub inattendue : contributionCount ${JSON.stringify(d.contributionCount)} le ${d.date}`);
      }
      days.push({ date: d.date, commits: d.contributionCount });
    }
  }
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return days;
}

function resetHint(res: Response): string {
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) return ` ; réinitialisation vers ${new Date(reset * 1000).toISOString()}`;
  const retry = res.headers.get("retry-after");
  return retry ? ` ; réessayer dans ${retry} s` : "";
}

async function readText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

/** Retire le token d'un texte qui pourrait l'avoir recopié (par prudence). */
export function redact(text: string, token: string): string {
  return token ? text.split(token).join("***") : text;
}

async function checkResponse(res: Response): Promise<unknown> {
  if (res.status === 401) {
    throw new GithubError("auth", "GitHub a refusé le token (401) : GITHUB_TOKEN absent, expiré ou révoqué", 401);
  }
  if (res.status === 403 || res.status === 429) {
    const text = await readText(res);
    if (res.headers.get("x-ratelimit-remaining") === "0" || res.status === 429 || /rate limit/i.test(text)) {
      throw new GithubError("rate_limit", `limite de requêtes GitHub atteinte (${res.status})${resetHint(res)}`, res.status);
    }
    throw new GithubError("forbidden", `GitHub refuse l'accès (403) : vérifier les permissions du token${text ? ` ; ${text}` : ""}`, 403);
  }
  if (!res.ok) {
    const text = await readText(res);
    throw new GithubError("http", `erreur HTTP GitHub ${res.status}${text ? ` : ${text}` : ""}`, res.status);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new GithubError("invalid_response", "réponse GitHub illisible (JSON invalide)", res.status);
  }
  const errors = (body as { errors?: { type?: string; message?: string }[] } | null)?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const msg = errors.map((e) => e?.message ?? "?").join(" ; ");
    if (errors.some((e) => e?.type === "RATE_LIMITED")) throw new GithubError("rate_limit", `limite de requêtes GitHub atteinte : ${msg}${resetHint(res)}`);
    if (errors.some((e) => e?.type === "NOT_FOUND")) throw new GithubError("not_found", `utilisateur GitHub introuvable : ${msg}`);
    throw new GithubError("graphql", `erreur GraphQL GitHub : ${msg}`);
  }
  return body;
}

/** Une requête GraphQL sur une plage d'au plus un an. */
export async function fetchCalendar(opts: GithubClientOptions, from: Date, to: Date): Promise<ContributionDay[]> {
  if (!opts.token) throw new GithubError("auth", "GITHUB_TOKEN manquant");
  if (!opts.login) throw new GithubError("not_found", "GITHUB_LOGIN manquant");
  if (to.getTime() - from.getTime() > MAX_SPAN_MS) throw new Error("plage de plus d'un an : utiliser fetchContributions");
  const doFetch = opts.fetch ?? (globalThis.fetch as FetchLike);

  try {
    let res: Response;
    try {
      res = await doFetch(GITHUB_GRAPHQL_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.token}`,
          "Content-Type": "application/json",
          "User-Agent": "sillage-github-collector",
        },
        body: JSON.stringify({
          query: CONTRIBUTIONS_QUERY,
          variables: { login: opts.login, from: from.toISOString(), to: to.toISOString() },
        }),
      });
    } catch (err) {
      throw new GithubError("http", `GitHub injoignable : ${err instanceof Error ? err.message : String(err)}`);
    }
    return parseCalendar(await checkResponse(res));
  } catch (err) {
    if (err instanceof GithubError) throw new GithubError(err.kind, redact(err.message, opts.token), err.status);
    throw err;
  }
}

/**
 * Contributions par jour sur [from, to], toutes requêtes confondues.
 * Soit tout réussit, soit une erreur est levée : jamais de résultat partiel.
 */
export async function fetchContributions(opts: GithubClientOptions, from: Date, to: Date): Promise<ContributionDay[]> {
  const byDate = new Map<string, number>();
  for (const chunk of planChunks(from, to)) {
    let days = await fetchCalendar(opts, chunk.from, chunk.to);
    if (chunk.dropFirst) days = days.slice(1);
    if (chunk.dropLast) days = days.slice(0, -1);
    for (const d of days) byDate.set(d.date, d.commits);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, commits]) => ({ date, commits }));
}
