import { router } from "expo-router";
import { Field, Input, OptionCards, Screen } from "@/components/ui";
import { useDraft, type Timeframe } from "@/lib/store";

export default function ContactScreen() {
  const { draft, setContact, setSurvey } = useDraft();
  const c = draft.contact;
  const property = draft.survey.property;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email);
  const ready = c.name.trim().length >= 2 && emailOk;

  return (
    <Screen
      step={7}
      totalSteps={8}
      title="Where should we send your quote?"
      subtitle="Your fixed price appears on the next screen, with a permanent link so you can come back to it any time."
      onBack={() => router.back()}
      onNext={() => router.push("/survey/result")}
      nextLabel="Show my fixed price"
      nextDisabled={!ready}
    >
      <Field label="Your name">
        <Input value={c.name} autoComplete="name" onChangeText={(name) => setContact({ name })} />
      </Field>
      <Field label="Email">
        <Input
          value={c.email}
          autoComplete="email"
          keyboardType="email-address"
          autoCapitalize="none"
          onChangeText={(email) => setContact({ email })}
        />
      </Field>
      <Field label="Phone (optional)" hint="Only used if we need to check an install detail.">
        <Input
          value={c.phone}
          autoComplete="tel"
          keyboardType="phone-pad"
          onChangeText={(phone) => setContact({ phone })}
        />
      </Field>
      <Field label="Do you own the property?">
        <OptionCards
          value={property.ownership}
          onChange={(ownership) => setSurvey({ property: { ...property, ownership } })}
          options={[
            { value: "owner", label: "Yes, I own it" },
            { value: "renting", label: "No, renting", hint: "Landlord consent needed" },
          ]}
        />
      </Field>
      <Field label="When are you looking to install?">
        <OptionCards<Timeframe>
          columns={3}
          value={c.timeframe}
          onChange={(timeframe) => setContact({ timeframe })}
          options={[
            { value: "asap", label: "ASAP" },
            { value: "1-3-months", label: "1–3 months" },
            { value: "researching", label: "Researching" },
          ]}
        />
      </Field>
    </Screen>
  );
}
