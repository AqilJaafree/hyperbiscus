/**
 * Settings — configure the agent WebSocket URL.
 *
 * On LAN: ws://192.168.x.x:18789
 * On same machine (simulator): ws://localhost:18789
 */

import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAgentUrl, DEFAULT_URL } from "@/hooks/useAgentUrl";

export default function Settings() {
  const router = useRouter();
  const { url, setUrl } = useAgentUrl();
  const [draft, setDraft] = useState(url);

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed.startsWith("ws://") && !trimmed.startsWith("wss://")) {
      Alert.alert("Invalid URL", "URL must start with ws:// or wss://");
      return;
    }
    await setUrl(trimmed);
    router.back();
  }

  async function reset() {
    setDraft(DEFAULT_URL);
    await setUrl(DEFAULT_URL);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.container}>
        <Text style={styles.label}>Agent WebSocket URL</Text>
        <Text style={styles.hint}>
          Find your laptop's LAN IP (e.g. 192.168.1.x) and enter it below.
          Port 18789 is fixed.
        </Text>

        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="ws://192.168.1.x:18789"
          placeholderTextColor="#555"
          returnKeyType="done"
          onSubmitEditing={save}
        />

        <TouchableOpacity style={styles.button} onPress={save}>
          <Text style={styles.buttonText}>Save & Connect</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.resetButton} onPress={reset}>
          <Text style={styles.resetText}>Reset to default (localhost)</Text>
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

const colors = {
  bg: "#0a0a0a",
  card: "#141414",
  border: "#2a2a2a",
  green: "#00d97e",
  text: "#e0e0e0",
  muted: "#888",
  dim: "#555",
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { padding: 20, gap: 16 },
  label: { color: colors.text, fontSize: 16, fontWeight: "600" },
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
  infoTitle: { color: colors.muted, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1 },
  infoText: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  code: { fontFamily: "monospace", color: colors.green },
});
