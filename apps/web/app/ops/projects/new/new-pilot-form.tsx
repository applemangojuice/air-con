"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  LAYOUT_LABEL,
  buildDefaultConfig,
  generateQuote,
  type ElectricsCondition,
  type KitchenLivingLayout,
  type PropertyEra,
  type PropertyType,
} from "@aircon/domain";
import { ActionForm, SubmitButton } from "@/components/ops/command/action-form";
import type { ActionResult } from "@/components/ops/command/types";
import { Checkbox, Fieldset, Input, Select, Textarea } from "@/components/kit/form";
import { isValidUkPostcode, money, normalisePostcode } from "@/lib/format";

const TYPES: { value: PropertyType; label: string }[] = [
  { value: "terraced", label: "Terraced" },
  { value: "semi-detached", label: "Semi-detached" },
  { value: "detached", label: "Detached" },
  { value: "bungalow", label: "Bungalow" },
  { value: "flat", label: "Flat" },
];
const ERAS: { value: PropertyEra; label: string }[] = [
  { value: "pre-1930", label: "Before 1930" },
  { value: "1930-1950", label: "1930 to 1950" },
  { value: "1950-2000", label: "1950 to 2000" },
  { value: "2000+", label: "2000 or later" },
];
const ELECTRICS: { value: ElectricsCondition; label: string }[] = [
  { value: "unsure", label: "Not sure yet" },
  { value: "modern-spare-ways", label: "Modern board with spare ways" },
  { value: "modern-full", label: "Modern board, full" },
  { value: "older-fuse-box", label: "Older fuse box" },
];

/** The outcode of a full or partial postcode, the way settings list them. */
function outcodeOf(postcode: string): string {
  const n = normalisePostcode(postcode);
  return n.includes(" ") ? n.split(" ")[0]! : n;
}

export function NewPilotForm({
  action,
  nextPilotNumber,
  serviceOutcodes,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  nextPilotNumber: number;
  serviceOutcodes: string[];
}) {
  const router = useRouter();
  const [requestId] = useState(() => crypto.randomUUID());
  const [postcode, setPostcode] = useState("");
  const [type, setType] = useState<PropertyType>("semi-detached");
  const [era, setEra] = useState<PropertyEra>("1930-1950");
  const [bedrooms, setBedrooms] = useState(3);
  const [layout, setLayout] = useState<KitchenLivingLayout>("separate");
  const [devLink, setDevLink] = useState<{ href: string; link: string } | null>(null);

  const preview = useMemo(() => {
    const config = buildDefaultConfig({ type, era, bedrooms, bathrooms: 1, layout });
    try {
      const quote = generateQuote({
        postcode: "SW16 2BE",
        addressLine: "preview",
        ...(config.archetypeId ? { archetypeId: config.archetypeId } : {}),
        property: { type, era, bedrooms, ownership: "owner" },
        rooms: config.rooms,
        outdoor: { location: config.outdoorDefault, photos: [] },
        electrics: { condition: "unsure", photos: [] },
      });
      return { config, totalPence: quote.totalGbp * 100 };
    } catch {
      return { config, totalPence: null };
    }
  }, [type, era, bedrooms, layout]);

  const pc = postcode.trim();
  const pcValid = pc.length > 0 && isValidUkPostcode(pc);
  const outside = pcValid && !serviceOutcodes.map((o) => o.toUpperCase().trim()).includes(outcodeOf(pc));

  function onResult(r: ActionResult) {
    if (!r.ok || !r.href) return;
    if (r.detail) setDevLink({ href: r.href, link: r.detail });
    else router.push(`${r.href}?created=1`);
  }

  return (
    <ActionForm action={action} onResult={onResult} quietSuccess={false}>
      <input type="hidden" name="requestId" value={requestId} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-line bg-white p-5" aria-labelledby="who">
            <h2 id="who" className="mb-4 font-display text-xl text-ink-900">
              Who
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Name" name="name" required autoComplete="off" maxLength={120} className="sm:col-span-2" />
              <Input label="Email" name="email" type="email" required autoComplete="off" maxLength={200} hint="Their proposal and contract go here." />
              <Input label="Phone" name="phone" type="tel" autoComplete="off" maxLength={20} hint="Mobile, for reminders by text." />
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-white p-5" aria-labelledby="where">
            <h2 id="where" className="mb-4 font-display text-xl text-ink-900">
              Where
            </h2>
            <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
              <Input label="Address" name="addressLine" required autoComplete="off" maxLength={200} hint="House number and street." />
              <Input
                label="Postcode"
                name="postcode"
                required
                autoComplete="off"
                maxLength={10}
                value={postcode}
                onChange={(e) => setPostcode(e.target.value.toUpperCase())}
                error={pc.length >= 5 && !pcValid ? "That isn't a full UK postcode." : undefined}
              />
            </div>
            {outside && (
              <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {outcodeOf(pc)} isn&apos;t in the service area in settings. You can still set them up; add the area in Settings if it&apos;s one you now cover.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-white p-5" aria-labelledby="home">
            <h2 id="home" className="mb-1 font-display text-xl text-ink-900">
              The home
            </h2>
            <p className="mb-4 text-sm text-ink-500">Enough to give them a starting price. The survey measures the rest.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="House type" name="type" value={type} onChange={(e) => setType(e.target.value as PropertyType)} options={TYPES} />
              <Select label="Built" name="era" value={era} onChange={(e) => setEra(e.target.value as PropertyEra)} options={ERAS} />
              <Select
                label="Bedrooms"
                name="bedrooms"
                value={String(bedrooms)}
                onChange={(e) => setBedrooms(Number(e.target.value))}
                options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: n === 6 ? "6 or more" : String(n) }))}
              />
              <Select
                label="Kitchen and living"
                name="layout"
                value={layout}
                onChange={(e) => setLayout(e.target.value as KitchenLivingLayout)}
                options={(Object.keys(LAYOUT_LABEL) as KitchenLivingLayout[]).map((k) => ({ value: k, label: LAYOUT_LABEL[k] }))}
              />
              <Select label="Bathrooms" name="bathrooms" defaultValue="1" options={[0, 1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))} />
              <Input label="Floor area (m²)" name="floorAreaM2" type="number" min={30} max={1000} hint="Optional. From the EPC if you have it." />
              <Select label="Fuse board" name="electrics" defaultValue="unsure" options={ELECTRICS} />
              <Fieldset legend="They">
                <div className="flex gap-4">
                  <label className="flex min-h-12 items-center gap-2 text-base text-ink-900">
                    <input type="radio" name="ownership" value="owner" defaultChecked className="h-5 w-5 accent-accent-600" /> Own it
                  </label>
                  <label className="flex min-h-12 items-center gap-2 text-base text-ink-900">
                    <input type="radio" name="ownership" value="renting" className="h-5 w-5 accent-accent-600" /> Rent it
                  </label>
                </div>
              </Fieldset>
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-white p-5" aria-labelledby="pilot">
            <h2 id="pilot" className="mb-4 font-display text-xl text-ink-900">
              Pilot
            </h2>
            <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
              <Input label="Number" name="pilotNumber" type="number" min={1} max={999} required defaultValue={String(nextPilotNumber)} />
              <Input label="Label" name="pilotLabel" required maxLength={80} placeholder="e.g. Croydon semi" hint="An area or house type, never the address: it shows on dashboards and exports." />
            </div>
            <Textarea label="Note" name="note" rows={3} maxLength={2000} hint="Optional. Only the team sees it." className="mt-4" />
            <Checkbox name="sendLink" label="Email them a link to their project now" hint="A sign-in link to their project page. It works once and lasts 30 days." className="mt-2" />
          </section>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-2xl border border-line bg-white p-5">
            <h2 className="text-sm font-semibold text-ink-900">What gets created</h2>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-ink-900">{preview.totalPence === null ? "–" : money(preview.totalPence)}</p>
            <p className="text-xs text-ink-500">Instant price, from the same engine as the website. The proposal replaces it after the survey.</p>
            <ul className="mt-3 space-y-1 text-sm text-ink-700">
              {preview.config.rooms.map((r) => (
                <li key={r.id}>· {r.name}</li>
              ))}
            </ul>
            {preview.config.excluded.length > 0 && (
              <p className="mt-2 text-xs text-ink-500">Not included: {preview.config.excluded.map((r) => r.name).join(", ")} (no suitable outside wall).</p>
            )}
            <div className="mt-5">
              <SubmitButton size="lg" block busyLabel="Setting up…">
                Set up the pilot
              </SubmitButton>
            </div>
          </div>
          {devLink && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Development only: the customer&apos;s link</p>
              <p className="mt-1 break-all font-mono text-xs">{devLink.link}</p>
              <a href={devLink.href} className="mt-3 inline-flex min-h-10 items-center font-semibold text-accent-700 underline">
                Open the project
              </a>
            </div>
          )}
        </aside>
      </div>
    </ActionForm>
  );
}
