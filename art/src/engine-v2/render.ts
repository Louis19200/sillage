/**
 * Rendu des techniques v2, hors du fil principal quand le navigateur le permet.
 *
 * - `renderDirect(ctx, size, input)` : dessine tout de suite sur un contexte (tests, repli).
 * - `createRenderer()` : pool de Workers (OffscreenCanvas) qui rendent une œuvre et renvoient
 *   une `ImageBitmap` (affichage) ou un `Blob` (miniatures, export PNG). Sans `OffscreenCanvas`
 *   ou sans Worker, même interface sur le fil principal. Les techniques lourdes (Pelage, Réseau :
 *   plusieurs secondes) n'ont rien à faire de plus : elles tournent déjà dans un Worker.
 */
import { createCanvas } from "./helpers";
import { techniqueFor } from "./techniques";
import type { Ctx2D, RenderOptions, TechniqueInput } from "./types";
import type { FromRenderWorker, ToRenderWorker } from "./render-protocol";

export async function renderDirect(ctx: Ctx2D, size: number, input: TechniqueInput, options: RenderOptions = {}): Promise<void> {
  await techniqueFor(input.style).render(ctx, size, input, options);
}

export interface BlobFormat {
  type: string;
  quality?: number;
}

export interface V2Renderer {
  readonly kind: "worker" | "main";
  bitmap(input: TechniqueInput, size: number, options?: RenderOptions): Promise<ImageBitmap>;
  blob(input: TechniqueInput, size: number, format: BlobFormat, options?: RenderOptions): Promise<Blob>;
  dispose(): void;
}

async function canvasToBlob(canvas: OffscreenCanvas | HTMLCanvasElement, format: BlobFormat): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob(format);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encodage impossible (image trop grande ?)"))), format.type, format.quality),
  );
}

/** Rendu sur le fil principal (repli, et navigateurs sans OffscreenCanvas). */
export function createMainThreadRenderer(): V2Renderer {
  async function draw(input: TechniqueInput, size: number, options?: RenderOptions) {
    const { canvas, ctx } = createCanvas(size, size);
    await renderDirect(ctx, size, input, options);
    return canvas;
  }
  return {
    kind: "main",
    async bitmap(input, size, options) {
      return createImageBitmap(await draw(input, size, options));
    },
    async blob(input, size, format, options) {
      const canvas = await draw(input, size, options);
      try {
        return await canvasToBlob(canvas, format);
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    },
    dispose() {},
  };
}

interface Job {
  resolve: (v: ImageBitmap | Blob) => void;
  reject: (e: Error) => void;
  msg: ToRenderWorker;
}

export function workersSupported(): boolean {
  return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
}

/** Pool de Workers de rendu (`count` défaut : cœurs − 1, entre 1 et 4). */
export function createRenderer(count?: number): V2Renderer {
  if (!workersSupported()) return createMainThreadRenderer();
  const n = count ?? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  const workers: { w: Worker; busy: Job | null }[] = [];
  const queue: Job[] = [];
  const fallback = createMainThreadRenderer();
  let nextId = 1;
  let broken = false;

  const pump = () => {
    for (const slot of workers) {
      if (slot.busy || queue.length === 0) continue;
      const job = queue.shift()!;
      slot.busy = job;
      slot.w.postMessage(job.msg);
    }
  };

  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module", name: `sillage-v2-${i}` });
    const slot = { w, busy: null as Job | null };
    w.onmessage = (e: MessageEvent<FromRenderWorker>) => {
      const job = slot.busy;
      slot.busy = null;
      if (job) {
        const m = e.data;
        if (m.type === "error") job.reject(new Error(m.message));
        else job.resolve(m.type === "bitmap" ? m.bitmap : m.blob);
      }
      pump();
    };
    w.onerror = (e) => {
      e.preventDefault();
      // Worker inutilisable (chargement impossible…) : tout repasse sur le fil principal.
      broken = true;
      const job = slot.busy;
      slot.busy = null;
      if (job) queue.unshift(job);
      for (const j of queue.splice(0)) runOnMain(j);
    };
    workers.push(slot);
  }

  function runOnMain(job: Job): void {
    const { input, size, options } = job.msg;
    const p = job.msg.output === "bitmap" ? fallback.bitmap(input, size, options) : fallback.blob(input, size, job.msg.format!, options);
    p.then(job.resolve, job.reject);
  }

  function enqueue<T extends ImageBitmap | Blob>(msg: Omit<ToRenderWorker, "id">): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: Job = { resolve: resolve as (v: ImageBitmap | Blob) => void, reject, msg: { ...msg, id: nextId++ } as ToRenderWorker };
      if (broken) runOnMain(job);
      else {
        queue.push(job);
        pump();
      }
    });
  }

  return {
    kind: "worker",
    bitmap: (input, size, options = {}) => enqueue<ImageBitmap>({ input, size, options, output: "bitmap" }),
    blob: (input, size, format, options = {}) => enqueue<Blob>({ input, size, options, output: "blob", format }),
    dispose() {
      for (const { w } of workers) w.terminate();
      queue.length = 0;
    },
  };
}
