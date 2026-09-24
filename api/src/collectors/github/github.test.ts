import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, resetTestDb } from "../../../test/helpers";
import { setDb, type Db } from "../../db";
import { listJobs } from "../../jobs";
import {
  CONTRIBUTIONS_QUERY,
  GITHUB_GRAPHQL_URL,
  GithubError,
  MAX_SPAN_MS,
  OVERLAP_MS,
  fetchCalendar,
  fetchContributions,
  parseCalendar,
  planChunks,
  type FetchLike,
} from "./client";
import { lastDays, runGithubSyncJob, syncGithub } from "./sync";

const TOKEN = "github_pat_TESTTOKEN_0123456789abcdef";
const LOGIN = "octocat";
const DAY = 24 * 60 * 60 * 1000;

/** Vraie structure d'une réponse `contributionCalendar` (fuseau du profil : Europe/Paris). */
const fixture7 = JSON.parse(readFileSync(new URL("./fixtures/contributions-7-days.json", import.meta.url), "utf8"));
/** Moment de la tâche nocturne correspondant à la fixture : 24/09/2026 04:15 à Paris. */
const NIGHT = new Date("2026-09-24T02:15:00Z");

type Call = { url: string; init: RequestInit; variables: { login: string; from: string; to: string } };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** `fetch` simulé : enregistre les appels et délègue la réponse. */
function fakeFetch(respond: (call: Call, index: number) => Response | Promise<Response>): FetchLike & { calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const call: Call = { url, init, variables: JSON.parse(String(init.body)).variables };
    calls.push(call);
    return respond(call, calls.length - 1);
  }) as FetchLike & { calls: Call[] };
  f.calls = calls;
  return f;
}

/** Valeur « vraie » d'une journée, déterministe. */
function trueCount(date: string): number {
  let h = 0;
  for (const c of date) h = (h * 31 + c.charCodeAt(0)) % 1009;
  return h % 9 === 0 ? 0 : h % 13;
}

/**
 * Simule GitHub sur un profil en UTC : une journée par date de la plage, et
 * des journées de bord **partielles** (valeur divisée par 2) quand la borne
 * tombe en cours de journée, pour vérifier qu'elles ne sont jamais écrites.
 */
function calendarFor(fromIso: string, toIso: string): unknown {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const days: { date: string; contributionCount: number }[] = [];
  for (let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); t <= to.getTime(); t += DAY) {
    const date = new Date(t).toISOString().slice(0, 10);
    const partial = t < from.getTime() || t + DAY - 1 > to.getTime();
    const full = trueCount(date);
    days.push({ date, contributionCount: partial ? Math.floor(full / 2) : full });
  }
  const weeks: { contributionDays: typeof days }[] = [];
  for (const d of days) {
    const sunday = new Date(`${d.date}T00:00:00Z`).getUTCDay() === 0;
    if (sunday || weeks.length === 0) weeks.push({ contributionDays: [] });
    weeks.at(-1)!.contributionDays.push(d);
  }
  return { data: { user: { contributionsCollection: { contributionCalendar: { weeks } } } } };
}

const simulatedGithub = () => fakeFetch(({ variables }) => jsonResponse(calendarFor(variables.from, variables.to)));

describe("planChunks", () => {
  it("une seule requête pour 7 jours, avec 48 h de marge avant from", () => {
    const { from, to } = lastDays(7, NIGHT);
    const chunks = planChunks(from, to);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ from: new Date(from.getTime() - OVERLAP_MS), to, dropFirst: true, dropLast: false });
  });

  it("découpe les plages de plus d'un an en requêtes d'au plus 364 jours qui se recouvrent", () => {
    const to = NIGHT;
    const from = new Date(to.getTime() - 1000 * DAY);
    const chunks = planChunks(from, to);
    expect(chunks.length).toBe(3);
    for (const c of chunks) expect(c.to.getTime() - c.from.getTime()).toBeLessThanOrEqual(MAX_SPAN_MS);
    expect(chunks[0]!.from.getTime()).toBe(from.getTime() - OVERLAP_MS);
    expect(chunks.at(-1)!.to).toEqual(to);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.from.getTime()).toBe(chunks[i - 1]!.to.getTime() - OVERLAP_MS);
    }
    expect(chunks.map((c) => c.dropLast)).toEqual([true, true, false]);
  });

  it("refuse une plage vide ou inversée", () => {
    expect(() => planChunks(NIGHT, NIGHT)).toThrow(/précéder/);
    expect(() => planChunks(NIGHT, new Date(NIGHT.getTime() - DAY))).toThrow(/précéder/);
  });
});

describe("parseCalendar", () => {
  it("lit la fixture réelle sans recalculer les dates", () => {
    const days = parseCalendar(fixture7);
    expect(days).toHaveLength(10);
    expect(days[0]).toEqual({ date: "2026-09-15", commits: 3 });
    expect(days[1]).toEqual({ date: "2026-09-16", commits: 0 }); // 0 reste 0
    expect(days.at(-1)).toEqual({ date: "2026-09-24", commits: 2 });
  });

  it("rejette une réponse mal formée", () => {
    expect(() => parseCalendar({ data: {} })).toThrow(GithubError);
    expect(() => parseCalendar({ data: { user: null } })).toThrow(/introuvable/);
    const bad = structuredClone(fixture7);
    bad.data.user.contributionsCollection.contributionCalendar.weeks[0].contributionDays[0].contributionCount = null;
    expect(() => parseCalendar(bad)).toThrow(/contributionCount/);
  });
});

describe("client GitHub", () => {
  it("envoie la requête GraphQL attendue avec le token en en-tête", async () => {
    const f = fakeFetch(() => jsonResponse(fixture7));
    await fetchCalendar({ token: TOKEN, login: LOGIN, fetch: f }, new Date("2026-09-15T02:15:00Z"), NIGHT);
    expect(f.calls).toHaveLength(1);
    const { url, init, variables } = f.calls[0]!;
    expect(url).toBe(GITHUB_GRAPHQL_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init.body)).query).toBe(CONTRIBUTIONS_QUERY);
    expect(variables).toEqual({ login: LOGIN, from: "2026-09-15T02:15:00.000Z", to: "2026-09-24T02:15:00.000Z" });
  });

  it("un an = 2 requêtes, journées continues, sans doublon ni journée partielle", async () => {
    const f = simulatedGithub();
    const to = new Date("2026-09-24T10:30:00Z");
    const from = new Date(to.getTime() - 365 * DAY);
    const days = await fetchContributions({ token: TOKEN, login: LOGIN, fetch: f }, from, to);

    expect(f.calls).toHaveLength(2);
    for (const c of f.calls) {
      expect(new Date(c.variables.to).getTime() - new Date(c.variables.from).getTime()).toBeLessThanOrEqual(MAX_SPAN_MS);
    }
    // Première date : la 1re journée complète de la marge de 48 h avant from ; dernière : aujourd'hui (en cours, donc partielle par nature).
    expect(days[0]!.date).toBe("2025-09-23");
    expect(days.at(-1)!.date).toBe("2026-09-24");
    expect(days).toHaveLength(367);
    for (let i = 1; i < days.length; i++) {
      expect(new Date(`${days[i]!.date}T00:00:00Z`).getTime() - new Date(`${days[i - 1]!.date}T00:00:00Z`).getTime()).toBe(DAY);
    }
    for (const d of days.slice(0, -1)) expect(d.commits).toBe(trueCount(d.date));
  });
});

describe("syncGithub", () => {
  let db: Db;
  let pg: PGlite;

  beforeAll(async () => {
    ({ db, pg } = await createTestDb());
    setDb(db);
  });
  afterAll(async () => {
    setDb(undefined);
    await db.close();
  });
  beforeEach(async () => {
    await resetTestDb(db);
  });

  const commitsInDb = async () =>
    (await pg.query<{ date: string; commits: number | null }>(
      "SELECT to_char(date, 'YYYY-MM-DD') AS date, commits FROM daily_metrics ORDER BY date",
    )).rows;
  const ingestLog = async () =>
    (await pg.query<{ source: string; days_count: number; first_date: string | null; last_date: string | null; ok: boolean; error: string | null }>(
      "SELECT source, days_count, to_char(first_date, 'YYYY-MM-DD') AS first_date, to_char(last_date, 'YYYY-MM-DD') AS last_date, ok, error FROM ingest_log ORDER BY id",
    )).rows;

  it("tâche nocturne : une requête, écrit les journées de la fixture (sauf le bord) et journalise", async () => {
    const f = fakeFetch(() => jsonResponse(fixture7));
    const result = await syncGithub({ ...lastDays(7, NIGHT), token: TOKEN, login: LOGIN, fetch: f });

    expect(f.calls).toHaveLength(1);
    expect(result).toEqual({
      source: "github",
      from: "2026-09-17T02:15:00.000Z",
      to: "2026-09-24T02:15:00.000Z",
      days_written: 9,
      first_date: "2026-09-16",
      last_date: "2026-09-24",
    });
    const rows = await commitsInDb();
    expect(rows.map((r) => r.date)).toEqual([
      "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20",
      "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24",
    ]);
    expect(rows[0]).toEqual({ date: "2026-09-16", commits: 0 }); // 0, pas null
    expect(rows.find((r) => r.date === "2026-09-21")).toEqual({ date: "2026-09-21", commits: 12 });
    expect(await ingestLog()).toEqual([
      { source: "github", days_count: 9, first_date: "2026-09-16", last_date: "2026-09-24", ok: true, error: null },
    ]);
  });

  it("utilise la base par défaut (setDb) et l'environnement", async () => {
    const saved = { token: process.env.GITHUB_TOKEN, login: process.env.GITHUB_LOGIN };
    process.env.GITHUB_TOKEN = TOKEN;
    process.env.GITHUB_LOGIN = LOGIN;
    try {
      const f = fakeFetch(() => jsonResponse(fixture7));
      await syncGithub({ ...lastDays(7, NIGHT), fetch: f });
      expect(f.calls[0]!.variables.login).toBe(LOGIN);
      expect(await commitsInDb()).toHaveLength(9);
    } finally {
      if (saved.token === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = saved.token;
      if (saved.login === undefined) delete process.env.GITHUB_LOGIN;
      else process.env.GITHUB_LOGIN = saved.login;
    }
  });

  it("est idempotente et ne touche que la colonne commits", async () => {
    await db.upsertHealthDays([{ date: "2026-09-20", steps: 8421, sleep_minutes: 412 }]);
    const opts = { ...lastDays(7, NIGHT), token: TOKEN, login: LOGIN, db };
    await syncGithub({ ...opts, fetch: fakeFetch(() => jsonResponse(fixture7)) });
    const first = await commitsInDb();
    await syncGithub({ ...opts, fetch: fakeFetch(() => jsonResponse(fixture7)) });
    expect(await commitsInDb()).toEqual(first);
    expect(first).toHaveLength(9);

    const day = await db.getDay("2026-09-20");
    expect(day).toMatchObject({ steps: 8421, sleep_minutes: 412, commits: 0 });
    expect(await db.getDay("2026-09-15")).toBeNull(); // bord écarté, rien inventé
  });

  it("backfill d'un an : 367 journées (365 + marge) écrites en une fois", async () => {
    const to = new Date("2026-09-24T10:30:00Z");
    const result = await syncGithub({ from: new Date(to.getTime() - 365 * DAY), to, token: TOKEN, login: LOGIN, fetch: simulatedGithub() });
    expect(result.days_written).toBe(367);
    const rows = await commitsInDb();
    expect(rows).toHaveLength(367);
    expect(rows.every((r) => Number.isInteger(r.commits))).toBe(true);
  });

  it("met à jour une valeur existante", async () => {
    const opts = { ...lastDays(7, NIGHT), token: TOKEN, login: LOGIN };
    await syncGithub({ ...opts, fetch: fakeFetch(() => jsonResponse(fixture7)) });
    const updated = structuredClone(fixture7);
    updated.data.user.contributionsCollection.contributionCalendar.weeks[1].contributionDays[4].contributionCount = 6;
    await syncGithub({ ...opts, fetch: fakeFetch(() => jsonResponse(updated)) });
    expect((await db.getDay("2026-09-24"))?.commits).toBe(6);
  });

  describe("erreurs GitHub : ok=false, aucune écriture, token jamais divulgué", () => {
    const cases: [string, () => Response, RegExp][] = [
      ["401", () => jsonResponse({ message: "Bad credentials", documentation_url: "https://docs.github.com/graphql" }, 401), /token \(401\)/],
      [
        "403 rate limit",
        () => jsonResponse({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1790000000" }),
        /limite de requêtes.*réinitialisation/,
      ],
      ["403 permissions", () => jsonResponse({ message: "Resource not accessible by personal access token" }, 403), /permissions du token/],
      ["429", () => jsonResponse({ message: "secondary rate limit" }, 429, { "retry-after": "60" }), /limite de requêtes.*60 s/],
      [
        "GraphQL RATE_LIMITED",
        () => jsonResponse({ errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded for user ID 1." }] }),
        /limite de requêtes/,
      ],
      [
        "utilisateur inconnu",
        () =>
          jsonResponse({
            data: { user: null },
            errors: [{ type: "NOT_FOUND", path: ["user"], locations: [{ line: 2, column: 3 }], message: "Could not resolve to a User with the login of 'octocat'." }],
          }),
        /introuvable/,
      ],
      ["500", () => new Response("oops", { status: 502 }), /HTTP GitHub 502/],
      ["JSON invalide", () => new Response("<html>", { status: 200 }), /illisible/],
      ["réseau", () => { throw new TypeError(`fetch failed (Bearer ${TOKEN})`); }, /injoignable/],
    ];

    for (const [name, respond, pattern] of cases) {
      it(name, async () => {
        await expect(
          syncGithub({ ...lastDays(7, NIGHT), token: TOKEN, login: LOGIN, fetch: fakeFetch(() => respond()) }),
        ).rejects.toThrow(pattern);
        expect(await commitsInDb()).toEqual([]);
        const log = await ingestLog();
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({ source: "github", days_count: 0, ok: false });
        expect(log[0]!.error).toMatch(pattern);
        expect(log[0]!.error).not.toContain(TOKEN);
      });
    }

    it("échec de la 2e requête d'un backfill : rien n'est écrit (pas de résultat partiel)", async () => {
      const f = fakeFetch(({ variables }, i) => (i === 0 ? jsonResponse(calendarFor(variables.from, variables.to)) : jsonResponse({ message: "Bad credentials" }, 401)));
      const to = new Date("2026-09-24T10:30:00Z");
      await expect(syncGithub({ from: new Date(to.getTime() - 365 * DAY), to, token: TOKEN, login: LOGIN, fetch: f })).rejects.toThrow(/401/);
      expect(f.calls).toHaveLength(2);
      expect(await commitsInDb()).toEqual([]);
      expect((await ingestLog())[0]).toMatchObject({ ok: false, days_count: 0 });
    });

    it("date inexistante renvoyée par GitHub : rien d'écrit", async () => {
      const bad = structuredClone(fixture7);
      bad.data.user.contributionsCollection.contributionCalendar.weeks[1].contributionDays[2].date = "2026-09-31";
      await expect(syncGithub({ ...lastDays(7, NIGHT), token: TOKEN, login: LOGIN, fetch: fakeFetch(() => jsonResponse(bad)) })).rejects.toThrow(/2026-09-31/);
      expect(await commitsInDb()).toEqual([]);
      expect((await ingestLog())[0]).toMatchObject({ ok: false, days_count: 0 });
    });

    it("échec d'écriture en base : ok=false, erreur propagée", async () => {
      const failing: Db = { ...db, upsertCommits: async () => { throw new Error("connexion perdue"); } };
      await expect(
        syncGithub({ ...lastDays(7, NIGHT), token: TOKEN, login: LOGIN, db: failing, fetch: fakeFetch(() => jsonResponse(fixture7)) }),
      ).rejects.toThrow(/connexion perdue/);
      expect(await commitsInDb()).toEqual([]);
      expect(await ingestLog()).toEqual([
        { source: "github", days_count: 0, first_date: "2026-09-16", last_date: "2026-09-24", ok: false, error: "connexion perdue" },
      ]);
    });

    it("sans GITHUB_TOKEN : message clair, journalisé", async () => {
      const saved = process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_TOKEN;
      try {
        await expect(syncGithub({ ...lastDays(7, NIGHT), login: LOGIN, fetch: fakeFetch(() => jsonResponse(fixture7)) })).rejects.toThrow(/GITHUB_TOKEN manquant/);
        expect((await ingestLog())[0]).toMatchObject({ ok: false });
      } finally {
        if (saved !== undefined) process.env.GITHUB_TOKEN = saved;
      }
    });
  });
});

describe("tâche github-sync", () => {
  it("est enregistrée tous les jours à 04:15", async () => {
    // jobs.ts enregistre ses tâches au chargement (un autre fichier de test peut vider le registre).
    expect(listJobs()).toContainEqual({ name: "github-sync", cronExpr: "15 4 * * *" });
  });

  it("synchronise les 7 derniers jours et renvoie un résumé JSON", async () => {
    const { db } = await createTestDb();
    setDb(db);
    const saved = { token: process.env.GITHUB_TOKEN, login: process.env.GITHUB_LOGIN, fetch: globalThis.fetch };
    process.env.GITHUB_TOKEN = TOKEN;
    process.env.GITHUB_LOGIN = LOGIN;
    const f = fakeFetch(() => jsonResponse(fixture7));
    globalThis.fetch = f as unknown as typeof fetch;
    try {
      const result = await runGithubSyncJob(NIGHT);
      expect(f.calls).toHaveLength(1);
      expect(JSON.parse(JSON.stringify(result))).toMatchObject({ source: "github", days_written: 9, first_date: "2026-09-16", last_date: "2026-09-24" });
    } finally {
      globalThis.fetch = saved.fetch;
      if (saved.token === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = saved.token;
      if (saved.login === undefined) delete process.env.GITHUB_LOGIN;
      else process.env.GITHUB_LOGIN = saved.login;
      setDb(undefined);
      await db.close();
    }
  });
});
