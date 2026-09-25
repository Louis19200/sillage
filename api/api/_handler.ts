/**
 * Point d'entrée de la fonction Vercel (runtime Node.js, pas Edge : le driver
 * `postgres` a besoin des sockets TCP de Node).
 *
 * `_build.mjs` le regroupe avec ses dépendances en un seul fichier ESM
 * (`.vercel/output/functions/index.func/index.mjs`). L'export par défaut est un
 * gestionnaire Node `(req, res)`, la forme la plus ancienne et la plus stable
 * que le runtime Node de Vercel accepte. C'est exactement ce que fait
 * `handle()` de `@hono/node-server/vercel`, appliqué à notre `fetch`.
 */
import { getRequestListener } from "@hono/node-server";
import { createVercelFetch } from "./_app";

export default getRequestListener(createVercelFetch());
