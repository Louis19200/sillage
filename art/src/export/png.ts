/**
 * Export PNG haute définition dans le navigateur : la `Scene` est redessinée par le rendu
 * du moteur (`drawSceneToContext`) sur un canvas détaché de `size` × `size` pixels réels,
 * sans rapport avec la taille de l'écran ni la densité de pixels.
 */
import { drawSceneToContext } from "../engine/render-canvas";
import type { Scene } from "../engine/scene";
import { setPngDpi } from "./png-dpi";

export const PRINT_DPI = 300;

export async function sceneToPngBlob(scene: Scene, size: number, dpi = PRINT_DPI): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(`canvas ${size} px indisponible dans ce navigateur`);
  try {
    drawSceneToContext(ctx, scene, size);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error(`le navigateur n'a pas pu encoder un PNG de ${size} px (trop grand ?)`);
    const bytes = setPngDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" });
  } finally {
    // Libère tout de suite les 64 Mo d'un 4000 px (Safari garde sinon la mémoire).
    canvas.width = 0;
    canvas.height = 0;
  }
}
