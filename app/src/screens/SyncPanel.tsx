/**
 * Étapes 4 à 6 : envoi des 7 derniers jours complets, backfill de 30 jours, et état de la
 * synchro automatique (tâche de fond + repli à l'ouverture de l'app).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, AppState, Linking, StyleSheet, Text, View } from "react-native";

import {
  backgroundReadFeature,
  isBackgroundRestricted,
  isIgnoringBatteryOptimizations,
  type BackgroundReadFeature,
} from "../../modules/sillage-device";
import {
  BACKGROUND_INTERVAL_MINUTES,
  DAILY_SYNC_HOUR,
  describeAutoSync,
  shouldSyncOnOpen,
  type BackgroundAccess,
} from "../background";
import { ensureBackgroundTaskRegistered, type BackgroundTaskInfo } from "../backgroundTask";
import { Button } from "../components";
import { formatDayLabel, formatLocalDateTime } from "../format";
import { getBackgroundAccess, requestBackgroundAccess } from "../healthConnect";
import { hasSettings, loadSyncState, syncNow } from "../settings";
import {
  AUTO_DAYS,
  BACKFILL_DAYS,
  EMPTY_SYNC_STATE,
  SYNC_DAYS,
  daysFor,
  type BackgroundRun,
  type SyncKind,
  type SyncRecord,
  type SyncState,
} from "../sync";
import { useTheme, type Theme } from "../theme";

interface AutoInfo {
  task: BackgroundTaskInfo;
  access: BackgroundAccess;
  feature: BackgroundReadFeature;
  configured: boolean;
  ignoringBattery: boolean | null;
  restricted: boolean | null;
}

async function loadAutoInfo(): Promise<AutoInfo> {
  const [task, access, configured] = await Promise.all([
    ensureBackgroundTaskRegistered(),
    getBackgroundAccess(),
    hasSettings(),
  ]);
  return {
    task,
    access,
    feature: backgroundReadFeature(),
    configured,
    ignoringBattery: isIgnoringBatteryOptimizations(),
    restricted: isBackgroundRestricted(),
  };
}

const KIND_LABEL: Record<SyncKind, string> = {
  sync: "synchro",
  backfill: "backfill",
  background: "arrière-plan",
  open: "auto à l'ouverture",
};

export function SyncPanel(props: { onOpenSettings: () => void }): ReactNode {
  const t = useTheme();
  const [running, setRunning] = useState<SyncKind | null>(null);
  const [state, setState] = useState<SyncState>(EMPTY_SYNC_STATE);
  const [auto, setAuto] = useState<AutoInfo | null>(null);
  const busy = useRef(false);

  const run = useCallback(async (kind: SyncKind) => {
    if (busy.current) return;
    busy.current = true;
    setRunning(kind);
    try {
      await syncNow(kind);
    } finally {
      // Relire l'état complet (il contient aussi le dernier réveil de la tâche de fond).
      setState(await loadSyncState());
      busy.current = false;
      setRunning(null);
    }
  }, []);

  /** Relit l'état, et lance la synchro de repli si hier n'a pas encore été envoyé. */
  const refresh = useCallback(async () => {
    const [s, info] = await Promise.all([loadSyncState(), loadAutoInfo()]);
    setState(s);
    setAuto(info);
    if (shouldSyncOnOpen(s, new Date(), info.configured)) await run("open");
  }, [run]);

  useEffect(() => {
    void refresh();
    // Retour dans l'app (après les réglages Android ou Health Connect, ou le lendemain).
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const askBackground = useCallback(async () => {
    try {
      await requestBackgroundAccess();
    } catch {
      // La fenêtre n'a pas pu s'ouvrir : l'état relu ci-dessous le montrera.
    }
    setAuto(await loadAutoInfo());
  }, []);

  const { lastAttempt, lastSuccess, lastBackground } = state;

  return (
    <View style={[styles.panel, { backgroundColor: t.surface, borderColor: t.border }]}>
      <Text style={[styles.title, { color: t.text }]}>Synchronisation</Text>

      {running ? (
        <View style={styles.runningRow}>
          <ActivityIndicator color={t.accent} />
          <Text style={[styles.text, { color: t.muted }]}>
            {running === "open" ? "Synchro automatique : " : ""}Envoi de {daysFor(running)} jours…
          </Text>
        </View>
      ) : lastAttempt ? (
        <RecordView title="Dernière tentative" record={lastAttempt} t={t} />
      ) : (
        <Text style={[styles.text, { color: t.muted }]}>Aucune synchro depuis l'installation.</Text>
      )}

      {!running && lastAttempt && !lastAttempt.ok && lastSuccess && (
        <Text style={[styles.text, { color: t.muted }]}>
          Dernière réussite : {formatLocalDateTime(lastSuccess.at)} ({KIND_LABEL[lastSuccess.kind] ?? lastSuccess.kind},{" "}
          {rangeLabel(lastSuccess)}).
        </Text>
      )}

      <Button
        label={`Synchroniser (${SYNC_DAYS} jours)`}
        onPress={() => void run("sync")}
        disabled={running !== null}
      />
      <Button
        label={`Backfill ${BACKFILL_DAYS} jours`}
        variant="secondary"
        onPress={() => void run("backfill")}
        disabled={running !== null}
      />
      <Text style={[styles.note, { color: t.muted }]}>
        Le backfill envoie les {BACKFILL_DAYS} dernières journées complètes en un seul appel. À faire
        tôt : Health Connect ne donne accès qu'aux 30 jours précédant l'autorisation, aller plus
        loin ne renverrait que des « — » sans la permission d'historique. Renvoyer une journée la
        met à jour, sans doublon. Seules les valeurs présentes sont envoyées : une lecture vide
        n'efface jamais rien.
      </Text>
      <Button label="Réglages (URL, token)" variant="secondary" onPress={props.onOpenSettings} />

      <AutoSection auto={auto} lastBackground={lastBackground} onAskBackground={() => void askBackground()} t={t} />
    </View>
  );
}

function AutoSection(props: {
  auto: AutoInfo | null;
  lastBackground: BackgroundRun | null;
  onAskBackground: () => void;
  t: Theme;
}): ReactNode {
  const { auto, lastBackground: b, t } = props;
  if (!auto) {
    return (
      <View style={styles.section}>
        <Text style={[styles.subtitle, { color: t.text }]}>Synchro automatique</Text>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }
  const status = describeAutoSync({
    configured: auto.configured,
    taskRegistered: auto.task.registered,
    access: auto.access,
    featureUnavailable: auto.feature === "unavailable",
    restricted: auto.restricted === true,
  });
  const canAsk = auto.access !== "granted" && auto.feature !== "unavailable" && auto.feature !== "sdk-unavailable";

  return (
    <View style={styles.section}>
      <Text style={[styles.subtitle, { color: t.text }]}>Synchro automatique</Text>
      <Text style={[styles.result, { color: status.mode === "background" ? t.accent : t.danger }]}>
        {status.title}
      </Text>
      <Text style={[styles.text, { color: t.muted }]}>{status.detail}</Text>
      {auto.task.error && (
        <Text style={[styles.detail, { color: t.danger }]}>Tâche de fond : {auto.task.error}</Text>
      )}

      <Text style={[styles.text, { color: t.text, marginTop: 8 }]}>
        Lecture Health Connect en arrière-plan :{" "}
        {auto.access === "granted"
          ? "autorisée"
          : auto.feature === "unavailable"
            ? "indisponible dans cette version de Health Connect (mets-la à jour depuis le Play Store)"
            : auto.access === "denied"
              ? "non autorisée"
              : "état inconnu"}
        .
      </Text>
      {canAsk && (
        <Button label="Autoriser la lecture en arrière-plan" variant="secondary" onPress={props.onAskBackground} />
      )}

      <Text style={[styles.text, { color: t.text, marginTop: 8 }]}>
        Dernier passage en arrière-plan :{" "}
        {b ? `${formatLocalDateTime(b.at)}, ${OUTCOME_LABEL[b.outcome]}` : "jamais"}
      </Text>
      {b ? (
        <Text style={[styles.detail, { color: b.outcome === "failed" ? t.danger : t.muted }]}>{b.message}</Text>
      ) : (
        <Text style={[styles.detail, { color: t.muted }]}>
          Premier passage au plus tôt {BACKGROUND_HOURS} h après l'installation, quand Sillage n'est pas à l'écran.
        </Text>
      )}

      {(auto.restricted === true || auto.ignoringBattery === false) && (
        <>
          <Text style={[styles.text, { color: auto.restricted ? t.danger : t.muted, marginTop: 8 }]}>
            {auto.restricted
              ? "Batterie « Restreinte » pour Sillage : Android n'exécute pas la tâche de fond."
              : "Sillage est soumise à l'optimisation de batterie : sur Samsung, la tâche peut être retardée ou tuée."}{" "}
            Réglages → Applications → Sillage → Batterie → « Non restreinte ».
          </Text>
          <Button label="Ouvrir les réglages de Sillage" variant="secondary" onPress={() => void Linking.openSettings()} />
        </>
      )}
      <Text style={[styles.note, { color: t.muted }]}>
        La synchro automatique envoie les {AUTO_DAYS} dernières journées complètes, une fois par jour
        après {DAILY_HOUR_LABEL}. Si elle n'a pas pu passer, Sillage l'envoie à l'ouverture de l'app.
      </Text>
    </View>
  );
}

const BACKGROUND_HOURS = BACKGROUND_INTERVAL_MINUTES / 60;
const DAILY_HOUR_LABEL = `${DAILY_SYNC_HOUR} h`;

const OUTCOME_LABEL:Record<BackgroundRun["outcome"], string> = {
  sent: "envoi réussi",
  failed: "échec",
  skipped: "rien à envoyer",
};

function rangeLabel(r: SyncRecord): string {
  if (!r.from || !r.to) return `${r.days} jours`;
  return `${r.days} jours, du ${formatDayLabel(r.from)} au ${formatDayLabel(r.to)}`;
}

function RecordView(props: { title: string; record: SyncRecord; t: Theme }): ReactNode {
  const { record: r, t } = props;
  return (
    <View>
      <Text style={[styles.text, { color: t.text }]}>
        {props.title} : {formatLocalDateTime(r.at)} ({KIND_LABEL[r.kind] ?? r.kind}, {rangeLabel(r)})
      </Text>
      <Text style={[styles.result, { color: r.ok ? t.accent : t.danger }]}>
        {r.ok ? "Réussie : " : "Échec : "}
        {r.message}
      </Text>
      {r.details.map((d, i) => (
        <Text key={i} style={[styles.detail, { color: t.danger }]}>
          • {d}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 14, marginTop: 20 },
  title: { fontSize: 18, fontWeight: "700", marginBottom: 8 },
  subtitle: { fontSize: 16, fontWeight: "700", marginBottom: 4 },
  section: { marginTop: 20 },
  runningRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  text: { fontSize: 14, lineHeight: 20 },
  result: { fontSize: 15, fontWeight: "600", marginTop: 4 },
  detail: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  note: { fontSize: 13, lineHeight: 19, marginTop: 10 },
});
