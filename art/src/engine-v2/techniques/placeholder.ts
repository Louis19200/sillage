/**
 * Rendu provisoire d'une technique pas encore portée depuis les esquisses : le système marche
 * de bout en bout (sélection, fiche, galerie, export PNG), et l'image dit clairement ce qu'elle est.
 * Motif simple aux couleurs de la palette du jour, nom de la technique, mention « provisoire ».
 * À remplacer par le vrai module (voir `_template.ts` et art/README.md « Ajouter une technique »).
 */
import type { FamilyId, StyleId } from "@sillage/shared";
import { drawMissingMark, rngFor } from "../helpers";
import type { Technique } from "../types";

export function createPlaceholder(id: StyleId, family: FamilyId, name: string, process: string): Technique {
  return {
    id,
    family,
    name,
    process,
    ported: false,
    heavy: false,
    maxExportSize: 4000,
    render(ctx, S, input) {
      const { palette } = input;
      const rng = rngFor(input, `provisoire-${id}`);
      const k = S / 1000;
      ctx.save();
      ctx.fillStyle = palette.paper;
      ctx.fillRect(0, 0, S, S);
      // Bandes concentriques décalées : une par couleur de la palette, rayons seedés.
      const cx = S * rng.range(0.42, 0.58);
      const cy = S * rng.range(0.36, 0.44);
      for (let i = 0; i < 9; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, S * (0.34 - i * 0.034) * rng.range(0.94, 1.04), 0, Math.PI * 2);
        ctx.fillStyle = palette.colors[i % 5]!;
        ctx.globalAlpha = 0.85;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // Cartouche.
      ctx.fillStyle = palette.paper;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(S * 0.12, S * 0.74, S * 0.76, S * 0.17);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = Math.max(1, 2 * k);
      ctx.setLineDash([10 * k, 8 * k]);
      ctx.strokeRect(S * 0.12, S * 0.74, S * 0.76, S * 0.17);
      ctx.setLineDash([]);
      ctx.fillStyle = palette.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${Math.round(64 * k)}px Georgia, "Times New Roman", serif`;
      ctx.fillText(name, S / 2, S * 0.8);
      ctx.font = `${Math.round(24 * k)}px system-ui, sans-serif`;
      ctx.fillText(`rendu provisoire · ${process}`, S / 2, S * 0.865);
      ctx.restore();
      drawMissingMark(ctx, S, input, palette.ink);
    },
    explain() {
      return [{ param: "Technique", source: "Pas encore portée depuis les esquisses", value: "rendu provisoire (cercles aux couleurs du jour)" }];
    },
  };
}
