import { describe, expect, it, vi } from "vitest";
import { createApiSource, createDataSource, createFixturesSource } from "./index";

const DAY = {
  date: "2026-09-23",
  steps: 8421,
  sleep_minutes: 412,
  sleep_start: "2026-09-22T23:48:00+02:00",
  sleep_end: "2026-09-23T06:40:00+02:00",
  commits: null,
  updated_at: "2026-09-24T06:00:00+02:00",
};

function mockFetch(routes: Record<string, { status: number; body?: unknown }>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const route = Object.entries(routes).find(([path]) => url.endsWith(path));
    const { status, body } = route?.[1] ?? { status: 404 };
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  });
}

describe("source fixtures", () => {
  it("lit les 120 journées et respecte les bornes", async () => {
    const src = createFixturesSource();
    expect(src.kind).toBe("fixtures");
    expect(await src.defaultDate()).toBe("2026-09-23");
    const range = await src.getRange("2026-06-01", "2026-06-10");
    expect(range.map((d) => d.date)).toEqual(
      Array.from({ length: 10 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`),
    );
    expect(await src.getDay("2030-01-01")).toBeNull();
    expect((await src.getDay("2026-06-06"))?.steps).toBeNull(); // null conservé
    expect((await src.getDay("2026-06-20"))?.steps).toBe(0); // 0 conservé
  });
});

describe("source api", () => {
  it("appelle /range avec le jeton et valide la réponse", async () => {
    const fetch = mockFetch({
      "/range?from=2026-09-01&to=2026-09-23": { status: 200, body: { from: "2026-09-01", to: "2026-09-23", days: [DAY] } },
    });
    const src = createApiSource({ baseUrl: "https://api.example/", token: "secret", fetch });
    expect(await src.getRange("2026-09-01", "2026-09-23")).toEqual([DAY]);
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example/range?from=2026-09-01&to=2026-09-23");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret");
  });

  it("GET /day/:date : 404 → null, 200 → journée", async () => {
    const fetch = mockFetch({ "/day/2026-09-23": { status: 200, body: DAY } });
    const src = createApiSource({ baseUrl: "https://api.example", fetch });
    expect(await src.getDay("2026-09-23")).toEqual(DAY);
    expect(await src.getDay("2026-09-22")).toBeNull();
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("refuse une réponse qui ne respecte pas le contrat", async () => {
    const fetch = mockFetch({ "/day/2026-09-23": { status: 200, body: { ...DAY, steps: -3 } } });
    const src = createApiSource({ baseUrl: "https://api.example", fetch });
    await expect(src.getDay("2026-09-23")).rejects.toThrow();
  });

  it("remonte les erreurs HTTP", async () => {
    const fetch = mockFetch({ "/day/2026-09-23": { status: 401 } });
    const src = createApiSource({ baseUrl: "https://api.example", fetch });
    await expect(src.getDay("2026-09-23")).rejects.toThrow(/401/);
  });
});

describe("choix de la source", () => {
  it("fixtures par défaut, api sur demande", () => {
    expect(createDataSource().kind).toBe("fixtures");
    expect(createDataSource({ source: "" }).kind).toBe("fixtures");
    expect(createDataSource({ source: "api", apiUrl: "http://localhost:8787" }).kind).toBe("api");
    expect(() => createDataSource({ source: "api" })).toThrow(/VITE_API_URL/);
    expect(() => createDataSource({ source: "csv" })).toThrow(/inconnue/);
  });
});
