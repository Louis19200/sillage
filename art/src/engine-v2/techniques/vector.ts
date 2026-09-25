/**
 * Plan vectoriel des techniques géométriques (Vitrail, Constructif) : une liste de formes
 * sérialisables dans un repère logique 1000 × 1000, dessinée à l'identique sur un contexte 2D
 * (`drawPlan`, Worker compris) ou en SVG (`planToSvg`). Le canvas et le SVG lisent le même plan :
 * l'export vectoriel est fidèle par construction (seul le grain de papier diffère : bruit seedé
 * pixel par pixel sur le canvas, `feTurbulence` seedé en SVG).
 *
 * Pur, sans `document`, sans hasard : tout le hasard est tiré avant, dans la construction du plan.
 */
import { drawMissingMark, grain, hex, missingMetrics } from "../helpers";
import type { Rng } from "../../engine/random";
import type { Ctx2D, TechniqueInput } from "../types";

export const PLAN_SIZE = 1000;

/** Commandes de chemin. `A` suit la sémantique de `CanvasRenderingContext2D.arc` (angles en radians, sens horaire à l'écran). */
export type PathCmd =
  | { t: "M"; x: number; y: number }
  | { t: "L"; x: number; y: number }
  | { t: "A"; cx: number; cy: number; r: number; a0: number; a1: number; ccw?: boolean }
  | { t: "Z" };

/** Dégradé radial linéaire en opacité (même rendu en canvas et en SVG). */
export interface RadialPaint {
  kind: "radial";
  cx: number;
  cy: number;
  r: number;
  /** [position 0–1, couleur #rrggbb, opacité 0–1] */
  stops: [number, string, number][];
}

export interface VShape {
  d: PathCmd[];
  fill?: string | RadialPaint;
  fillAlpha?: number;
  stroke?: string;
  strokeAlpha?: number;
  lineWidth?: number;
  dash?: number[];
  cap?: "butt" | "round" | "square";
  join?: "miter" | "round" | "bevel";
  blend?: "multiply";
}

export interface VectorPlan {
  background: string;
  /** Formes dessinées sous le grain. */
  shapes: VShape[];
  /** Force du grain de papier (0 = aucun). */
  grain: number;
  /** Graine du grain (canvas : bruit par pixel ; SVG : `feTurbulence`). */
  grainSeed: number;
}

/* ——— Construction de chemins ——— */

export const polygonPath = (pts: readonly (readonly [number, number])[]): PathCmd[] => [
  ...pts.map(([x, y], i): PathCmd => ({ t: i === 0 ? "M" : "L", x, y })),
  { t: "Z" },
];

export const circlePath = (cx: number, cy: number, r: number): PathCmd[] => [{ t: "A", cx, cy, r, a0: 0, a1: Math.PI * 2 }, { t: "Z" }];

export const rectPath = (x: number, y: number, w: number, h: number): PathCmd[] =>
  polygonPath([
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]);

/** Déplace un chemin (couche décalée de la risographie). */
export function translatePath(d: readonly PathCmd[], dx: number, dy: number): PathCmd[] {
  return d.map((c) => {
    if (c.t === "M" || c.t === "L") return { ...c, x: c.x + dx, y: c.y + dy };
    if (c.t === "A") return { ...c, cx: c.cx + dx, cy: c.cy + dy };
    return c;
  });
}

/** Marque « données manquantes » (cadre en pointillés + un tiret par métrique absente) dans le repère 1000, pour le SVG. */
export function missingMarkShapes(input: TechniqueInput, color: string): VShape[] {
  const missing = missingMetrics(input);
  if (missing.length === 0) return [];
  const out: VShape[] = [{ d: rectPath(22, 22, 956, 956), stroke: color, strokeAlpha: 0.55, lineWidth: 1.6, dash: [6, 7] }];
  missing.forEach((_, i) => {
    out.push({ d: [{ t: "M", x: 1000 - (40 + i * 22), y: 964 }, { t: "L", x: 1000 - (28 + i * 22), y: 964 }], stroke: color, strokeAlpha: 0.55, lineWidth: 3 });
  });
  return out;
}

/* ——— Canvas ——— */

function rgba(color: string, alpha: number): string {
  const [r, g, b] = hex(color);
  return `rgba(${r},${g},${b},${alpha})`;
}

function tracePath(ctx: Ctx2D, d: readonly PathCmd[], k: number): void {
  ctx.beginPath();
  for (const c of d) {
    if (c.t === "M") ctx.moveTo(c.x * k, c.y * k);
    else if (c.t === "L") ctx.lineTo(c.x * k, c.y * k);
    else if (c.t === "A") ctx.arc(c.cx * k, c.cy * k, c.r * k, c.a0, c.a1, c.ccw ?? false);
    else ctx.closePath();
  }
}

export function drawShape(ctx: Ctx2D, s: VShape, k: number): void {
  tracePath(ctx, s.d, k);
  ctx.globalCompositeOperation = s.blend ?? "source-over";
  if (s.fill !== undefined) {
    if (typeof s.fill === "string") {
      ctx.fillStyle = s.fill;
    } else {
      const p = s.fill;
      const g = ctx.createRadialGradient(p.cx * k, p.cy * k, 0, p.cx * k, p.cy * k, p.r * k);
      for (const [o, c, a] of p.stops) g.addColorStop(o, rgba(c, a));
      ctx.fillStyle = g;
    }
    ctx.globalAlpha = s.fillAlpha ?? 1;
    ctx.fill();
  }
  if (s.stroke !== undefined) {
    ctx.strokeStyle = s.stroke;
    ctx.globalAlpha = s.strokeAlpha ?? 1;
    ctx.lineWidth = Math.max(0.75, (s.lineWidth ?? 1) * k);
    ctx.setLineDash((s.dash ?? []).map((v) => v * k));
    ctx.lineCap = s.cap ?? "butt";
    ctx.lineJoin = s.join ?? "miter";
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/**
 * Dessine le plan sur un contexte carré de `S` px. `grainRng` : générateur du grain (même graine
 * que le plan) ; `null` saute le grain (miniatures). La marque « données manquantes » est posée
 * après le grain, comme pour les autres techniques.
 */
export function drawPlan(ctx: Ctx2D, S: number, plan: VectorPlan, input: TechniqueInput, markColor: string, grainRng: Rng | null): void {
  const k = S / PLAN_SIZE;
  ctx.save();
  ctx.fillStyle = plan.background;
  ctx.fillRect(0, 0, S, S);
  for (const s of plan.shapes) drawShape(ctx, s, k);
  ctx.restore();
  if (grainRng && plan.grain > 0) grain(ctx, S, grainRng, plan.grain);
  drawMissingMark(ctx, S, input, markColor);
}

/* ——— SVG ——— */

const n2 = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

const TAU = Math.PI * 2;

/** Chemin SVG (`d`) équivalent au tracé canvas, arcs compris. */
export function pathToSvg(d: readonly PathCmd[]): string {
  const out: string[] = [];
  let has = false;
  for (const c of d) {
    if (c.t === "M" || c.t === "L") {
      out.push(`${c.t}${n2(c.x)} ${n2(c.y)}`);
      has = true;
    } else if (c.t === "Z") {
      out.push("Z");
    } else {
      const ccw = c.ccw ?? false;
      const sx = c.cx + c.r * Math.cos(c.a0), sy = c.cy + c.r * Math.sin(c.a0);
      out.push(`${has ? "L" : "M"}${n2(sx)} ${n2(sy)}`);
      has = true;
      const raw = ccw ? c.a0 - c.a1 : c.a1 - c.a0;
      const sweep = ccw ? 0 : 1;
      const r = n2(c.r);
      if (raw >= TAU - 1e-9) {
        // Cercle complet : deux demi-arcs (un arc SVG ne peut pas revenir à son point de départ).
        const mid = c.a0 + (ccw ? -Math.PI : Math.PI);
        out.push(`A${r} ${r} 0 0 ${sweep} ${n2(c.cx + c.r * Math.cos(mid))} ${n2(c.cy + c.r * Math.sin(mid))}`);
        out.push(`A${r} ${r} 0 0 ${sweep} ${n2(sx)} ${n2(sy)}`);
      } else {
        const delta = ((raw % TAU) + TAU) % TAU;
        if (delta < 1e-9) continue;
        const ex = c.cx + c.r * Math.cos(c.a1), ey = c.cy + c.r * Math.sin(c.a1);
        out.push(`A${r} ${r} 0 ${delta > Math.PI ? 1 : 0} ${sweep} ${n2(ex)} ${n2(ey)}`);
      }
    }
  }
  return out.join("");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface SvgMeta {
  title: string;
  /** Préfixe des identifiants (dégradés, filtre), pour pouvoir insérer plusieurs SVG dans une page. */
  idPrefix: string;
  /** Taille affichée en px (le `viewBox` reste 1000). */
  size?: number;
}

export function planToSvg(plan: VectorPlan, extra: VShape[], meta: SvgMeta): string {
  const size = meta.size ?? PLAN_SIZE;
  const defs: string[] = [];
  let gid = 0;
  const shapeToSvg = (s: VShape): string => {
    const attrs: string[] = [`d="${pathToSvg(s.d)}"`];
    if (s.fill === undefined) attrs.push('fill="none"');
    else if (typeof s.fill === "string") attrs.push(`fill="${s.fill}"`);
    else {
      const id = `${meta.idPrefix}-g${gid++}`;
      const p = s.fill;
      const stops = p.stops.map(([o, c, a]) => `<stop offset="${n2(o)}" stop-color="${c}" stop-opacity="${n2(a)}"/>`).join("");
      defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n2(p.cx)}" cy="${n2(p.cy)}" r="${n2(p.r)}">${stops}</radialGradient>`);
      attrs.push(`fill="url(#${id})"`);
    }
    if (s.fill !== undefined && (s.fillAlpha ?? 1) !== 1) attrs.push(`fill-opacity="${n2(s.fillAlpha!)}"`);
    if (s.stroke !== undefined) {
      attrs.push(`stroke="${s.stroke}"`, `stroke-width="${n2(s.lineWidth ?? 1)}"`);
      if ((s.strokeAlpha ?? 1) !== 1) attrs.push(`stroke-opacity="${n2(s.strokeAlpha!)}"`);
      if (s.dash && s.dash.length) attrs.push(`stroke-dasharray="${s.dash.map(n2).join(" ")}"`);
      if (s.cap && s.cap !== "butt") attrs.push(`stroke-linecap="${s.cap}"`);
      if (s.join && s.join !== "miter") attrs.push(`stroke-linejoin="${s.join}"`);
    }
    if (s.blend) attrs.push(`style="mix-blend-mode:${s.blend}"`);
    return `<path ${attrs.join(" ")}/>`;
  };
  const body = plan.shapes.map(shapeToSvg);
  const over = extra.map(shapeToSvg);
  let grainLayer = "";
  if (plan.grain > 0) {
    const fid = `${meta.idPrefix}-grain`;
    defs.push(
      `<filter id="${fid}" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
        `<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${plan.grainSeed % 10000}" stitchTiles="stitch"/>` +
        `<feColorMatrix type="saturate" values="0"/></filter>`,
    );
    grainLayer = `<rect width="1000" height="1000" filter="url(#${fid})" opacity="${n2(Math.min(0.35, plan.grain / 110))}" style="mix-blend-mode:overlay"/>`;
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1000 1000">`,
    `<title>${esc(meta.title)}</title>`,
    defs.length ? `<defs>${defs.join("")}</defs>` : "",
    `<rect width="1000" height="1000" fill="${plan.background}"/>`,
    `<g>${body.join("")}</g>`,
    grainLayer,
    over.length ? `<g>${over.join("")}</g>` : "",
    `</svg>`,
  ].join("\n");
}
