/**
 * Position — visual LP position dashboard.
 *
 * Shows a range meter (active bin vs position range), fee cards,
 * agent summary, and a compact tick history — all from live WS data.
 */

import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Linking,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAgent, useReloadOnFocus } from "@/context/AgentContext";
import { colors, withAlpha } from "@/constants/theme";
import { timeAgo, shortKey, formatTime } from "@/utils/time";

export default function Position() {
  const { connected, lastTick, history, agentConfig, sendAction } = useAgent();
  const router = useRouter();
  useReloadOnFocus();

  const tick = lastTick;
  const inRange = tick?.isInRange;
  const statusColor = !tick
    ? colors.dim
    : inRange
    ? colors.green
    : colors.red;

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
      >

        {/* ── Status Hero ── */}
        <View style={[styles.hero, { borderColor: withAlpha(statusColor, 0.4) }]}>
          <View style={[styles.heroGlow, { backgroundColor: withAlpha(statusColor, 0.06) }]} />
          <Text style={[styles.heroStatus, { color: statusColor }]}>
            {!connected
              ? "CONNECTING"
              : !tick
              ? "WAITING"
              : inRange
              ? "IN RANGE"
              : "OUT OF RANGE"}
          </Text>
          {tick && (
            <Text style={styles.heroSub}>
              Active bin {tick.activeBin ?? "—"} · Tick #{tick.tickNumber}
            </Text>
          )}
          {tick && (
            <Text style={styles.heroAge}>{timeAgo(tick.timestamp)}</Text>
          )}
        </View>

        {/* ── Actions ── */}
        <TouchableOpacity
          style={[
            styles.actionBtn,
            !connected && styles.actionBtnDisabled,
          ]}
          disabled={!connected}
          onPress={() => {
            sendAction("add_liquidity");
            router.navigate("/");
          }}
        >
          <Text style={styles.actionBtnText}>+ Add Liquidity</Text>
          <Text style={styles.actionBtnSub}>via MagicBlock ER · watch in Chat</Text>
        </TouchableOpacity>

        {/* ── Range Meter ── */}
        {tick?.activeBin != null &&
          tick.positionMinBin != null &&
          tick.positionMaxBin != null && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Position Range</Text>
              <RangeMeter
                activeBin={tick.activeBin}
                minBin={tick.positionMinBin}
                maxBin={tick.positionMaxBin}
                inRange={tick.isInRange ?? false}
              />
              <View style={styles.rangeLabels}>
                <View style={styles.rangeLabelItem}>
                  <Text style={styles.rangeLabelVal}>{tick.positionMinBin}</Text>
                  <Text style={styles.rangeLabelKey}>Min Bin</Text>
                </View>
                <View style={[styles.rangeLabelItem, styles.rangeLabelCenter]}>
                  <Text style={[styles.rangeLabelVal, { color: statusColor }]}>
                    {tick.activeBin}
                  </Text>
                  <Text style={styles.rangeLabelKey}>Active</Text>
                </View>
                <View style={[styles.rangeLabelItem, styles.rangeLabelRight]}>
                  <Text style={styles.rangeLabelVal}>{tick.positionMaxBin}</Text>
                  <Text style={styles.rangeLabelKey}>Max Bin</Text>
                </View>
              </View>
            </View>
          )}

        {/* ── Fees ── */}
        <View style={styles.feeRow}>
          <FeeCard label="Token X" value={tick?.feeX ?? "—"} />
          <FeeCard label="Token Y" value={tick?.feeY ?? "—"} />
        </View>

        {/* ── Last Checkpoint ── */}
        {tick?.txSignature && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Last Checkpoint</Text>
            <TouchableOpacity
              onPress={() => {
                const url = tick.explorerUrl;
                if (url?.startsWith("https://explorer.solana.com/tx/")) {
                  Linking.openURL(url);
                }
              }}
            >
              <Text style={styles.txLink}>
                {shortKey(tick.txSignature)} ↗
              </Text>
            </TouchableOpacity>
            <Text style={styles.dimText}>{formatTime(tick.timestamp)}</Text>
          </View>
        )}

        {/* ── Agent Summary ── */}
        {tick?.summary ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Agent Summary</Text>
            <Text style={styles.summaryText}>{tick.summary}</Text>
          </View>
        ) : null}

        {/* ── Error ── */}
        {tick?.error ? (
          <View style={[styles.card, styles.errorCard]}>
            <Text style={[styles.cardTitle, { color: colors.red }]}>Error</Text>
            <Text style={styles.errorText}>{tick.error}</Text>
          </View>
        ) : null}

        {/* ── Session Info ── */}
        {agentConfig && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Session</Text>
            <MetaRow label="Position" value={shortKey(agentConfig.positionPubkey)} />
            <MetaRow label="LB Pair" value={shortKey(agentConfig.lbPair)} />
            <MetaRow
              label="Interval"
              value={`${agentConfig.intervalMs / 1000}s`}
            />
          </View>
        )}

        {/* ── Tick History ── */}
        {history.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Recent Ticks</Text>
            {history.slice(0, 8).map((t) => (
              <View key={t.timestamp} style={styles.historyRow}>
                <View
                  style={[
                    styles.historyDot,
                    {
                      backgroundColor:
                        t.isInRange == null
                          ? colors.dim
                          : t.isInRange
                          ? colors.green
                          : colors.red,
                    },
                  ]}
                />
                <Text style={styles.historyTick}>#{t.tickNumber}</Text>
                <Text style={styles.historyBin}>
                  bin {t.activeBin ?? "—"}
                </Text>
                <Text style={styles.historyAge}>{timeAgo(t.timestamp)}</Text>
              </View>
            ))}
          </View>
        )}

        {!tick && connected && (
          <Text style={styles.waiting}>Waiting for first tick…</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function RangeMeter({
  activeBin,
  minBin,
  maxBin,
  inRange,
}: {
  activeBin: number;
  minBin: number;
  maxBin: number;
  inRange: boolean;
}) {
  const span = maxBin - minBin;
  const pad = Math.max(Math.ceil(span * 0.25), 5);
  const viewMin = minBin - pad;
  const viewMax = maxBin + pad;
  const viewSpan = viewMax - viewMin;

  const barLeftPct = ((minBin - viewMin) / viewSpan) * 100;
  const barRightPct = ((viewMax - maxBin) / viewSpan) * 100;
  const dotPct = Math.max(0, Math.min(100, ((activeBin - viewMin) / viewSpan) * 100));

  const barColor = inRange ? colors.green : colors.dim;
  const dotColor = inRange ? colors.green : colors.red;

  return (
    <View style={meter.wrap}>
      {/* Track */}
      <View style={meter.track}>
        {/* Range fill */}
        <View
          style={[
            meter.bar,
            {
              left: `${barLeftPct}%` as any,
              right: `${barRightPct}%` as any,
              backgroundColor: withAlpha(barColor, 0.25),
              borderColor: withAlpha(barColor, 0.6),
            },
          ]}
        />
        {/* Active bin marker */}
        <View
          style={[
            meter.dot,
            {
              left: `${dotPct}%` as any,
              backgroundColor: dotColor,
              shadowColor: dotColor,
            },
          ]}
        />
      </View>
    </View>
  );
}

function FeeCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.feeCard}>
      <Text style={styles.feeValue}>{value}</Text>
      <Text style={styles.feeLabel}>{label}</Text>
    </View>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 12 },

  // Hero
  hero: {
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 28,
    alignItems: "center",
    gap: 6,
    overflow: "hidden",
    position: "relative",
  },
  heroGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  heroStatus: {
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: 2,
  },
  heroSub: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
  },
  heroAge: {
    color: colors.dim,
    fontSize: 12,
  },

  // Cards
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  errorCard: {
    borderColor: withAlpha(colors.red, 0.4),
  },
  errorText: { color: colors.red, fontSize: 13, lineHeight: 18 },

  // Range labels
  rangeLabels: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 4,
  },
  rangeLabelItem: { flex: 1, gap: 2 },
  rangeLabelCenter: { alignItems: "center" },
  rangeLabelRight: { alignItems: "flex-end" },
  rangeLabelVal: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  rangeLabelKey: { color: colors.dim, fontSize: 11 },

  // Fees
  feeRow: { flexDirection: "row", gap: 12 },
  feeCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    gap: 6,
  },
  feeValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  feeLabel: { color: colors.muted, fontSize: 12 },

  // Checkpoint
  txLink: { color: "#4da6ff", fontSize: 14, fontWeight: "500" },
  dimText: { color: colors.dim, fontSize: 12 },

  // Summary
  summaryText: { color: colors.text, fontSize: 14, lineHeight: 20 },

  // Session meta
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  metaLabel: { color: colors.muted, fontSize: 13 },
  metaValue: { color: colors.text, fontSize: 13, fontWeight: "500" },

  // History
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 3,
  },
  historyDot: { width: 8, height: 8, borderRadius: 4 },
  historyTick: { color: colors.dim, fontSize: 12, width: 38 },
  historyBin: { color: colors.muted, fontSize: 12, flex: 1 },
  historyAge: { color: colors.dim, fontSize: 12 },

  waiting: {
    color: colors.dim,
    fontSize: 13,
    textAlign: "center",
    marginTop: 24,
  },

  // Action button
  actionBtn: {
    backgroundColor: withAlpha(colors.green, 0.12),
    borderWidth: 1.5,
    borderColor: withAlpha(colors.green, 0.5),
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    gap: 4,
  },
  actionBtnDisabled: {
    opacity: 0.4,
  },
  actionBtnText: {
    color: colors.green,
    fontSize: 16,
    fontWeight: "700",
  },
  actionBtnSub: {
    color: colors.muted,
    fontSize: 12,
  },
});

const meter = StyleSheet.create({
  wrap: { paddingVertical: 8 },
  track: {
    height: 28,
    backgroundColor: withAlpha(colors.border, 0.5),
    borderRadius: 14,
    position: "relative",
    overflow: "visible",
  },
  bar: {
    position: "absolute",
    top: 4,
    bottom: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  dot: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    top: 7,
    marginLeft: -7,
    borderWidth: 2,
    borderColor: colors.bg,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4,
  },
});
