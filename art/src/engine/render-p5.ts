/**
 * Dessine une `Scene` avec p5 (mode instance), à n'importe quelle taille.
 * Le rendu passe par le contexte 2D de p5 (`drawingContext`) : dégradés, pointillés
 * et Bézier y sont natifs, et le même code sert à dessiner sur n'importe quel canvas.
 * Aucune dépendance au temps ni au nombre de frames : un seul `draw()` (noLoop).
 */
import p5 from "p5";
import { catmullRomToBezier } from "./geometry";
import { SCENE_SIZE, type GradientStop, type Paint, type Primitive, type Scene, type Stroke } from "./scene";

function rgba({ color, alpha }: Paint): string {
  const n = Number.parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function addStops(g: CanvasGradient, stops: readonly GradientStop[]): CanvasGradient {
  for (const s of stops) g.addColorStop(s.offset, rgba(s.paint));
  return g;
}

function applyStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  ctx.strokeStyle = rgba(stroke.paint);
  ctx.lineWidth = stroke.weight;
  ctx.setLineDash(stroke.dash ?? []);
}

function tracePath(ctx: CanvasRenderingContext2D, points: [number, number][], smooth: boolean, closed: boolean) {
  ctx.beginPath();
  if (!smooth) {
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  } else {
    const path = catmullRomToBezier(points, closed);
    if (!path) return;
    ctx.moveTo(path.start[0], path.start[1]);
    for (const [c1, c2, e] of path.segments) ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], e[0], e[1]);
  }
  if (closed) ctx.closePath();
}

function drawPrimitive(ctx: CanvasRenderingContext2D, prim: Primitive): void {
  switch (prim.kind) {
    case "linear-gradient": {
      ctx.fillStyle = addStops(ctx.createLinearGradient(prim.x1, prim.y1, prim.x2, prim.y2), prim.stops);
      ctx.fillRect(0, 0, SCENE_SIZE, SCENE_SIZE);
      return;
    }
    case "radial-gradient": {
      ctx.fillStyle = addStops(ctx.createRadialGradient(prim.cx, prim.cy, 0, prim.cx, prim.cy, prim.r), prim.stops);
      ctx.beginPath();
      ctx.arc(prim.cx, prim.cy, prim.r, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case "circle": {
      ctx.beginPath();
      ctx.arc(prim.cx, prim.cy, prim.r, 0, Math.PI * 2);
      if (prim.fill) {
        ctx.fillStyle = rgba(prim.fill);
        ctx.fill();
      }
      if (prim.stroke) {
        applyStroke(ctx, prim.stroke);
        ctx.stroke();
      }
      return;
    }
    case "curve": {
      tracePath(ctx, prim.points, true, false);
      applyStroke(ctx, prim.stroke);
      ctx.stroke();
      return;
    }
    case "polygon": {
      tracePath(ctx, prim.points, prim.smooth, true);
      if (prim.fill) {
        ctx.fillStyle = rgba(prim.fill);
        ctx.fill();
      }
      if (prim.stroke) {
        applyStroke(ctx, prim.stroke);
        ctx.stroke();
      }
      return;
    }
  }
}

/**
 * Dessine la scène sur un contexte 2D quelconque, dans un carré de `size` pixels CSS
 * à partir de l'origine courante. Utilisable sans p5 (export PNG, miniatures).
 */
export function drawSceneToContext(ctx: CanvasRenderingContext2D, scene: Scene, size: number): void {
  ctx.save();
  ctx.scale(size / scene.size, size / scene.size);
  ctx.beginPath();
  ctx.rect(0, 0, scene.size, scene.size);
  ctx.clip();
  ctx.fillStyle = scene.background;
  ctx.fillRect(0, 0, scene.size, scene.size);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const prim of scene.primitives) drawPrimitive(ctx, prim);
  ctx.restore();
}

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
