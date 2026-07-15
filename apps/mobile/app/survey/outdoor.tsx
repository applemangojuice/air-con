import { router } from "expo-router";
import { PhotoGrid } from "@/components/photo-grid";
import { Field, OptionCards, Screen } from "@/components/ui";
import { useDraft } from "@/lib/store";

export default function OutdoorScreen() {
  const { draft, setSurvey } = useDraft();
  const outdoor = draft.survey.outdoor;

  return (
    <Screen
      step={5}
      totalSteps={8}
      title="Where could the outdoor unit go?"
      subtitle="Every system needs one outdoor unit (about the size of a suitcase). It hums quietly, roughly as loud as a fridge."
      onBack={() => router.back()}
      onNext={() => router.push("/survey/electrics")}
    >
      <Field label="Best location">
        <OptionCards
          value={outdoor.location}
          onChange={(location) => setSurvey({ outdoor: { ...outdoor, location } })}
          options={[
            { value: "ground-rear", label: "Back garden / patio", hint: "On the ground" },
            { value: "ground-side", label: "Side passage", hint: "On the ground" },
            { value: "wall-bracket", label: "On an outside wall", hint: "Bracket-mounted" },
            { value: "flat-roof", label: "Flat roof" },
            { value: "balcony", label: "Balcony" },
            { value: "unsure", label: "Not sure", hint: "We'll advise" },
          ]}
        />
      </Field>
      <PhotoGrid
        kind="outdoor-location"
        label="Photo of the spot"
        guidance="Step 3–4 m back. Show where the unit sits and the route we'd walk to reach it."
        photos={outdoor.photos}
        onChange={(photos) => setSurvey({ outdoor: { ...outdoor, photos } })}
      />
    </Screen>
  );
}
