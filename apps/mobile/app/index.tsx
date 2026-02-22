/**
 * Chat — main tab, talk to the DeFi agent.
 *
 * Renders three message types in a single thread:
 *   "user"   — messages the user sends
 *   "agent"  — Claude's replies
 *   "action" — live transaction flow cards (e.g. add_liquidity)
 */

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRef, useState, useEffect } from "react";
import { useAgent, useReloadOnFocus } from "@/context/AgentContext";
import { ChatMessage, ActionStep, PositionSnapshot } from "@/hooks/useAgentWebSocket";
import { colors, withAlpha } from "@/constants/theme";
import { UI } from "@/constants/config";
import { formatTime } from "@/utils/time";

export default function Chat() {
  const { connected, chatMessages, chatPending, streamingText, actionFlows, sendChat } =
    useAgent();
  useReloadOnFocus();

  const [draft, setDraft] = useState("");
  const listRef = useRef<FlatList>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (chatMessages.length > 0 || chatPending || streamingText) {
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
      scrollTimer.current = setTimeout(
        () => listRef.current?.scrollToEnd({ animated: true }),
        UI.SCROLL_DELAY_MS,
      );
    }
    return () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    };
  }, [chatMessages.length, chatPending, streamingText, actionFlows]);

  function submit() {
    const msg = draft.trim();
    if (!msg || chatPending || !connected) return;
    setDraft("");
    sendChat(msg);
  }

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === "ios" ? UI.KEYBOARD_OFFSET_IOS : 0}
      >
        {!connected && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Disconnected — reconnecting…</Text>
          </View>
        )}

        {chatMessages.length === 0 && !chatPending && !streamingText ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Chat with your agent</Text>
            <Text style={styles.emptyHint}>Try asking:</Text>
            {SUGGESTIONS.map((s) => (
              <TouchableOpacity
                key={s}
                style={styles.suggestion}
                onPress={() => sendChat(s)}
                disabled={!connected}
              >
                <Text style={styles.suggestionText}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <FlatList
            ref={listRef}
            style={styles.flex}
            data={chatMessages}
            keyExtractor={(item, i) => `${item.role}-${item.timestamp}-${i}`}
            contentContainerStyle={styles.thread}
            extraData={actionFlows}
            renderItem={({ item }) => {
              if (item.role === "action" && item.actionId) {
                const steps = Object.values(
                  actionFlows[item.actionId] ?? {},
                ).sort((a, b) => a.step - b.step);
                return (
                  <ActionFlowCard
                    action={item.message}
                    steps={steps}
                    timestamp={item.timestamp}
                  />
                );
              }
              if (item.role === "position" && item.position) {
                return <PositionCard data={item.position} timestamp={item.timestamp} />;
              }
              return <ChatBubble item={item} />;
            }}
          />
        )}

        {/* Spinner while thinking (tool calls), then live streaming text */}
        {streamingText ? (
          <View style={[styles.bubble, styles.bubbleAgent, styles.streamingBubble]}>
            <Text style={[styles.bubbleText, styles.bubbleTextAgent]}>{stripMarkdown(streamingText)}</Text>
          </View>
        ) : chatPending ? (
          <View style={styles.thinking}>
            <ActivityIndicator size="small" color={colors.green} />
            <Text style={styles.thinkingText}>Agent is thinking…</Text>
          </View>
        ) : null}

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask the agent…"
            placeholderTextColor={colors.dim}
            multiline
            returnKeyType="send"
            onSubmitEditing={submit}
            editable={connected}
          />
          <TouchableOpacity
            style={[
              styles.sendBtn,
              (!draft.trim() || chatPending || !connected) &&
                styles.sendBtnDisabled,
            ]}
            onPress={submit}
            disabled={!draft.trim() || chatPending || !connected}
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

/** Strip common markdown so raw asterisks never show in chat bubbles. */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")   // **bold**
    .replace(/\*(.*?)\*/g, "$1")        // *italic*
    .replace(/^#{1,6}\s+/gm, "")        // # headings
    .replace(/`([^`]+)`/g, "$1")        // `code`
    .trim();
}

function ChatBubble({ item }: { item: ChatMessage }) {
  const isUser = item.role === "user";
  const text = isUser ? item.message : stripMarkdown(item.message);
  return (
    <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAgent]}>
      <Text
        style={[
          styles.bubbleText,
          isUser ? styles.bubbleTextUser : styles.bubbleTextAgent,
        ]}
      >
        {text}
      </Text>
      <Text style={styles.bubbleTime}>{formatTime(item.timestamp)}</Text>
    </View>
  );
}

function PositionCard({ data, timestamp }: { data: PositionSnapshot; timestamp: string }) {
  const color = data.isInRange ? colors.green : colors.red;
  return (
    <View style={[pos.card, { borderColor: withAlpha(color, 0.35) }]}>
      <View style={pos.header}>
        <View style={[pos.dot, { backgroundColor: color }]} />
        <Text style={[pos.status, { color }]}>
          {data.isInRange ? "IN RANGE" : "OUT OF RANGE"}
        </Text>
        <Text style={pos.time}>{formatTime(timestamp)}</Text>
      </View>
      <View style={pos.row}>
        <View style={pos.cell}>
          <Text style={pos.val}>{data.activeBin}</Text>
          <Text style={pos.key}>Active Bin</Text>
        </View>
        <View style={pos.cell}>
          <Text style={pos.val}>{data.positionMinBin}</Text>
          <Text style={pos.key}>Min</Text>
        </View>
        <View style={pos.cell}>
          <Text style={pos.val}>{data.positionMaxBin}</Text>
          <Text style={pos.key}>Max</Text>
        </View>
      </View>
      <View style={pos.row}>
        <View style={pos.cell}>
          <Text style={pos.val}>{data.feeX}</Text>
          <Text style={pos.key}>Fee X</Text>
        </View>
        <View style={pos.cell}>
          <Text style={pos.val}>{data.feeY}</Text>
          <Text style={pos.key}>Fee Y</Text>
        </View>
      </View>
    </View>
  );
}

function ActionFlowCard({
  action,
  steps,
  timestamp,
}: {
  action: string;
  steps: ActionStep[];
  timestamp: string;
}) {
  const total = steps[0]?.total ?? 4;
  const done = steps.every((s) => s.status !== "pending");
  const hasError = steps.some((s) => s.status === "error");

  const headerColor = hasError
    ? colors.red
    : done
    ? colors.green
    : colors.muted;

  return (
    <View style={flow.card}>
      {/* Header */}
      <View style={flow.header}>
        <View style={[flow.headerDot, { backgroundColor: headerColor }]} />
        <Text style={flow.headerTitle}>
          {ACTION_LABELS[action] ?? action}
        </Text>
        <Text style={flow.headerTime}>{formatTime(timestamp)}</Text>
      </View>

      {/* Steps */}
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
        const step = steps.find((s) => s.step === n);
        return (
          <StepRow
            key={n}
            number={n}
            total={total}
            step={step}
          />
        );
      })}
    </View>
  );
}

function StepRow({
  number,
  total,
  step,
}: {
  number: number;
  total: number;
  step?: ActionStep;
}) {
  const status = step?.status ?? "waiting";
  const isLast = number === total;

  return (
    <View style={flow.stepRow}>
      {/* Connector line + icon */}
      <View style={flow.stepLeft}>
        <StepIcon status={status} />
        {!isLast && <View style={flow.connector} />}
      </View>

      {/* Content */}
      <View style={flow.stepContent}>
        <Text style={[flow.stepLabel, status === "error" && { color: colors.red }]}>
          {step?.label ?? `Step ${number}`}
        </Text>
        {step?.detail && (
          <Text style={flow.stepDetail}>{step.detail}</Text>
        )}
        {step?.txSignature && (
          <TouchableOpacity
            onPress={() => step.txUrl && Linking.openURL(step.txUrl)}
            disabled={!step.txUrl}
          >
            <Text style={[flow.stepTx, !step.txUrl && { opacity: 0.4 }]}>
              {step.txSignature.slice(0, 6)}…{step.txSignature.slice(-6)}{step.txUrl ? " ↗" : ""}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function StepIcon({ status }: { status: ActionStep["status"] | "waiting" }) {
  if (status === "pending") {
    return (
      <View style={[icon.circle, { borderColor: colors.green }]}>
        <ActivityIndicator size="small" color={colors.green} style={icon.spinner} />
      </View>
    );
  }
  if (status === "success") {
    return (
      <View style={[icon.circle, { backgroundColor: withAlpha(colors.green, 0.15), borderColor: colors.green }]}>
        <Text style={[icon.glyph, { color: colors.green }]}>✓</Text>
      </View>
    );
  }
  if (status === "error") {
    return (
      <View style={[icon.circle, { backgroundColor: withAlpha(colors.red, 0.15), borderColor: colors.red }]}>
        <Text style={[icon.glyph, { color: colors.red }]}>✕</Text>
      </View>
    );
  }
  // waiting
  return (
    <View style={[icon.circle, { borderColor: colors.border }]}>
      <View style={icon.waitDot} />
    </View>
  );
}

// ── Constants ───────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "What's the current position status?",
  "Are my fees worth harvesting?",
  "How long has the position been in range?",
  "Check the position and give me a fresh reading",
];

const ACTION_LABELS: Record<string, string> = {
  add_liquidity: "Add Liquidity · MagicBlock ER Flow",
};

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  banner: {
    backgroundColor: withAlpha(colors.red, 0.13),
    borderBottomWidth: 1,
    borderColor: withAlpha(colors.red, 0.27),
    padding: 10,
    alignItems: "center",
  },
  bannerText: { color: colors.red, fontSize: 13 },
  empty: { flex: 1, padding: 24, gap: 12, justifyContent: "center" },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: "700", marginBottom: 4 },
  emptyHint: { color: colors.muted, fontSize: 14 },
  suggestion: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  suggestionText: { color: colors.muted, fontSize: 14 },
  thread: { padding: 16, gap: 10, flexGrow: 1, justifyContent: "flex-end" },
  bubble: { maxWidth: "80%", borderRadius: 14, padding: 12, gap: 4, marginBottom: 6 },
  bubbleUser: {
    backgroundColor: withAlpha(colors.user, 0.13),
    borderWidth: 1,
    borderColor: withAlpha(colors.user, 0.33),
    alignSelf: "flex-end",
  },
  bubbleAgent: {
    backgroundColor: colors.agent,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: "flex-start",
  },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextUser: { color: colors.green },
  bubbleTextAgent: { color: colors.text },
  bubbleTime: { color: colors.dim, fontSize: 11, alignSelf: "flex-end" },
  thinking: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    alignSelf: "flex-start",
  },
  thinkingText: { color: colors.muted, fontSize: 13 },
  streamingBubble: {
    marginHorizontal: 16,
    marginBottom: 4,
    maxWidth: "80%",
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.3 },
  sendBtnText: { color: "#000", fontSize: 20, fontWeight: "800", lineHeight: 22 },
});

const pos = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
    alignSelf: "stretch",
    backgroundColor: colors.card,
    marginBottom: 6,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { flex: 1, fontSize: 13, fontWeight: "700", letterSpacing: 0.5 },
  time: { color: colors.dim, fontSize: 11 },
  row: { flexDirection: "row", gap: 8 },
  cell: { flex: 1, alignItems: "center", gap: 2 },
  val: { color: colors.text, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] as any },
  key: { color: colors.dim, fontSize: 11 },
});

const flow = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: withAlpha(colors.green, 0.3),
    padding: 14,
    gap: 0,
    alignSelf: "stretch",
    marginBottom: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  headerDot: { width: 8, height: 8, borderRadius: 4 },
  headerTitle: { color: colors.text, fontSize: 13, fontWeight: "600", flex: 1 },
  headerTime: { color: colors.dim, fontSize: 11 },
  stepRow: {
    flexDirection: "row",
    gap: 12,
    minHeight: 40,
  },
  stepLeft: {
    alignItems: "center",
    width: 24,
  },
  connector: {
    flex: 1,
    width: 1.5,
    backgroundColor: colors.border,
    marginVertical: 3,
  },
  stepContent: {
    flex: 1,
    paddingBottom: 12,
    gap: 3,
  },
  stepLabel: { color: colors.text, fontSize: 13, lineHeight: 18 },
  stepDetail: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  stepTx: { color: "#4da6ff", fontSize: 12 },
});

const icon = StyleSheet.create({
  circle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  spinner: { transform: [{ scale: 0.7 }] },
  glyph: { fontSize: 12, fontWeight: "700", lineHeight: 14 },
  waitDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
});
