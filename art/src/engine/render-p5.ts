/**
 * Dessine une `Scene` avec p5 (mode instance), à n'importe quelle taille.
 * Le rendu passe par le contexte 2D de p5 (`drawingContext`) : dégradés, pointillés
 * et Bézier y sont natifs, et le même code sert à dessiner sur n'importe quel canvas.
 * Aucune dépendance au temps ni au nombre de frames : un seul `draw()` (noLoop).
 */
import p5 from "p5";
import { drawSceneToContext } from "./render-canvas";
import type { Scene } from "./scene";

export { drawSceneToContext, type Ctx2D } from "./render-canvas";

/** Dessine la scène sur le canvas d'une instance p5 existante. */
export function drawScene(p: p5, scene: Scene, size: number): void {
  drawSceneToContext(p.drawingContext as CanvasRenderingContext2D, scene, size);
}

export interface MountedScene {
  instance: p5;
  /** Redessine (autre scène et/ou autre taille) sans recréer l'instance. */
  update(scene: Scene, size: number): void;
  remove(): void;
}

/**
 * Crée une instance p5 dans `container` et y dessine `scene` en `size` × `size` pixels CSS.
 * `pixelDensity` : 2 par défaut pour un rendu net sur écran haute densité.
 */
export function mountScene(
  container: HTMLElement,
  scene: Scene,
  size: number,
  options: { pixelDensity?: number } = {},
): MountedScene {
  let current = scene;
  let currentSize = Math.max(1, Math.round(size));
  const instance = new p5((p: p5) => {
    p.setup = () => {
      p.pixelDensity(options.pixelDensity ?? 2);
      p.createCanvas(currentSize, currentSize);
      p.noLoop();
    };
    p.draw = () => {
      p.clear();
      drawScene(p, current, currentSize);
    };
  }, container);
  return {
    instance,
    update(scene, size) {
      current = scene;
      const next = Math.max(1, Math.round(size));
      if (next !== currentSize) {
        currentSize = next;
        instance.resizeCanvas(next, next);
      }
      instance.redraw();
    },
    remove: () => instance.remove(),
  };
}
