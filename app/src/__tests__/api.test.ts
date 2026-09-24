/**
 * Client HTTP de /ingest/health, avec un faux `fetch` : aucun réseau.
 */
import { HealthIngestBody, type HealthDay } from "@sillage/shared";

import { ingestHealthDays, isInsecureRemoteUrl, normalizeBaseUrl, type FetchLike } from "../api";

const TOKEN = "0123456789abcdef0123456789abcdef-secret";

const DAYS: HealthDay[] = [
  {
    date: "2026-09-22",
    steps: 0,
    sleep_minutes: null,
    sleep_start: null,
    sleep_end: null,
  },
  {
    date: "2026-09-23",
    steps: 8421,
    sleep_minutes: 412,
    sleep_start: "2026-09-22T23:48:00+02:00",
    sleep_end: "2026-09-23T06:40:00+02:00",
  },
];

interface Call {
  url: string;
  init: Parameters<FetchLike>[1];
}

function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { fetch, calls };
}

function allText(outcome: unknown): string {
  return JSON.stringify(outcome);
}

let consoleSpies: jest.SpyInstance[] = [];
beforeEach(() => {
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    jest.spyOn(console, m).mockImplementation(() => undefined)
  );
});
afterEach(() => {
  // Le token ne doit jamais passer par la console.
  for (const spy of consoleSpies) {
    for (const args of spy.mock.calls) expect(JSON.stringify(args)).not.toContain(TOKEN);
    spy.mockRestore();
  }
});

describe("normalizeBaseUrl", () => {
  it("retire espaces et / finaux, exige http(s)", () => {
    expect(normalizeBaseUrl("  https://sillage.vercel.app/ ")).toBe("https://sillage.vercel.app");
    expect(normalizeBaseUrl("http://localhost:8787")).toBe("http://localhost:8787");
    expect(normalizeBaseUrl("https://exemple.fr/api//")).toBe("https://exemple.fr/api");
    expect(normalizeBaseUrl("sillage.vercel.app")).toBeNull();
    expect(normalizeBaseUrl("")).toBeNull();
    expect(normalizeBaseUrl("ftp://exemple.fr")).toBeNull();
  });

  it("repère le HTTP en clair vers une adresse distante", () => {
    expect(isInsecureRemoteUrl("http://192.168.1.20:8787")).toBe(true);
    expect(isInsecureRemoteUrl("http://localhost:8787")).toBe(false);
    expect(isInsecureRemoteUrl("http://127.0.0.1:8787")).toBe(false);
    expect(isInsecureRemoteUrl("https://sillage.vercel.app")).toBe(false);
  });
});

describe("ingestHealthDays : requête", () => {
  it("POST sur /ingest/health, en-tête Bearer, corps conforme à HealthIngestBody", async () => {
    const { fetch, calls } = fakeFetch(200, { upserted: 2 });
    const outcome = await ingestHealthDays({
      baseUrl: "https://sillage.vercel.app/",
      token: `  ${TOKEN}\n`, // un copier-coller avec espaces reste valide
      days: DAYS,
      fetch,
    });

    expect(outcome).toEqual({ ok: true, upserted: 2 });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe("https://sillage.vercel.app/ingest/health");
    expect(call?.init.method).toBe("POST");
    expect(call?.init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(call?.init.headers["Content-Type"]).toBe("application/json");
    expect(call?.init.signal).toBeDefined();

    const sent: unknown = JSON.parse(call?.init.body ?? "");
    expect(HealthIngestBody.safeParse(sent).success).toBe(true);
    // null et 0 transmis tels quels, jamais confondus.
    expect(sent).toEqual({ days: DAYS });
    expect(call?.init.body).not.toContain(TOKEN);
  });

  it("n'envoie rien sans URL ou sans token", async () => {
    const { fetch, calls } = fakeFetch(200, { upserted: 2 });
    const noUrl = await ingestHealthDays({ baseUrl: "", token: TOKEN, days: DAYS, fetch });
    const badUrl = await ingestHealthDays({ baseUrl: "sillage.app", token: TOKEN, days: DAYS, fetch });
    const noToken = await ingestHealthDays({ baseUrl: "http://localhost:8787", token: "  ", days: DAYS, fetch });
    expect(noUrl).toMatchObject({ ok: false, kind: "config" });
    expect(badUrl).toMatchObject({ ok: false, kind: "config" });
    expect(noToken).toMatchObject({ ok: false, kind: "config" });
    expect(calls).toHaveLength(0);
  });

  it("n'envoie rien si les journées ne respectent pas le contrat", async () => {
    const { fetch, calls } = fakeFetch(200, { upserted: 1 });
    const empty = await ingestHealthDays({ baseUrl: "http://localhost:8787", token: TOKEN, days: [], fetch });
    const negative = await ingestHealthDays({
      baseUrl: "http://localhost:8787",
      token: TOKEN,
      days: [{ date: "2026-09-23", steps: -1 }],
      fetch,
    });
    expect(empty).toMatchObject({ ok: false, kind: "invalid-body" });
    expect(negative).toMatchObject({ ok: false, kind: "invalid-body" });
    expect(calls).toHaveLength(0);
  });
});

describe("ingestHealthDays : réponses", () => {
  const base = { baseUrl: "http://localhost:8787", token: TOKEN, days: DAYS };

  it("400 : message et détails zod de l'API", async () => {
    const { fetch } = fakeFetch(400, {
      error: "bad_request",
      message: "corps invalide",
      issues: [{ path: "days.0.date", message: "date inexistante" }],
    });
    const outcome = await ingestHealthDays({ ...base, fetch });
    expect(outcome).toMatchObject({ ok: false, kind: "bad-request", status: 400 });
    if (outcome.ok) throw new Error("attendu : échec");
    expect(outcome.message).toContain("corps invalide");
    expect(outcome.details).toEqual(["days.0.date : date inexistante"]);
  });

  it("401 : token refusé, sans jamais citer le token", async () => {
    const { fetch } = fakeFetch(401, { error: "unauthorized", message: "manquant ou invalide" });
    const outcome = await ingestHealthDays({ ...base, fetch });
    expect(outcome).toMatchObject({ ok: false, kind: "unauthorized", status: 401 });
    expect(allText(outcome)).not.toContain(TOKEN);
  });

  it("autre statut : erreur HTTP, token masqué même si le serveur le renvoie", async () => {
    const { fetch } = fakeFetch(500, `Internal error for Bearer ${TOKEN}`);
    const outcome = await ingestHealthDays({ ...base, fetch });
    expect(outcome).toMatchObject({ ok: false, kind: "http", status: 500 });
    expect(allText(outcome)).not.toContain(TOKEN);
    expect(allText(outcome)).toContain("***");
  });

  it("200 non conforme à IngestResult : réponse inattendue", async () => {
    const html = await ingestHealthDays({ ...base, fetch: fakeFetch(200, "<html>Vercel</html>").fetch });
    const wrong = await ingestHealthDays({ ...base, fetch: fakeFetch(200, { upserted: "2" }).fetch });
    expect(html).toMatchObject({ ok: false, kind: "bad-response" });
    expect(wrong).toMatchObject({ ok: false, kind: "bad-response" });
  });

  it("réseau coupé : erreur réseau", async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError("Network request failed");
    };
    const outcome = await ingestHealthDays({ ...base, fetch });
    expect(outcome).toMatchObject({ ok: false, kind: "network" });
    if (outcome.ok) throw new Error("attendu : échec");
    expect(outcome.message).toContain("Network request failed");
  });

  it("délai dépassé : la requête est annulée", async () => {
    let aborted = false;
    // Serveur muet : ne répond jamais, sauf à rejeter quand on annule.
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("Aborted"));
        });
      });
    const outcome = await ingestHealthDays({ ...base, fetch, timeoutMs: 30 });
    expect(aborted).toBe(true);
    expect(outcome).toMatchObject({ ok: false, kind: "timeout" });
  });
});
