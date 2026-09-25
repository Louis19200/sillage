/**
 * Vitrail (diagramme de Voronoï) : chaque tranche d'activité de la journée sème
 * des cellules, disposées en spirale de minuit à minuit. Couleur ← heure et
 * température ; plomb ← contours ; lumière ← phase de lune.
 */
import { hex, mix, grain, ramp } from "../helpers";
import { day, hourly, moon, palette, rngFor, weather, type Sketch } from "../day";

const sketch: Sketch = (ctx, S) => {
  const rng = rngFor("vitrail");
  const total = hourly.reduce((a, b) => a + b, 0) || 1;
  const sites: { x: number; y: number; h: number }[] = [];
  hourly.forEach((v, h) => {
    const k = Math.round((v / total) * 70) + 1;
    for (let j = 0; j < k; j++) {
      const ang = (h / 24) * Math.PI * 2 - Math.PI / 2 + rng.range(-0.12, 0.12);
      const rad = S * (0.1 + 0.4 * Math.sqrt(rng.next()));
      sites.push({ x: S / 2 + Math.cos(ang) * rad, y: S / 2 + Math.sin(ang) * rad, h });
    }
  });
  for (let c = 0; c < (day.commits ?? 0); c++) sites.push({ x: rng.range(0, S), y: rng.range(0, S), h: -1 });

  // Chaud l'après-midi, froid la nuit ; teinté par la température.
  const warmth = (weather.tempMax - 10) / 25;
  const byHour = ramp([palette.night, palette.colors[0]!, palette.colors[3]!, palette.colors[2]!, palette.colors[1]!, palette.colors[4]!]);
  const siteCol = sites.map((s, i) => {
    if (s.h < 0) return hex(palette.colors[2]!);
    const t = 0.5 - 0.5 * Math.cos((s.h / 24) * Math.PI * 2);
    return mix(byHour(t * (0.6 + 0.4 * warmth)), [255, 255, 255], (i % 5) * 0.03);
  });

  const owner = new Int32Array(S * S);
  const dist = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < sites.length; i++) {
      const dx = sites[i]!.x - x, dy = sites[i]!.y - y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    owner[y * S + x] = best;
    dist[y * S + x] = Math.sqrt(bd);
  }
  const img = ctx.createImageData(S, S);
  const lead = hex("#17140f");
  const glow = 0.35 + 0.5 * Math.sin(moon * Math.PI);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const o = owner[i]!;
    let edge = false;
    for (let d = 1; d <= 3 && !edge; d++) {
      if (x + d < S && owner[i + d] !== o) edge = true;
      if (y + d < S && owner[i + d * S] !== o) edge = true;
      if (x - d >= 0 && owner[i - d] !== o) edge = true;
      if (y - d >= 0 && owner[i - d * S] !== o) edge = true;
    }
    let c = siteCol[o]!;
    const light = Math.max(0, 1 - dist[i]! / 90) * glow;
    c = mix(c, [255, 250, 235], light * 0.45);
    const vign = Math.hypot(x - S / 2, y - S / 2) / (S * 0.75);
    c = mix(c, [10, 10, 14], Math.max(0, vign - 0.35) * 0.9);
    if (edge) c = lead;
    img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  grain(ctx, S, rng.fork("grain"), 22);
};
export default sketch;
