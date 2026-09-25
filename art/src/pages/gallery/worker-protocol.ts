import type { DayInput } from "../../engine";

export type ToWorker =
  | { type: "history"; days: DayInput[] }
  | { type: "compose"; id: number; date: string };

export type FromWorker =
  | { type: "scene"; id: number; date: string; json: string; ms: number }
  | { type: "error"; id: number; date: string; message: string };
