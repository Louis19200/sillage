/**
 * Gravure au trait, pensée pour une table traçante : le plan est subdivisé en
 * rectangles hachurés, un disque croisé au centre. Profondeur de découpe ← pas ;
 * angle des hachures ← vent ; espacement ← heure par heure ; disque ← sommeil ;
 * zones rouges ← commits. Traits légèrement tremblés, comme un vrai stylo.
 */
import { grain } from "../helpers";
import { day, hourly, n, palette, rngFor, weather, type Sketch } from "../day";

const sketch: Sketch = (ctx, S) => {
  const rng = rngFor("hachures");
  ctx.fillStyle = "#f4efe4";
  ctx.fillRect(0, 0, S, S);
  const M = S * 0.07;
  const rects: [number, number, number, number, number][] = [];
  const split = (x: number, y: number, w: number, h: number, depth: number) => {
    if (depth <= 0 || w < 60 || h < 60 || (depth < 3 && rng.next() < 0.25)) { rects.push([x, y, w, h, depth]); return; }
    const t = rng.range(0.3, 0.7);
    if (w > h) { split(x, y, w * t, h, depth - 1); split(x + w * t, y, w * (1 - t), h, depth - 1); }
    else { split(x, y, w, h * t, depth - 1); split(x, y + h * t, w, h * (1 - t), depth - 1); }
  };
  split(M, M, S - 2 * M, S - 2 * M, Math.round(3 + 4 * n.steps));

  const wobble = (x1: number, y1: number, x2: number, y2: number) => {
    const L = Math.hypot(x2 - x1, y2 - y1), k = Math.max(2, Math.floor(L / 25));
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    for (let i = 1; i <= k; i++) {
      const t = i / k;
      ctx.lineTo(x1 + (x2 - x1) * t + (rng.next() - 0.5) * 0.9, y1 + (y2 - y1) * t + (rng.next() - 0.5) * 0.9);
    }
    ctx.stroke();
  };
  const hatch = (clip: () => void, angle: number, gap: number, color: string, width: number) => {
    ctx.save();
    ctx.beginPath(); clip(); ctx.clip();
    ctx.strokeStyle = color; ctx.lineWidth = width;
    const c = Math.cos(angle), s = Math.sin(angle), D = S * 1.5;
    for (let o = -D; o < D; o += gap) {
      const cx = S / 2 - s * o, cy = S / 2 + c * o;
      wobble(cx - c * D, cy - s * D, cx + c * D, cy + s * D);
    }
    ctx.restore();
  };
  const base = (weather.windDirDeg * Math.PI) / 180;
  const maxH = Math.max(...hourly, 1);
  const red = new Set<number>();
  while (red.size < Math.min(rects.length, Math.round((day.commits ?? 0) / 3))) red.add(rng.int(0, rects.length - 1));
  rects.forEach(([x, y, w, h], i) => {
    const hour = Math.floor(((x + w / 2) / S) * 24);
    const gap = 4 + 16 * (1 - hourly[hour]! / maxH);
    const angle = base + (rng.int(0, 3) * Math.PI) / 4;
    hatch(() => ctx.rect(x + 4, y + 4, w - 8, h - 8), angle, gap, red.has(i) ? palette.colors[4]! : palette.ink, red.has(i) ? 1.1 : 0.8);
  });
  // Disque du sommeil : blanc réservé puis croisillons fins.
  const R = S * (0.12 + 0.14 * n.sleep);
  const cx = S * rng.range(0.35, 0.65), cy = S * rng.range(0.35, 0.65);
  ctx.fillStyle = "#f4efe4";
  ctx.beginPath(); ctx.arc(cx, cy, R + 10, 0, Math.PI * 2); ctx.fill();
  hatch(() => ctx.arc(cx, cy, R, 0, Math.PI * 2), base + Math.PI / 2, 5, palette.ink, 0.6);
  hatch(() => ctx.arc(cx, cy, R, 0, Math.PI * 2), base + Math.PI / 2 + 0.6, 7, palette.ink, 0.5);
  ctx.strokeStyle = palette.ink; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  grain(ctx, S, rng.fork("grain"), 16);
};
export default sketch;
