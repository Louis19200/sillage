/**
 * Boutons d'export d'une œuvre (PNG haute définition, SVG), posés par la page du jour.
 * Tout part de la même `Scene` que celle affichée. Styles : `export.css`, chargé par un `<link>` de la page
 * (un `import` CSS ici rend le build multi-pages de Vite ~100× plus lent, à cause du gros chunk p5).
 */
import type { Scene } from "../engine/scene";
import { sceneToPngBlob } from "./png";
import { sceneToSvg } from "./svg";

export const PNG_SIZES = [2000, 4000, 8000] as const;
export const DEFAULT_PNG_SIZE = 4000;

export function exportFileName(date: string, ext: "png" | "svg", size?: number): string {
  return `sillage-${date}${size ? `-${size}px` : ""}.${ext}`;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadSvg(scene: Scene): void {
  const svg = sceneToSvg(scene);
  downloadBlob(new Blob([svg], { type: "image/svg+xml" }), exportFileName(scene.meta.date, "svg"));
}

export async function downloadPng(scene: Scene, size: number): Promise<void> {
  const blob = await sceneToPngBlob(scene, size);
  downloadBlob(blob, exportFileName(scene.meta.date, "png", size));
}

/**
 * Ajoute dans `container` : « PNG [4000 px ▾] · SVG ». Discret, en texte, comme la légende.
 * `getScene` est lu au moment du clic.
 */
export function mountExportControls(container: HTMLElement, getScene: () => Scene): void {
  container.replaceChildren();
  container.classList.add("export");

  const png = document.createElement("button");
  png.type = "button";
  png.className = "export__button";
  png.textContent = "PNG";
  png.title = "Télécharger en PNG (300 dpi)";

  const size = document.createElement("select");
  size.className = "export__size";
  size.setAttribute("aria-label", "Taille du PNG");
  for (const s of PNG_SIZES) {
    const opt = document.createElement("option");
    opt.value = String(s);
    opt.textContent = `${s} px`;
    opt.selected = s === DEFAULT_PNG_SIZE;
    size.append(opt);
  }

  const svg = document.createElement("button");
  svg.type = "button";
  svg.className = "export__button";
  svg.textContent = "SVG";
  svg.title = "Télécharger en SVG (vectoriel)";

  const status = document.createElement("span");
  status.className = "export__status";
  status.setAttribute("role", "status");

  png.addEventListener("click", async () => {
    const px = Number(size.value);
    png.disabled = true;
    status.textContent = `rendu ${px} px…`;
    // Laisse le navigateur afficher l'état avant le rendu synchrone.
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    try {
      await downloadPng(getScene(), px);
      status.textContent = "";
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      png.disabled = false;
    }
  });
  svg.addEventListener("click", () => {
    try {
      downloadSvg(getScene());
      status.textContent = "";
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
    }
  });

  const label = document.createElement("span");
  label.className = "export__label";
  label.textContent = "Exporter";
  const sep = document.createElement("span");
  sep.className = "export__sep";
  sep.textContent = "·";
  container.append(label, png, size, sep, svg, status);
}
