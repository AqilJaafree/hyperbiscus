/**
 * Chat — talk to the DeFi agent.
 *
 * Mirrors MimiClaw's Telegram bot interface: the agent has full context
 * (SOUL.md + MEMORY.md + last tick state) and can call tools on your behalf.
 *
 * Examples:
 *   "What's the current position status?"
 *   "Are my fees worth harvesting yet?"
 *   "How long has the position been in range?"
 *   "Check the position and give me a fresh reading"
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRef, useState, useEffect } from "react";
import { useAgentWebSocket } from "@/hooks/useAgentWebSocket";
import { useAgentUrl } from "@/hooks/useAgentUrl";

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function Chat() {
  const { url } = useAgentUrl();
  const { connected, chatMessages, chatPending, sendChat } =
    useAgentWebSocket(url);

  const [draft, setDraft] = useState("");
  const listRef = useRef<FlatList>(null);

  // Scroll to bottom on new message
  useEffect(() => {
    if (chatMessages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [chatMessages.length, chatPending]);

  function submit() {
    const msg = draft.trim();
    if (!msg || chatPending || !connected) return;
    setDraft("");
    sendChat(msg);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={90}
      >
        {/* Connection banner */}
        {!connected && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Disconnected — reconnecting…</Text>
          </View>
        )}

        {/* Empty state */}
        {chatMessages.length === 0 && !chatPending && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Chat with your agent</Text>
            <Text style={styles.emptyHint}>Try asking:</Text>
            {SUGGESTIONS.map((s) => (
              <TouchableOpacity
                key={s}
                style={styles.suggestion}
                onPress={() => sendChat(s)}
              >
                <Text style={styles.suggestionText}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Message thread */}
        <FlatList
          ref={listRef}
          data={chatMessages}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={styles.thread}
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubble,
                item.role === "user" ? styles.bubbleUser : styles.bubbleAgent,
              ]}
            >
              <Text
                style={[
                  styles.bubbleText,
                  item.role === "user"
                    ? styles.bubbleTextUser
                    : styles.bubbleTextAgent,
                ]}
              >
                {item.message}
              </Text>
              <Text style={styles.bubbleTime}>{timeStr(item.timestamp)}</Text>
            </View>
          )}
          ListFooterComponent={
            chatPending ? (
              <View style={styles.thinking}>
                <ActivityIndicator size="small" color={colors.green} />
                <Text style={styles.thinkingText}>Agent is thinking…</Text>
              </View>
            ) : null
          }
        />

        {/* Input bar */}
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
              (!draft.trim() || chatPending || !connected) && styles.sendBtnDisabled,
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

const SUGGESTIONS = [
  "What's the current position status?",
  "Are my fees worth harvesting?",
  "How long has the position been in range?",
  "Check the position and give me a fresh reading",
];

const colors = {
  bg: "#0a0a0a",
  card: "#141414",
  border: "#2a2a2a",
  green: "#00d97e",
  user: "#00d97e",
  agent: "#1e1e1e",
  text: "#e0e0e0",
  muted: "#888",
  dim: "#555",
  red: "#ff4d4f",
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  banner: {
    backgroundColor: colors.red + "22",
    borderBottomWidth: 1,
    borderColor: colors.red + "44",
    padding: 10,
    alignItems: "center",
  },
  bannerText: { color: colors.red, fontSize: 13 },
  empty: {
    flex: 1,
    padding: 24,
    gap: 12,
    justifyContent: "center",
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 4,
  },
  emptyHint: { color: colors.muted, fontSize: 14 },
  suggestion: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  suggestionText: { color: colors.muted, fontSize: 14 },
  thread: {
    padding: 16,
    gap: 10,
    flexGrow: 1,
    justifyContent: "flex-end",
  },
  bubble: {
    maxWidth: "80%",
    borderRadius: 14,
    padding: 12,
    gap: 4,
    marginBottom: 6,
  },
  bubbleUser: {
    backgroundColor: colors.user + "22",
    borderWidth: 1,
    borderColor: colors.user + "55",
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
