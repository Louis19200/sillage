/** Petits outils communs aux pages du jour v1 et v2 (aucun import de p5). */
import type { legendRows } from "./format";

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function hrefFor(date: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("date", date);
  return url.pathname + url.search;
}

export function renderLegend(rows: ReturnType<typeof legendRows>): void {
  const legend = $("legend");
  legend.replaceChildren();
  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "legend__item" + (row.value === null ? " legend__item--missing" : "");
    const dt = document.createElement("dt");
    dt.textContent = row.label;
    const dd = document.createElement("dd");
    const value = document.createElement("span");
    value.className = "legend__value";
    value.textContent = row.value ?? "non mesuré";
    dd.append(value);
    if (row.detail) {
      const detail = document.createElement("span");
      detail.className = "legend__detail";
      detail.textContent = row.detail;
      dd.append(detail);
    }
    item.append(dt, dd);
    legend.append(item);
  }
}

export function showError(err: unknown): void {
  $("art").textContent = `Impossible de charger la journée : ${err instanceof Error ? err.message : String(err)}`;
  $("art").classList.add("day__art--error");
  document.body.dataset.ready = "error";
}
