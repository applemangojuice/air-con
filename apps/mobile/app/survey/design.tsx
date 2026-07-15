import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { buildPresetRoom, getArchetype } from "@aircon/domain";
import { Screen } from "@/components/ui";
import { useDraft } from "@/lib/store";
import { theme } from "@/lib/theme";

const { colors, radius, space } = theme;

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);

/**
 * Design parameters upfront: only a few proven install permutations exist for
 * each archetype. The customer picks one before the walkthrough, so the video
 * narration happens with the install pattern already in mind.
 */
export default function DesignScreen() {
  const { draft, setSurvey } = useDraft();
  const archetype = draft.survey.archetypeId ? getArchetype(draft.survey.archetypeId) : undefined;

  if (!archetype) {
    router.replace("/survey/house");
    return null;
  }

  function choose(permutationId: string) {
    const permutation = archetype!.permutations.find((p) => p.id === permutationId)!;
    setSurvey({
      permutationId,
      // The pattern decides where the outdoor unit lives, so prefill it.
      outdoor: { ...draft.survey.outdoor, location: permutation.outdoorLocation },
      // Zero-AI floor plan: start from the archetype's stock layout. The
      // customer confirms/tweaks rooms instead of describing them.
      rooms:
        draft.survey.rooms.length === 0
          ? archetype!.typicalRooms
              .map((preset, i) => ({ preset, i }))
              .filter(({ preset }) => preset.popular)
              .map(({ preset, i }) => buildPresetRoom(archetype!.id, preset, i))
          : draft.survey.rooms,
    });
    router.push("/survey/address");
  }

  return (
    <Screen
      step={1}
      totalSteps={8}
      title={`How we install in a ${archetype.name.toLowerCase()}`}
      subtitle={`There ${archetype.permutations.length === 1 ? "is one proven way" : `are ${archetype.permutations.length} proven ways`} we install in homes like yours. Pick the one that suits you best and we'll double-check it on your video.`}
      onBack={() => router.back()}
    >
      <View style={{ gap: space(3) }}>
        {archetype.permutations.map((p) => {
          const selected = draft.survey.permutationId === p.id;
          return (
            <Pressable
              key={p.id}
              onPress={() => choose(p.id)}
              style={[styles.card, selected && styles.cardSelected]}
            >
              <View style={styles.head}>
                <Text style={styles.title}>{p.label}</Text>
                <Text style={styles.price}>{p.adderGbp > 0 ? `+${gbp(p.adderGbp)}` : "Included"}</Text>
              </View>
              <Text style={styles.summary}>{p.summary}</Text>
              <Text style={styles.route}>{p.pipeRoute}</Text>
              <Text style={styles.meta}>
                Serves up to {p.servesUpTo} room{p.servesUpTo > 1 ? "s" : ""} · We&apos;ll check:{" "}
                {p.checks.join(", ").toLowerCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    padding: space(4),
  },
  cardSelected: { borderColor: colors.accent600, backgroundColor: colors.accent50 },
  head: { flexDirection: "row", justifyContent: "space-between", gap: space(2) },
  title: { fontWeight: "700", fontSize: 15, color: colors.ink900, flex: 1 },
  price: { fontWeight: "700", fontSize: 13, color: colors.sage700 },
  summary: { fontSize: 13, lineHeight: 19, color: colors.ink700, marginTop: 4 },
  route: { fontSize: 12, lineHeight: 17, color: colors.ink500, marginTop: space(2) },
  meta: { fontSize: 11, lineHeight: 16, color: colors.ink300, marginTop: space(2) },
});
