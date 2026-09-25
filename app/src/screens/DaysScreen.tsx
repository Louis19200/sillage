/**
 * Étape 3 : les 7 dernières journées complètes, lues dans Health Connect et calculées
 * sur le téléphone, sans aucun appel réseau. C'est ici qu'on vérifie que les chiffres
 * sont justes avant de les envoyer où que ce soit. L'envoi (étapes 4 et 5) est dans
 * SyncPanel, sous le tableau : la lecture ne dépend jamais de l'API.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { backgroundTaskDiagnostic } from "../backgroundTask";
import { Button } from "../components";
import { computeLastCompleteDays, type ComputedHealthDay } from "../days";
import { formatClock, formatDayLabel, formatSleepMinutes, formatSteps, MISSING } from "../format";
import { healthConnectReader, openHealthConnectSettings, runDiagnostic } from "../healthConnect";
import { useTheme, type Theme } from "../theme";
import { SyncPanel } from "./SyncPanel";

const DAY_COUNT = 7;

type State =
  | { kind: "loading" }
  | { kind: "ready"; days: ComputedHealthDay[]; computedAt: Date }
  | { kind: "error"; message: string };

function timeZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "inconnu";
  } catch {
    return "inconnu";
  }
}

export function DaysScreen(props: { onOpenSettings: () => void }): ReactNode {
  const t = useTheme();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const now = new Date();
      const days = await computeLastCompleteDays(healthConnectReader, DAY_COUNT, now);
      setState({ kind: "ready", days, computedAt: now });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={[styles.title, { color: t.text }]}>7 derniers jours</Text>
      <Text style={[styles.subtitle, { color: t.muted }]}>
        Lu sur ce téléphone, sans réseau. Fuseau : {timeZoneName()}. Aujourd'hui n'apparaît
        pas (journée incomplète). Le sommeil compte pour le jour du réveil.
      </Text>

      {state.kind === "loading" && <ActivityIndicator color={t.accent} style={styles.spinner} />}

      {state.kind === "error" && (
        <Text style={[styles.error, { color: t.danger }]}>Erreur de lecture : {state.message}</Text>
      )}

      {state.kind === "ready" && <DaysTable days={[...state.days].reverse()} t={t} />}

      {state.kind === "ready" && (
        <Text style={[styles.legend, { color: t.muted }]}>
          « {MISSING} » = aucune donnée (différent de 0). Calculé à{" "}
          {String(state.computedAt.getHours()).padStart(2, "0")}:
          {String(state.computedAt.getMinutes()).padStart(2, "0")}.{"\n"}
          Health Connect ne donne accès qu'aux 30 jours précédant l'autorisation : au-delà, il
          faudrait la permission d'historique.
        </Text>
      )}

      <Button label="Relire" onPress={() => void load()} disabled={state.kind === "loading"} />
      <Button
        label="Réglages Health Connect"
        variant="secondary"
        onPress={() => openHealthConnectSettings()}
      />

      <DiagnosticPanel t={t} />

      <SyncPanel onOpenSettings={props.onOpenSettings} />
    </ScrollView>
  );
}

/** Ce que Health Connect renvoie vraiment : pour comprendre un tableau vide. */
function DiagnosticPanel(props: { t: Theme }): ReactNode {
  const { t } = props;
  const [lines, setLines] = useState<string[] | null>(null);
  const [running, setRunning] = useState(false);
  const run = useCallback(async () => {
    setRunning(true);
    try {
      const hc = await runDiagnostic();
      let task: string[];
      try {
        task = await backgroundTaskDiagnostic();
      } catch (e) {
        task = [`Tâche de fond : ERREUR ${e instanceof Error ? e.message : String(e)}`];
      }
      setLines([...hc, ...task]);
    } finally {
      setRunning(false);
    }
  }, []);
  return (
    <View>
      <Button
        label={running ? "Diagnostic en cours…" : "Diagnostic Health Connect"}
        variant="secondary"
        onPress={() => void run()}
        disabled={running}
      />
      {lines && (
        <View style={[styles.table, { backgroundColor: t.surface, borderColor: t.border, padding: 12 }]}>
          {lines.map((line, i) => (
            <Text key={i} selectable style={{ color: t.text, marginBottom: 4 }}>
              {line}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const COLUMNS = [
  { key: "date", label: "Date", flex: 1.3 },
  { key: "steps", label: "Pas", flex: 1.1 },
  { key: "sleep", label: "Sommeil", flex: 1.1 },
  { key: "start", label: "Coucher", flex: 1 },
  { key: "end", label: "Réveil", flex: 1 },
] as const;

function DaysTable(props: { days: ComputedHealthDay[]; t: Theme }): ReactNode {
  const { days, t } = props;
  return (
    <View style={[styles.table, { backgroundColor: t.surface, borderColor: t.border }]}>
      <View style={[styles.row, { borderBottomColor: t.border }]}>
        {COLUMNS.map((c, j) => (
          <Text
            key={c.key}
            style={[styles.head, { flex: c.flex, color: t.muted }, j > 0 && styles.numeric]}
          >
            {c.label}
          </Text>
        ))}
      </View>
      {days.map((d, i) => {
        const cells = [
          formatDayLabel(d.date),
          formatSteps(d.steps),
          formatSleepMinutes(d.sleep_minutes),
          formatClock(d.sleep_start),
          formatClock(d.sleep_end),
        ];
        return (
          <View
            key={d.date}
            style={[
              styles.row,
              { borderBottomColor: t.border },
              i === days.length - 1 && styles.lastRow,
            ]}
          >
            {cells.map((text, j) => (
              <Text
                key={COLUMNS[j]?.key ?? j}
                style={[
                  styles.cell,
                  { flex: COLUMNS[j]?.flex ?? 1, color: text === MISSING ? t.muted : t.text },
                  j > 0 && styles.numeric,
                ]}
              >
                {text}
              </Text>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingTop: 24 },
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 16 },
  spinner: { marginVertical: 32 },
  error: { fontSize: 15, marginVertical: 16 },
  table: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lastRow: { borderBottomWidth: 0 },
  head: { fontSize: 12, fontWeight: "600", textTransform: "uppercase" },
  cell: { fontSize: 14 },
  numeric: { textAlign: "right", fontVariant: ["tabular-nums"] },
  legend: { fontSize: 13, lineHeight: 19, marginTop: 12 },
});
