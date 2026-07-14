import { router } from "expo-router";
import type { Survey } from "@aircon/domain";
import { Field, OptionCards, Screen } from "@/components/ui";
import { useDraft } from "@/lib/store";

export default function PropertyScreen() {
  const { draft, setSurvey } = useDraft();
  const p = draft.survey.property;
  const set = (update: Partial<Survey["property"]>) =>
    setSurvey({ property: { ...p, ...update } });

  return (
    <Screen
      step={1}
      totalSteps={6}
      title="Tell us about your home"
      subtitle="Property type and age drive how we route pipework and where the outdoor unit can go."
      onBack={() => router.back()}
      onNext={() => router.push("/survey/rooms")}
    >
      <Field label="Property type">
        <OptionCards
          columns={3}
          value={p.type}
          onChange={(type) => set({ type })}
          options={[
            { value: "detached", label: "Detached" },
            { value: "semi-detached", label: "Semi" },
            { value: "terraced", label: "Terraced" },
            { value: "flat", label: "Flat" },
            { value: "bungalow", label: "Bungalow" },
          ]}
        />
      </Field>
      <Field label="Roughly when was it built?">
        <OptionCards
          value={p.era}
          onChange={(era) => set({ era })}
          options={[
            { value: "pre-1930", label: "Before 1930", hint: "Solid walls" },
            { value: "1930-1979", label: "1930 – 1979", hint: "Early cavity" },
            { value: "1980-1999", label: "1980 – 1999", hint: "Insulated cavity" },
            { value: "2000+", label: "2000 or later", hint: "Modern build" },
          ]}
        />
      </Field>
      <Field label="Bedrooms">
        <OptionCards
          columns={3}
          value={p.bedrooms}
          onChange={(bedrooms) => set({ bedrooms })}
          options={[1, 2, 3, 4, 5, 6].map((n) => ({
            value: n,
            label: n === 6 ? "6+" : String(n),
          }))}
        />
      </Field>
      <Field label="Do you own the property?">
        <OptionCards
          value={p.ownership}
          onChange={(ownership) => set({ ownership })}
          options={[
            { value: "owner", label: "Yes, I own it" },
            { value: "renting", label: "No, renting", hint: "Landlord consent needed" },
          ]}
        />
      </Field>
    </Screen>
  );
}
