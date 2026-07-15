import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDraft } from "@/lib/store";
import { theme } from "@/lib/theme";

const { colors, radius, space } = theme;

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const { draft, hydrated, reset } = useDraft();
  const inProgress =
    hydrated && (draft.survey.postcode.length > 0 || draft.survey.rooms.length > 0);

  return (
    <View style={[styles.container, { paddingTop: insets.top + space(10) }]}>
      <View style={styles.mark}>
        <Text style={styles.markText}>❋</Text>
      </View>
      <Text style={styles.title}>Your home, priced in minutes</Text>
      <Text style={styles.body}>
        Pick the house that matches yours, film a short narrated walkthrough,
        and we&apos;ll draft your floor plan and a guaranteed fixed price for
        air conditioning.
      </Text>

      <View style={{ marginTop: space(8), gap: space(3) }}>
        <Pressable style={styles.primary} onPress={() => router.push("/survey/house")}>
          <Text style={styles.primaryText}>
            {inProgress ? "Continue my survey" : "Start my survey"}
          </Text>
        </Pressable>
        {inProgress && (
          <Pressable
            style={styles.secondary}
            onPress={() => {
              reset();
              router.push("/survey/house");
            }}
          >
            <Text style={styles.secondaryText}>Start over</Text>
          </Pressable>
        )}
      </View>

      <Text style={styles.footnote}>
        Fixed price · no obligation · 5-year parts &amp; labour warranty
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.cream, paddingHorizontal: space(6) },
  mark: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.accent500,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space(6),
  },
  markText: { color: colors.white, fontSize: 26 },
  title: { fontSize: 34, fontWeight: "700", color: colors.ink900, letterSpacing: -0.5 },
  body: { marginTop: space(3), fontSize: 16, lineHeight: 23, color: colors.ink500 },
  primary: {
    borderRadius: radius.pill,
    backgroundColor: colors.accent600,
    paddingVertical: space(4),
    alignItems: "center",
  },
  primaryText: { color: colors.white, fontWeight: "700", fontSize: 17 },
  secondary: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: space(4),
    alignItems: "center",
  },
  secondaryText: { color: colors.ink700, fontWeight: "600" },
  footnote: { marginTop: "auto", marginBottom: space(10), fontSize: 12, color: colors.ink300 },
});
