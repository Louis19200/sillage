/**
 * Pelage : réaction-diffusion de Gray-Scott (porté depuis `art/sketches/techniques/pelage.ts`).
 * Deux « substances » U et V : V se nourrit de U (u·v²), U est réapprovisionné (F), V disparaît (F + k).
 *
 *   régime (F, k)      ← pas (4 régimes vérifiés, voir `REGIMES`)
 *   ajustement de k    ← sommeil (±0,0005, reste dans le régime)
 *   germes             ← commits (+ pluie : chaque millimètre sème des germes en plus)
 *   étirement          ← vent (direction = axe, vitesse = force de l'anisotropie)
 *   couleurs           ← palette v2 du jour (papier → accents du plus clair au plus sombre → nuit)
 *
 * La simulation (`simulatePelage`) est pure : tableaux en entrée, champ V en sortie, sans canvas.
 * Coût : c'est le nombre de cellules × itérations qui compte, pas la taille de l'image. Le motif a
 * une largeur fixe en cellules (≈ 12) : la grille reste donc à `FULL.grid` quel que soit `S`, et
 * l'image est agrandie avec lissage. Itérations adaptées : on s'arrête quand le motif a couvert la
 * grille et a eu le temps de s'organiser (`settle` du régime). Miniature : `PREVIEW` (grille 80,
 * mêmes germes au même endroit, bandes plus larges).
 * Métrique absente : valeur neutre (pas → régime « corail », sommeil → k inchangé, commits → 3)
 * et cadre en pointillés ; jamais « absent = 0 ».
 */
import type { Rng } from "../../engine/random";
import { blitField, centile, drawMissingMark, fmt, fmtInt, grain, hex, mixHex, ramp, rngFor } from "../helpers";
import { weatherOrFallback } from "../input";
import type { PaletteV2, Technique, TechniqueInput } from "../types";

/**
 * Régimes vérifiés un par un avec Du = 1, Dv = 0,5 : chacun donne un motif stable. Un autre
 * couple (F, k) peut s'éteindre (tout redevient U = 1) ou déborder en une nappe uniforme :
 * vérifier visuellement avant d'en ajouter un.
 * `settle` : pas à faire une fois la grille couverte pour que le motif s'organise (les rayures
 * couvrent vite mais s'alignent lentement ; les vers et le corail avancent lentement et peuvent
 * laisser du papier nu au plafond d'itérations, ce qui fait partie de leur allure).
 */
export const REGIMES = [
  { name: "labyrinthe", F: 0.029, k: 0.057, settle: 2000, gain: 3.2 },
  { name: "vers", F: 0.042, k: 0.063, settle: 2000, gain: 2.3 },
  { name: "corail", F: 0.0545, k: 0.062, settle: 1600, gain: 2.3 },
  { name: "rayures", F: 0.022, k: 0.051, settle: 4000, gain: 3.2 },
] as const;

export const DIFFUSION = { Du: 1, Dv: 0.5 } as const;

/**
 * Qualités de rendu. L'esquisse : grille 340, 7 000 itérations (~10–14 s). Le motif a une largeur
 * fixe en cellules : une grille plus petite donne des bandes plus larges une fois agrandie, pas
 * un motif différent. Plein format : grille 224 et itérations adaptées (au plus 5 000), ~2–3 s.
 * Miniature : grille 80, au plus 1 200 itérations, mêmes germes (rayon réduit, 16 au plus : au-delà,
 * les rayures s'éteignent parfois sur une si petite grille) : ~0,1 s.
 * `settleScale` : part du `settle` du régime.
 */
export const FULL = { grid: 224, minIterations: 2400, maxIterations: 5000, settleScale: 1, maxGerms: 40 } as const;
export const PREVIEW = { grid: 80, minIterations: 600, maxIterations: 1200, settleScale: 0.25, maxGerms: 16 } as const;

/** Contrôle de couverture tous les `CHECK_EVERY` pas ; « couvert » à partir de `COVERED` des cellules. */
const CHECK_EVERY = 200;
const COVERED = 0.995;

/** Germes : commits + `base` (commits non mesurés → `neutralCommits`), + `rainPerMm` par mm de pluie (au plus `maxRain`), au plus `max` en tout. */
export const GERMS = { base: 6, neutralCommits: 3, rainPerMm: 2, maxRain: 16, max: 40 } as const;

/** Part de la grille que les germes peuvent couvrir au départ (au-delà, le motif s'éteint : vérifié en miniature). */
export const GERM_AREA_MAX = 0.1;

/** Anisotropie (0 = isotrope) : `min + (max − min) · min(1, vent / fullKmh)`. */
export const ANISOTROPY = { min: 0.06, max: 0.45, fullKmh: 50 } as const;

export interface PelageGerm {
  /** Centre, en fraction de la grille (0–1). */
  x: number;
  y: number;
  /** Rayon, en cellules (le motif a une largeur fixe en cellules). */
  r: number;
  /** Concentration initiale de V. */
  v: number;
}

export interface PelageSim {
  grid: number;
  /** Itérations : au moins `minIterations`, au plus `maxIterations`, et `settle` après la couverture. */
  minIterations: number;
  maxIterations: number;
  settle: number;
  F: number;
  k: number;
  Du: number;
  Dv: number;
  /** Force de l'anisotropie, 0–0,5. */
  aniso: number;
  /** Axe d'étirement, radians (repère de la grille : x à droite, y vers le bas). */
  axis: number;
  germs: PelageGerm[];
}

export interface PelageResult {
  /** Concentration de V, grid × grid, ligne par ligne. */
  field: Float32Array;
  iterations: number;
  /** Itération à laquelle le motif a couvert la grille (`null` : jamais, plafond atteint). */
  coveredAt: number | null;
}

export interface PelageParams {
  regime: (typeof REGIMES)[number];
  regimeIndex: number;
  F: number;
  k: number;
  commitGerms: number;
  rainGerms: number;
  germs: number;
  aniso: number;
  windDirDeg: number;
  windKmh: number;
  windMeasured: boolean;
  precipMm: number;
  precipMeasured: boolean;
}

/** Paramètres de la journée (sans la position des germes). Pur. */
export function pelageParams(input: TechniqueInput): PelageParams {
  const rng = rngFor(input, "pelage");
  const n = input.norms;
  const w = weatherOrFallback(input.weather);
  const regimeIndex = Math.min(3, Math.floor((n.steps ?? 0.5) * 4));
  const regime = REGIMES[regimeIndex]!;
  // Petit écart seedé sur F (comme l'esquisse) : deux journées de même régime ne sont pas jumelles.
  const F = regime.F + (rng.next() - 0.5) * 0.0015;
  const k = regime.k + ((n.sleep ?? 0.5) - 0.5) * 0.001;
  const commits = input.day.commits ?? GERMS.neutralCommits;
  const commitGerms = commits + GERMS.base;
  const rainGerms = Math.min(GERMS.maxRain, Math.round(w.precipMm.value * GERMS.rainPerMm));
  const germs = Math.min(GERMS.max, commitGerms + rainGerms);
  const aniso = ANISOTROPY.min + (ANISOTROPY.max - ANISOTROPY.min) * Math.min(1, w.windKmh.value / ANISOTROPY.fullKmh);
  return {
    regime,
    regimeIndex,
    F,
    k,
    commitGerms,
    rainGerms,
    germs,
    aniso,
    windDirDeg: w.windDirDeg.value,
    windKmh: w.windKmh.value,
    windMeasured: w.windDirDeg.measured && w.windKmh.measured,
    precipMm: w.precipMm.value,
    precipMeasured: w.precipMm.measured,
  };
}

/**
 * Germes répartis par tirage stratifié sur le tore : une case d'une grille c × c (c² ≥ count) par
 * germe, cases tirées sans remise, position libre dans la case. Assez irrégulier pour rester
 * organique, sans les grands vides d'un tirage uniforme (les vers et le corail avancent lentement :
 * un vide au départ reste du papier nu à la fin). Rayon de 3 à 7 cellules (× `scale` en miniature).
 */
function placeGerms(rng: Rng, count: number, scale: number): PelageGerm[] {
  const c = Math.ceil(Math.sqrt(count));
  const cells = Array.from({ length: c * c }, (_, i) => i);
  const out: PelageGerm[] = [];
  for (let s = 0; s < count; s++) {
    const j = s + Math.floor(rng.next() * (cells.length - s));
    [cells[s], cells[j]] = [cells[j]!, cells[s]!];
    const cell = cells[s]!;
    const x = ((cell % c) + rng.range(0.15, 0.85)) / c;
    const y = (Math.floor(cell / c) + rng.range(0.15, 0.85)) / c;
    const r = Math.max(2, Math.round(rng.int(3, 7) * scale));
    out.push({ x, y, r, v: 0.5 + rng.next() * 0.2 });
  }
  return out;
}

/** Tout ce qu'il faut pour lancer la simulation d'une journée, à une qualité donnée. Pur. */
export function pelageSim(input: TechniqueInput, quality: "full" | "preview" = "full"): PelageSim {
  const q = quality === "preview" ? PREVIEW : FULL;
  const p = pelageParams(input);
  let germs = placeGerms(rngFor(input, "pelage-germes"), Math.min(p.germs, q.maxGerms), q.grid / FULL.grid);
  // Trop de germes sur une petite grille épuisent U partout d'un coup et le motif s'éteint :
  // on réduit alors leur rayon pour qu'ils couvrent au plus `GERM_AREA_MAX` de la grille.
  const area = germs.reduce((s, g) => s + (2 * g.r + 1) ** 2, 0);
  if (area > GERM_AREA_MAX * q.grid * q.grid) {
    const f = Math.sqrt((GERM_AREA_MAX * q.grid * q.grid) / area);
    germs = germs.map((g) => ({ ...g, r: Math.max(1, Math.round((g.r + 0.5) * f - 0.5)) }));
  }
  // Le vent souffle « depuis » windDirDeg ; le motif s'étire dans cet axe (le sens ne compte pas).
  // Nord en haut : direction météo θ → vecteur (sin θ, −cos θ) dans la grille.
  const t = (p.windDirDeg * Math.PI) / 180;
  const axis = Math.atan2(-Math.cos(t), Math.sin(t));
  return { grid: q.grid, minIterations: q.minIterations, maxIterations: q.maxIterations, settle: Math.round(p.regime.settle * q.settleScale), F: p.F, k: p.k, Du: DIFFUSION.Du, Dv: DIFFUSION.Dv, aniso: p.aniso, axis, germs };
}

/** Recopie les bords opposés dans le halo d'une grille (W + 2)² : le tore sans modulo. */
function halo(a: Float64Array, W: number): void {
  const P = W + 2;
  for (let y = 1; y <= W; y++) {
    a[y * P] = a[y * P + W]!;
    a[y * P + W + 1] = a[y * P + 1]!;
  }
  a.copyWithin(0, W * P, W * P + P);
  a.copyWithin((W + 1) * P, P, 2 * P);
}

/** Un pas de temps (U, V → U2, V2) sur la grille à halo. Coefficients en nombres : fonction chaude monomorphe. */
function step(U: Float64Array, V: Float64Array, U2: Float64Array, V2: Float64Array, W: number, wh: number, wv: number, wd1: number, wd2: number, F: number, Fk: number, Du: number, Dv: number): void {
  const P = W + 2;
  halo(U, W);
  halo(V, W);
  for (let y = 1; y <= W; y++) {
    const end = y * P + W;
    for (let i = y * P + 1; i <= end; i++) {
      const iu = i - P, id = i + P;
      const u = U[i]!, v = V[i]!;
      const lu = wh * (U[i - 1]! + U[i + 1]!) + wv * (U[iu]! + U[id]!) +
        wd1 * (U[iu - 1]! + U[id + 1]!) + wd2 * (U[iu + 1]! + U[id - 1]!) - u;
      const lv = wh * (V[i - 1]! + V[i + 1]!) + wv * (V[iu]! + V[id]!) +
        wd1 * (V[iu - 1]! + V[id + 1]!) + wd2 * (V[iu + 1]! + V[id - 1]!) - v;
      const uvv = u * v * v;
      U2[i] = u + Du * lu - uvv + F * (1 - u);
      V2[i] = v + Dv * lv + uvv - Fk * v;
    }
  }
}

/**
 * Gray-Scott sur un tore, laplacien à 9 points (0,2 pour les voisins directs, 0,05 en diagonale),
 * pondéré par la direction : w(φ) = base · (1 + aniso · cos 2(φ − axe)). Les voisins opposés
 * par paire gardent la somme des poids à 1, donc le schéma reste stable (Du ≤ 1).
 * Renvoie le champ V (grid × grid, ligne par ligne) et le nombre d'itérations faites. Pur et déterministe (Float64Array,
 * ordre de calcul fixe ; Float64 aussi pour éviter les nombres dénormalisés, très lents, du fond).
 */
export function simulatePelage(sim: PelageSim): PelageResult {
  const W = sim.grid;
  const P = W + 2;
  const U = new Float64Array(P * P).fill(1);
  const V = new Float64Array(P * P);
  const U2 = new Float64Array(P * P);
  const V2 = new Float64Array(P * P);
  for (const g of sim.germs) {
    const gx = Math.floor(g.x * W), gy = Math.floor(g.y * W);
    const r = g.r;
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const i = (((gy + y + W) % W) + 1) * P + ((gx + x + W) % W) + 1;
        V[i] = g.v;
        U[i] = 0.5;
      }
    }
  }
  const c2 = (phi: number) => Math.cos(2 * (phi - sim.axis));
  const a = sim.aniso;
  // Poids par direction : horizontal (φ = 0), vertical (π/2), diagonales (π/4 : (+1,+1), 3π/4 : (+1,−1)).
  const wh = 0.2 * (1 + a * c2(0));
  const wv = 0.2 * (1 + a * c2(Math.PI / 2));
  const wd1 = 0.05 * (1 + a * c2(Math.PI / 4));
  const wd2 = 0.05 * (1 + a * c2((3 * Math.PI) / 4));
  const { F, Du, Dv } = sim;
  const Fk = sim.F + sim.k;
  // Itérations adaptées : par blocs de `CHECK_EVERY` pas (nombre pair : le résultat revient dans
  // U, V), jusqu'à ce que le motif couvre la grille, puis `settle` pas pour qu'il s'organise.
  let it = 0;
  let coveredAt: number | null = null;
  while (it < sim.maxIterations) {
    for (let b = 0; b < CHECK_EVERY; b += 2) {
      step(U, V, U2, V2, W, wh, wv, wd1, wd2, F, Fk, Du, Dv);
      step(U2, V2, U, V, W, wh, wv, wd1, wd2, F, Fk, Du, Dv);
    }
    it += CHECK_EVERY;
    if (coveredAt === null && coverage(U, V, W) >= COVERED) coveredAt = it;
    if (coveredAt !== null && it >= Math.max(sim.minIterations, coveredAt + sim.settle)) break;
  }
  const field = new Float32Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) field[y * W + x] = V[(y + 1) * P + x + 1]!;
  return { field, iterations: it, coveredAt };
}

/** Part des cellules que le motif a atteintes (l'état de repos est U = 1, V = 0). */
function coverage(U: Float64Array, V: Float64Array, W: number): number {
  const P = W + 2;
  let n = 0;
  for (let y = 1; y <= W; y++) {
    for (let i = y * P + 1, end = y * P + W; i <= end; i++) if (V[i]! > 0.02 || U[i]! < 0.98) n++;
  }
  return n / (W * W);
}

const lum = (h: string) => {
  const c = hex(h);
  return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
};

/** Accents de la palette du plus sombre au plus clair (indépendant de la rotation seedée). */
export function byLuminance(p: PaletteV2): string[] {
  return [...p.colors].sort((a, b) => lum(a) - lum(b) || (a < b ? -1 : 1));
}

/** Dégradé du pelage : papier → accent le plus clair → accent médian → 2ᵉ plus sombre → nuit. */
export function pelageStops(p: PaletteV2): string[] {
  const L = byLuminance(p);
  return [p.paper, L[4]!, L[2]!, L[1]!, p.night];
}

export const pelage: Technique = {
  id: "pelage",
  family: "organique",
  name: "Pelage",
  process: "réaction-diffusion (Gray-Scott)",
  ported: true,
  heavy: true,
  maxExportSize: 4000,
  render(ctx, S, input, options = {}) {
    const quality = options.quality ?? "full";
    const sim = pelageSim(input, quality);
    const { field } = simulatePelage(sim);
    const gain = pelageParams(input).regime.gain;
    const col = ramp(pelageStops(input.palette));
    blitField(ctx, S, sim.grid, (i) => col(Math.min(1, field[i]! * gain)));
    if (quality === "full") grain(ctx, S, rngFor(input, "pelage-grain"), 10);
    drawMissingMark(ctx, S, input, input.palette.mood === "nocturne" ? input.palette.ink : mixHex(input.palette.ink, input.palette.paper, 0.1));
  },
  explain(input) {
    const p = pelageParams(input);
    const n = input.norms;
    const neutral = (v: number | null, what: string) => (v === null ? ` → ${what}` : "");
    const deg = ((p.windDirDeg % 360) + 360) % 360;
    return [
      {
        param: "Régime du motif (F, k)",
        source: `Pas (${centile(n.steps)}${neutral(n.steps, "régime du milieu")})`,
        value: `${p.regime.name} (F ${fmt(p.F, 4)}, k ${fmt(p.k, 4)})`,
      },
      { param: "Écart de F (deux jours du même régime diffèrent)", source: "Hasard de la date", value: fmt(p.F - p.regime.F, 4) },
      {
        param: "Ajustement de k (épaisseur des bandes)",
        source: `Sommeil (${centile(n.sleep)}${neutral(n.sleep, "sans ajustement")})`,
        value: fmt(p.k - p.regime.k, 4),
      },
      {
        param: "Germes semés par les commits",
        source: input.day.commits === null ? `Commits non mesurés → ${GERMS.neutralCommits} + ${GERMS.base}` : `Commits (${input.day.commits}) + ${GERMS.base}`,
        value: fmtInt(p.commitGerms),
      },
      {
        param: "Germes semés par la pluie",
        source: p.precipMeasured ? `Pluie (${fmt(p.precipMm, 1)} mm × ${GERMS.rainPerMm})` : "Pluie : pas de météo → repli 0 mm",
        value: `${fmtInt(p.rainGerms)} (total ${fmtInt(p.germs)}, au plus ${GERMS.max})`,
      },
      {
        param: "Axe d'étirement",
        source: p.windMeasured ? "Direction du vent" : `Vent : pas de météo → repli ${fmtInt(deg)}°`,
        value: `${fmtInt(deg)}° (d'où vient le vent)`,
      },
      {
        param: "Force de l'étirement",
        source: p.windMeasured ? `Vent (${fmt(p.windKmh, 0)} km/h)` : `Vent : repli ${fmt(p.windKmh, 0)} km/h`,
        value: fmt(p.aniso, 2),
      },
      { param: "Couleurs", source: "Palette du jour (papier → accents du plus clair au plus sombre → nuit)", value: `palette « ${input.palette.name} »` },
      {
        param: "Simulation",
        source: `Régime « ${p.regime.name} » (même motif à toute taille)`,
        value: `grille ${FULL.grid} × ${FULL.grid} ; itérations jusqu'à ce que le motif couvre la grille, puis ${fmtInt(p.regime.settle)} de plus (entre ${fmtInt(FULL.minIterations)} et ${fmtInt(FULL.maxIterations)}) ; Du ${fmt(DIFFUSION.Du, 1)}, Dv ${fmt(DIFFUSION.Dv, 1)}`,
      },
    ];
  },
};
