/**
 * Vérifie une API déployée, depuis n'importe quel système (Windows compris).
 *
 *   node api/scripts/check-prod.mjs
 *   node api/scripts/check-prod.mjs https://sillage-api.vercel.app
 *
 * Aucune dépendance : il suffit de Node 22 ou plus (pas besoin de pnpm install).
 *
 * Variables lues dans l'environnement, `api/.env` ou `.env` à la racine :
 *   API_URL        URL de l'API (ou premier argument)
 *   INGEST_TOKEN   obligatoire
 *   READ_TOKEN     facultatif
 *   CRON_SECRET    facultatif
 *   ART_URL        facultatif : adresse de la page d'art, pour vérifier le CORS
 *
 * N'écrit rien en base : l'écriture est testée avec un corps volontairement
 * invalide (réponse 400 attendue), ce qui prouve que le token est accepté
 * sans toucher à tes vraies journées.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Même ordre que loadDotenvFiles() de src/env.ts : api/.env puis .env à la racine,
// sans écraser les variables déjà définies.
const here = dirname(fileURLToPath(import.meta.url));
for (const p of [resolve(here, "../.env"), resolve(here, "../../.env")]) {
  if (existsSync(p)) process.loadEnvFile(p);
}

const rawUrl = process.argv[2] ?? process.env.API_URL ?? "";
const ingestToken = process.env.INGEST_TOKEN ?? "";
const readToken = process.env.READ_TOKEN ?? "";
const cronSecret = process.env.CRON_SECRET ?? "";
const artUrl = process.env.ART_URL ?? "";

const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(rawUrl);
if (!/^https:\/\//.test(rawUrl) && !isLocal) {
  console.error(
    "API_URL manquante ou pas en https://. Ajoute dans .env une ligne\n" +
      "  API_URL=https://<ton-projet>.vercel.app\n" +
      "ou passe l'URL en argument : node api/scripts/check-prod.mjs https://<ton-projet>.vercel.app",
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
function report(ok, label, hint) {
  console.log(`${ok ? "ok  " : "ÉCHEC"} ${label}`);
  if (!ok) {
    failures++;
    if (hint) console.log(`      → ${hint}`);
  }
}

/** @typedef {{ status: number, body: string, type: string, location: string | null, allowOrigin: string | null }} Result */

/** @returns {Promise<Result>} */
async function call(path, init = {}, base = api) {
  try {
    const res = await fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(20_000), ...init });
    return {
      status: res.status,
      body: await res.text(),
      type: res.headers.get("content-type") ?? "",
      location: res.headers.get("location"),
      allowOrigin: res.headers.get("access-control-allow-origin"),
    };
  } catch (err) {
    return { status: 0, body: String(err instanceof Error ? (err.cause ?? err.message) : err), type: "", location: null, allowOrigin: null };
  }
}
const bearer = (t) => ({ authorization: `Bearer ${t}` });

/** Explication lisible des réponses qui ne viennent pas de l'API elle-même. */
/** @param {Result} r */
function diagnose(r) {
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
if (readIngest.status === 200) days = JSON.parse(readIngest.body).days.length;
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

// 7. CORS : la page d'art (navigateur) a-t-elle le droit de lire l'API ?
if (artUrl) {
  let origin = "";
  try {
    origin = new URL(artUrl).origin;
  } catch {
    report(false, "ART_URL valide", `« ${artUrl} » n'est pas une adresse complète (ex. https://sillage-art.vercel.app).`);
  }
  if (origin) {
    const pre = await call(rangePath, {
      method: "OPTIONS",
      headers: { origin, "access-control-request-method": "GET", "access-control-request-headers": "authorization" },
    });
    const allowed = pre.status < 400 && pre.allowOrigin === origin;
    report(
      allowed,
      `CORS : la page ${origin} peut lire l'API`,
      pre.status === 0
        ? diagnose(pre)
        : `l'API n'autorise pas cette origine (reçu : ${pre.allowOrigin ?? "aucun en-tête Access-Control-Allow-Origin"}). ` +
            `Sur Vercel, projet API → Settings → Environment Variables : CORS_ORIGINS=${origin} ` +
            "(exactement, sans / final ; plusieurs origines séparées par des virgules), puis Redeploy de l'API.",
    );
    if (allowed) {
      const get = await call(rangePath, { headers: { origin, ...(readToken ? bearer(readToken) : bearer(ingestToken)) } });
      report(get.status === 200 && get.allowOrigin === origin, "CORS : lecture réelle depuis la page acceptée", diagnose(get));
    }
  }
} else {
  console.log("—    ART_URL absent de .env : CORS non vérifié (mets l'adresse de la page d'art pour le tester)");
}

console.log(failures === 0 ? "\nTout est bon." : `\n${failures} vérification(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
