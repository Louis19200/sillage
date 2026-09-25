/**
 * Rendu d'une journée hors navigateur (Node) : même `Scene` que la page du jour,
 * écrite en SVG (`sceneToSvg`) puis rastérisée en PNG par resvg à partir de ce SVG.
 * Le PNG est donc, par construction, la même image que le SVG.
 */
import { Resvg } from "@resvg/resvg-js";
import type { DataSource } from "../src/data/source";
import { addDays, composeForDate, REFERENCE_WINDOW_DAYS, type Scene } from "../src/engine";
import { setPngDpi } from "../src/export/png-dpi";
import { sceneToSvg } from "../src/export/svg";
import { hasData, toDayInput } from "../src/pages/gallery/inputs";

export interface RenderedDay {
  date: string;
  scene: Scene;
  /** La journée existe en base avec au moins une métrique (0 compris). */
  hasData: boolean;
  svg: string;
  png: Uint8Array;
}

export async function renderDay(source: DataSource, date: string, size = 4000, dpi = 300): Promise<RenderedDay> {
  const history = (await source.getRange(addDays(date, -REFERENCE_WINDOW_DAYS), date)).map(toDayInput);
  const scene = composeForDate(date, history);
  const svg = sceneToSvg(scene);
  const raster = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    background: scene.background,
    shapeRendering: 2, // geometricPrecision : antialiasing comme le canvas
  }).render();
  const png = setPngDpi(new Uint8Array(raster.asPng()), dpi);
  return { date, scene, hasData: hasData(history.find((d) => d.date === date)), svg, png };
}

/** Veille en heure locale du processus (régler `TZ=Europe/Paris` sur un serveur en UTC). */
export function localYesterday(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
