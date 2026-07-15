import { router } from "expo-router";
import { PhotoGrid } from "@/components/photo-grid";
import { Field, OptionCards, Screen } from "@/components/ui";
import { useDraft } from "@/lib/store";

export default function ElectricsScreen() {
  const { draft, setSurvey } = useDraft();
  const electrics = draft.survey.electrics;

  return (
    <Screen
      step={6}
      totalSteps={8}
      title="A quick look at your electrics"
      subtitle="Air conditioning needs its own circuit from your fuse board — usually in the hallway, garage or under the stairs."
      onBack={() => router.back()}
      onNext={() => router.push("/survey/contact")}
    >
      <Field label="Which best describes your fuse board?">
        <OptionCards
          value={electrics.condition}
          onChange={(condition) => setSurvey({ electrics: { ...electrics, condition } })}
          options={[
            { value: "modern-spare-ways", label: "Modern, spare switches", hint: "Empty slots visible" },
            { value: "modern-full", label: "Modern, but full", hint: "No empty slots" },
            { value: "older-fuse-box", label: "Older fuse box", hint: "Rewireable fuses" },
            { value: "unsure", label: "Not sure", hint: "The photo is enough" },
          ]}
        />
      </Field>
      <PhotoGrid
        kind="fuse-board"
        label="Photo of your fuse board"
        guidance="Straight on, door open, close enough to read the breaker labels."
        photos={electrics.photos}
        onChange={(photos) => setSurvey({ electrics: { ...electrics, photos } })}
      />
    </Screen>
  );
}
