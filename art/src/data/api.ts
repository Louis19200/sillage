import { DailyMetricsWithContext, RangeWithContextResponse } from "@sillage/shared";
import type { DataSource } from "./source";

export interface ApiSourceOptions {
  /** Ex. `https://sillage.fly.dev` (sans slash final). */
  baseUrl: string;
  /** Jeton envoyé en `Authorization: Bearer …` s'il est défini. */
  token?: string | undefined;
  /** Injectable pour les tests. */
  fetch?: typeof fetch;
  /** Date par défaut (sinon : hier, en heure locale du navigateur). */
  today?: () => string;
}

function localYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Source réelle : `GET /day/:date` et `GET /range?from=&to=` (voir docs/API.md). */
export function createApiSource(options: ApiSourceOptions): DataSource {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  async function get(path: string): Promise<Response> {
    const res = await doFetch(`${base}${path}`, { headers });
    if (!res.ok && res.status !== 404) {
      throw new Error(`API ${path} : HTTP ${res.status}`);
    }
    return res;
  }

  return {
    kind: "api",
    async getDay(date) {
      const res = await get(`/day/${encodeURIComponent(date)}`);
      if (res.status === 404) return null;
      return DailyMetricsWithContext.parse(await res.json());
    },
    async getRange(from, to) {
      const qs = new URLSearchParams({ from, to }).toString();
      const res = await get(`/range?${qs}`);
      if (res.status === 404) return [];
      return RangeWithContextResponse.parse(await res.json()).days;
    },
    defaultDate: async () => (options.today ?? localYesterday)(),
  };
}
