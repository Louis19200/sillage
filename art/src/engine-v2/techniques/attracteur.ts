/**
 * Attracteur de Clifford (porté depuis `art/sketches/techniques/attracteur.ts`) :
 *   x' = sin(a·y) + c·cos(a·x),  y' = sin(b·x) + d·cos(b·y)
 * a ← pas, b ← sommeil, c ← commits, d ← nuages (repli 0,5). Un petit écart de données donne
 * une forme très différente. Couleur ← direction du mouvement ; densité en échelle log.
 *
 * Coût : ~6 millions d'itérations pour 1000 px (0,3–0,6 s). La densité est accumulée à au plus
 * `MAX_RES` px puis agrandie, ce qui borne la mémoire à l'export.
 * Métrique absente : valeur neutre (0,5) et cadre en pointillés (`drawMissingMark`).
 *
 * Formes effondrées (voir `COLLAPSE`) : deux protections.
 * 1. `attractorParams` suit l'orbite sur 600 000 points et décale `a` (ordre fixe) tant que la
 *    pire fenêtre de 50 000 points remplit moins de 3 % de la grille.
 * 2. `accumulate` (rendu) jette toute tranche de 20 000 points tombée sur un cycle et relance
 *    l'orbite d'un point seedé : un grand export, qui va plus loin que la vérification, ne peut
 *    pas s'effondrer non plus.
 */
import { centile, createCanvas, drawMissingMark, fmt, fmtInt, grain, hex, mix, rngFor, type RGB } from "../helpers";
import { weatherOrFallback } from "../input";
import type { Technique, TechniqueInput } from "../types";

const MAX_RES = 2000;
const ITER_PER_MPX = 6_000_000;

/** Pas de décalage de `a` quand la forme s'effondre (orbite périodique : quelques points seulement). */
const DEGENERATE_STEP = 0.071;
const MAX_NUDGES = 12;

/**
 * Détection de l'effondrement. Le piège : le chaos peut n'être que transitoire. L'orbite dessine
 * une belle forme pendant des dizaines de milliers de points, puis tombe sur un cycle de 2 à
 * 24 points et y reste : toute la densité s'y accumule et l'image (échelle log) devient une
 * poignée de points (galerie v2 du 6 juillet 2026). Mesurer les 30 000 premiers points ne
 * suffit donc pas : on suit l'orbite sur `checkIter` points, par fenêtres de `checkWindow`,
 * et on garde le remplissage de la PIRE fenêtre.
 */
export const COLLAPSE = {
  /** Points suivis (~20 ms). */
  checkIter: 600_000,
  checkWindow: 50_000,
  grid: 128,
  /** Remplissage minimal de chaque fenêtre : sous 8 % des cases, cycle (2 à 24 points) ou simple courbe fermée (≈ 3 %) ; une forme pleine en remplit 20 à 65 %. */
  minFill: 0.08,
  /** Étendue minimale du nuage (unités de l'attracteur) : en dessous, tout tient en un point. */
  minSpan: 0.2,
} as const;

/**
 * Remplissage de la pire fenêtre (0–1) : part des cases d'une grille `grid²` (posée sur
 * l'étendue de la première fenêtre) touchées par chaque fenêtre de points. Pur, sans canvas.
 */
export function coverage(a: number, b: number, c: number, d: number, iter: number = COLLAPSE.checkIter): number {
  const { grid: G, checkWindow: W } = COLLAPSE;
  let x = 0.1, y = 0.1;
  for (let i = 0; i < 100; i++) {
    const nx = Math.sin(a * y) + c * Math.cos(a * x);
    y = Math.sin(b * x) + d * Math.cos(b * y);
    x = nx;
  }
  // Étendue : première fenêtre.
  const firstLen = Math.min(W, iter);
  const first = new Float64Array(firstLen * 2);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < firstLen; i++) {
    const nx = Math.sin(a * y) + c * Math.cos(a * x);
    y = Math.sin(b * x) + d * Math.cos(b * y);
    x = nx;
    first[2 * i] = x;
    first[2 * i + 1] = y;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const span = Math.max(maxX - minX, maxY - minY);
  if (!(span >= COLLAPSE.minSpan)) return 0;
  const hit = new Uint32Array(G * G);
  const cell = (px: number, py: number) => {
    const gx = Math.max(0, Math.min(G - 1, Math.floor(((px - minX) / span) * G)));
    const gy = Math.max(0, Math.min(G - 1, Math.floor(((py - minY) / span) * G)));
    return gy * G + gx;
  };
  let windowId = 1, n = 0;
  for (let i = 0; i < firstLen; i++) {
    const k = cell(first[2 * i]!, first[2 * i + 1]!);
    if (hit[k] !== windowId) { hit[k] = windowId; n++; }
  }
  let worst = n;
  n = 0;
  windowId++;
  let inWindow = 0;
  for (let i = firstLen; i < iter; i++) {
    const nx = Math.sin(a * y) + c * Math.cos(a * x);
    y = Math.sin(b * x) + d * Math.cos(b * y);
    x = nx;
    const k = cell(x, y);
    if (hit[k] !== windowId) { hit[k] = windowId; n++; }
    if (++inWindow === W) {
      if (n < worst) worst = n;
      windowId++;
      n = 0;
      inWindow = 0;
    }
  }
  // Dernière fenêtre incomplète : jugée à proportion.
  if (inWindow > 0) worst = Math.min(worst, Math.round((n * W) / inWindow));
  return worst / (G * G);
}

export interface AttractorParams {
  a: number;
  /** `a` tiré des données, avant décalage. */
  a0: number;
  /** Rang du décalage retenu (0 : la forme des données était pleine). */
  nudges: number;
  b: number;
  c: number;
  d: number;
  /** Remplissage de la pire fenêtre pour le `a` retenu (`coverage`). */
  fill: number;
  cloudMeasured: boolean;
}

// `explain()` et `render()` demandent les mêmes paramètres : on garde les derniers calculs.
const memo = new Map<string, Omit<AttractorParams, "cloudMeasured">>();

export function attractorParams(input: TechniqueInput): AttractorParams {
  const rng = rngFor(input, "attracteur");
  const n = input.norms;
  const cloud = weatherOrFallback(input.weather).cloud;
  const a0 = -1.25 - 0.8 * (n.steps ?? 0.5) + (rng.next() - 0.5) * 0.08;
  const b = 1.35 + 0.6 * (n.sleep ?? 0.5);
  const c = 0.55 + 0.9 * (n.commits ?? 0.5);
  const d = 0.35 + 0.9 * cloud.value;
  const key = `${a0}|${b}|${c}|${d}`;
  let found = memo.get(key);
  if (!found) {
    // Forme effondrée : on essaie a − s, a + s, a − 2s, a + 2s… (ordre fixe, donc déterministe)
    // jusqu'à une forme pleine ; si aucune ne l'est, la plus remplie.
    let best = { a: a0, nudges: 0, fill: coverage(a0, b, c, d) };
    for (let k = 1; best.fill < COLLAPSE.minFill && k <= MAX_NUDGES * 2; k++) {
      const a = a0 + (k % 2 === 1 ? -1 : 1) * Math.ceil(k / 2) * DEGENERATE_STEP;
      const fill = coverage(a, b, c, d);
      if (fill > best.fill) best = { a, nudges: k, fill };
    }
    found = { a: best.a, a0, nudges: best.nudges, b, c, d, fill: best.fill };
    if (memo.size >= 256) memo.clear();
    memo.set(key, found);
  }
  return { ...found, cloudMeasured: cloud.measured };
}

/** Filet de sécurité du rendu : l'orbite est suivie par tranches, une tranche effondrée est jetée. */
const CHUNK = 20_000;
const CHUNK_GRID = 64;
/** Sous ce nombre de cases (grille 64²) touchées par une tranche pleine, l'orbite est sur un cycle. */
const CHUNK_MIN_CELLS = 48;
const MAX_RESTARTS = 64;

export interface Density {
  R: number;
  count: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  /** Points réellement posés (tranches effondrées exclues). */
  plotted: number;
  /** Relances de l'orbite depuis un point seedé (tranche effondrée). */
  restarts: number;
}

/**
 * Densité de l'attracteur sur une grille R × R (pur, sans canvas : testable, utilisable dans un
 * Worker). Si l'orbite tombe sur un cycle (au-delà de la vérification de `attractorParams`,
 * pour les grands exports), la tranche est jetée et l'orbite repart d'un point tiré de
 * `rngFor(input, "attracteur-relance")`, toujours le même pour une journée donnée.
 */
export function accumulate(input: TechniqueInput, p: Pick<AttractorParams, "a" | "b" | "c" | "d">, R: number, total: number): Density {
  const { a, b, c, d } = p;
  // Couleur ← direction du mouvement : roue des 5 couleurs de la palette (sans allocation par point).
  const pal = input.palette.colors.map(hex);
  const NC = pal.length;
  const wheel = new Float64Array((NC + 1) * 3);
  for (let i = 0; i <= NC; i++) for (let ch = 0; ch < 3; ch++) wheel[i * 3 + ch] = pal[i % NC]![ch]!;
  const TAU = 2 * Math.PI;
  const N = R * R;
  const count = new Float32Array(N);
  const r = new Float32Array(N), g = new Float32Array(N), bl = new Float32Array(N);

  // Bornes du nuage (premiers 20 000 points, hors transitoire).
  let x = 0.1, y = 0.1;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < 20000; i++) {
    const nx = Math.sin(a * y) + c * Math.cos(a * x);
    const ny = Math.sin(b * x) + d * Math.cos(b * y);
    x = nx; y = ny;
    if (i > 100) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const span = Math.max(maxX - minX, maxY - minY, 1e-3) * 1.12;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

  const idx = new Int32Array(CHUNK);
  const cr = new Float32Array(CHUNK), cg = new Float32Array(CHUNK), cb = new Float32Array(CHUNK);
  const cells = new Uint32Array(CHUNK_GRID * CHUNK_GRID);
  const restartRng = rngFor(input, "attracteur-relance");
  let plotted = 0, restarts = 0, done = 0, chunkId = 0;
  while (done < total) {
    const len = Math.min(CHUNK, total - done);
    chunkId++;
    let m = 0, distinct = 0;
    for (let i = 0; i < len; i++) {
      const nx = Math.sin(a * y) + c * Math.cos(a * x);
      const ny = Math.sin(b * x) + d * Math.cos(b * y);
      const u = (nx - cx) / span + 0.5, v = (ny - cy) / span + 0.5;
      const gk = Math.max(0, Math.min(CHUNK_GRID - 1, Math.floor(v * CHUNK_GRID))) * CHUNK_GRID + Math.max(0, Math.min(CHUNK_GRID - 1, Math.floor(u * CHUNK_GRID)));
      if (cells[gk] !== chunkId) { cells[gk] = chunkId; distinct++; }
      const px = Math.floor(u * R), py = Math.floor(v * R);
      if (px >= 0 && py >= 0 && px < R && py < R) {
        let t = Math.atan2(ny - y, nx - x) / TAU;
        t = (t - Math.floor(t)) * NC;
        const ci = Math.floor(t), f = t - ci, o = ci * 3;
        idx[m] = py * R + px;
        cr[m] = wheel[o]! + (wheel[o + 3]! - wheel[o]!) * f;
        cg[m] = wheel[o + 1]! + (wheel[o + 4]! - wheel[o + 1]!) * f;
        cb[m] = wheel[o + 2]! + (wheel[o + 5]! - wheel[o + 2]!) * f;
        m++;
      }
      x = nx; y = ny;
    }
    done += len;
    if (distinct < CHUNK_MIN_CELLS * Math.min(1, len / CHUNK) && restarts < MAX_RESTARTS) {
      restarts++;
      x = restartRng.range(-1, 1);
      y = restartRng.range(-1, 1);
      for (let i = 0; i < 200; i++) {
        const nx = Math.sin(a * y) + c * Math.cos(a * x);
        y = Math.sin(b * x) + d * Math.cos(b * y);
        x = nx;
      }
      continue;
    }
    for (let i = 0; i < m; i++) {
      const k = idx[i]!;
      count[k]! += 1; r[k]! += cr[i]!; g[k]! += cg[i]!; bl[k]! += cb[i]!;
    }
    plotted += m;
  }
  return { R, count, r, g, b: bl, plotted, restarts };
}

export function iterations(res: number, quality: "full" | "preview"): number {
  const full = ITER_PER_MPX * (res / 1000) ** 2;
  return Math.round(quality === "preview" ? Math.max(120_000, full * 0.2) : Math.max(400_000, full));
}

/** Intensité 0–1 d'un pixel (échelle log, comme le rendu). */
export function intensity(cnt: number, max: number): number {
  const lm = Math.log(1 + Math.max(1, max));
  return cnt > 0 ? Math.pow(Math.log(1 + cnt) / lm, 0.55) : 0;
}

export const attracteur: Technique = {
  id: "attracteur",
  family: "mathematique",
  name: "Attracteur",
  process: "chaos déterministe (Clifford)",
  ported: true,
  heavy: false,
  maxExportSize: 4000,
  render(ctx, S, input, options = {}) {
    const R = Math.min(S, MAX_RES);
    const p = attractorParams(input);
    const { palette } = input;
    const N = R * R;
    const { count, r, g, b: bl } = accumulate(input, p, R, iterations(R, options.quality ?? "full"));

    let max = 0;
    for (let i = 0; i < N; i++) if (count[i]! > max) max = count[i]!;
    const bg = hex(palette.night);
    const { canvas, ctx: off } = createCanvas(R, R);
    const img = off.createImageData(R, R);
    for (let i = 0; i < N; i++) {
      const cnt = count[i]!;
      const v = intensity(cnt, max);
      const avg: RGB = cnt > 0 ? [r[i]! / cnt, g[i]! / cnt, bl[i]! / cnt] : bg;
      const lit = mix(avg, [250, 244, 230], Math.max(0, v - 0.75) * 2);
      const out = mix(bg, lit, Math.min(1, v * 1.15));
      img.data[i * 4] = out[0]; img.data[i * 4 + 1] = out[1]; img.data[i * 4 + 2] = out[2]; img.data[i * 4 + 3] = 255;
    }
    off.putImageData(img, 0, 0);
    grain(off, R, rngFor(input, "attracteur-grain"), 8);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, 0, 0, S, S);
    ctx.restore();
    drawMissingMark(ctx, S, input, palette.colors[2]);
  },
  explain(input) {
    const p = attractorParams(input);
    const n = input.norms;
    const neutral = (v: number | null) => (v === null ? " → valeur neutre 0,5" : "");
    return [
      {
        param: "Paramètre a (torsion principale)",
        source: `Pas (${centile(n.steps)}${neutral(n.steps)})`,
        value: p.nudges ? `${fmt(p.a, 3)} (au lieu de ${fmt(p.a0, 3)}, qui effondrait la forme en quelques points)` : fmt(p.a, 3),
      },
      { param: "Paramètre b (seconde fréquence)", source: `Sommeil (${centile(n.sleep)}${neutral(n.sleep)})`, value: fmt(p.b, 3) },
      { param: "Paramètre c (amplitude)", source: `Commits (${centile(n.commits)}${neutral(n.commits)})`, value: fmt(p.c, 3) },
      { param: "Paramètre d (épaisseur)", source: p.cloudMeasured ? "Couverture nuageuse" : "Nuages : pas de météo → repli 0,5", value: fmt(p.d, 3) },
      {
        param: "Remplissage vérifié",
        source: `Pire fenêtre de ${fmtInt(COLLAPSE.checkWindow)} points sur ${fmtInt(COLLAPSE.checkIter)}`,
        value: `${fmt(p.fill * 100, 1)} % de la grille (minimum ${fmt(COLLAPSE.minFill * 100, 0)} %)`,
      },
      { param: "Couleur des traînées", source: "Direction du mouvement dans l'attracteur", value: `palette « ${input.palette.name} »` },
      { param: "Points calculés", source: "Taille du rendu (même forme à toute taille)", value: `${fmtInt(ITER_PER_MPX)} par million de pixels` },
    ];
  },
};
