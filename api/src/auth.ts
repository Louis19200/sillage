/**
 * Authentification par `Authorization: Bearer <INGEST_TOKEN>`.
 * Les deux valeurs sont hachées avant `timingSafeEqual` : longueur fixe,
 * donc aucune fuite de la longueur du token par le temps de réponse.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { AUTH_HEADER } from "@sillage/shared";

const digest = (s: string): Buffer => createHash("sha256").update(s, "utf8").digest();

export function tokenMatches(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1] ? m[1].trim() : null;
}

export function bearerAuth(expectedToken: string): MiddlewareHandler {
  if (expectedToken.length < 32) throw new Error("INGEST_TOKEN trop court (32 caractères minimum)");
  return async (c, next) => {
    const presented = extractBearer(c.req.header(AUTH_HEADER));
    // On compare même sans en-tête pour garder un temps de réponse homogène.
    const ok = tokenMatches(presented ?? "", expectedToken) && presented !== null;
    if (!ok) {
      c.header("WWW-Authenticate", 'Bearer realm="sillage"');
      return c.json({ error: "unauthorized", message: "en-tête Authorization: Bearer <INGEST_TOKEN> manquant ou invalide" }, 401);
    }
    await next();
  };
}
