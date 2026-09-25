import type { Sketch } from "./day";

const modules = import.meta.glob<{ default: Sketch }>("./techniques/*.ts");
const name = new URLSearchParams(location.search).get("t") ?? "maree";
const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const load = modules[`./techniques/${name}.ts`];
if (!load) throw new Error(`technique inconnue : ${name}`);
const t0 = performance.now();
await (await load()).default(ctx, canvas.width);
(window as unknown as { done: number }).done = Math.round(performance.now() - t0);
