import type { RenderOptions, TechniqueInput } from "./types";

export interface ToRenderWorker {
  id: number;
  input: TechniqueInput;
  size: number;
  options: RenderOptions;
  output: "bitmap" | "blob";
  format?: { type: string; quality?: number };
}

export type FromRenderWorker =
  | { type: "bitmap"; id: number; bitmap: ImageBitmap; ms: number }
  | { type: "blob"; id: number; blob: Blob; ms: number }
  | { type: "error"; id: number; message: string };
