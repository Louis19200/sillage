/**
 * Corail : croissance par colonisation de l'espace (porté depuis `art/sketches/techniques/corail.ts`).
 * Des branches poussent vers des « nutriments » semés dans une couronne ovale ; chaque nutriment
 * atteint disparaît. Épaisseur des branches : modèle des tuyaux (racine du nombre de pointes en aval).
 *
 *   nutriments  ← pas (centile) : 900 à 2 700, répartis de gauche (matin) à droite (soir)
 *                 selon les pas horaires (repli : profil type × total du jour) ;
 *   racines     ← commits (centile) : 1 à 5 arbres ;
 *   épaisseur   ← sommeil (centile) ;
 *   inclinaison ← vent (direction et force ; repli : vent d'ouest-sud-ouest, 12 km/h) ;
 *   couleurs    ← palette v2 du jour.
 *
 * Tout est calculé dans le repère logique 1000 × 1000 (`coralDrawing`, pur, sans canvas), puis
 * dessiné à l'échelle : même arbre à toute taille, et le SVG reprend exactement les mêmes segments.
 *
 * Défaut corrigé de l'esquisse : un tronc dont la colonne avait été vidée par les arbres voisins
 * montait seul jusqu'en haut (trait isolé). Chaque racine reçoit maintenant sa propre poche de
 * nutriments au-dessus d'elle, le tronc s'arrête au sommet de la couronne, et une tige qui n'a
 * jamais ramifié est retirée au dessin (voir `CORAIL`).
 *
 * Métrique absente : valeur neutre, marque commune (`drawMissingMark`) et signe propre :
 * pas inconnus → bourgeons creux ; commits inconnus → racines en pointillés ; sommeil inconnu →
 * palette « brume » (désaturée).
 */
import { centile, css, drawMissingMark, fmt, fmtInt, grain, hex, mix, rngFor, type RGB } from "../helpers";
import { hourlyOrFallback, weatherOrFallback } from "../input";
import type { Technique, TechniqueInput } from "../types";
import { n1, svgMissingMark, svgOpen } from "./svg-kit";

/** Réglages (repère logique 1000). */
export const CORAIL = {
  nutrientsMin: 900,
  nutrientsSpan: 1800,
  /** Couronne ovale : centre, demi-axes. */
  crown: { cx: 500, cy: 460, rx: 460, ry: 420, xMin: 60, xMax: 940, yMin: 50, yMax: 800 },
  /** Poche de nutriments réservée au-dessus de chaque racine (nombre, rayon). */
  pocket: { count: 26, radius: 55 },
  influence: 70,
  kill: 9,
  step: 6,
  maxIter: 500,
  rootsMax: 5,
  rootSpacing: 120,
  groundY: 970,
  /** Poids d'une heure dans la répartition gauche → droite : base + part des pas horaires. */
  hourlyBase: 0.45,
  /** Heures couvertes de gauche à droite (6 h → 23 h). */
  hourFrom: 6,
  hourTo: 23,
  /** Inclinaison : 0,25 × (vent / 30 km/h), bornée. */
  leanPer30Kmh: 0.25,
  leanMax: 0.4,
  /** Épaisseur : base + part du sommeil ; plafond (px logiques). */
  thickBase: 0.45,
  thickSpan: 0.5,
  maxWidth: 28,
  budChance: 0.35,
} as const;

export interface CoralParams {
  nutrients: number;
  roots: number;
  thick: number;
  /** Composante horizontale ajoutée à chaque pas de croissance (+ : vers la droite). */
  lean: number;
  windDirDeg: number;
  windKmh: number;
  windMeasured: boolean;
  hourlyMeasured: boolean;
  /** Poids (normalisés, max 1) des 18 colonnes horaires de la couronne. */
  hourWeights: number[];
}

export function coralParams(input: TechniqueInput): CoralParams {
  const n = input.norms;
  const w = weatherOrFallback(input.weather);
  const hourly = hourlyOrFallback(input);
  const span = hourly.slice(CORAIL.hourFrom, CORAIL.hourTo + 1);
  const max = Math.max(0, ...span);
  const hourWeights = span.map((v) => CORAIL.hourlyBase + (1 - CORAIL.hourlyBase) * (max > 0 ? v / max : 0));
  // Le vent souffle DEPUIS `windDirDeg` : un vent d'ouest (270°) couche la pousse vers l'est (droite).
  const toward = ((w.windDirDeg.value + 180) * Math.PI) / 180;
  const lean = Math.max(-CORAIL.leanMax, Math.min(CORAIL.leanMax, Math.sin(toward) * CORAIL.leanPer30Kmh * (w.windKmh.value / 30)));
  return {
    nutrients: Math.round(CORAIL.nutrientsMin + CORAIL.nutrientsSpan * (n.steps ?? 0.5)),
    roots: 1 + Math.round((CORAIL.rootsMax - 1) * (n.commits ?? 0.5)),
    thick: CORAIL.thickBase + CORAIL.thickSpan * (n.sleep ?? 0.5),
    lean,
    windDirDeg: w.windDirDeg.value,
    windKmh: w.windKmh.value,
    windMeasured: w.windDirDeg.measured,
    hourlyMeasured: input.hourlySteps !== null,
    hourWeights,
  };
}

export interface CoralTree {
  x: number[];
  y: number[];
  parent: number[];
  /** Pointes en aval (modèle des tuyaux). */
  leaves: number[];
  /** Nombre d'enfants. */
  children: number[];
  /** Index de l'arbre (racine) de chaque nœud. */
  tree: number[];
  rootX: number[];
  iterations: number;
}

function insideCrown(x: number, y: number): boolean {
  const c = CORAIL.crown;
  const dx = (x - c.cx) / c.rx, dy = (y - c.cy) / c.ry;
  return dx * dx + dy * dy < 1 && x >= c.xMin && x <= c.xMax && y >= c.yMin && y <= c.yMax;
}

/** Croissance complète (pure, repère 1000). */
export function growCoral(input: TechniqueInput, p: CoralParams = coralParams(input)): CoralTree {
  const rng = rngFor(input, "corail");
  const C = CORAIL;
  const ax: number[] = [], ay: number[] = [];
  // Nutriments : rejet sur l'ovale, puis sur le poids de la colonne horaire (gauche = matin).
  const cols = p.hourWeights.length;
  let guard = 0;
  while (ax.length < p.nutrients && guard++ < p.nutrients * 200) {
    const x = rng.range(C.crown.xMin, C.crown.xMax), y = rng.range(C.crown.yMin, C.crown.yMax);
    if (!insideCrown(x, y)) continue;
    const col = Math.min(cols - 1, Math.floor(((x - C.crown.xMin) / (C.crown.xMax - C.crown.xMin)) * cols));
    if (rng.next() > p.hourWeights[col]!) continue;
    ax.push(x); ay.push(y);
  }
  const rootX: number[] = [];
  for (let r = 0; r < p.roots; r++) rootX.push(500 + (r - (p.roots - 1) / 2) * C.rootSpacing);
  // Poche réservée à chaque racine : juste au-dessus du bas de la couronne, dans sa colonne.
  const pocketRng = rng.fork("poches");
  for (const rx of rootX) {
    const ex = (rx - C.crown.cx) / C.crown.rx;
    const bottom = C.crown.cy + C.crown.ry * Math.sqrt(Math.max(0, 1 - ex * ex));
    const py = Math.min(C.crown.yMax, bottom) - C.pocket.radius * 1.4;
    for (let i = 0; i < C.pocket.count; i++) {
      const a = pocketRng.range(0, Math.PI * 2), d = C.pocket.radius * Math.sqrt(pocketRng.next());
      ax.push(rx + Math.cos(a) * d); ay.push(py + Math.sin(a) * d);
    }
  }
  const alive = new Uint8Array(ax.length).fill(1);

  const X: number[] = [], Y: number[] = [], parent: number[] = [], tree: number[] = [];
  let dxs: number[] = [], dys: number[] = [], cnt: number[] = [];
  const cell = C.influence;
  const grid = new Map<number, number[]>();
  const add = (x: number, y: number, par: number, t: number) => {
    X.push(x); Y.push(y); parent.push(par); tree.push(t);
    const k = Math.floor(x / cell) * 10007 + Math.floor(y / cell);
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(X.length - 1);
  };
  rootX.forEach((x, r) => add(x, C.groundY, -1, r));
  const trunks = rootX.map((_, i) => i);
  const jitter = rng.fork("pousse");

  let iter = 0;
  for (; iter < C.maxIter; iter++) {
    let grew = false;
    dxs = new Array(X.length).fill(0); dys = new Array(X.length).fill(0); cnt = new Array(X.length).fill(0);
    for (let a = 0; a < ax.length; a++) {
      if (!alive[a]) continue;
      const px = ax[a]!, py = ay[a]!;
      let best = -1, bd = C.influence * C.influence;
      const gx0 = Math.floor(px / cell), gy0 = Math.floor(py / cell);
      for (let gx = gx0 - 1; gx <= gx0 + 1; gx++) for (let gy = gy0 - 1; gy <= gy0 + 1; gy++) {
        const l = grid.get(gx * 10007 + gy);
        if (!l) continue;
        for (const i of l) {
          const d = (X[i]! - px) ** 2 + (Y[i]! - py) ** 2;
          if (d < C.kill * C.kill) alive[a] = 0;
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (!alive[a] || best < 0) continue;
      const len = Math.sqrt(bd) || 1;
      dxs[best]! += (px - X[best]!) / len; dys[best]! += (py - Y[best]!) / len; cnt[best]!++;
    }
    const count = X.length;
    for (let i = 0; i < count; i++) {
      if (cnt[i] === 0) continue;
      let dx = dxs[i]! / cnt[i]! + p.lean + (jitter.next() - 0.5) * 0.25;
      let dy = dys[i]! / cnt[i]! - 0.08;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      add(X[i]! + dx * C.step, Y[i]! + dy * C.step, i, tree[i]!);
      grew = true;
    }
    // Troncs : montent tant qu'aucun nutriment n'est à portée, jamais au-delà du haut de la couronne.
    for (let t = 0; t < trunks.length; t++) {
      const i = trunks[t]!;
      if (i < 0) continue;
      if (cnt[i]! > 0 || Y[i]! - C.step < C.crown.yMin) { trunks[t] = -1; continue; }
      add(X[i]! + p.lean * C.step * 0.5, Y[i]! - C.step, i, t);
      trunks[t] = X.length - 1;
      grew = true;
    }
    if (!grew) break;
  }

  const N = X.length;
  const children = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i++) if (parent[i]! >= 0) children[parent[i]!]!++;
  const leaves = new Array<number>(N).fill(0);
  for (let i = N - 1; i >= 0; i--) {
    if (children[i] === 0) leaves[i]! += 1;
    if (parent[i]! >= 0) leaves[parent[i]!]! += leaves[i]!;
  }
  return { x: X, y: Y, parent, leaves, children, tree, rootX, iterations: iter };
}

export interface CoralSegment { x1: number; y1: number; x2: number; y2: number; w: number; color: string }
export interface CoralBud { x: number; y: number; r: number; color: string; hollow: boolean }
export interface CoralDrawing {
  paper: string;
  segments: CoralSegment[];
  buds: CoralBud[];
  /** Commits inconnus : racines en pointillés (x des racines). */
  ghostRoots: number[];
  ghostColor: string;
  stats: { nodes: number; tips: number; trees: number; pruned: number; iterations: number };
}

const toHex = (c: RGB) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

/** Tout ce qui est dessiné, dans le repère 1000 (pur). Le canvas et le SVG lisent cette liste. */
export function coralDrawing(input: TechniqueInput): CoralDrawing {
  const p = coralParams(input);
  const t = growCoral(input, p);
  const { palette } = input;
  const N = t.x.length;
  // Tige jamais ramifiée (arbre à une seule pointe) : retirée, ce serait un trait isolé.
  const tipsPerTree = new Array<number>(t.rootX.length).fill(0);
  for (let i = 0; i < N; i++) if (t.children[i] === 0 && t.parent[i]! >= 0) tipsPerTree[t.tree[i]!]!++;
  const keepTree = tipsPerTree.map((n) => n > 1);
  const ink = hex(palette.ink), warm = hex(palette.colors[1]), teal = hex(palette.colors[0]);
  const segments: CoralSegment[] = [];
  let pruned = 0;
  for (let i = 0; i < N; i++) {
    const par = t.parent[i]!;
    if (par < 0) continue;
    if (!keepTree[t.tree[i]!]) { pruned++; continue; }
    const w = Math.max(0.6, Math.min(CORAIL.maxWidth, p.thick * Math.pow(t.leaves[i]!, 0.62)));
    const h = Math.min(1, 1 - t.y[i]! / 1000);
    const col = mix(mix(ink, teal, h * 0.8), warm, Math.max(0, 1 - t.leaves[i]! / 3) * 0.6);
    segments.push({ x1: t.x[par]!, y1: t.y[par]!, x2: t.x[i]!, y2: t.y[i]!, w, color: toHex(col) });
  }
  const budRng = rngFor(input, "corail-bourgeons");
  const hollow = input.day.steps === null;
  const buds: CoralBud[] = [];
  let tips = 0;
  for (let i = 0; i < N; i++) {
    if (t.children[i]! > 0 || t.parent[i]! < 0 || !keepTree[t.tree[i]!]) continue;
    tips++;
    if (budRng.next() > CORAIL.budChance) continue;
    const color = palette.colors[budRng.int(1, 4)]!;
    buds.push({ x: t.x[i]!, y: t.y[i]!, r: budRng.range(1.5, 3.8), color, hollow });
  }
  return {
    paper: palette.paper,
    segments,
    buds,
    ghostRoots: input.day.commits === null ? t.rootX : [],
    ghostColor: palette.ink,
    stats: { nodes: N, tips, trees: keepTree.filter(Boolean).length, pruned, iterations: t.iterations },
  };
}

// render() et explain() / toSvg() d'une même journée : on garde le dernier dessin calculé.
let last: { key: string; drawing: CoralDrawing } | null = null;
function drawingFor(input: TechniqueInput): CoralDrawing {
  const key = JSON.stringify([input.date, input.seed, input.norms, input.palette.id, input.palette.colors, input.palette.paper, input.weather, input.hourlySteps, input.day]);
  if (last?.key !== key) last = { key, drawing: coralDrawing(input) };
  return last.drawing;
}

export const corail: Technique = {
  id: "corail",
  family: "organique",
  name: "Corail",
  process: "croissance (colonisation de l'espace)",
  ported: true,
  heavy: false,
  maxExportSize: 8000,
  toSvg(input) {
    const dr = drawingFor(input);
    const out = svgOpen(dr.paper, `Sillage · ${input.date} · Corail`);
    out.push(`<g fill="none" stroke-linecap="round">`);
    for (const s of dr.segments) out.push(`<path d="M${n1(s.x1)} ${n1(s.y1)}L${n1(s.x2)} ${n1(s.y2)}" stroke="${s.color}" stroke-width="${n1(s.w)}"/>`);
    out.push(`</g>`);
    for (const b of dr.buds) {
      out.push(
        b.hollow
          ? `<circle cx="${n1(b.x)}" cy="${n1(b.y)}" r="${n1(b.r + 0.6)}" fill="none" stroke="${b.color}" stroke-opacity="0.85" stroke-width="1.1"/>`
          : `<circle cx="${n1(b.x)}" cy="${n1(b.y)}" r="${n1(b.r)}" fill="${b.color}" fill-opacity="0.85"/>`,
      );
    }
    if (dr.ghostRoots.length) {
      out.push(`<path d="${dr.ghostRoots.map((x) => `M${n1(x - 26)} ${CORAIL.groundY + 8}H${n1(x + 26)}`).join("")}" stroke="${dr.ghostColor}" stroke-opacity="0.6" stroke-width="2" stroke-dasharray="4 5" fill="none"/>`);
    }
    out.push(svgMissingMark(input, input.palette.ink), `</svg>`);
    return out.join("\n");
  },
  render(ctx, S, input) {
    const dr = drawingFor(input);
    const k = S / 1000;
    ctx.save();
    ctx.fillStyle = dr.paper;
    ctx.fillRect(0, 0, S, S);
    ctx.lineCap = "round";
    for (const s of dr.segments) {
      ctx.strokeStyle = s.color;
      // Sous 1 px, un trait trop fin disparaît dans les miniatures : plancher à 0,5 px.
      ctx.lineWidth = Math.max(0.5, s.w * k);
      ctx.beginPath();
      ctx.moveTo(s.x1 * k, s.y1 * k);
      ctx.lineTo(s.x2 * k, s.y2 * k);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.85;
    for (const b of dr.buds) {
      ctx.beginPath();
      if (b.hollow) {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = Math.max(0.5, 1.1 * k);
        ctx.arc(b.x * k, b.y * k, (b.r + 0.6) * k, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = b.color;
        ctx.arc(b.x * k, b.y * k, b.r * k, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (dr.ghostRoots.length) {
      ctx.strokeStyle = css(hex(dr.ghostColor), 0.6);
      ctx.lineWidth = Math.max(1, 2 * k);
      ctx.setLineDash([4 * k, 5 * k]);
      ctx.beginPath();
      for (const x of dr.ghostRoots) { ctx.moveTo((x - 26) * k, (CORAIL.groundY + 8) * k); ctx.lineTo((x + 26) * k, (CORAIL.groundY + 8) * k); }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    if (S <= 4000) grain(ctx, S, rngFor(input, "corail-grain"), 12);
    drawMissingMark(ctx, S, input, input.palette.ink);
  },
  explain(input) {
    const p = coralParams(input);
    const dr = drawingFor(input);
    const n = input.norms;
    const neutral = (v: number | null) => (v === null ? " → valeur neutre" : "");
    const dir = Math.round(p.windDirDeg);
    return [
      { param: "Nutriments semés (densité des branches)", source: `Pas (${centile(n.steps)}${neutral(n.steps)})`, value: `${fmtInt(p.nutrients)} (de 900 à 2 700)` },
      {
        param: "Répartition des nutriments (gauche = matin, droite = soir)",
        source: p.hourlyMeasured ? "Pas heure par heure" : input.day.steps === null ? "Pas non mesurés → répartition uniforme" : "Pas horaires absents → profil type × total du jour",
        value: `colonnes de ${CORAIL.hourFrom} h à ${CORAIL.hourTo} h, poids ${fmt(Math.min(...p.hourWeights), 2)} à ${fmt(Math.max(...p.hourWeights), 2)}`,
      },
      {
        param: "Nombre d'arbres (racines)",
        source: input.day.commits === null ? "Commits non mesurés → 3 racines en pointillés" : `Commits (${input.day.commits}, ${centile(n.commits)})`,
        value: `${p.roots} racine${p.roots > 1 ? "s" : ""}`,
      },
      { param: "Épaisseur des branches", source: `Sommeil (${centile(n.sleep)}${neutral(n.sleep)})`, value: `× ${fmt(p.thick, 2)} (tronc jusqu'à ${CORAIL.maxWidth} px / 1000)` },
      {
        param: "Inclinaison de la pousse",
        source: p.windMeasured ? `Vent mesuré (${dir}°, ${fmt(p.windKmh, 0)} km/h)` : `Vent : pas de météo → repli ${dir}°, ${fmt(p.windKmh, 0)} km/h`,
        value: `${p.lean >= 0 ? "vers la droite" : "vers la gauche"} (${fmt(p.lean, 3)} par pas)`,
      },
      {
        param: "Bourgeons aux pointes",
        source: input.day.steps === null ? "Pas non mesurés → bourgeons creux" : "Tirage seedé (1 pointe sur 3)",
        value: `${fmtInt(dr.buds.length)} bourgeons sur ${fmtInt(dr.stats.tips)} pointes`,
      },
      { param: "Couleurs", source: "Palette du jour (encre → turquoise en montant, pointes chaudes)", value: `palette « ${input.palette.name} »` },
    ];
  },
};
