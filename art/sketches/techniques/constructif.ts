/**
 * Composition constructiviste : une grille, des cercles, demi-disques et plans
 * en aplats. Forme maîtresse ← sommeil ; nombre de modules ← pas ;
 * petits carrés ← commits ; grande diagonale ← vent ; décalage d'encre (risographie).
 */
import { grain } from "../helpers";
import { day, n, palette, rngFor, weather, type Sketch } from "../day";

const sketch: Sketch = (ctx, S) => {
  const rng = rngFor("constructif");
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, S, S);
  const M = S * 0.08;
  const G = 5;
  const cell = (S - 2 * M) / G;
  const colors = [palette.colors[0]!, palette.colors[1]!, palette.colors[2]!, palette.ink, palette.colors[4]!];
  const pick = () => colors[rng.int(0, colors.length - 1)]!;

  const shape = (x: number, y: number, w: number, kind: number, rot: number, color: string) => {
    ctx.save();
    ctx.translate(x + w / 2, y + w / 2);
    ctx.rotate(rot);
    ctx.fillStyle = color;
    ctx.beginPath();
    if (kind === 0) ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
    else if (kind === 1) { ctx.arc(0, w / 2, w / 2, Math.PI, 0); ctx.closePath(); }
    else if (kind === 2) { ctx.moveTo(-w / 2, -w / 2); ctx.arc(-w / 2, -w / 2, w, 0, Math.PI / 2); ctx.closePath(); }
    else if (kind === 3) ctx.rect(-w / 2, -w / 2, w, w / 2);
    else { ctx.moveTo(-w / 2, w / 2); ctx.lineTo(w / 2, w / 2); ctx.lineTo(-w / 2, -w / 2); ctx.closePath(); }
    ctx.fill();
    ctx.restore();
  };

  // Ombre d'encre décalée, puis encre principale (effet risographie).
  const draw = (dx: number, dy: number, alpha: number) => {
    const r2 = rngFor("constructif-plan");
    ctx.save();
    ctx.translate(dx, dy);
    ctx.globalAlpha = alpha;
    const filled = Math.round(6 + 12 * n.steps);
    const cells = Array.from({ length: G * G }, (_, i) => i).sort(() => r2.next() - 0.5).slice(0, filled);
    for (const c of cells) {
      const gx = c % G, gy = Math.floor(c / G);
      const kind = r2.int(0, 4);
      const rot = (r2.int(0, 3) * Math.PI) / 2;
      shape(M + gx * cell, M + gy * cell, cell, kind, rot, colors[r2.int(0, colors.length - 1)]!);
    }
    // Forme maîtresse : grand disque, taille ← sommeil.
    const R = S * (0.1 + 0.12 * n.sleep);
    ctx.fillStyle = palette.colors[1]!;
    ctx.globalCompositeOperation = "multiply";
    ctx.beginPath();
    ctx.arc(M + cell * (1 + r2.int(0, 2)), M + cell * (1 + r2.int(0, 2)), R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    // Grande diagonale dans l'axe du vent.
    const wa = (weather.windDirDeg * Math.PI) / 180;
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = S * 0.012;
    ctx.beginPath();
    ctx.moveTo(S / 2 - Math.cos(wa) * S * 0.6, S / 2 - Math.sin(wa) * S * 0.6);
    ctx.lineTo(S / 2 + Math.cos(wa) * S * 0.6, S / 2 + Math.sin(wa) * S * 0.6);
    ctx.stroke();
    // Petits carrés : un par commit.
    for (let i = 0; i < (day.commits ?? 0); i++) {
      ctx.fillStyle = i % 3 === 0 ? palette.colors[4]! : palette.ink;
      const s = S * 0.022;
      ctx.fillRect(M + r2.range(0, S - 2 * M - s), M + r2.range(0, S - 2 * M - s), s, s);
    }
    ctx.restore();
  };
  draw(4, 3, 0.25);
  draw(0, 0, 1);
  // Filets fins de la grille.
  ctx.strokeStyle = "rgba(29,31,43,0.25)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= G; i++) {
    ctx.beginPath(); ctx.moveTo(M + i * cell, M * 0.6); ctx.lineTo(M + i * cell, S - M * 0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(M * 0.6, M + i * cell); ctx.lineTo(S - M * 0.6, M + i * cell); ctx.stroke();
  }
  void pick;
  grain(ctx, S, rng.fork("grain"), 20);
};
export default sketch;
