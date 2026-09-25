/**
 * Dessin d'une `Scene` sur n'importe quel contexte 2D (canvas, OffscreenCanvas dans un worker),
 * sans p5. `render-p5.ts` le réexporte : c'est le même code que la v1, déplacé tel quel.
 */
import { catmullRomToBezier } from "./geometry";
import { SCENE_SIZE, type GradientStop, type Paint, type Primitive, type Scene, type Stroke } from "./scene";

/** Contexte 2D d'un canvas de page ou d'un OffscreenCanvas. */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function rgba({ color, alpha }: Paint): string {
  const n = Number.parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function addStops(g: CanvasGradient, stops: readonly GradientStop[]): CanvasGradient {
  for (const s of stops) g.addColorStop(s.offset, rgba(s.paint));
  return g;
}

function applyStroke(ctx: Ctx2D, stroke: Stroke): void {
  ctx.strokeStyle = rgba(stroke.paint);
  ctx.lineWidth = stroke.weight;
  ctx.setLineDash(stroke.dash ?? []);
}

function tracePath(ctx: Ctx2D, points: [number, number][], smooth: boolean, closed: boolean) {
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

function drawPrimitive(ctx: Ctx2D, prim: Primitive): void {
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
export function drawSceneToContext(ctx: Ctx2D, scene: Scene, size: number): void {
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

