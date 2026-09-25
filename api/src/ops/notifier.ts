/**
 * Canal d'alerte. Implémentation principale : ntfy (https://ntfy.sh), gratuit,
 * notification poussée sur le téléphone par l'app ntfy. Voir docs/DEPLOY.md, « Surveillance ».
 *
 * Variables :
 *   NTFY_TOPIC   nom du topic (long et impossible à deviner : quiconque le connaît lit les alertes)
 *   NTFY_SERVER  facultatif, défaut https://ntfy.sh (serveur ntfy auto-hébergé)
 *   NTFY_TOKEN   facultatif, token d'accès ntfy (topic réservé / serveur protégé)
 *   ALERT_EMAIL  facultatif : ntfy transfère aussi l'alerte à cette adresse (fonction e-mail de ntfy.sh)
 *
 * Sans NTFY_TOPIC : les alertes ne partent que dans les journaux (LogNotifier),
 * avec un avertissement au démarrage.
 */
import { logEvent, sanitize, type EventLogger } from "./log";

export type Alert = {
  title: string;
  message: string;
  /** `high` : alerte ; `default` : information (rétablissement). */
  priority: "high" | "default";
  /** Émoticônes ntfy (noms courts, ex. `warning`, `white_check_mark`). */
  tags: string[];
};

export interface Notifier {
  /** Nom du canal, pour les journaux (`ntfy`, `log`…). */
  readonly name: string;
  /** Lève une erreur si l'alerte n'a pas pu être remise. */
  send(alert: Alert): Promise<void>;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type NtfyOptions = {
  topic: string;
  server?: string;
  token?: string;
  email?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
};

export const DEFAULT_NTFY_SERVER = "https://ntfy.sh";

/** Publication JSON (POST sur la racine du serveur) : pas de souci d'accents dans les en-têtes HTTP. */
export class NtfyNotifier implements Notifier {
  readonly name = "ntfy";
  private readonly server: string;

  constructor(private readonly opts: NtfyOptions) {
    this.server = (opts.server ?? DEFAULT_NTFY_SERVER).replace(/\/+$/, "");
  }

  async send(alert: Alert): Promise<void> {
    const body = {
      topic: this.opts.topic,
      title: alert.title,
      message: alert.message,
      priority: alert.priority === "high" ? 4 : 3,
      tags: alert.tags,
      ...(this.opts.email ? { email: this.opts.email } : {}),
    };
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.opts.token) headers.authorization = `Bearer ${this.opts.token}`;
    const doFetch = this.opts.fetch ?? ((url, init) => fetch(url, init));

    let res: Response;
    try {
      res = await doFetch(this.server, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
      });
    } catch (err) {
      throw new Error(`ntfy injoignable : ${sanitize(err instanceof Error ? err.message : String(err))}`);
    }
    if (!res.ok) {
      // Début de la réponse seulement (ntfy renvoie un JSON d'erreur court).
      const detail = sanitize((await res.text().catch(() => "")).slice(0, 200));
      throw new Error(`ntfy a refusé l'alerte : HTTP ${res.status}${detail ? ` ${detail}` : ""}`);
    }
  }
}

/** Repli sans configuration : l'alerte n'est visible que dans les journaux (Logs Vercel). */
export class LogNotifier implements Notifier {
  readonly name = "log";
  constructor(private readonly log: EventLogger = logEvent) {}
  async send(alert: Alert): Promise<void> {
    this.log(alert.priority === "high" ? "error" : "info", "alert", { title: alert.title, message: alert.message, channel: "log" });
  }
}

const trimmed = (v: string | undefined): string | undefined => (v === undefined || v.trim() === "" ? undefined : v.trim());

/** `true` si un vrai canal (ntfy) est configuré. */
export function hasNotifierConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  return trimmed(env.NTFY_TOPIC) !== undefined;
}

export function notifierFromEnv(env: NodeJS.ProcessEnv = process.env, log: EventLogger = logEvent): Notifier {
  const topic = trimmed(env.NTFY_TOPIC);
  if (!topic) return new LogNotifier(log);
  const server = trimmed(env.NTFY_SERVER);
  const token = trimmed(env.NTFY_TOKEN);
  const email = trimmed(env.ALERT_EMAIL);
  return new NtfyNotifier({
    topic,
    ...(server ? { server } : {}),
    ...(token ? { token } : {}),
    ...(email ? { email } : {}),
  });
}

let warned = false;

/** Avertit une fois par processus (instance serverless) si aucune alerte ne peut partir ailleurs que dans les logs. */
export function warnIfNoNotifier(env: NodeJS.ProcessEnv = process.env, log: EventLogger = logEvent): void {
  if (warned || hasNotifierConfig(env)) return;
  warned = true;
  log("warn", "notifier_missing", {
    message: "NTFY_TOPIC n'est pas défini : les alertes de fraîcheur n'iront que dans les journaux. Voir docs/DEPLOY.md, section Surveillance.",
  });
}
