/**
 * Vérifie une API déployée, depuis n'importe quel système (Windows compris).
 *
 *   pnpm --filter api check:prod
 *   pnpm --filter api check:prod https://sillage-api.vercel.app
 *
 * Variables lues dans l'environnement, `api/.env` ou `.env` à la racine :
 *   API_URL        URL de l'API (ou premier argument)
 *   INGEST_TOKEN   obligatoire
 *   READ_TOKEN     facultatif
 *   CRON_SECRET    facultatif
 *
 * N'écrit rien en base : l'écriture est testée avec un corps volontairement
 * invalide (réponse 400 attendue), ce qui prouve que le token est accepté
 * sans toucher à tes vraies journées.
 */
import { loadDotenvFiles } from "../src/env";

loadDotenvFiles();

const rawUrl = process.argv[2] ?? process.env.API_URL ?? "";
const ingestToken = process.env.INGEST_TOKEN ?? "";
const readToken = process.env.READ_TOKEN ?? "";
const cronSecret = process.env.CRON_SECRET ?? "";

const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(rawUrl);
if (!/^https:\/\//.test(rawUrl) && !isLocal) {
  console.error(
    "API_URL manquante ou pas en https://. Ajoute dans .env une ligne\n" +
      "  API_URL=https://<ton-projet>.vercel.app\n" +
      "ou passe l'URL en argument : pnpm --filter api check:prod https://<ton-projet>.vercel.app",
  );
  process.exit(2);
}
if (!ingestToken) {
  console.error("INGEST_TOKEN manquant dans .env (la même valeur que sur Vercel).");
  process.exit(2);
}

const api = rawUrl.replace(/\/+$/, "");
const today = new Date();
const from = new Date(today.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
const to = today.toISOString().slice(0, 10);
const rangePath = `/range?from=${from}&to=${to}`;

let failures = 0;
function report(ok: boolean, label: string, hint?: string): void {
  console.log(`${ok ? "ok  " : "ÉCHEC"} ${label}`);
  if (!ok) {
    failures++;
    if (hint) console.log(`      → ${hint}`);
  }
}

type Result = { status: number; body: string; type: string; location: string | null };
async function call(path: string, init: RequestInit = {}, base = api): Promise<Result> {
  try {
    const res = await fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(20_000), ...init });
    return {
      status: res.status,
      body: await res.text(),
      type: res.headers.get("content-type") ?? "",
      location: res.headers.get("location"),
    };
  } catch (err) {
    return { status: 0, body: String(err instanceof Error ? (err.cause ?? err.message) : err), type: "", location: null };
  }
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

/** Explication lisible des réponses qui ne viennent pas de l'API elle-même. */
function diagnose(r: Result): string {
  if (r.status === 0) return `API injoignable (${r.body}). Vérifie l'URL et ta connexion.`;
  if (r.type.includes("text/html") && r.status === 401)
    return "page de connexion Vercel : la « Deployment Protection » bloque l'accès. Utilise l'URL de production (Settings → Domains), ou désactive « Vercel Authentication » dans Settings → Deployment Protection.";
  if (r.status === 404 && !r.type.includes("json"))
    return "404 de Vercel, pas de l'API : l'URL ne correspond à aucun déploiement, ou le dossier racine du projet n'est pas « api ».";
  if (r.status === 500 && r.body.includes("misconfigured"))
    return "l'API démarre mais refuse sa configuration : une variable manque ou est invalide sur Vercel (voir Logs du déploiement). Après avoir changé une variable, il faut redéployer.";
  if (r.status >= 500) return `erreur serveur ${r.status} : ouvre les Logs du projet sur Vercel. Réponse : ${r.body.slice(0, 200)}`;
  return `statut ${r.status}, réponse : ${r.body.slice(0, 200)}`;
}

console.log(`Vérification de ${api}\n`);

// 1. HTTP → HTTPS (sans objet en local)
if (isLocal) {
  console.log("—    API locale : redirection HTTPS non vérifiée");
} else {
  const http = await call(rangePath, {}, api.replace(/^https:/, "http:"));
  report(
    [301, 302, 307, 308].includes(http.status) && (http.location ?? "").startsWith("https://"),
    "HTTP redirigé vers HTTPS",
    http.status === 0 ? diagnose(http) : `statut ${http.status}`,
  );
}

// 2. Lecture sans token
const anon = await call(rangePath);
report(
  anon.status === 401 && anon.type.includes("json"),
  "lecture sans token refusée (401)",
  anon.status === 200
    ? "la lecture est publique : ajoute PROTECT_READS=true dans les variables Vercel puis redéploie."
    : diagnose(anon),
);

// 3. Lecture avec INGEST_TOKEN
const readIngest = await call(rangePath, { headers: bearer(ingestToken) });
let days = -1;
if (readIngest.status === 200) days = (JSON.parse(readIngest.body) as { days: unknown[] }).days.length;
report(
  readIngest.status === 200,
  `lecture avec INGEST_TOKEN (${days >= 0 ? `${days} jour(s) sur les 30 derniers` : "—"})`,
  readIngest.status === 401 ? "INGEST_TOKEN refusé : la valeur de .env diffère de celle sur Vercel (ou Vercel n'a pas été redéployé)." : diagnose(readIngest),
);

// 4. Écriture : token accepté, corps invalide → 400, rien n'est écrit
const write = await call("/ingest/health", {
  method: "POST",
  headers: { ...bearer(ingestToken), "content-type": "application/json" },
  body: JSON.stringify({ days: [] }),
});
report(
  write.status === 400,
  "écriture : INGEST_TOKEN accepté (corps volontairement invalide → 400, rien d'écrit)",
  write.status === 401 ? "INGEST_TOKEN refusé en écriture : vérifie la valeur sur Vercel." : diagnose(write),
);

// 5. READ_TOKEN
if (readToken) {
  const r = await call(rangePath, { headers: bearer(readToken) });
  report(r.status === 200, "lecture avec READ_TOKEN", r.status === 401 ? "READ_TOKEN refusé : absent sur Vercel ou valeur différente." : diagnose(r));
  const w = await call("/ingest/health", {
    method: "POST",
    headers: { ...bearer(readToken), "content-type": "application/json" },
    body: JSON.stringify({ days: [] }),
  });
  report(w.status === 401, "écriture avec READ_TOKEN refusée (401)", `statut ${w.status} : le token de lecture ne doit pas pouvoir écrire.`);
} else {
  console.log("—    READ_TOKEN absent de .env : vérification ignorée");
}

// 6. Cron : secret accepté, sans lancer de tâche (nom inexistant → 404)
if (cronSecret) {
  const c = await call("/cron/verification-inexistante", { headers: bearer(cronSecret) });
  report(
    c.status === 404,
    "CRON_SECRET accepté (tâche inexistante → 404, rien n'est lancé)",
    c.status === 401
      ? "CRON_SECRET refusé : valeur différente sur Vercel."
      : c.status === 503
        ? "CRON_SECRET n'est pas défini sur Vercel : le cron nocturne ne pourra pas tourner."
        : diagnose(c),
  );
} else {
  console.log("—    CRON_SECRET absent de .env : vérification ignorée");
}

console.log(failures === 0 ? "\nTout est bon." : `\n${failures} vérification(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
