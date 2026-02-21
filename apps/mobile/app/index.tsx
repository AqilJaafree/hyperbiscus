/**
 * Dashboard — live LP position monitor.
 *
 * Connects to the agent WebSocket on port 18789 and displays:
 *   • IN RANGE / OUT OF RANGE status badge
 *   • Active bin vs position range
 *   • Unclaimed fees (X + Y)
 *   • Last checkpoint TX with explorer link
 *   • Tick history
 */

import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Linking,
  StyleSheet,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAgentWebSocket } from "@/hooks/useAgentWebSocket";
import { useAgentUrl } from "@/hooks/useAgentUrl";

function shortKey(key: string) {
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function timeAgo(isoString: string) {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export default function Dashboard() {
  const router = useRouter();
  const { url } = useAgentUrl();
  const { connected, agentConfig, lastTick, history } = useAgentWebSocket(url);

  const isInRange = lastTick?.isInRange;
  const statusColor = !connected
    ? colors.dim
    : isInRange === null
    ? colors.dim
    : isInRange
    ? colors.green
    : colors.red;

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      {/* Header row */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.dot, { backgroundColor: connected ? colors.green : colors.red }]} />
          <Text style={styles.headerStatus}>
            {connected ? "connected" : "disconnected"}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 16 }}>
          <TouchableOpacity onPress={() => router.push("/chat")}>
            <Text style={styles.settingsLink}>💬</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push("/settings")}>
            <Text style={styles.settingsLink}>⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={false} tintColor={colors.dim} />}
      >
        {/* Status badge */}
        <View style={[styles.badge, { borderColor: statusColor }]}>
          <Text style={[styles.badgeText, { color: statusColor }]}>
            {!connected
              ? "CONNECTING…"
              : isInRange === null
              ? "WAITING"
              : isInRange
              ? "IN RANGE"
              : "⚠ OUT OF RANGE"}
          </Text>
        </View>

        {/* Bin info */}
        <View style={styles.card}>
          <Row
            label="Active bin"
            value={lastTick?.activeBin?.toString() ?? "—"}
          />
          <Row
            label="Position range"
            value={
              lastTick
                ? `[${lastTick.positionMinBin}, ${lastTick.positionMaxBin}]`
                : "—"
            }
          />
        </View>

        {/* Fees */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Unclaimed Fees</Text>
          <Row label="Token X" value={lastTick?.feeX ?? "—"} />
          <Row label="Token Y" value={lastTick?.feeY ?? "—"} />
        </View>

        {/* Last checkpoint */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Last Checkpoint</Text>
          {lastTick?.txSignature ? (
            <>
              <TouchableOpacity
                onPress={() =>
                  lastTick.explorerUrl && Linking.openURL(lastTick.explorerUrl)
                }
              >
                <Text style={styles.txLink}>
                  {shortKey(lastTick.txSignature)} ↗
                </Text>
              </TouchableOpacity>
              <Text style={styles.dim}>{timeAgo(lastTick.timestamp)}</Text>
            </>
          ) : (
            <Text style={styles.dim}>—</Text>
          )}
        </View>

        {/* Session info */}
        {agentConfig && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Session</Text>
            <Row label="Session PDA" value={shortKey(agentConfig.sessionPda)} />
            <Row label="Monitor PDA" value={shortKey(agentConfig.monitorPda)} />
            <Row
              label="Interval"
              value={`${agentConfig.intervalMs / 1000}s`}
            />
          </View>
        )}

        {/* Claude summary */}
        {lastTick?.summary ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Agent Summary</Text>
            <Text style={styles.summary}>{lastTick.summary}</Text>
          </View>
        ) : null}

        {/* Error */}
        {lastTick?.error ? (
          <View style={[styles.card, { borderColor: colors.red }]}>
            <Text style={[styles.cardTitle, { color: colors.red }]}>Error</Text>
            <Text style={styles.errorText}>{lastTick.error}</Text>
          </View>
        ) : null}

        {/* History */}
        {history.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Tick History ({history.length})
            </Text>
            {history.slice(0, 10).map((tick) => (
              <View key={tick.tickNumber} style={styles.historyRow}>
                <Text style={styles.historyTick}>#{tick.tickNumber}</Text>
                <Text
                  style={[
                    styles.historyStatus,
                    {
                      color:
                        tick.isInRange === null
                          ? colors.dim
                          : tick.isInRange
                          ? colors.green
                          : colors.red,
                    },
                  ]}
                >
                  {tick.isInRange === null
                    ? "—"
                    : tick.isInRange
                    ? "✓"
                    : "⚠"}
                </Text>
                <Text style={styles.historyBin}>
                  bin {tick.activeBin ?? "—"}
                </Text>
                <Text style={styles.dim}>{timeAgo(tick.timestamp)}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.footer}>
          {lastTick ? `Tick #${lastTick.tickNumber} · ${timeAgo(lastTick.timestamp)}` : "Waiting for first tick…"}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const colors = {
  bg: "#0a0a0a",
  card: "#141414",
  border: "#2a2a2a",
  green: "#00d97e",
  red: "#ff4d4f",
  dim: "#555",
  text: "#e0e0e0",
  muted: "#888",
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  headerStatus: { color: colors.muted, fontSize: 13 },
  settingsLink: { color: colors.muted, fontSize: 20 },
  scroll: { padding: 16, gap: 12 },
  badge: {
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: 20,
    alignItems: "center",
    marginBottom: 4,
  },
  badgeText: { fontSize: 28, fontWeight: "800", letterSpacing: 2 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { color: colors.muted, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowLabel: { color: colors.muted, fontSize: 14 },
  rowValue: { color: colors.text, fontSize: 14, fontWeight: "500" },
  txLink: { color: "#4da6ff", fontSize: 14, fontWeight: "500" },
  dim: { color: colors.dim, fontSize: 12 },
  summary: { color: colors.text, fontSize: 14, lineHeight: 20 },
  errorText: { color: colors.red, fontSize: 13 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 2 },
  historyTick: { color: colors.dim, fontSize: 12, width: 36 },
  historyStatus: { fontSize: 14, width: 16 },
  historyBin: { color: colors.muted, fontSize: 12, flex: 1 },
  footer: { color: colors.dim, fontSize: 12, textAlign: "center", marginTop: 8 },
});
