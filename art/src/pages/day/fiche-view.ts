/**
 * Fiche « Comment cette œuvre a été choisie » en HTML, à partir du modèle pur `FicheModel`.
 * Repliable (<details>), lisible sans connaître le code : phrases, petits tableaux, barres.
 */
import type { ExplainLine, FicheModel } from "../../engine-v2";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function step(n: number, title: string, ...children: (Node | string)[]): HTMLElement {
  const s = el("section", "fiche__step");
  const h = el("h3", "fiche__h");
  h.append(el("span", "fiche__n", String(n)), title);
  s.append(h, ...children);
  return s;
}

function rows(items: { label: string; value: string; note?: string | undefined }[]): HTMLElement {
  const dl = el("dl", "fiche__rows");
  for (const r of items) {
    const dt = el("dt", undefined, r.label);
    const dd = el("dd");
    dd.append(el("span", r.value === "non mesuré" ? "fiche__missing" : "fiche__val", r.value));
    if (r.note) dd.append(el("span", "fiche__note", r.note));
    dl.append(dt, dd);
  }
  return dl;
}

function explainTable(lines: readonly ExplainLine[]): HTMLElement {
  const t = el("table", "fiche__table");
  const head = el("tr");
  head.append(el("th", undefined, "Paramètre"), el("th", undefined, "Piloté par"), el("th", undefined, "Valeur"));
  t.append(el("thead"), el("tbody"));
  t.tHead!.append(head);
  for (const l of lines) {
    const tr = el("tr");
    tr.append(el("td", undefined, l.param), el("td", undefined, l.source), el("td", "fiche__val", l.value));
    t.tBodies[0]!.append(tr);
  }
  return t;
}

function p(text: string, className = "fiche__p"): HTMLElement {
  return el("p", className, text);
}

function code(text: string): HTMLElement {
  return el("p", "fiche__formula", text);
}

export function renderFiche(container: HTMLElement, f: FicheModel, options: { open?: boolean } = {}): void {
  container.replaceChildren();
  const details = el("details", "fiche");
  details.open = options.open ?? false;
  const summary = el("summary", "fiche__summary");
  summary.append(el("span", "fiche__title", "Comment cette œuvre a été choisie"), el("span", "fiche__hint", `${f.styleName} · ${f.status.split(":")[0]}`));
  details.append(summary);

  const body = el("div", "fiche__body");
  let n = 1;
  body.append(step(n++, "Les données du jour", rows(f.raw)));

  if (!f.hasDetail) {
    body.append(p("Ce style a été figé sans que le détail du calcul soit conservé : seul le résultat est connu."));
  }
  if (f.key) {
    const kids: (Node | string)[] = [code(f.key.formula), code(f.key.substituted), code(f.key.uFormula), p(`u = ${f.key.u}. Ce nombre entre 0 et 1 sert de « dé » : même journée, même u.`)];
    if (f.key.note) kids.push(p(f.key.note, "fiche__p fiche__p--muted"));
    body.append(step(n++, "Le nombre clé", ...kids));
  }
  if (f.band) {
    const table = el("table", "fiche__table fiche__table--weights");
    const tr1 = el("tr");
    const tr2 = el("tr");
    for (const r of f.band.table) {
      const th = el("th", r.highlight ? "is-chosen" : undefined, r.name);
      const td = el("td", r.highlight ? "is-chosen" : undefined, r.weight);
      tr1.append(th);
      tr2.append(td);
    }
    table.append(tr1, tr2);
    const scroll = el("div", "fiche__scroll");
    scroll.append(table);
    body.append(step(n++, "La tranche de pas", p(`${f.band.centile} → journée « ${f.band.label} ». Poids de base de cette tranche :`), scroll));
  }
  if (f.key) {
    const kids: (Node | string)[] = [];
    if (f.adjustments.length === 0) kids.push(p("Aucun ajustement : ni nuit très courte ou très longue, ni commits extrêmes."));
    else {
      const ul = el("ul", "fiche__list");
      for (const a of f.adjustments) {
        const li = el("li");
        li.append(el("strong", undefined, a.label), ` — ${a.reason} : ${a.effects}`);
        ul.append(li);
      }
      kids.push(ul);
    }
    if (f.missingAdjustments.length) kids.push(p(f.missingAdjustments.join(" · "), "fiche__p fiche__p--muted"));
    body.append(step(n++, "Les ajustements", ...kids));

    const ex = f.exclusions.length === 0 ? p("Aucune exclusion (début de l'historique).") : (() => {
      const ul = el("ul", "fiche__list");
      for (const x of f.exclusions) {
        const li = el("li");
        li.append(el("strong", undefined, x.name), ` — ${x.reason}`);
        ul.append(li);
      }
      return ul;
    })();
    body.append(step(n++, "Les styles exclus", p("Pour varier : ni le style d'hier ou d'avant-hier, ni la même famille qu'hier."), ex));

    const bars = el("div", "fiche__bars");
    bars.setAttribute("role", "table");
    for (const c of f.chances) {
      const row = el("div", "bar" + (c.excluded ? " bar--out" : "") + (c.chosen ? " bar--chosen" : ""));
      row.setAttribute("role", "row");
      const name = el("span", "bar__name", c.name);
      name.setAttribute("role", "cell");
      const track = el("span", "bar__track");
      const fill = el("span", "bar__fill");
      fill.style.width = `${(c.chance * 100).toFixed(2)}%`;
      track.append(fill);
      track.setAttribute("role", "cell");
      const val = el("span", "bar__val", c.excluded ? `exclu · ${c.reason ?? ""}` : `${c.chanceText} · poids ${c.weight}`);
      val.setAttribute("role", "cell");
      row.append(name, track, val);
      bars.append(row);
    }
    body.append(step(n++, "Les chances finales", bars));
  }
  if (f.draw) body.append(step(n++, "Le tirage", code(f.draw.formula), p(f.draw.result, "fiche__p fiche__result")));
  body.append(p(f.status, "fiche__p fiche__status"));

  const tech = [explainTable(f.technique)];
  if (!f.ported) tech.unshift(p("Cette technique n'est pas encore portée : l'image est un rendu provisoire à ses couleurs.", "fiche__p fiche__p--muted"));
  body.append(step(n++, `Ce que les données ont réglé dans « ${f.styleName} »`, p(`${f.styleName} : ${f.process} (famille ${f.familyName}).`), ...tech));
  if (f.palette) body.append(step(n++, "La palette du jour", explainTable(f.palette)));

  details.append(body);
  container.append(details);
}
