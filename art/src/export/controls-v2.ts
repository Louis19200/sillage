/**
 * Export d'une œuvre v2 : PNG pour toutes les techniques (rendu à la taille demandée, dans un
 * Worker si possible), SVG seulement pour les techniques vectorielles (`toSvg`) ; sinon le
 * bouton est remplacé par une courte explication.
 */
import type { Technique, TechniqueInput } from "../engine-v2";
import type { V2Renderer } from "../engine-v2/render";
import { downloadBlob, PNG_SIZES } from "./controls";
import { setPngDpi } from "./png-dpi";
import { PRINT_DPI } from "./png";

export function exportFileNameV2(date: string, style: string, ext: "png" | "svg", size?: number): string {
  return `sillage-v2-${date}-${style}${size ? `-${size}px` : ""}.${ext}`;
}

export function mountExportControlsV2(container: HTMLElement, technique: Technique, input: TechniqueInput, renderer: V2Renderer): void {
  container.replaceChildren();
  container.classList.add("export");
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = "") => {
    const n = document.createElement(tag);
    n.className = cls;
    n.textContent = text;
    return n;
  };

  const label = make("span", "export__label", "Exporter");
  const png = make("button", "export__button", "PNG");
  png.type = "button";
  png.title = "Télécharger en PNG (300 dpi)";
  const size = make("select", "export__size");
  size.setAttribute("aria-label", "Taille du PNG");
  const sizes = PNG_SIZES.filter((s) => s <= technique.maxExportSize);
  for (const s of sizes) {
    const opt = document.createElement("option");
    opt.value = String(s);
    opt.textContent = `${s} px`;
    opt.selected = s === Math.min(4000, sizes.at(-1)!);
    size.append(opt);
  }
  const status = make("span", "export__status");
  status.setAttribute("role", "status");

  png.addEventListener("click", async () => {
    const px = Number(size.value);
    png.disabled = true;
    status.textContent = `rendu ${px} px…`;
    try {
      const blob = await renderer.blob(input, px, { type: "image/png" });
      const bytes = setPngDpi(new Uint8Array(await blob.arrayBuffer()), PRINT_DPI);
      downloadBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }), exportFileNameV2(input.date, technique.id, "png", px));
      status.textContent = "";
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      png.disabled = false;
    }
  });

  const sep = make("span", "export__sep", "·");
  container.append(label, png, size, sep);
  if (technique.toSvg) {
    const svg = make("button", "export__button", "SVG");
    svg.type = "button";
    svg.title = "Télécharger en SVG (vectoriel)";
    svg.addEventListener("click", () => {
      try {
        downloadBlob(new Blob([technique.toSvg!(input)], { type: "image/svg+xml" }), exportFileNameV2(input.date, technique.id, "svg"));
        status.textContent = "";
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : String(err);
      }
    });
    container.append(svg);
  } else {
    const note = make("span", "export__note", "SVG indisponible");
    note.title = `${technique.name} est une image en pixels (${technique.process}) : pas de version vectorielle. Le PNG garde toute la finesse.`;
    container.append(note);
  }
  container.append(status);
}
