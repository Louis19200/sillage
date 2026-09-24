/**
 * Étapes 4 et 5 : envoi des 7 derniers jours complets, ou backfill de 30 jours en un seul
 * appel, puis affichage du résultat et de la dernière synchro mémorisée.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { Button } from "../components";
import { formatDayLabel, formatLocalDateTime } from "../format";
import { loadSyncState, syncNow } from "../settings";
import { BACKFILL_DAYS, SYNC_DAYS, type SyncKind, type SyncRecord, type SyncState } from "../sync";
import { useTheme, type Theme } from "../theme";

export function SyncPanel(props: { onOpenSettings: () => void }): ReactNode {
  const t = useTheme();
  const [running, setRunning] = useState<SyncKind | null>(null);
  const [state, setState] = useState<SyncState>({ lastAttempt: null, lastSuccess: null });

  useEffect(() => {
    void loadSyncState().then(setState);
  }, []);

  const run = useCallback(async (kind: SyncKind) => {
    setRunning(kind);
    try {
      const record = await syncNow(kind);
      setState((prev) => ({
        lastAttempt: record,
        lastSuccess: record.ok ? record : prev.lastSuccess,
      }));
    } finally {
      setRunning(null);
    }
  }, []);

  const { lastAttempt, lastSuccess } = state;

  return (
    <View style={[styles.panel, { backgroundColor: t.surface, borderColor: t.border }]}>
      <Text style={[styles.title, { color: t.text }]}>Synchronisation</Text>

      {running ? (
        <View style={styles.runningRow}>
          <ActivityIndicator color={t.accent} />
          <Text style={[styles.text, { color: t.muted }]}>
            {running === "backfill" ? `Envoi de ${BACKFILL_DAYS} jours…` : `Envoi de ${SYNC_DAYS} jours…`}
          </Text>
        </View>
      ) : lastAttempt ? (
        <RecordView title="Dernière tentative" record={lastAttempt} t={t} />
      ) : (
        <Text style={[styles.text, { color: t.muted }]}>Aucune synchro depuis l'installation.</Text>
      )}

      {!running && lastAttempt && !lastAttempt.ok && lastSuccess && (
        <Text style={[styles.text, { color: t.muted }]}>
          Dernière réussite : {formatLocalDateTime(lastSuccess.at)} ({rangeLabel(lastSuccess)}).
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
        met à jour, sans doublon.
      </Text>
      <Button label="Réglages (URL, token)" variant="secondary" onPress={props.onOpenSettings} />
    </View>
  );
}

function rangeLabel(r: SyncRecord): string {
  if (!r.from || !r.to) return `${r.days} jours`;
  return `${r.days} jours, du ${formatDayLabel(r.from)} au ${formatDayLabel(r.to)}`;
}

function RecordView(props: { title: string; record: SyncRecord; t: Theme }): ReactNode {
  const { record: r, t } = props;
  return (
    <View>
      <Text style={[styles.text, { color: t.text }]}>
        {props.title} : {formatLocalDateTime(r.at)} ({r.kind === "backfill" ? "backfill" : "synchro"},{" "}
        {rangeLabel(r)})
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
  runningRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  text: { fontSize: 14, lineHeight: 20 },
  result: { fontSize: 15, fontWeight: "600", marginTop: 4 },
  detail: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  note: { fontSize: 13, lineHeight: 19, marginTop: 10 },
});
