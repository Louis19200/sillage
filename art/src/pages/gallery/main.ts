/**
 * Galerie : `?year=YYYY` (douze mois d'un coup) ou `?month=YYYY-MM` (calendrier).
 * Une seule requête `/range` par vue, qui couvre la période et les 90 jours de référence
 * du premier jour affiché. La grille s'affiche avant les données, les miniatures ensuite.
 */
import { dataSourceFromEnv, type DataSource } from "../../data";
import { addDays, REFERENCE_WINDOW_DAYS, type DayInput } from "../../engine";
import { formatLongDate } from "../day/format";
import { openThumbCache } from "./cache";
import {
  datesOfMonth,
  datesOfYear,
  isoDate,
  monthGrid,
  monthKey,
  monthTitle,
  MONTHS_FR,
  parseMonthKey,
  shiftMonth,
} from "./calendar";
import { hasData, inputFingerprints, toDayInput } from "./inputs";
import { Thumbnailer, type ThumbRequest, type ThumbStats } from "./thumbs";

type View = { kind: "year"; year: number } | { kind: "month"; year: number; month: number };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const BASE = import.meta.env.BASE_URL;
const GALLERY = `${BASE}gallery/`;
const nf = new Intl.NumberFormat("fr-FR");

const dayHref = (date: string) => `${BASE}?date=${date}`;
const yearHref = (year: number) => `${GALLERY}?year=${year}`;
const monthHref = (year: number, month: number) => `${GALLERY}?month=${monthKey(year, month)}`;

function localToday(): string {
  const d = new Date();
  return isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Première année proposée : `VITE_GALLERY_FIRST_YEAR` (défaut 2019, début de l'historique). */
function firstYear(): number {
  const n = Number(import.meta.env.VITE_GALLERY_FIRST_YEAR);
  return Number.isInteger(n) && n > 1900 ? n : 2019;
}

function parseView(params: URLSearchParams, fallbackDate: string): View {
  const month = parseMonthKey(params.get("month"));
  if (month) return { kind: "month", ...month };
  const year = Number(params.get("year"));
  if (Number.isInteger(year) && year >= 1900 && year <= 9999) return { kind: "year", year };
  return { kind: "year", year: Number(fallbackDate.slice(0, 4)) };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function arrow(label: string, glyph: string, href: string | null): HTMLAnchorElement {
  const a = el("a", "nav__arrow", glyph);
  a.setAttribute("aria-label", label);
  a.title = label;
  if (href) a.href = href;
  else a.setAttribute("aria-disabled", "true");
  return a;
}

/** Une case de jour. Renvoie l'élément et, si la journée a des données, la case à remplir. */
interface Cell {
  date: string;
  node: HTMLElement;
}

function dayCell(date: string, today: string): Cell {
  if (date > today) {
    const span = el("span", "cell cell--future");
    return { date, node: span };
  }
  const a = el("a", "cell cell--pending");
  a.href = dayHref(date);
  a.title = formatLongDate(date);
  a.setAttribute("aria-label", a.title);
  return { date, node: a };
}

// ——— Rendu des vues (squelette sans données) ———

function renderYearSkeleton(year: number, today: string): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  const root = el("div", "year");
  for (let m = 1; m <= 12; m++) {
    const section = el("section", "ym");
    section.dataset.month = monthKey(year, m);
    const h = el("h2", "ym__title");
    const link = el("a", undefined, MONTHS_FR[m - 1]);
    link.href = monthHref(year, m);
    h.append(link, el("span", "ym__count"));
    const grid = el("div", "ym__grid");
    for (const week of monthGrid(year, m).weeks) {
      for (const date of week) {
        if (!date) {
          grid.append(el("span", "cell cell--pad"));
          continue;
        }
        const cell = dayCell(date, today);
        cells.set(date, cell);
        grid.append(cell.node);
      }
    }
    section.append(h, grid);
    root.append(section);
  }
  $("body").replaceChildren(root);
  return cells;
}

function renderMonthSkeleton(year: number, month: number, today: string): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  const root = el("div", "month");
  const head = el("div", "month__weekdays");
  for (const d of ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"]) head.append(el("span", undefined, d));
  const grid = el("div", "month__grid");
  for (const week of monthGrid(year, month).weeks) {
    for (const date of week) {
      if (!date) {
        grid.append(el("span", "mday mday--pad"));
        continue;
      }
      const fig = el("figure", "mday");
      const cell = dayCell(date, today);
      if (date > today) fig.classList.add("mday--future");
      const cap = el("figcaption");
      cap.append(el("span", "mday__num", String(Number(date.slice(8)))), el("span", "mday__note"));
      fig.append(cell.node, cap);
      cells.set(date, { date, node: cell.node });
      grid.append(fig);
    }
  }
  root.append(head, grid);
  $("body").replaceChildren(root);
  return cells;
}

function renderNav(view: View, years: { first: number; last: number }): void {
  const nav = $("nav");
  nav.replaceChildren();
  $<HTMLAnchorElement>("view-year").href = yearHref(view.year);
  const monthForLink = view.kind === "month" ? view.month : 1;
  $<HTMLAnchorElement>("view-month").href = monthHref(view.year, monthForLink);
  $(view.kind === "year" ? "view-year" : "view-month").setAttribute("aria-current", "page");

  if (view.kind === "year") {
    const { year } = view;
    const title = el("h1", "nav__title", String(year));
    const list = el("div", "years");
    for (let y = years.first; y <= years.last; y++) {
      const a = el("a", undefined, String(y));
      a.href = yearHref(y);
      if (y === year) a.setAttribute("aria-current", "page");
      list.append(a);
    }
    const row = el("div", "nav__row");
    row.append(
      arrow("Année précédente", "←", year > years.first ? yearHref(year - 1) : null),
      title,
      arrow("Année suivante", "→", year < years.last ? yearHref(year + 1) : null),
    );
    nav.classList.add("gallery__nav--year");
    nav.append(row, list);
    document.title = `Sillage · ${year}`;
  } else {
    const { year, month } = view;
    const prev = shiftMonth(year, month, -1);
    const next = shiftMonth(year, month, 1);
    const title = el("h1", "nav__title", monthTitle(year, month).replace(/^./, (c) => c.toUpperCase()));
    const back = el("small");
    const yearLink = el("a", undefined, `toute l'année ${year}`);
    yearLink.href = yearHref(year);
    back.append(yearLink);
    title.append(back);
    nav.append(
      arrow(`${monthTitle(prev.year, prev.month)}`, "←", prev.year >= years.first ? monthHref(prev.year, prev.month) : null),
      title,
      arrow(`${monthTitle(next.year, next.month)}`, "→", next.year <= years.last ? monthHref(next.year, next.month) : null),
    );
    document.title = `Sillage · ${monthTitle(year, month)}`;
  }

  const left = nav.querySelector<HTMLAnchorElement>(".nav__arrow:first-child");
  const right = nav.querySelector<HTMLAnchorElement>(".nav__arrow:last-child");
  window.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowLeft" && left?.href) window.location.href = left.href;
    if (e.key === "ArrowRight" && right?.href) window.location.href = right.href;
  });
}

// ——— Données et miniatures ———

/** Côté des images, arrondi pour que le cache serve d'une visite à l'autre. */
function thumbSize(cells: Map<string, Cell>, min: number, max: number): number {
  const first = cells.values().next().value as Cell | undefined;
  const css = first?.node.getBoundingClientRect().width || min / 2;
  const px = css * Math.min(3, window.devicePixelRatio || 1);
  return Math.min(max, Math.max(min, Math.ceil(px / 64) * 64));
}

function summaryText(view: View, withData: number, total: number): string {
  if (total === 0) return "";
  if (withData === 0) {
    return view.kind === "year" ? `Aucune journée enregistrée en ${view.year}.` : "Aucune journée enregistrée ce mois-ci.";
  }
  return `${nf.format(withData)} journée${withData > 1 ? "s" : ""} sur ${nf.format(total)}`;
}

function statusText(stats: ThumbStats, source: DataSource): string {
  const parts = [`source : ${source.kind}`];
  if (stats.requested > 0) {
    const secs = ((stats.totalMs ?? 0) / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    let s = `${stats.requested} œuvres en ${secs} s`;
    if (stats.fromCache > 0) s += ` (${stats.fromCache} en cache)`;
    parts.push(s);
  }
  if (stats.failed > 0) parts.push(`${stats.failed} en échec`);
  return parts.join(" · ");
}

declare global {
  interface Window {
    __gallery?: { stats: ThumbStats | null; dataMs: number; view: View; done: boolean };
  }
}

async function main(source: DataSource): Promise<void> {
  const t0 = performance.now();
  const params = new URLSearchParams(window.location.search);
  const today = localToday();
  const fallback = await source.defaultDate();
  const view = parseView(params, fallback);
  const years = { first: Math.min(firstYear(), view.year), last: Math.max(Number(today.slice(0, 4)), Number(fallback.slice(0, 4)), view.year) };

  $<HTMLAnchorElement>("brand").href = `${BASE}?date=${fallback}`;
  renderNav(view, years);

  const dates = view.kind === "year" ? datesOfYear(view.year) : datesOfMonth(view.year, view.month);
  const cells = view.kind === "year" ? renderYearSkeleton(view.year, today) : renderMonthSkeleton(view.year, view.month, today);
  window.__gallery = { stats: null, dataMs: 0, view, done: false };

  // Une requête : la période + les 90 jours avant son premier jour (normalisation).
  const from = addDays(dates[0]!, -REFERENCE_WINDOW_DAYS);
  const to = dates.at(-1)!;
  const history: DayInput[] = (await source.getRange(from, to)).map(toDayInput);
  window.__gallery.dataMs = performance.now() - t0;
  const byDate = new Map(history.map((d) => [d.date, d]));

  const toRender: string[] = [];
  const perMonth = new Map<string, number>();
  let past = 0;
  for (const date of dates) {
    const cell = cells.get(date)!;
    if (date > today) continue;
    past++;
    cell.node.classList.remove("cell--pending");
    if (hasData(byDate.get(date))) {
      cell.node.classList.add("cell--art");
      toRender.push(date);
      perMonth.set(date.slice(0, 7), (perMonth.get(date.slice(0, 7)) ?? 0) + 1);
    } else {
      cell.node.classList.add("cell--empty");
      cell.node.title = `${formatLongDate(date)} · sans données`;
      cell.node.setAttribute("aria-label", cell.node.title);
      const note = cell.node.parentElement?.querySelector(".mday__note");
      if (note) note.textContent = "sans données";
    }
  }

  // Compteurs par mois (vue année), résumé.
  document.querySelectorAll<HTMLElement>(".ym").forEach((section) => {
    const n = perMonth.get(section.dataset.month!) ?? 0;
    section.querySelector(".ym__count")!.textContent = n > 0 ? String(n) : "";
    section.classList.toggle("ym--empty", n === 0);
  });
  $("summary").textContent = summaryText(view, toRender.length, past);

  if (toRender.length === 0) {
    $("status").textContent = `source : ${source.kind}`;
    window.__gallery = { stats: null, dataMs: window.__gallery.dataMs, view, done: true };
    document.body.dataset.ready = "true";
    return;
  }

  const fingerprints = inputFingerprints(toRender, history);
  const size = view.kind === "year" ? thumbSize(cells, 64, 192) : thumbSize(cells, 192, 512);
  // Cache persistant seulement en build : en dev, le code du moteur change sans que l'URL change.
  const useCache = !import.meta.env.DEV || params.has("cache");
  const cache = useCache && !params.has("nocache") ? await openThumbCache() : null;
  // `?workers=N` : pour mesurer (voir les notes de la phase 6).
  const workers = Number(params.get("workers")) || undefined;
  const thumbs = new Thumbnailer(history, { cache, version: `${import.meta.url}|${size}`, workers });
  window.addEventListener("pagehide", () => {
    void cache?.flush(); // au mieux : ce qui est déjà dessiné servira à la prochaine visite
    thumbs.dispose();
  });

  const requests: ThumbRequest[] = toRender.map((date) => ({
    date,
    size,
    fingerprint: fingerprints.get(date)!,
    onReady(url) {
      const cell = cells.get(date)!.node;
      const img = new Image(size, size);
      img.alt = "";
      img.decoding = "async";
      img.onload = () => img.classList.add("is-ready");
      img.src = url;
      cell.replaceChildren(img);
    },
  }));
  $("status").textContent = `source : ${source.kind} · ${requests.length} œuvres à composer…`;
  const stats = await thumbs.render(requests);
  $("status").textContent = statusText(stats, source);
  window.__gallery = { stats, dataMs: window.__gallery.dataMs, view, done: true };
  document.body.dataset.ready = "true";
}

function showError(err: unknown): void {
  const p = el("p", "gallery__error", `Impossible de charger la galerie : ${err instanceof Error ? err.message : String(err)}`);
  $("body").replaceChildren(p);
  document.body.dataset.ready = "error";
}

try {
  main(dataSourceFromEnv()).catch(showError);
} catch (err) {
  showError(err);
}
