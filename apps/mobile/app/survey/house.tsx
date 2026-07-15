import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ARCHETYPES, suggestArchetypes, type PropertyType } from "@aircon/domain";
import { OptionCards, Screen } from "@/components/ui";
import { useDraft } from "@/lib/store";
import { theme } from "@/lib/theme";

const { colors, radius, space } = theme;

/**
 * Archetype-first capture: the customer identifies their house from the
 * library. Design becomes selection — only a few install permutations exist
 * per archetype.
 */
export default function HouseScreen() {
  const { draft, setSurvey } = useDraft();
  const [typeFilter, setTypeFilter] = useState<PropertyType>(draft.survey.property.type);

  const ranked = suggestArchetypes({ type: typeFilter, era: draft.survey.property.era });
  const rest = ARCHETYPES.filter((a) => !ranked.includes(a));

  function choose(archetypeId: string) {
    const archetype = ARCHETYPES.find((a) => a.id === archetypeId)!;
    setSurvey({
      archetypeId,
      permutationId: undefined,
      property: {
        ...draft.survey.property,
        type: archetype.matches.types[0] ?? draft.survey.property.type,
        era: archetype.matches.eras[0] ?? draft.survey.property.era,
      },
    });
    router.push("/survey/design");
  }

  return (
    <Screen
      step={0}
      totalSteps={8}
      title="Which is your house?"
      subtitle="We've designed installations for every common British home. Pick the one that matches yours — it decides how we install."
      onBack={() => router.back()}
    >
      <View>
        <Text style={styles.filterLabel}>What kind of home?</Text>
        <OptionCards<PropertyType>
          columns={3}
          value={typeFilter}
          onChange={setTypeFilter}
          options={[
            { value: "detached", label: "Detached" },
            { value: "semi-detached", label: "Semi" },
            { value: "terraced", label: "Terraced" },
            { value: "flat", label: "Flat" },
            { value: "bungalow", label: "Bungalow" },
          ]}
        />
      </View>

      <View style={{ gap: space(2.5) }}>
        {[...ranked, ...rest].map((a, i) => {
          const selected = draft.survey.archetypeId === a.id;
          const suggested = i < ranked.length;
          return (
            <Pressable
              key={a.id}
              onPress={() => choose(a.id)}
              style={[styles.card, selected && styles.cardSelected, !suggested && { opacity: 0.75 }]}
            >
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>{a.name}</Text>
                <Text style={styles.cardEra}>{a.eraLabel}</Text>
              </View>
              <Text style={styles.cardBody}>{a.description}</Text>
              <Text style={styles.cardRecognise}>
                {a.recognisers.slice(0, 2).join(" · ")}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterLabel: { fontSize: 14, fontWeight: "600", color: colors.ink900, marginBottom: space(1.5) },
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    padding: space(4),
  },
  cardSelected: { borderColor: colors.accent600, backgroundColor: colors.accent50 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", gap: space(2) },
  cardTitle: { fontWeight: "700", fontSize: 15, color: colors.ink900, flex: 1 },
  cardEra: { fontSize: 12, color: colors.ink300 },
  cardBody: { fontSize: 13, lineHeight: 18, color: colors.ink500, marginTop: 4 },
  cardRecognise: { fontSize: 12, color: colors.accent700, marginTop: space(2) },
});
