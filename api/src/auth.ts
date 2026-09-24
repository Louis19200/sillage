/**
 * Authentification par `Authorization: Bearer <token>`.
 *  - écriture : INGEST_TOKEN seul ;
 *  - lecture protégée (PROTECT_READS) : READ_TOKEN ou INGEST_TOKEN ;
 *  - routes /cron : CRON_SECRET.
 * Les valeurs sont hachées avant `timingSafeEqual` : longueur fixe, donc aucune
 * fuite de la longueur du token par le temps de réponse.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { AUTH_HEADER } from "@sillage/shared";

const digest = (s: string): Buffer => createHash("sha256").update(s, "utf8").digest();

export function tokenMatches(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}

/**
 * Vrai si `presented` correspond à l'un des `accepted`. Tous les candidats sont
 * comparés (pas de sortie anticipée) : le temps ne dit pas lequel a correspondu.
 */
export function tokenMatchesAny(presented: string | null, accepted: readonly string[]): boolean {
  let ok = false;
  for (const expected of accepted) ok = tokenMatches(presented ?? "", expected) || ok;
  return ok && presented !== null;
}

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1] ? m[1].trim() : null;
}

export type BearerAuthOptions = {
  /** Nom du ou des tokens attendus, repris dans le message d'erreur. Défaut : "INGEST_TOKEN". */
  label?: string;
  /** Longueur minimale de chaque token attendu. Défaut : 32. */
  minLength?: number;
};

/**
 * Middleware `Authorization: Bearer`. `expected` : un token, ou plusieurs
 * acceptés indifféremment (ex. `[INGEST_TOKEN, READ_TOKEN]` pour la lecture).
 */
export function bearerAuth(expected: string | readonly string[], options: BearerAuthOptions = {}): MiddlewareHandler {
  const accepted = typeof expected === "string" ? [expected] : [...expected];
  const label = options.label ?? "INGEST_TOKEN";
  const min = options.minLength ?? 32;
  if (accepted.length === 0) throw new Error("bearerAuth : aucun token attendu");
  for (const t of accepted) {
    if (t.length < min) throw new Error(`token attendu trop court (${min} caractères minimum)`);
  }
  return async (c, next) => {
    // On compare même sans en-tête pour garder un temps de réponse homogène.
    if (!tokenMatchesAny(extractBearer(c.req.header(AUTH_HEADER)), accepted)) {
      c.header("WWW-Authenticate", 'Bearer realm="sillage"');
      return c.json({ error: "unauthorized", message: `en-tête Authorization: Bearer <${label}> manquant ou invalide` }, 401);
    }
    await next();
  };
}
