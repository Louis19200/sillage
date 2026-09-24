/**
 * Géométrie pure partagée par les moteurs de rendu (p5/canvas aujourd'hui, SVG en phase 6) :
 * une courbe de la Scene passe par tous ses points (Catmull-Rom uniforme), qu'on convertit
 * en segments de Bézier cubiques, dessinables partout (`bezierCurveTo`, `C` en SVG).
 */

export type Pt = [number, number];

export interface BezierPath {
  start: Pt;
  /** Chaque segment : [contrôle 1, contrôle 2, arrivée]. */
  segments: [Pt, Pt, Pt][];
}

export function catmullRomToBezier(points: readonly Pt[], closed: boolean): BezierPath | null {
  const n = points.length;
  if (n < 2) return null;
  const at = (i: number): Pt => {
    if (closed) return points[((i % n) + n) % n]!;
    return points[Math.min(n - 1, Math.max(0, i))]!;
  };
  const segments: [Pt, Pt, Pt][] = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    segments.push([
      [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
      [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
      [p2[0], p2[1]],
    ]);
  }
  return { start: at(0), segments };
}
