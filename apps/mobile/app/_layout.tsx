import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { AgentProvider, useAgent } from "@/context/AgentContext";
import { colors } from "@/constants/theme";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

function TabIcon({
  name,
  focused,
}: {
  name: IoniconName;
  focused: boolean;
}) {
  return (
    <Ionicons
      name={focused ? name : (`${name}-outline` as IoniconName)}
      size={22}
      color={focused ? colors.green : colors.muted}
    />
  );
}

// Green dot overlay on chat icon when connected
function ChatIcon({ focused }: { focused: boolean }) {
  const { connected } = useAgent();
  return (
    <View>
      <TabIcon name="chatbubble-ellipses" focused={focused} />
      <View
        style={{
          position: "absolute",
          top: -1,
          right: -3,
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: connected ? colors.green : colors.red,
          borderWidth: 1.5,
          borderColor: colors.card,
        }}
      />
    </View>
  );
}

function AppTabs() {
  const insets = useSafeAreaInsets();
  // Tab icons sit in a 56px zone; below that is padding for the system nav bar.
  const TAB_CONTENT_HEIGHT = 56;
  const tabBarHeight = TAB_CONTENT_HEIGHT + insets.bottom;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "700", fontSize: 16 },
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          paddingTop: 6,
          paddingBottom: insets.bottom,
          height: tabBarHeight,
        },
        tabBarActiveTintColor: colors.green,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 10 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Chat",
          headerShown: false,
          tabBarIcon: ({ focused }) => <ChatIcon focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="position"
        options={{
          title: "Position",
          tabBarIcon: ({ focused }) => (
            <TabIcon name="pulse" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="marketplace"
        options={{
          title: "Skills",
          tabBarIcon: ({ focused }) => (
            <TabIcon name="grid" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ focused }) => (
            <TabIcon name="settings" focused={focused} />
          ),
        }}
      />
      {/* Legacy routes — hidden from tab bar */}
      <Tabs.Screen name="chat" options={{ href: null }} />
    </Tabs>
  );
}

export default function RootLayout() {
  return (
    <AgentProvider>
      <StatusBar style="light" />
      <AppTabs />
    </AgentProvider>
  );
}
