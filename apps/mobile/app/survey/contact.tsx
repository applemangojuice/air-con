import { router } from "expo-router";
import { Field, Input, OptionCards, Screen } from "@/components/ui";
import { MARKETING_CONSENT, OPERATIONAL_CONSENT } from "@/lib/consent";
import { useDraft, type Timeframe } from "@/lib/store";

export default function ContactScreen() {
  const { draft, setContact, setSurvey, setConsents } = useDraft();
  const c = draft.contact;
  const property = draft.survey.property;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email);
  // The API won't save a quote without the operational consent, in the words the web funnel uses.
  const ready = c.name.trim().length >= 2 && emailOk && draft.consents.operational;

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
      <Field label="Saving your quote" hint="Tap to tick. Needed to save your quote.">
        <OptionCards<boolean>
          value={draft.consents.operational}
          onChange={() => setConsents({ operational: !draft.consents.operational })}
          options={[{ value: true, label: `${draft.consents.operational ? "✓ " : ""}${OPERATIONAL_CONSENT.label}`, hint: OPERATIONAL_CONSENT.hint }]}
        />
      </Field>
      <Field label="News and offers (optional)" hint="Never assumed: leave it unticked and you get no marketing.">
        <OptionCards<boolean>
          value={draft.consents.marketing}
          onChange={() => setConsents({ marketing: !draft.consents.marketing })}
          options={[{ value: true, label: `${draft.consents.marketing ? "✓ " : ""}${MARKETING_CONSENT.label}`, hint: MARKETING_CONSENT.hint }]}
        />
      </Field>
    </Screen>
  );
}
