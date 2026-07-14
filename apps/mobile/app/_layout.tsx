import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { DraftProvider } from "@/lib/store";
import { theme } from "@/lib/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <DraftProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.cream },
          }}
        />
      </DraftProvider>
    </SafeAreaProvider>
  );
}
