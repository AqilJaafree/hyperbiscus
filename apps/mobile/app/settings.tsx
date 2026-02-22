/**
 * Settings — configure the agent WebSocket URL and auth token.
 *
 * On LAN: ws://192.168.x.x:18789
 * On same machine (simulator): ws://localhost:18789
 */

import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAgent } from "@/context/AgentContext";
import { colors } from "@/constants/theme";
import { WEBSOCKET } from "@/constants/config";

function maskUrl(url: string): string {
  // ws://192.168.1.100:18789 → ws://●●●.●●●.●.●●●:18789
  return url.replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/, "●●●.●●●.●.●●●");
}

export default function Settings() {
  const { url, setUrl, token, setToken, connected } = useAgent();
  const [draftUrl, setDraftUrl] = useState(url);
  const [draftToken, setDraftToken] = useState(token);
  const [saved, setSaved] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (savedTimer.current) clearTimeout(savedTimer.current); };
  }, []);

  async function save() {
    const trimmedUrl = draftUrl.trim();
    if (!trimmedUrl.startsWith("ws://") && !trimmedUrl.startsWith("wss://")) {
      Alert.alert("Invalid URL", "URL must start with ws:// or wss://");
      return;
    }
    await Promise.all([setUrl(trimmedUrl), setToken(draftToken.trim())]);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setSaved(true);
    savedTimer.current = setTimeout(() => setSaved(false), 2000);
  }

  async function reset() {
    setDraftUrl(WEBSOCKET.DEFAULT_URL);
    setDraftToken("");
    await Promise.all([setUrl(WEBSOCKET.DEFAULT_URL), setToken("")]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <View style={styles.container}>

        {/* Connection status pill */}
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: connected ? colors.green : colors.red },
            ]}
          />
          <Text style={styles.statusText}>
            {connected ? "Connected" : "Disconnected"}
          </Text>
        </View>

        <View style={styles.labelRow}>
          <Text style={styles.label}>Agent WebSocket URL</Text>
          <TouchableOpacity onPress={() => setShowUrl((v) => !v)}>
            <Text style={styles.toggle}>{showUrl ? "Hide" : "Show"}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>
          Find your laptop's LAN IP (e.g. 192.168.1.x) and enter it below.
          Port 18789 is fixed.
        </Text>

        {showUrl ? (
          <TextInput
            style={styles.input}
            value={draftUrl}
            onChangeText={(v) => { setDraftUrl(v); setSaved(false); }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="ws://192.168.1.x:18789"
            placeholderTextColor={colors.dim}
            returnKeyType="next"
          />
        ) : (
          <TouchableOpacity style={styles.maskedInput} onPress={() => setShowUrl(true)}>
            <Text style={styles.maskedText}>{maskUrl(draftUrl) || "ws://●●●.●●●.●.●●●:18789"}</Text>
            <Text style={styles.maskedHint}>tap to edit</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.label}>Auth Token</Text>
        <Text style={styles.hint}>
          Optional. Set WS_SECRET in the agent .env and enter the same value
          here. Leave blank for open access (localhost only).
        </Text>

        <TextInput
          style={styles.input}
          value={draftToken}
          onChangeText={(v) => { setDraftToken(v); setSaved(false); }}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder="leave blank if no WS_SECRET set"
          placeholderTextColor={colors.dim}
          returnKeyType="done"
          onSubmitEditing={save}
        />

        <TouchableOpacity
          style={[styles.button, saved && styles.buttonSaved]}
          onPress={save}
        >
          <Text style={styles.buttonText}>
            {saved ? "✓ Saved — reconnecting…" : "Save & Connect"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.resetButton} onPress={reset}>
          <Text style={styles.resetText}>Reset to defaults</Text>
        </TouchableOpacity>

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>How to find your laptop's IP</Text>
          <Text style={styles.infoText}>
            Run in terminal:{"\n"}
            <Text style={styles.code}>ip addr | grep 192.168</Text>
            {"\n\n"}
            Then enter:{"\n"}
            <Text style={styles.code}>ws://192.168.x.x:18789</Text>
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { padding: 20, gap: 16 },

  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: colors.muted, fontSize: 13 },

  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { color: colors.text, fontSize: 16, fontWeight: "600" },
  toggle: { color: colors.green, fontSize: 13, fontWeight: "500" },
  maskedInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  maskedText: { color: colors.muted, fontSize: 15, fontFamily: "monospace" },
  maskedHint: { color: colors.dim, fontSize: 12 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    color: colors.text,
    fontSize: 15,
    fontFamily: "monospace",
  },
  button: {
    backgroundColor: colors.green,
    borderRadius: 10,
    padding: 16,
    alignItems: "center",
  },
  buttonSaved: {
    backgroundColor: "#007a47",
  },
  buttonText: { color: "#000", fontWeight: "700", fontSize: 16 },
  resetButton: { alignItems: "center", paddingVertical: 8 },
  resetText: { color: colors.dim, fontSize: 13 },
  infoBox: {
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
    marginTop: 8,
  },
  infoTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  infoText: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  code: { fontFamily: "monospace", color: colors.green },
});
