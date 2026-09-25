/**
 * Page d'une journée, moteur v1 (Marée pour tous les jours) : `?date=YYYY-MM-DD&engine=v1`.
 * L'image ne dépend que des données (J et les 90 jours avant) et de la date :
 * ni de la taille de la fenêtre, ni de l'heure, ni d'un hasard non seedé.
 */
import type { DataSource } from "../../data";
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
import { mountExportControls } from "../../export/controls";
import { formatLongDate, legendRows } from "./format";
import { $, hrefFor, renderLegend } from "./shared";

function artSize(): number {
  const byWidth = window.innerWidth - 32;
  const byHeight = window.innerHeight - 230; // 200 + la ligne d'export et de galerie (phase 6)
  return Math.max(240, Math.min(820, byWidth, byHeight));
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
  mountExportControls($("export"), () => scene);
  $<HTMLAnchorElement>("gallery").href = `${import.meta.env.BASE_URL}gallery/?month=${date.slice(0, 7)}`;
  const absent = history.every((d) => d.date !== date);
  $("source").textContent =
    (absent ? "Journée absente de la base · " : "") +
    `source : ${source.kind} · référence : ${norms.steps.referenceSize} j de pas, ` +
    `${norms.sleep_minutes.referenceSize} j de sommeil, ${norms.commits.referenceSize} j de commits`;
  document.body.dataset.ready = "true";
}

export const runV1 = main;
