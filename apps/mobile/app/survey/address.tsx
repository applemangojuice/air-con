import { router } from "expo-router";
import { Field, Input, Screen } from "@/components/ui";
import { useDraft } from "@/lib/store";

const POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export default function AddressScreen() {
  const { draft, setSurvey } = useDraft();
  const { postcode, addressLine } = draft.survey;
  const ready = POSTCODE_RE.test(postcode.trim()) && addressLine.trim().length >= 5;

  return (
    <Screen
      step={0}
      totalSteps={6}
      title="Where's the installation?"
      subtitle="We price every home individually — your address lets us check access, property type and local install patterns."
      onBack={() => router.back()}
      onNext={() => router.push("/survey/property")}
      nextDisabled={!ready}
    >
      <Field label="Postcode">
        <Input
          value={postcode}
          placeholder="e.g. SW1A 1AA"
          autoCapitalize="characters"
          autoComplete="postal-code"
          onChangeText={(v) => setSurvey({ postcode: v.toUpperCase() })}
        />
      </Field>
      <Field label="First line of address" hint="House number and street.">
        <Input
          value={addressLine}
          placeholder="e.g. 42 Maple Avenue"
          onChangeText={(v) => setSurvey({ addressLine: v })}
        />
      </Field>
    </Screen>
  );
}
