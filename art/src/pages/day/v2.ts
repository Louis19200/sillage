/**
 * Page d'une journée, moteur v2 : la technique du jour (figée par l'API ou calculée ici),
 * rendue dans un Worker, suivie de la fiche « Comment cette œuvre a été choisie ».
 *
 * Données : voir `../v2-data.ts` (une requête `/range`).
 */
import type { DataSource } from "../../data";
import { addDays, isIsoDate } from "../../engine";
import { buildFiche, buildTechniqueInput, techniqueFor } from "../../engine-v2";
import { createRenderer } from "../../engine-v2/render";
import { mountExportControlsV2 } from "../../export/controls-v2";
import { loadV2 } from "../v2-data";
import { renderFiche } from "./fiche-view";
import { formatLongDate, legendRows } from "./format";
import { $, hrefFor, renderLegend } from "./shared";

/** Résolution maximale du rendu à l'écran (le canvas est ensuite mis à l'échelle en CSS). */
const MAX_SCREEN_PX = 1600;

function artSize(): number {
  const byWidth = window.innerWidth - 32;
  const byHeight = window.innerHeight - 250;
  return Math.max(240, Math.min(760, byWidth, byHeight));
}

export async function runV2(source: DataSource): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const asked = params.get("date");
  const date = asked && isIsoDate(asked) ? asked : await source.defaultDate();

  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  $<HTMLAnchorElement>("prev").href = hrefFor(prev);
  $<HTMLAnchorElement>("next").href = hrefFor(next);
  window.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowLeft") window.location.href = hrefFor(prev);
    if (e.key === "ArrowRight") window.location.href = hrefFor(next);
  });
  $("title").textContent = formatLongDate(date);
  document.title = `Sillage · ${date}`;

  const { days, selections } = await loadV2(source, date, date);
  const selection = selections.get(date)!;
  const technique = techniqueFor(selection.style);
  const input = buildTechniqueInput(date, days, selection.style);

  // Œuvre : canvas à taille fixe (en pixels réels), mis à l'échelle en CSS au redimensionnement.
  const css = artSize();
  const px = Math.min(MAX_SCREEN_PX, Math.round(css * Math.min(2, window.devicePixelRatio || 1)));
  const container = $("art");
  container.replaceChildren();
  container.classList.add("day__art--v2");
  container.style.setProperty("--art-size", `${css}px`);
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `${technique.name}, œuvre du ${formatLongDate(date)}`);
  container.append(canvas);
  window.addEventListener("resize", () => container.style.setProperty("--art-size", `${artSize()}px`));

  const caption = $("technique");
  caption.replaceChildren();
  const name = document.createElement("strong");
  name.textContent = technique.name;
  caption.append(name, ` · ${technique.process}`);
  if (!technique.ported) {
    const tag = document.createElement("span");
    tag.className = "technique__tag";
    tag.textContent = "rendu provisoire";
    caption.append(" ", tag);
  }
  caption.hidden = false;

  const fiche = buildFiche(selection, technique, input);
  renderFiche($("fiche"), fiche, { open: params.has("fiche") });
  renderLegend(legendRows(input.day, input.v1Norms));

  const renderer = createRenderer(1);
  window.addEventListener("pagehide", () => renderer.dispose());
  mountExportControlsV2($("export"), technique, input, renderer);
  $<HTMLAnchorElement>("gallery").href = `${import.meta.env.BASE_URL}gallery/?month=${date.slice(0, 7)}`;
  const absent = days.every((d) => d.date !== date);
  $("source").textContent =
    (absent ? "Journée absente de la base · " : "") +
    `source : ${source.kind} · moteur v2 · ${selection.frozen ? "style figé" : "style calculé ici"} · rendu ${renderer.kind === "worker" ? "hors fil principal" : "sur le fil principal"}`;

  const t0 = performance.now();
  const bitmap = await renderer.bitmap(input, px);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  (window as unknown as { __v2?: unknown }).__v2 = { style: selection.style, frozen: selection.frozen, renderMs: Math.round(performance.now() - t0), renderer: renderer.kind };
  document.body.dataset.ready = "true";
}
