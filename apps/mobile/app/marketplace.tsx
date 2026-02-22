/**
 * Marketplace — DeFi protocol integrations available to the agent.
 *
 * Shows integrated and upcoming skills the agent can use.
 * Meteora DLMM is the active integration powering the current position.
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
import { useAgent } from "@/context/AgentContext";
import { colors, withAlpha } from "@/constants/theme";

interface Protocol {
  id: string;
  name: string;
  category: string;
  description: string;
  status: "active" | "coming_soon";
  url: string;
  chain: string;
  skill: string;
}

const PROTOCOLS: Protocol[] = [
  {
    id: "meteora-dlmm",
    name: "Meteora DLMM",
    category: "Concentrated Liquidity",
    description:
      "Dynamic Liquidity Market Maker with bin-based concentrated liquidity. Agent monitors active bin position, tracks fee accrual, and checkpoints status on-chain via MagicBlock.",
    status: "active",
    url: "https://meteora.ag",
    chain: "Solana",
    skill: "LP Monitor · MagicBlock ER",
  },
  {
    id: "orca-whirlpools",
    name: "Orca Whirlpools",
    category: "Concentrated Liquidity",
    description: "Solana's leading CLMM. Tick-based positions with auto-rebalance support.",
    status: "coming_soon",
    url: "https://orca.so",
    chain: "Solana",
    skill: "LP Monitor",
  },
  {
    id: "raydium-clmm",
    name: "Raydium CLMM",
    category: "Concentrated Liquidity",
    description: "Full-range and concentrated positions with deep order book integration.",
    status: "coming_soon",
    url: "https://raydium.io",
    chain: "Solana",
    skill: "LP Monitor",
  },
  {
    id: "jupiter-dca",
    name: "Jupiter DCA",
    category: "Dollar Cost Average",
    description: "Automated recurring swap orders. Agent can schedule and monitor DCA strategies.",
    status: "coming_soon",
    url: "https://jup.ag",
    chain: "Solana",
    skill: "DCA Strategy",
  },
];

export default function Marketplace() {
  const { agentConfig } = useAgent();

  const active = PROTOCOLS.filter((p) => p.status === "active");
  const upcoming = PROTOCOLS.filter((p) => p.status === "coming_soon");

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <ScrollView contentContainerStyle={styles.scroll}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Skills Marketplace</Text>
          <Text style={styles.headerSub}>
            DeFi protocols integrated into your agent
          </Text>
        </View>

        {/* ── Active integrations ── */}
        <Text style={styles.sectionLabel}>ACTIVE</Text>
        {active.map((p) => (
          <ProtocolCard key={p.id} protocol={p} agentConfig={agentConfig} />
        ))}

        {/* ── Coming soon ── */}
        <Text style={styles.sectionLabel}>COMING SOON</Text>
        {upcoming.map((p) => (
          <ProtocolCard key={p.id} protocol={p} agentConfig={agentConfig} />
        ))}

      </ScrollView>
    </SafeAreaView>
  );
}

function ProtocolCard({
  protocol,
  agentConfig,
}: {
  protocol: Protocol;
  agentConfig: any;
}) {
  const isActive = protocol.status === "active";
  const accentColor = isActive ? colors.green : colors.dim;

  return (
    <View style={[card.wrap, { borderColor: withAlpha(accentColor, isActive ? 0.4 : 0.15) }]}>
      {/* Top row */}
      <View style={card.topRow}>
        <View style={card.nameBlock}>
          <View style={[card.dot, { backgroundColor: accentColor }]} />
          <Text style={card.name}>{protocol.name}</Text>
          <View style={[card.badge, { backgroundColor: withAlpha(accentColor, 0.12), borderColor: withAlpha(accentColor, 0.3) }]}>
            <Text style={[card.badgeText, { color: accentColor }]}>
              {isActive ? "Active" : "Soon"}
            </Text>
          </View>
        </View>
        <Text style={card.chain}>{protocol.chain}</Text>
      </View>

      {/* Category */}
      <Text style={card.category}>{protocol.category}</Text>

      {/* Description */}
      <Text style={card.desc}>{protocol.description}</Text>

      {/* Skill chip */}
      <View style={card.skillRow}>
        <View style={card.skillChip}>
          <Text style={card.skillText}>⚡ {protocol.skill}</Text>
        </View>
      </View>

      {/* Position info if active */}
      {isActive && agentConfig && (
        <View style={card.infoBox}>
          <InfoRow label="LB Pair" value={shortKey(agentConfig.lbPair)} />
          <InfoRow label="Position" value={shortKey(agentConfig.positionPubkey)} />
          <InfoRow label="Interval" value={`${agentConfig.intervalMs / 1000}s`} />
        </View>
      )}

      {/* Action button */}
      <TouchableOpacity
        style={[card.btn, !isActive && card.btnDisabled]}
        onPress={() => {
          if (protocol.url.startsWith("https://")) {
            Linking.openURL(protocol.url);
          }
        }}
      >
        <Text style={[card.btnText, !isActive && card.btnTextDim]}>
          {isActive ? `Open ${protocol.name} ↗` : "Coming Soon"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={info.row}>
      <Text style={info.label}>{label}</Text>
      <Text style={info.value}>{value}</Text>
    </View>
  );
}

function shortKey(key: string): string {
  if (!key || key.length < 12) return key;
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 12 },
  header: { gap: 4, marginBottom: 4 },
  headerTitle: { color: colors.text, fontSize: 22, fontWeight: "800" },
  headerSub: { color: colors.muted, fontSize: 13 },
  sectionLabel: {
    color: colors.dim,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 8,
    marginBottom: 2,
  },
});

const card = StyleSheet.create({
  wrap: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  nameBlock: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  badge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 11, fontWeight: "600" },
  chain: { color: colors.dim, fontSize: 12 },
  category: { color: colors.muted, fontSize: 12, fontWeight: "500" },
  desc: { color: colors.text, fontSize: 13, lineHeight: 19 },
  skillRow: { flexDirection: "row" },
  skillChip: {
    backgroundColor: withAlpha(colors.green, 0.08),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: withAlpha(colors.green, 0.2),
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  skillText: { color: colors.green, fontSize: 12, fontWeight: "500" },
  infoBox: {
    backgroundColor: withAlpha(colors.border, 0.4),
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  btn: {
    backgroundColor: withAlpha(colors.green, 0.12),
    borderWidth: 1.5,
    borderColor: withAlpha(colors.green, 0.4),
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
  },
  btnDisabled: {
    backgroundColor: withAlpha(colors.border, 0.3),
    borderColor: withAlpha(colors.border, 0.5),
  },
  btnText: { color: colors.green, fontSize: 14, fontWeight: "600" },
  btnTextDim: { color: colors.dim },
});

const info = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between" },
  label: { color: colors.muted, fontSize: 12 },
  value: { color: colors.text, fontSize: 12, fontWeight: "500" },
});
