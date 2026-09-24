import type { DailyMetrics } from "@sillage/shared";

/** D'où viennent les journées. Deux implémentations : `fixtures` et `api`. */
export interface DataSource {
  readonly kind: "fixtures" | "api";
  /** Une journée, ou `null` si elle n'existe pas en base (à traiter comme tout à `null`). */
  getDay(date: string): Promise<DailyMetrics | null>;
  /** Jours présents entre `from` et `to` inclus, triés par date. Les jours absents ne sont pas inventés. */
  getRange(from: string, to: string): Promise<DailyMetrics[]>;
  /** Date affichée quand la page est ouverte sans `?date=`. */
  defaultDate(): Promise<string>;
}
