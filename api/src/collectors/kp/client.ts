/**
 * Indice géomagnétique Kp, service JSON du GFZ Potsdam (source officielle du Kp,
 * valeurs depuis 1932, licence CC BY 4.0) :
 *
 *   https://kp.gfz.de/app/json/?start=2024-05-10T00:00:00Z&end=2024-05-11T23:59:59Z&index=Kp
 *   → { "meta": {…}, "datetime": ["2024-05-10T00:00:00Z", …], "Kp": [2.667, …], "status": ["def", …] }
 *
 * Une valeur par tranche de 3 h en UTC (00-03, 03-06…), en tiers (0, 0,333,
 * 0,667, 1…9). `status` : "def" (définitif) ou "now" (provisoire, quasi temps
 * réel). Les tranches pas encore publiées sont absentes, `null` ou négatives.
 *
 * `kp_max` d'une journée = maximum des tranches qui recouvrent la journée
 * **locale** (fuseau `CONTEXT_TZ`), écrit seulement si toutes ces tranches sont
 * publiées : jamais de maximum partiel.
 */
import { localDayBounds } from "../../context/dates";

export const GFZ_KP_URL = "https://kp.gfz.de/app/json/";
export const BIN_MS = 3 * 3_600_000;

export type KpBin = { start: number; kp: number; status: string | null };
export type KpDay = { date: string; kp_max: number };
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type KpErrorKind = "http" | "rate_limit" | "invalid_response";

export class KpError extends Error {
  constructor(
    readonly kind: KpErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "KpError";
  }
}

const isoSeconds = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");

export function buildKpUrl(start: number, end: number): string {
  return `${GFZ_KP_URL}?start=${isoSeconds(start)}&end=${isoSeconds(end)}&index=Kp`;
}

/** Tranches publiées d'une réponse GFZ (les tranches absentes sont ignorées). */
export function parseKp(body: unknown): KpBin[] {
  const b = body as { datetime?: unknown; Kp?: unknown; status?: unknown } | null;
  if (!b || !Array.isArray(b.datetime) || !Array.isArray(b.Kp) || b.Kp.length !== b.datetime.length) {
    throw new KpError("invalid_response", "réponse GFZ inattendue : tableaux datetime et Kp absents ou de longueurs différentes");
  }
  const status = Array.isArray(b.status) ? b.status : [];
  const bins: KpBin[] = [];
  b.datetime.forEach((dt, i) => {
    const start = typeof dt === "string" ? Date.parse(dt) : Number.NaN;
    if (!Number.isFinite(start)) throw new KpError("invalid_response", `réponse GFZ inattendue : datetime ${JSON.stringify(dt)}`);
    const kp = (b.Kp as unknown[])[i];
    if (kp === null || kp === undefined) return;
    if (typeof kp !== "number" || !Number.isFinite(kp) || kp > 9) {
      throw new KpError("invalid_response", `réponse GFZ inattendue : Kp ${JSON.stringify(kp)} à ${dt}`);
    }
    if (kp < 0) return; // -1 : tranche non publiée
    const s = status[i];
    bins.push({ start, kp: Math.round(kp * 1000) / 1000, status: typeof s === "string" ? s : null });
  });
  return bins.sort((x, y) => x.start - y.start);
}

/**
 * Kp maximal de chaque journée locale de `dates` dans `tz`. Une journée n'est
 * renvoyée que si toutes les tranches de 3 h qui la recouvrent sont publiées.
 */
export function dailyKpMax(bins: readonly KpBin[], dates: readonly string[], tz: string): KpDay[] {
  const byStart = new Map(bins.map((b) => [b.start, b.kp]));
  const out: KpDay[] = [];
  for (const date of dates) {
    const { start, end } = localDayBounds(date, tz);
    let max = -1;
    let complete = true;
    for (let t = Math.floor(start / BIN_MS) * BIN_MS; t < end; t += BIN_MS) {
      const kp = byStart.get(t);
      if (kp === undefined) {
        complete = false;
        break;
      }
      max = Math.max(max, kp);
    }
    if (complete && max >= 0) out.push({ date, kp_max: max });
  }
  return out;
}

export type KpClientOptions = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  retries?: number;
};

/** Tranches Kp couvrant [start, end] (instants UTC), en une requête. */
export async function fetchKp(start: number, end: number, opts: KpClientOptions = {}): Promise<KpBin[]> {
  const doFetch = opts.fetch ?? (globalThis.fetch as FetchLike);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retries = opts.retries ?? 2;
  const url = buildKpUrl(start, end);
  const span = `${isoSeconds(start)} → ${isoSeconds(end)}`;

  for (let attempt = 0; ; attempt++) {
    let failure: KpError | undefined;
    let res: Response | null = null;
    try {
      res = await doFetch(url, { headers: { Accept: "application/json", "User-Agent": "sillage-context-collector" } });
    } catch (err) {
      failure = new KpError("http", `GFZ injoignable (${span}) : ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res) {
      if (res.ok) {
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          throw new KpError("invalid_response", `réponse GFZ illisible (JSON invalide, ${span})`, res.status);
        }
        return parseKp(body);
      }
      let text = "";
      try {
        text = (await res.text()).slice(0, 200);
      } catch {
        /* rien */
      }
      failure = new KpError(res.status === 429 ? "rate_limit" : "http", `erreur HTTP GFZ ${res.status} (${span})${text ? ` : ${text}` : ""}`, res.status);
      if (res.status < 500 && res.status !== 429) throw failure;
    }
    if (attempt >= retries) throw failure ?? new KpError("http", `GFZ injoignable (${span})`);
    await sleep(res?.status === 429 ? 61_000 : 5_000 * (attempt + 1));
  }
}
