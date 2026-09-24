/**
 * Page d'une journée : `?date=YYYY-MM-DD`.
 * L'image ne dépend que des données (J et les 90 jours avant) et de la date :
 * ni de la taille de la fenêtre, ni de l'heure, ni d'un hasard non seedé.
 */
import { dataSourceFromEnv, type DataSource } from "../../data";
import {
  addDays,
  composeDay,
  emptyDay,
  isIsoDate,
  normalizeDay,
  REFERENCE_WINDOW_DAYS,
  seedFromDate,
} from "../../engine";
import { mountScene, type MountedScene } from "../../engine/render-p5";
import { formatLongDate, legendRows } from "./format";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function artSize(): number {
  const byWidth = window.innerWidth - 32;
  const byHeight = window.innerHeight - 200;
  return Math.max(240, Math.min(820, byWidth, byHeight));
}

function hrefFor(date: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("date", date);
  return url.pathname + url.search;
}

function renderLegend(rows: ReturnType<typeof legendRows>): void {
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

async function main(source: DataSource): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const asked = params.get("date");
  const date = asked && isIsoDate(asked) ? asked : await source.defaultDate();

  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  $<HTMLAnchorElement>("prev").href = hrefFor(prev);
  $<HTMLAnchorElement>("next").href = hrefFor(next);
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") window.location.href = hrefFor(prev);
    if (e.key === "ArrowRight") window.location.href = hrefFor(next);
  });

  $("title").textContent = formatLongDate(date);
  document.title = `Sillage · ${date}`;

  const history = await source.getRange(addDays(date, -REFERENCE_WINDOW_DAYS), date);
  const day = history.find((d) => d.date === date) ?? emptyDay(date);
  const norms = normalizeDay(day, history);
  const scene = composeDay(day, norms, seedFromDate(date));

  const container = $("art");
  container.replaceChildren();
  const mounted: MountedScene = mountScene(container, scene, artSize());
  let pending = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => mounted.update(scene, artSize()));
  });

  renderLegend(legendRows(day, norms));
  const absent = history.every((d) => d.date !== date);
  $("source").textContent =
    (absent ? "Journée absente de la base · " : "") +
    `source : ${source.kind} · référence : ${norms.steps.referenceSize} j de pas, ` +
    `${norms.sleep_minutes.referenceSize} j de sommeil, ${norms.commits.referenceSize} j de commits`;
  document.body.dataset.ready = "true";
}

let source: DataSource;
try {
  source = dataSourceFromEnv();
  main(source).catch(showError);
} catch (err) {
  showError(err);
}

function showError(err: unknown): void {
  $("art").textContent = `Impossible de charger la journée : ${err instanceof Error ? err.message : String(err)}`;
  $("art").classList.add("day__art--error");
  document.body.dataset.ready = "error";
}
