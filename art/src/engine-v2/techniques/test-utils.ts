/**
 * Outils de test des techniques vectorielles (Vitrail, Constructif) : contexte 2D factice qui
 * vérifie que toutes les coordonnées sont finies, et contrôle de bonne formation XML.
 * Importé seulement par les tests.
 */
import { expect } from "vitest";
import type { Ctx2D } from "../types";

export function mockCtx(S: number): { ctx: Ctx2D; calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const finite = (name: string, args: unknown[]) => {
    for (const a of args) if (typeof a === "number" && !Number.isFinite(a)) throw new Error(`${name} : argument non fini ${a}`);
  };
  const target: Record<string | symbol, unknown> = {
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createRadialGradient: (...args: number[]) => {
      finite("createRadialGradient", args);
      return {
        addColorStop: (o: number, c: string) => {
          if (!(o >= 0 && o <= 1)) throw new Error(`addColorStop : position ${o}`);
          if (!/^rgba\(\d+,\d+,\d+,[\d.e-]+\)$/.test(c)) throw new Error(`addColorStop : couleur ${c}`);
        },
      };
    },
  };
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k !== "string") return undefined;
      return (...args: unknown[]) => {
        calls[k] = (calls[k] ?? 0) + 1;
        finite(k, args);
      };
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as Ctx2D;
  void S;
  return { ctx, calls };
}

/** Balises équilibrées, attributs entre guillemets, entités connues (même contrôle que `export/svg.test.ts`). */
export function expectWellFormedXml(xml: string): void {
  const stack: string[] = [];
  const tag = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g;
  let last = 0;
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    const text = xml.slice(last, m.index);
    expect(text, `texte invalide avant ${m[0].slice(0, 40)}`).not.toMatch(/[<>]|&(?!(amp|lt|gt|quot|apos);)/);
    last = tag.lastIndex;
    if (!m[2]) continue;
    const [, closing, name, , selfClosing] = m;
    if (closing) expect(stack.pop()).toBe(name);
    else if (!selfClosing) stack.push(name!);
  }
  expect(xml.slice(last).trim()).toBe("");
  expect(stack).toEqual([]);
  expect(xml.replace(tag, "")).not.toMatch(/[<>]/);
  expect(xml).not.toMatch(/NaN|Infinity|undefined/);
}
