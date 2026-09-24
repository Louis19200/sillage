import { createApiSource } from "./api";
import { createFixturesSource } from "./fixtures";
import type { DataSource } from "./source";

export type { DataSource } from "./source";
export { createApiSource, type ApiSourceOptions } from "./api";
export { createFixturesSource } from "./fixtures";

export interface DataSourceConfig {
  /** `VITE_DATA_SOURCE` : "fixtures" (défaut) ou "api". */
  source?: string | undefined;
  /** `VITE_API_URL`. */
  apiUrl?: string | undefined;
  /** `VITE_API_TOKEN`. */
  apiToken?: string | undefined;
}

export function createDataSource(config: DataSourceConfig = {}): DataSource {
  const kind = (config.source ?? "fixtures").trim() || "fixtures";
  if (kind === "fixtures") return createFixturesSource();
  if (kind === "api") {
    if (!config.apiUrl) throw new Error("VITE_DATA_SOURCE=api demande VITE_API_URL");
    return createApiSource({ baseUrl: config.apiUrl, token: config.apiToken });
  }
  throw new Error(`VITE_DATA_SOURCE inconnue : "${kind}" (attendu : fixtures | api)`);
}

/** Source choisie par les variables d'environnement Vite. */
export function dataSourceFromEnv(): DataSource {
  return createDataSource({
    source: import.meta.env.VITE_DATA_SOURCE,
    apiUrl: import.meta.env.VITE_API_URL,
    apiToken: import.meta.env.VITE_API_TOKEN,
  });
}
