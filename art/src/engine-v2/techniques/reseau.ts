/**
 * Réseau : physarum (porté depuis `art/sketches/techniques/reseau.ts`). Des dizaines de milliers
 * d'agents avancent, sentent la trace laissée par les autres devant eux (à gauche, en face, à
 * droite), tournent vers la plus forte et déposent la leur ; la trace diffuse et s'évapore.
 * Il en sort un réseau veineux, renforcé autour des points nourriciers.
 *
 *   nombre d'agents      ← pas (centile)
 *   vitesse heure par heure ← pas horaires (`hourlyOrFallback`) : la journée se déroule sur les itérations
 *   points nourriciers   ← commits (un par commit, au plus `FOOD.max` ; 0 commit = aucun)
 *   angle de détection   ← sommeil (centile) : nuit courte → réseau serré, longue nuit → larges mailles
 *   dérive               ← vent (direction et vitesse)
 *   couleurs             ← palette v2 du jour, sur son fond « nuit »
 *
 * La simulation (`simulateReseau`) est pure : pas de canvas, résultat = champ de traces.
 * Miniature : grille réduite, distance de détection et agents mis à l'échelle (même réseau, en
 * plus grossier), mêmes itérations. Métrique absente : valeur neutre et cadre en pointillés.
 */
import { FALLBACKS, hourlyOrFallback, weatherOrFallback } from "../input";
import { blitField, centile, drawMissingMark, fmt, fmtInt, grain, hex, mixHex, ramp, rngFor } from "../helpers";
import type { PaletteV2, Technique, TechniqueInput } from "../types";

/** Réglages de l'esquisse (grille 500). */
export const FULL = { grid: 500, iterations: 150 } as const;
/** Miniature : grille 180, même densité d'agents et mêmes distances (le réseau a des mailles de même taille en cellules, donc moins de mailles, plus grosses à l'écran). */
export const PREVIEW = { grid: 180, iterations: 150 } as const;

export const AGENTS = { min: 25_000, span: 45_000 } as const;
/** Angle de détection, degrés : `min + span · sommeil`. */
export const SENSOR = { minDeg: 22, spanDeg: 23, rotateDeg: 45, distance: 9 } as const;
/** Vitesse (cellules par pas) : `min + span · pas de l'heure / heure la plus active`. */
export const SPEED = { min: 0.6, span: 0.8 } as const;
/** Points nourriciers : un par commit, au plus `max` ; commits non mesurés → `neutral`. */
export const FOOD = { max: 24, neutral: 3, value: 40, half: 2 } as const;
/** Dérive : `perKmh · vent` cellules par pas, dans le sens où le vent souffle. */
export const DRIFT = { perKmh: 0.002 } as const;
export const TRAIL = { deposit: 5, decay: 0.92 } as const;

export interface ReseauSim {
  grid: number;
  iterations: number;
  agents: number;
  /** Demi-angle de détection, radians. */
  sensorAngle: number;
  rotateAngle: number;
  sensorDistance: number;
  /** Vitesse à chaque itération (profil horaire étalé sur les itérations). */
  speeds: number[];
  /** Points nourriciers, en fraction de la grille. */
  food: [number, number][];
  foodHalf: number;
  driftX: number;
  driftY: number;
}

export interface ReseauParams {
  agents: number;
  sensorDeg: number;
  food: number;
  foodNeutral: boolean;
  hourly: number[];
  hourlyMeasured: boolean;
  /** Heure la plus active (0–23), `null` si aucun pas. */
  peakHour: number | null;
  windDirDeg: number;
  windKmh: number;
  windMeasured: boolean;
  drift: number;
}

/** Pas horaires : la donnée, ou le total réparti selon le profil type ; pas non mesurés → profil type seul. */
function hourlyProfile(input: TechniqueInput): { values: number[]; measured: boolean } {
  if (input.hourlySteps && input.hourlySteps.length === 24) return { values: input.hourlySteps, measured: true };
  if (input.day.steps === null) return { values: [...FALLBACKS.hourlyShape], measured: false };
  return { values: hourlyOrFallback(input), measured: false };
}

export function reseauParams(input: TechniqueInput): ReseauParams {
  const n = input.norms;
  const w = weatherOrFallback(input.weather);
  const { values, measured } = hourlyProfile(input);
  const max = Math.max(...values);
  const commits = input.day.commits;
  return {
    agents: Math.round(AGENTS.min + AGENTS.span * (n.steps ?? 0.5)),
    sensorDeg: SENSOR.minDeg + SENSOR.spanDeg * (n.sleep ?? 0.5),
    food: commits === null ? FOOD.neutral : Math.min(FOOD.max, commits),
    foodNeutral: commits === null,
    hourly: values,
    hourlyMeasured: measured,
    peakHour: max > 0 ? values.indexOf(max) : null,
    windDirDeg: w.windDirDeg.value,
    windKmh: w.windKmh.value,
    windMeasured: w.windDirDeg.measured && w.windKmh.measured,
    drift: DRIFT.perKmh * w.windKmh.value,
  };
}

/** Vitesse de chaque itération : l'itération `it` tombe dans l'heure ⌊it · 24 / itérations⌋. */
export function speedsFor(hourly: readonly number[], iterations: number): number[] {
  const max = Math.max(0, ...hourly);
  return Array.from({ length: iterations }, (_, it) => {
    const h = Math.min(23, Math.floor((it * 24) / iterations));
    return SPEED.min + (max > 0 ? SPEED.span * (hourly[h]! / max) : 0);
  });
}

export function reseauSim(input: TechniqueInput, quality: "full" | "preview" = "full"): ReseauSim {
  const q = quality === "preview" ? PREVIEW : FULL;
  const scale = q.grid / FULL.grid;
  const p = reseauParams(input);
  const rng = rngFor(input, "reseau-nourriture");
  const food: [number, number][] = [];
  for (let i = 0; i < p.food; i++) food.push([rng.range(0.1, 0.9), rng.range(0.1, 0.9)]);
  // Le vent vient de windDirDeg et souffle vers l'opposé ; nord en haut, y vers le bas.
  const t = (p.windDirDeg * Math.PI) / 180;
  return {
    grid: q.grid,
    iterations: q.iterations,
    agents: Math.round(p.agents * scale * scale),
    sensorAngle: (p.sensorDeg * Math.PI) / 180,
    rotateAngle: (SENSOR.rotateDeg * Math.PI) / 180,
    sensorDistance: SENSOR.distance,
    speeds: speedsFor(p.hourly, q.iterations),
    food,
    foodHalf: FOOD.half,
    driftX: -Math.sin(t) * p.drift,
    driftY: Math.cos(t) * p.drift,
  };
}

/** Flou 3 × 3 (boîte, séparable) sur le tore, multiplié par `decay` : `src` → `dst`, `tmp` en tampon. */
function diffuse(src: Float32Array, dst: Float32Array, tmp: Float32Array, W: number, decay: number): void {
  for (let y = 0; y < W; y++) {
    const r = y * W;
    tmp[r] = src[r + W - 1]! + src[r]! + src[r + 1]!;
    for (let x = 1; x < W - 1; x++) tmp[r + x] = src[r + x - 1]! + src[r + x]! + src[r + x + 1]!;
    tmp[r + W - 1] = src[r + W - 2]! + src[r + W - 1]! + src[r]!;
  }
  const k = decay / 9;
  for (let y = 0; y < W; y++) {
    const r = y * W;
    const up = ((y - 1 + W) % W) * W;
    const dn = ((y + 1) % W) * W;
    for (let x = 0; x < W; x++) dst[r + x] = (tmp[up + x]! + tmp[r + x]! + tmp[dn + x]!) * k;
  }
}

/**
 * Simulation physarum sur un tore. Renvoie le champ de traces (grid × grid). Pur et déterministe :
 * tout le hasard vient de `rngFor(input, "reseau")` (positions, caps, choix gauche/droite).
 */
export function simulateReseau(sim: ReseauSim, input: TechniqueInput): Float32Array {
  const rng = rngFor(input, "reseau");
  const W = sim.grid;
  const A = sim.agents;
  // Position et cap (cos, sin) de chaque agent. Le cap ne tourne que de ±RA : on le fait tourner
  // par matrice de rotation au lieu d'appeler cos/sin (6 appels par agent et par pas dans l'esquisse).
  const px = new Float64Array(A), py = new Float64Array(A), dc = new Float64Array(A), ds = new Float64Array(A);
  for (let i = 0; i < A; i++) {
    px[i] = rng.next() * W;
    py[i] = rng.next() * W;
    const a = rng.next() * Math.PI * 2;
    dc[i] = Math.cos(a);
    ds[i] = Math.sin(a);
  }
  let trail = new Float32Array(W * W);
  let next = new Float32Array(W * W);
  const tmp = new Float32Array(W * W);
  const food = sim.food.map(([fx, fy]) => [Math.floor(fx * W), Math.floor(fy * W)] as const);
  const SD = sim.sensorDistance;
  const cS = Math.cos(sim.sensorAngle), sS = Math.sin(sim.sensorAngle);
  const cR = Math.cos(sim.rotateAngle), sR = Math.sin(sim.rotateAngle);
  // Positions toujours dans [0, W) : décaler de W garde l'argument positif (troncature = plancher).
  const sense = (x: number, y: number, c: number, s: number) => {
    const sx = ((x + W + c * SD) | 0) % W;
    const sy = ((y + W + s * SD) | 0) % W;
    return trail[sy * W + sx]!;
  };
  const fh = sim.foodHalf;
  const { driftX, driftY } = sim;
  for (let it = 0; it < sim.iterations; it++) {
    for (const [fx, fy] of food) {
      for (let dy = -fh; dy <= fh; dy++) for (let dx = -fh; dx <= fh; dx++) trail[((fy + dy + W) % W) * W + ((fx + dx + W) % W)] = FOOD.value;
    }
    const speed = sim.speeds[it]!;
    for (let i = 0; i < A; i++) {
      const x0 = px[i]!, y0 = py[i]!;
      let c = dc[i]!, s = ds[i]!;
      const f = sense(x0, y0, c, s);
      const l = sense(x0, y0, c * cS + s * sS, s * cS - c * sS); // cap − SA
      const r = sense(x0, y0, c * cS - s * sS, s * cS + c * sS); // cap + SA
      let turn = 0;
      if (f > l && f > r) turn = 0;
      else if (f < l && f < r) turn = rng.next() < 0.5 ? -1 : 1;
      else if (l > r) turn = -1;
      else if (r > l) turn = 1;
      if (turn !== 0) {
        const sr = turn * sR;
        const nc = c * cR - s * sr;
        s = s * cR + c * sr;
        c = nc;
        dc[i] = c;
        ds[i] = s;
      }
      let x = x0 + c * speed + driftX;
      let y = y0 + s * speed + driftY;
      if (x < 0) x += W; else if (x >= W) x -= W;
      if (y < 0) y += W; else if (y >= W) y -= W;
      px[i] = x;
      py[i] = y;
      trail[(y | 0) * W + (x | 0)]! += TRAIL.deposit;
    }
    diffuse(trail, next, tmp, W, TRAIL.decay);
    const t = trail;
    trail = next;
    next = t;
  }
  return trail;
}

const lum = (h: string) => {
  const c = hex(h);
  return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
};

/** Dégradé du réseau : nuit → accent le plus sombre → 4ᵉ → le plus clair → presque blanc. */
export function reseauStops(p: PaletteV2): string[] {
  const L = [...p.colors].sort((a, b) => lum(a) - lum(b) || (a < b ? -1 : 1));
  return [p.night, mixHex(p.night, L[0]!, 0.45), L[0]!, L[3]!, L[4]!, mixHex(L[4]!, "#ffffff", 0.75)];
}

export const reseau: Technique = {
  id: "reseau",
  family: "organique",
  name: "Réseau",
  process: "vie artificielle (physarum)",
  ported: true,
  heavy: false, // 0,4–0,8 s à 1000 px (mesuré dans Chromium) ; tourne quand même dans le Worker
  maxExportSize: 4000,
  render(ctx, S, input, options = {}) {
    const quality = options.quality ?? "full";
    const sim = reseauSim(input, quality);
    const trail = simulateReseau(sim, input);
    let max = 0;
    for (let i = 0; i < trail.length; i++) if (trail[i]! > max) max = trail[i]!;
    const col = ramp(reseauStops(input.palette));
    const lm = Math.log(1 + Math.max(1e-6, max));
    blitField(ctx, S, sim.grid, (i) => col(Math.pow(Math.log(1 + trail[i]!) / lm, 1.6)));
    if (quality === "full") grain(ctx, S, rngFor(input, "reseau-grain"), 10);
    drawMissingMark(ctx, S, input, reseauStops(input.palette)[4]!);
  },
  explain(input) {
    const p = reseauParams(input);
    const n = input.norms;
    const neutral = (v: number | null) => (v === null ? " → valeur neutre 0,5" : "");
    const deg = ((p.windDirDeg % 360) + 360) % 360;
    const speeds = speedsFor(p.hourly, FULL.iterations);
    return [
      { param: "Nombre d'agents", source: `Pas (${centile(n.steps)}${neutral(n.steps)})`, value: fmtInt(p.agents) },
      {
        param: "Vitesse des agents, heure par heure",
        source:
          p.hourlyMeasured ? "Pas horaires"
          : input.day.steps === null ? "Pas non mesurés → profil type d'une journée"
          : `Pas du jour (${fmtInt(input.day.steps)}) répartis selon le profil type`,
        value:
          p.peakHour === null ? `${fmt(SPEED.min, 1)} cellule par pas (aucun pas : lent toute la journée)`
          : `${fmt(Math.min(...speeds), 2)} à ${fmt(Math.max(...speeds), 2)} cellule par pas, pic à ${p.peakHour} h`,
      },
      {
        param: "Points nourriciers",
        source: p.foodNeutral ? `Commits non mesurés → ${FOOD.neutral}` : `Commits (${input.day.commits}${input.day.commits! > FOOD.max ? `, au plus ${FOOD.max}` : ""})`,
        value: p.food === 0 ? "aucun (réseau libre)" : fmtInt(p.food),
      },
      { param: "Angle de détection (largeur des mailles)", source: `Sommeil (${centile(n.sleep)}${neutral(n.sleep)})`, value: `${fmt(p.sensorDeg, 1)}°` },
      {
        param: "Direction de la dérive",
        source: p.windMeasured ? "Direction du vent" : `Vent : pas de météo → repli ${fmtInt(deg)}°`,
        value: `vers ${fmtInt((deg + 180) % 360)}° (vent de ${fmtInt(deg)}°)`,
      },
      {
        param: "Force de la dérive",
        source: p.windMeasured ? `Vent (${fmt(p.windKmh, 0)} km/h)` : `Vent : repli ${fmt(p.windKmh, 0)} km/h`,
        value: `${fmt(p.drift, 3)} cellule par pas`,
      },
      { param: "Couleurs", source: "Palette du jour, sur son fond de nuit", value: `palette « ${input.palette.name} »` },
      {
        param: "Simulation",
        source: "Fixe (même réseau à toute taille)",
        value: `grille ${FULL.grid} × ${FULL.grid}, ${fmtInt(FULL.iterations)} itérations, détection à ${SENSOR.distance} cellules, rotation ${SENSOR.rotateDeg}°`,
      },
    ];
  },
};
