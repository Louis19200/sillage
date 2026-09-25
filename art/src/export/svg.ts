/**
 * `Scene` → SVG autonome (pur, sans DOM : utilisable en Node et dans les tests).
 *
 * Traduction fidèle de `drawSceneToContext` (engine/render-p5.ts) : même repère 1000 × 1000,
 * mêmes courbes (Catmull-Rom → Bézier via `catmullRomToBezier`), mêmes dégradés, extrémités
 * et jointures arrondies, pointillés en unités logiques. Le PNG et le SVG d'une date sont
 * donc la même image ; seule la taille de sortie change (`viewBox` fixe, `width`/`height` libres).
 *
 * Déterministe : mêmes entrées → même chaîne, octet pour octet (nombres arrondis à 2 décimales).
 */
import { catmullRomToBezier, type Pt } from "../engine/geometry";
import type { GradientStop, Paint, Primitive, Scene, Stroke } from "../engine/scene";

export interface SvgOptions {
  /** Taille affichée (attributs `width`/`height`), en px ou avec unité (« 30cm »). Défaut : 1000. */
  size?: number | string;
  /** Ajoute `<title>`/`<desc>` (date, seed, données absentes). Défaut : true. */
  metadata?: boolean;
}

/** Nombre compact et stable : 2 décimales au plus, jamais « -0 ». */
export function num(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) || r === 0 ? "0" : String(r);
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

function paintAttrs(kind: "fill" | "stroke", paint: Paint): string {
  const opacity = paint.alpha >= 1 ? "" : ` ${kind}-opacity="${num(paint.alpha)}"`;
  return ` ${kind}="${paint.color}"${opacity}`;
}

function strokeAttrs(stroke: Stroke): string {
  let out = paintAttrs("stroke", stroke.paint) + ` stroke-width="${num(stroke.weight)}"`;
  if (stroke.dash && stroke.dash.length > 0) out += ` stroke-dasharray="${stroke.dash.map(num).join(" ")}"`;
  return out;
}

function stopsXml(stops: readonly GradientStop[]): string {
  return stops
    .map((s) => {
      const opacity = s.paint.alpha >= 1 ? "" : ` stop-opacity="${num(s.paint.alpha)}"`;
      return `<stop offset="${num(s.offset)}" stop-color="${s.paint.color}"${opacity}/>`;
    })
    .join("");
}

/** Centièmes d'unité entiers : les coordonnées relatives se calculent sans dérive d'arrondi. */
const hundredths = (n: number): number => Math.round(n * 100) || 0;

/** Suite de nombres SVG compacte (en centièmes) : pas d'espace avant un signe moins. */
function numbers(values: readonly number[]): string {
  let out = "";
  for (const h of values) {
    const s = h === 0 ? "0" : String(h / 100);
    out += out === "" || s.startsWith("-") ? s : ` ${s}`;
  }
  return out;
}

/**
 * Attribut `d` du même tracé que `tracePath` (rendu canvas). `null` si rien à tracer.
 * Départ absolu puis commandes relatives (`l`, `c`) calculées entre positions déjà arrondies
 * au centième : le fichier est bien plus léger et le tracé ne dérive pas.
 */
export function pathData(points: readonly Pt[], smooth: boolean, closed: boolean): string | null {
  if (points.length === 0) return null;
  const q = ([x, y]: Pt): [number, number] => [hundredths(x), hundredths(y)];
  let d: string;
  if (!smooth) {
    const [sx, sy] = q(points[0]!);
    let [cx, cy] = [sx, sy];
    const rel: number[] = [];
    for (const p of points.slice(1)) {
      const [x, y] = q(p);
      rel.push(x - cx, y - cy);
      [cx, cy] = [x, y];
    }
    d = `M${numbers([sx, sy])}` + (rel.length ? `l${numbers(rel)}` : "");
  } else {
    const path = catmullRomToBezier(points, closed);
    if (!path) return null;
    const [sx, sy] = q(path.start);
    let [cx, cy] = [sx, sy];
    const rel: number[] = [];
    for (const [c1, c2, e] of path.segments) {
      const [x1, y1] = q(c1);
      const [x2, y2] = q(c2);
      const [x, y] = q(e);
      rel.push(x1 - cx, y1 - cy, x2 - cx, y2 - cy, x - cx, y - cy);
      [cx, cy] = [x, y];
    }
    d = `M${numbers([sx, sy])}c${numbers(rel)}`;
  }
  return closed ? `${d}z` : d;
}

function primitiveXml(prim: Primitive, id: string, defs: string[], size: number): string {
  switch (prim.kind) {
    case "linear-gradient": {
      defs.push(
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(prim.x1)}" y1="${num(prim.y1)}" x2="${num(prim.x2)}" y2="${num(prim.y2)}">${stopsXml(prim.stops)}</linearGradient>`,
      );
      return `<rect width="${size}" height="${size}" fill="url(#${id})"/>`;
    }
    case "radial-gradient": {
      defs.push(
        `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(prim.cx)}" cy="${num(prim.cy)}" r="${num(prim.r)}">${stopsXml(prim.stops)}</radialGradient>`,
      );
      return `<circle cx="${num(prim.cx)}" cy="${num(prim.cy)}" r="${num(prim.r)}" fill="url(#${id})"/>`;
    }
    case "circle": {
      if (!prim.fill && !prim.stroke) return "";
      const fill = prim.fill ? paintAttrs("fill", prim.fill) : ` fill="none"`;
      const stroke = prim.stroke ? strokeAttrs(prim.stroke) : "";
      return `<circle cx="${num(prim.cx)}" cy="${num(prim.cy)}" r="${num(prim.r)}"${fill}${stroke}/>`;
    }
    case "curve": {
      const d = pathData(prim.points, true, false);
      return d ? `<path d="${d}" fill="none"${strokeAttrs(prim.stroke)}/>` : "";
    }
    case "polygon": {
      if (!prim.fill && !prim.stroke) return "";
      const d = pathData(prim.points, prim.smooth, true);
      if (!d) return "";
      const fill = prim.fill ? paintAttrs("fill", prim.fill) : ` fill="none"`;
      const stroke = prim.stroke ? strokeAttrs(prim.stroke) : "";
      return `<path d="${d}"${fill}${stroke}/>`;
    }
  }
}

export function sceneToSvg(scene: Scene, options: SvgOptions = {}): string {
  const s = scene.size;
  const out = options.size ?? s;
  const dim = typeof out === "number" ? num(out) : escapeXml(out);
  const defs: string[] = [];
  const body: string[] = [];
  // Ordre de peinture conservé : chaque primitive est un élément, dans l'ordre de la Scene.
  scene.primitives.forEach((prim, i) => {
    const xml = primitiveXml(prim, `g${i}`, defs, s);
    if (xml) body.push(xml);
  });

  const meta =
    options.metadata === false
      ? ""
      : `<title>Sillage · ${escapeXml(scene.meta.date)}</title>` +
        `<desc>seed ${scene.meta.seed}` +
        (scene.meta.missing.length ? ` · absent : ${escapeXml(scene.meta.missing.join(", "))}` : "") +
        `</desc>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${s} ${s}">` +
    meta +
    (defs.length ? `<defs>${defs.join("")}</defs>` : "") +
    // Le cadre borne le dessin comme le `clip()` du rendu canvas.
    `<clipPath id="frame"><rect width="${s}" height="${s}"/></clipPath>` +
    `<g clip-path="url(#frame)" stroke-linecap="round" stroke-linejoin="round">` +
    `<rect width="${s}" height="${s}" fill="${escapeXml(scene.background)}"/>` +
    body.join("\n") +
    `</g></svg>\n`
  );
}
