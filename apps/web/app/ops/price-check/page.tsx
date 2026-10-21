import Link from "next/link";
import type { Metadata } from "next";
import {
  LAYOUT_LABEL,
  buildDefaultConfig,
  classifyProperty,
  costQuote,
  generateQuote,
  lookupNeeds,
  prefillFromIntel,
  PLANNING_COSTS,
  type ElectricsCondition,
  type KitchenLivingLayout,
  type PropertyEra,
  type PropertyIntel,
  type PropertyType,
  type QuoteCost,
  type Survey,
} from "@aircon/domain";
import { Card, EmptyState, PageHeader, Section, Stat } from "@/components/kit";
import { Money } from "@/components/kit/money";
import { requireStaff } from "@/lib/auth/server";
import { gbp, isValidUkPostcode, normalisePostcode } from "@/lib/format";
import { addressesForPostcode, isSampleIntel, loadIntel } from "@/lib/intel-server";
import { enrichAndStore, epcBearerToken, lookupPostcode } from "@/lib/property-lookup";
import { getSettings } from "@/lib/settings-server";
import { getServiceClient } from "@/lib/supabase-server";

export const metadata: Metadata = { title: "Price check · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Any home through the same engine the customer's quote uses, with what it
 * would cost us and the margin left. For pricing the pilot homes by hand
 * while proving the rules: what's wrong for one home here is wrong for every
 * home like it, and the fix (a rule in the engine, a cost in PLANNING_COSTS,
 * a day rate in Settings) corrects them all.
 */

type Search = Record<string, string | string[] | undefined>;
const one = (sp: Search, k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

const TYPES: PropertyType[] = ["detached", "semi-detached", "terraced", "flat", "bungalow"];
const ERAS: PropertyEra[] = ["pre-1930", "1930-1950", "1950-2000", "2000+"];
const LAYOUTS = Object.keys(LAYOUT_LABEL) as KitchenLivingLayout[];
const ELECTRICS: { value: ElectricsCondition; label: string }[] = [
  { value: "unsure", label: "Not known yet" },
  { value: "modern-spare-ways", label: "Modern board, spare ways" },
  { value: "modern-full", label: "Modern board, full" },
  { value: "older-fuse-box", label: "Older fuse box" },
];

function pick<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T): T {
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}
function int(raw: string | undefined, min: number, max: number, fallback: number | undefined) {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export default async function PriceCheckPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireStaff("finance.view-margin");
  const sp = await searchParams;
  const postcodeRaw = one(sp, "postcode") ?? "";
  const postcode = isValidUkPostcode(postcodeRaw) ? normalisePostcode(postcodeRaw) : "";
  const id = one(sp, "id");
  const db = getServiceClient();
  const tokenSet = Boolean(epcBearerToken());

  // 1. The homes at the postcode: the book first, then the EPC register live.
  let homes: { id: string; line1: string }[] = [];
  let homesFrom: "book" | "epc" | "none" = "none";
  if (postcode) {
    homes = await addressesForPostcode(postcode);
    if (homes.length > 0) homesFrom = "book";
    else if (db) {
      const found = await lookupPostcode(db, postcode);
      homes = found.map((p) => ({ id: p.id, line1: p.address.line1 }));
      if (homes.length > 0) homesFrom = "epc";
    }
  }

  // 2. The picked home, with anything missing fetched and saved.
  let intel: PropertyIntel | null = id && /^[a-z0-9-]{4,80}$/i.test(id) ? await loadIntel(id) : null;
  if (intel && db && lookupNeeds(intel).any && !isSampleIntel(intel)) intel = await enrichAndStore(db, intel);

  const settings = await getSettings();

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="Pricing"
        title="Price check"
        subtitle="Any home through the customer's price engine, with what it costs us and the margin left."
      />

      <Card className="mb-8">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink-700">
            Postcode
            <input
              name="postcode"
              defaultValue={postcode || postcodeRaw}
              placeholder="SW16 2QT"
              className="min-h-11 w-40 rounded-lg border border-line bg-white px-3 uppercase"
              autoCapitalize="characters"
            />
          </label>
          <button type="submit" className="min-h-11 rounded-lg bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-ink-700">
            Find homes
          </button>
          <p className="basis-full text-xs text-ink-500">
            {tokenSet
              ? "Postcodes not in the property book are looked up live in the EPC register and saved."
              : "EPC_BEARER_TOKEN isn't set, so only homes already in the property book can be found. See docs/quote-data.md."}
          </p>
        </form>

        {postcode && (
          <div className="mt-5 border-t border-line pt-4">
            {homes.length === 0 ? (
              <p className="text-sm text-ink-700">
                No homes found at {postcode}.{" "}
                {tokenSet ? "The EPC register has no certificates there." : "Set EPC_BEARER_TOKEN to look it up."} You can still
                price a home by hand below.
              </p>
            ) : (
              <>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  {homes.length} home{homes.length === 1 ? "" : "s"} at {postcode} · {homesFrom === "epc" ? "just looked up in the EPC register" : "from the property book"}
                </p>
                <ul className="flex flex-wrap gap-2">
                  {homes.map((h) => (
                    <li key={h.id}>
                      <Link
                        href={`/ops/price-check?postcode=${encodeURIComponent(postcode)}&id=${encodeURIComponent(h.id)}`}
                        className={`inline-flex min-h-10 items-center rounded-lg border px-3 text-sm ${h.id === intel?.id ? "border-ink-900 bg-ink-900 text-white" : "border-line bg-white text-ink-900 hover:border-ink-500"}`}
                      >
                        {h.line1}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </Card>

      {intel ? (
        <HomeCheck intel={intel} sp={sp} settings={settings} postcode={postcode || intel.address.postcode} />
      ) : (
        <EmptyState
          title={postcode ? "Pick a home above" : "Start with a postcode"}
          body="You'll see what the public records say about the home, the system the engine designs, its price, our cost and the margin."
        />
      )}
    </main>
  );
}

async function HomeCheck({
  intel,
  sp,
  settings,
  postcode,
}: {
  intel: PropertyIntel;
  sp: Search;
  settings: Awaited<ReturnType<typeof getSettings>>;
  postcode: string;
}) {
  const cls = classifyProperty(intel);
  const prefill = prefillFromIntel(intel);

  // The answers the customer would give: public records first, the office's corrections on top.
  const type = pick(one(sp, "type"), TYPES, prefill.type ?? "semi-detached");
  const era = pick(one(sp, "era"), ERAS, prefill.era ?? "1930-1950");
  const bedrooms = int(one(sp, "bedrooms"), 1, 6, prefill.bedrooms ?? 3)!;
  const bathrooms = int(one(sp, "bathrooms"), 1, 4, 1)!;
  const layout = pick(one(sp, "layout"), LAYOUTS, "separate");
  const area = int(one(sp, "area"), 30, 1000, prefill.floorAreaM2);
  const electrics = pick(one(sp, "electrics"), ELECTRICS.map((e) => e.value), "unsure");

  const config = buildDefaultConfig({ type, era, bedrooms, bathrooms, layout, floorAreaM2: area });
  const survey: Survey = {
    postcode: intel.address.postcode,
    addressLine: intel.address.line1,
    archetypeId: config.archetypeId,
    permutationId: config.permutationId,
    property: { type, era, bedrooms, bathrooms, floorAreaM2: area, ownership: "owner" },
    rooms: config.rooms,
    outdoor: { location: config.outdoorDefault, photos: [] },
    electrics: { condition: electrics, photos: [] },
  };
  const quote = generateQuote(survey);
  const standard = costQuote(survey, quote, settings, "standard");
  const premium = costQuote(survey, quote, settings, "premium");
  const capacityByRoom = new Map(quote.systems.flatMap((s) => s.rooms.map((r) => [r.roomId, r])));

  const epc = intel.epc;
  const facts: [string, string | undefined][] = [
    ["Type", [epc?.builtForm, epc?.propertyType].filter(Boolean).join(" ") || undefined],
    ["Built", epc?.constructionAgeBand?.replace(/^England and Wales:\s*/i, "")],
    ["Floor area", epc?.totalFloorAreaM2 ? `${Math.round(epc.totalFloorAreaM2)} m²` : undefined],
    ["Habitable rooms", epc?.habitableRooms ? String(epc.habitableRooms) : undefined],
    ["Walls", epc?.wallDescription],
    ["Glazing", epc?.glazingDescription],
    ["Heating", epc?.mainHeatDescription],
    ["EPC rating", epc?.currentRating ? `${epc.currentRating}${epc.potentialRating ? ` (could be ${epc.potentialRating})` : ""}` : undefined],
    ["Certificate", epc?.lodgedAt ? `Lodged ${epc.lodgedAt}${epc.certificateNumber ? ` · ${epc.certificateNumber}` : ""}` : epc?.certificateNumber],
    ["Council", intel.sources?.geo?.district],
  ];
  const constraintNames = intel.sources?.constraints?.names ?? [];
  const self = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ postcode, id: intel.id, type, era, bedrooms: String(bedrooms), bathrooms: String(bathrooms), layout, electrics, ...(area ? { area: String(area) } : {}), ...extra });
    return `/ops/price-check?${q.toString()}`;
  };

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-2xl text-ink-900">
          {intel.address.line1}, {intel.address.postcode}
        </h2>
        <div className="flex gap-4 text-sm">
          <Link href={`/quote?intel=${encodeURIComponent(intel.id)}`} className="font-semibold text-accent-700 hover:underline">
            Open the customer&apos;s quote form for this home
          </Link>
          <Link href={self({})} className="font-semibold text-ink-700 hover:underline">
            Link to this check
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="What the public records say" description={cls.reasons.join(" · ") || undefined}>
          <Card>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
              {facts.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-500">{k}</dt>
                  <dd className={v ? "text-ink-900" : "text-ink-300"}>{v ?? "Not on record"}</dd>
                </div>
              ))}
              <dt className="text-ink-500">Planning</dt>
              <dd className="text-ink-900">
                {cls.planningRisk === "none"
                  ? intel.sources?.constraints
                    ? "No conservation area, Article 4 or listing at the postcode"
                    : "Not checked yet"
                  : constraintNames.join("; ") || `Risk: ${cls.planningRisk}`}
              </dd>
              <dt className="text-ink-500">Pattern</dt>
              <dd className="text-ink-900">
                {cls.archetypeName ?? "Unclassified"} · {cls.confidence}% sure
              </dd>
            </dl>
          </Card>
        </Section>

        <Section title="The customer's answers" description="Prefilled from the records. Change anything you know better and recalculate.">
          <Card>
            <form method="get" className="grid grid-cols-2 gap-3 text-sm">
              <input type="hidden" name="postcode" value={postcode} />
              <input type="hidden" name="id" value={intel.id} />
              <SelectField name="type" label="Home" value={type} options={TYPES.map((t) => ({ value: t, label: t }))} />
              <SelectField name="era" label="Built" value={era} options={ERAS.map((e) => ({ value: e, label: e }))} />
              <SelectField name="bedrooms" label="Bedrooms and studies" value={String(bedrooms)} options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))} />
              <SelectField name="bathrooms" label="Bathrooms" value={String(bathrooms)} options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))} />
              <SelectField name="layout" label="Kitchen and living" value={layout} options={LAYOUTS.map((l) => ({ value: l, label: LAYOUT_LABEL[l] }))} />
              <SelectField name="electrics" label="Fuse board" value={electrics} options={ELECTRICS} />
              <label className="flex flex-col gap-1 font-semibold text-ink-700">
                Floor area (m²)
                <input name="area" defaultValue={area ?? ""} inputMode="numeric" className="min-h-10 rounded-lg border border-line bg-white px-3 font-normal" />
              </label>
              <div className="flex items-end">
                <button type="submit" className="min-h-10 w-full rounded-lg bg-ink-900 px-4 font-semibold text-white hover:bg-ink-700">
                  Recalculate
                </button>
              </div>
            </form>
          </Card>
        </Section>
      </div>

      <Section title="The price and the margin" description={`Minimum margin ${settings.pricing.minMarginPct}% (Settings → Pricing). Costs are researched retail prices from ${PLANNING_COSTS.researchedAt}, ex VAT: your trade prices are likely lower.`}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Online price (standard)" value={gbp(quote.totalGbp)} hint={`${quote.installDays} install day${quote.installDays === 1 ? "" : "s"} · ${survey.rooms.length} rooms`} />
          <Stat label="Our cost (standard)" value={<Money pence={standard.costPence} />} hint="Kit, materials, labour, VAT we pay, contingency" />
          <Stat
            label="Margin (standard)"
            value={`${standard.marginPct}%`}
            tone={standard.belowMinMargin ? (standard.marginPct < 0 ? "danger" : "warn") : "success"}
            hint={<>Profit <Money pence={standard.profitPence} /> · needs <Money pence={standard.priceAtMinMarginPence} /> for {standard.minMarginPct}%</>}
          />
          <Stat
            label="Margin (premium)"
            value={`${premium.marginPct}%`}
            tone={premium.belowMinMargin ? (premium.marginPct < 0 ? "danger" : "warn") : "success"}
            hint={<>At <Money pence={premium.priceTotalPence} /> (+{settings.pricing.premiumUpliftPct}%) · needs <Money pence={premium.priceAtMinMarginPence} /></>}
          />
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Rooms and units" description={config.excluded.length ? `Not served: ${config.excluded.map((e) => e.name).join(", ")} (no suitable external wall).` : undefined}>
          <Card padded={false}>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Room</th>
                  <th className="px-4 py-2 font-semibold">Size</th>
                  <th className="px-4 py-2 font-semibold">Unit</th>
                </tr>
              </thead>
              <tbody>
                {survey.rooms.map((r) => {
                  const d = capacityByRoom.get(r.id);
                  return (
                    <tr key={r.id} className="border-t border-line">
                      <td className="px-4 py-2 text-ink-900">
                        {r.name}
                        <span className="block text-xs text-ink-500">{r.floor} floor</span>
                      </td>
                      <td className="px-4 py-2 tabular-nums">{r.areaM2 ? `${r.areaM2} m²` : r.size}</td>
                      <td className="px-4 py-2">
                        {d ? `${d.capacityKw.toFixed(1)} kW` : "—"}
                        <span className="block text-xs text-ink-500">{d ? `${Math.round(d.estimatedLoadWatts)} W load` : ""}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ul className="border-t border-line px-4 py-3 text-xs text-ink-500">
              {standard.units.map((u, i) => (
                <li key={i}>
                  <span className="font-semibold text-ink-700">{u.system}:</span> {u.unit} · <Money pence={u.costPence} />
                </li>
              ))}
            </ul>
          </Card>
        </Section>

        <Section title="What the customer sees" description={`Engine ${quote.engineVersion}. VAT inclusive.`}>
          <Card padded={false}>
            <table className="w-full text-sm">
              <tbody>
                {quote.lines.map((l, i) => (
                  <tr key={i} className="border-t border-line first:border-t-0">
                    <td className="px-4 py-2 text-ink-900">
                      {l.label}
                      {l.detail && <span className="block text-xs text-ink-500">{l.detail}</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{gbp(l.amount)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-ink-900 font-semibold">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2 text-right tabular-nums">{gbp(quote.totalGbp)}</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <CostTable title="Our cost: standard units" cost={standard} />
        <CostTable title="Our cost: premium units" cost={premium} />
      </div>

      <p className="text-xs text-ink-500">
        Change a rule once and every home follows: prices in packages/domain/src/pricing.ts, costs in
        packages/domain/src/quote-cost.ts, day rates, contingency, minimum margin and the premium uplift in Settings → Pricing.
      </p>
    </div>
  );
}

function CostTable({ title, cost }: { title: string; cost: QuoteCost }) {
  return (
    <Section title={title}>
      <Card padded={false}>
        <table className="w-full text-sm">
          <tbody>
            {cost.lines.map((l, i) => (
              <tr key={i} className="border-t border-line first:border-t-0">
                <td className="px-4 py-2 text-ink-900">
                  {l.label}
                  <span className="block text-xs text-ink-500">{l.basis}</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  <Money pence={l.amountPence} />
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-ink-900 font-semibold">
              <td className="px-4 py-2">Cost</td>
              <td className="px-4 py-2 text-right">
                <Money pence={cost.costPence} />
              </td>
            </tr>
            <tr className="border-t border-line">
              <td className="px-4 py-2 text-ink-700">Price, net of any VAT</td>
              <td className="px-4 py-2 text-right">
                <Money pence={cost.priceNetPence} />
              </td>
            </tr>
            <tr className="border-t border-line font-semibold">
              <td className="px-4 py-2">
                Profit · {cost.marginPct}% margin
              </td>
              <td className={`px-4 py-2 text-right ${cost.profitPence < 0 ? "text-red-700" : ""}`}>
                <Money pence={cost.profitPence} />
              </td>
            </tr>
          </tbody>
        </table>
      </Card>
    </Section>
  );
}

function SelectField({ name, label, value, options }: { name: string; label: string; value: string; options: { value: string; label: string }[] }) {
  return (
    <label className="flex flex-col gap-1 font-semibold text-ink-700">
      {label}
      <select name={name} defaultValue={value} className="min-h-10 rounded-lg border border-line bg-white px-2 font-normal">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
