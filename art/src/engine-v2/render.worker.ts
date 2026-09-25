/**
 * Worker de rendu v2 : dessine une technique sur un OffscreenCanvas et renvoie une ImageBitmap
 * (transférée, sans copie) ou un Blob encodé. N'importe ni p5 ni le DOM.
 */
import { techniqueFor } from "./techniques";
import type { FromRenderWorker, ToRenderWorker } from "./render-protocol";

// Pas de lib « webworker » dans ce tsconfig (conflit avec « DOM ») : on type le strict nécessaire.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ToRenderWorker>) => void) | null;
  postMessage(message: FromRenderWorker, transfer?: Transferable[]): void;
};

scope.onmessage = async (e) => {
  const msg = e.data;
  const t0 = performance.now();
  try {
    const canvas = new OffscreenCanvas(msg.size, msg.size);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas 2D indisponible");
    await techniqueFor(msg.input.style).render(ctx, msg.size, msg.input, msg.options);
    if (msg.output === "bitmap") {
      const bitmap = canvas.transferToImageBitmap();
      scope.postMessage({ type: "bitmap", id: msg.id, bitmap, ms: performance.now() - t0 }, [bitmap]);
    } else {
      const blob = await canvas.convertToBlob(msg.format ?? { type: "image/png" });
      scope.postMessage({ type: "blob", id: msg.id, blob, ms: performance.now() - t0 });
    }
  } catch (err) {
    scope.postMessage({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
