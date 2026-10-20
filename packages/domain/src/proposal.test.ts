import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogueItem } from "./catalogue.ts";
import { RESEARCHED_CATALOGUE } from "./catalogue-data.ts";
import type { DesignRecord, DesignVariant } from "./design-record.ts";
import {
  DEFAULT_EXCLUSIONS,
  DEFAULT_INCLUSIONS,
  DEFAULT_PROPOSAL_ASSUMPTIONS,
  acceptanceErrors,
  customerSafeProposal,
  defaultOptionFor,
  draftProposal,
  guaranteeLines,
  hasPilotDiscount,
  installPlan,
  isFullName,
  isProposalExpired,
  pipeNoteFor,
  pricingInputsOf,
  proposalDocumentContent,
  proposalIssueErrors,
  proposalCheckFor,
  agreedPaymentsFor,
  contractTaxCode,
  recomputeOption,
  reviseProposal,
  unitHighlights,
  whyThisSize,
  withPipeNotes,
  withSettingsWording,
  withoutDiscountLine,
  type AcceptanceRecord,
  type OptionContext,
  type ProposalOption,
  type ProposalRecord,
} from "./proposal.ts";
import { performanceCommitment, performanceDueOn, proposalTermsFrom, settingsForProposal } from "./proposal.ts";
import { DEFAULT_SETTINGS, mergeSettings, type PilotSettings } from "./settings.ts";

/* Fixtures: a fictional DEMO two-room home, Standard and Quiet. */

const item = (over: Partial<CatalogueItem> & Pick<CatalogueItem, "id" | "kind" | "label" | "costPence">): CatalogueItem => ({
  status: "available",
  confidence: "provisional",
  sources: [],
  active: true,
  ...over,
});

const CATALOGUE: CatalogueItem[] = [
  item({ id: "std25", kind: "indoor", label: "DEMO Breeze 25 wall unit", costPence: 38_000, customerBlurb: "Neat and efficient.", specs: { coolingKw: 2.5, heatingKw: 3.2, soundPressureLowDb: 21, wifi: "Built in" } }),
  item({ id: "std35", kind: "indoor", label: "DEMO Breeze 35 wall unit", costPence: 45_000, specs: { coolingKw: 3.5, heatingKw: 4, soundPressureLowDb: 22 } }),
  item({ id: "q25", kind: "indoor", label: "DEMO Whisper 25 wall unit", costPence: 62_000, specs: { coolingKw: 2.5, heatingKw: 3.4, soundPressureLowDb: 19 } }),
  item({ id: "q35", kind: "indoor", label: "DEMO Whisper 35 wall unit", costPence: 70_000, specs: { coolingKw: 3.5, heatingKw: 4.2, soundPressureLowDb: 19 } }),
  item({ id: "duo", kind: "outdoor", label: "DEMO Duo 50 outdoor unit", costPence: 112_000 }),
  item({ id: "single", kind: "outdoor", label: "DEMO single outdoor unit", costPence: 52_000 }),
];

const system = (id: string, outdoorItemId: string, roomIds: string[]) => ({
  id,
  topology: roomIds.length > 1 ? ("multi" as const) : ("single" as const),
  outdoorItemId,
  roomIds,
  compatibility: { ok: true, errors: [], warnings: [] },
  electrical: { breaker: "16 A", cableMm2: 2.5, isolator: "20 A" },
  refrigerant: { totalPipeM: 12, prechargedPipeM: 20, additionalChargeG: 0 },
});

const variant = (tier: "standard" | "premium"): DesignVariant => {
  const q = tier === "premium";
  const units = [
    { roomId: "bed", indoorItemId: q ? "q25" : "std25" },
    { roomId: "living", indoorItemId: q ? "q35" : "std35" },
  ];
  return {
    id: `v-${tier}`,
    label: q ? "Quiet" : "Standard",
    tier,
    systems: [system("sys1", "duo", ["bed", "living"])],
    roomUnits: units,
    bom: [
      ...units.map((u) => ({ catalogueItemId: u.indoorItemId, sku: u.indoorItemId, label: u.indoorItemId, qty: 1, category: "equipment" as const })),
      { catalogueItemId: "duo", sku: "duo", label: "duo", qty: 1, category: "equipment" },
    ],
    rules: [],
    verdict: "auto-approved",
    installDays: 3,
  };
};

const DESIGN: DesignRecord = {
  id: "d1",
  projectId: "p1",
  version: 2,
  status: "approved",
  rooms: [
    { roomId: "bed", roomName: "Main bedroom", floor: "first", preliminaryLoadW: 1_900, suggestedKw: 2.5, chosenKw: 2.5, pipeRunM: 6, heightDiffM: 3, condensate: "gravity", layoutMediaIds: ["m-bed"] },
    { roomId: "living", roomName: "Living room", floor: "ground", preliminaryLoadW: 3_100, suggestedKw: 3.5, chosenKw: 3.5, reason: "Big south window.", pipeRunM: 4.5, heightDiffM: 0, condensate: "pump", layoutMediaIds: ["m-liv"] },
  ],
  variants: [variant("standard"), variant("premium")],
  overrides: [],
  approval: { staffId: "s-tl", name: "DEMO Tess", qualificationRef: "DEMO-FGAS", at: "2026-10-10T16:00:00.000Z" },
  createdAt: "2026-10-09T10:00:00.000Z",
};

const READY: PilotSettings = mergeSettings({
  company: { ...DEFAULT_SETTINGS.company, geographicAddress: "DEMO: 1 Demo Street", phone: "020 7946 0123", complaintsProcess: "DEMO: call us." },
  warranty: { workmanshipYears: 2, manufacturerSummary: "DEMO: five years' parts once registered." },
});

const CTX: OptionContext = {
  design: DESIGN,
  catalogue: CATALOGUE,
  settings: READY,
  engineNetPence: 450_000,
  contractType: "supply-and-install",
  outdoorMediaBySystem: { sys1: ["m-out"] },
  routes: { bed: { route: "external-trunking" } },
};

const TODAY = "2026-10-18";
const NOW = "2026-10-18T10:00:00.000Z";

const draft = (over: Partial<ProposalRecord> = {}, ctx: OptionContext = CTX): ProposalRecord => ({
  ...draftProposal(ctx, { id: "prop-1", projectId: "p1", version: 1, instantPriceGbp: 9_000, today: TODAY, now: NOW }),
  ...over,
});

/** Costs typed in for every line the catalogue can't price (ex VAT), as the builder does. */
function priceGaps(o: ProposalOption, unitCostPence = 2_500): Record<string, { unitCostPence: number }> {
  return Object.fromEntries(o.costLines.filter((l) => l.totalPence === null).map((l) => [l.id, { unitCostPence }]));
}

/** A draft whose prices clear the minimum margin (cost-plus to 40%), every cost line priced. */
function healthy(): ProposalRecord {
  const p = draft();
  p.options = p.options.map((o) => {
    const gaps = priceGaps(recomputeOption(CTX, { ...o, pricingInputs: { basis: "cost-plus", targetMarginPct: 40 } }));
    return recomputeOption(CTX, { ...o, pricingInputs: { basis: "cost-plus", targetMarginPct: 40, costOverrides: gaps } });
  });
  return p;
}

const issued = (over: Partial<ProposalRecord> = {}): ProposalRecord => ({ ...healthy(), status: "issued", issuedAt: NOW, ...over });

const acceptance = (p: ProposalRecord, over: Partial<Omit<AcceptanceRecord, "at">> = {}): Omit<AcceptanceRecord, "at"> => ({
  optionId: p.options[0]!.id,
  optionLabel: p.options[0]!.label,
  totalPence: p.options[0]!.pricing.totalPence,
  name: "Alex Morgan",
  termsVersion: p.termsVersion,
  cancellationNoticeVersion: "ccr-2013-sch3-v2",
  acknowledgedCancellationInfo: true,
  earlyStartRequested: false,
  acknowledgedLossOfRight: false,
  ...over,
});

/* ------------------------------------------------------------------ */
/* Wording                                                             */
/* ------------------------------------------------------------------ */

test("default wording covers the honest basics in plain English", () => {
  const inc = DEFAULT_INCLUSIONS.join(" ");
  for (const needle of ["65 mm", "condensate", "Part P", "F-gas", "Making good", "waste", "handover", "Up to 5 m"]) {
    assert.ok(inc.toLowerCase().includes(needle.toLowerCase()), `inclusions mention ${needle}`);
  }
  const exc = DEFAULT_EXCLUSIONS.join(" ").toLowerCase();
  for (const needle of ["redecorating", "structural", "asbestos", "fuse board", "planning permission"]) {
    assert.ok(exc.includes(needle), `exclusions mention ${needle}`);
  }
  assert.ok(DEFAULT_PROPOSAL_ASSUMPTIONS.some((a) => /in writing first/.test(a)), "no surprise extras");
  for (const line of [...DEFAULT_INCLUSIONS, ...DEFAULT_EXCLUSIONS, ...DEFAULT_PROPOSAL_ASSUMPTIONS]) {
    assert.doesNotMatch(line, /lorem|TODO|TBC/i);
  }
});

test("guaranteeLines: says plainly when no extended warranty is offered, and never drops statutory rights", () => {
  const none = guaranteeLines(DEFAULT_SETTINGS);
  assert.match(none[0]!, /don't offer an extended warranty/);
  assert.match(none.at(-1)!, /statutory rights/);
  const set = guaranteeLines(READY);
  assert.deepEqual(set.slice(0, 2), ["Manufacturer's warranty: DEMO: five years' parts once registered.", "Our workmanship guarantee: 2 years."]);
  const zero = guaranteeLines(mergeSettings({ warranty: { workmanshipYears: 0, manufacturerSummary: null } }));
  assert.match(zero.join(" "), /don't offer a separate guarantee on our workmanship/);
  assert.match(zero.join(" "), /manufacturer's standard warranty terms/);
});

test("withSettingsWording: a draft picks up settings saved after its last edit; issued versions stay frozen", () => {
  const stale = { status: "draft", warranty: null, guarantees: guaranteeLines(DEFAULT_SETTINGS), termsVersion: "old-terms" } as unknown as ProposalRecord;
  const fresh = withSettingsWording(stale, READY);
  assert.deepEqual(fresh.guarantees, guaranteeLines(READY));
  assert.equal(fresh.warranty, "DEMO: five years' parts once registered.");
  assert.equal(fresh.termsVersion, READY.legal.termsVersion);
  assert.doesNotMatch(fresh.guarantees!.join(" "), /don't offer an extended warranty/);
  const issued = { ...stale, status: "issued" } as ProposalRecord;
  assert.equal(withSettingsWording(issued, READY), issued, "an issued version never changes");
});

test("installPlan: three days by default, sensible for one, two and four", () => {
  const three = installPlan(3);
  assert.deepEqual(three.map((d) => d.title), ["Prep and building work", "Units, pipes and power", "Test, commission and hand over"]);
  assert.match(three[1]!.items.join(" "), /power is off for about 30 minutes/);
  assert.equal(installPlan(1).length, 1);
  assert.equal(installPlan(2).length, 2);
  assert.deepEqual(installPlan(4).map((d) => d.day), [1, 2, 3, 4]);
  assert.equal(installPlan(0).length, 1);
});

test("whyThisSize and pipeNoteFor read like a person wrote them", () => {
  assert.equal(
    whyThisSize(DESIGN.rooms[0]!),
    "We chose 2.5 kW. On a hot day this room needs about 1.9 kW, so this size keeps it comfortable without working flat out, and it heats the room on cold evenings too.",
  );
  assert.match(whyThisSize(DESIGN.rooms[1]!), /Our engineer's note: Big south window\.$/);
  assert.match(whyThisSize({ chosenKw: 2.5, preliminaryLoadW: 0 }), /for this room's size/);
  assert.equal(
    pipeNoteFor(DESIGN.rooms[0]!, { route: "external-trunking" }),
    "About 6 m of pipe to the outdoor unit, outside, in neat white trunking down the wall, with a 3 m change in height. The water the unit makes drains away by gravity.",
  );
  assert.match(pipeNoteFor(DESIGN.rooms[1]!), /About 4\.5 m of pipe.*small, quiet pump/);
  assert.match(pipeNoteFor(DESIGN.rooms[1]!, { route: "other", routeNote: "Behind the kitchen units" }), /Behind the kitchen units/);
});

test("withPipeNotes: cards with no pipe line get it from the design; a cleared one stays cleared", () => {
  const o = defaultOptionFor(CTX, DESIGN.variants[1]!);
  const bare = { ...o, roomCards: o.roomCards.map(({ pipeNote: _drop, ...c }) => c) };
  const [filled] = withPipeNotes([bare], DESIGN);
  assert.match(filled!.roomCards[0]!.pipeNote!, /About 6 m of pipe to the outdoor unit/);
  assert.match(filled!.roomCards[1]!.pipeNote!, /small, quiet pump/);
  // The office cleared one on purpose, and a card with a note keeps its own words.
  const edited = { ...bare, roomCards: [{ ...bare.roomCards[0]!, pipeNote: "" }, { ...bare.roomCards[1]!, pipeNote: "Up through the loft hatch." }] };
  const [kept] = withPipeNotes([edited], DESIGN);
  assert.equal(kept!.roomCards[0]!.pipeNote, "");
  assert.equal(kept!.roomCards[1]!.pipeNote, "Up through the loft hatch.");
  // Nothing to go by: unchanged.
  assert.equal(withPipeNotes([bare], null)[0], bare);
  assert.equal(withPipeNotes([o], DESIGN)[0], o, "already complete: the same object back");
});

/* ------------------------------------------------------------------ */
/* Options and drafts                                                  */
/* ------------------------------------------------------------------ */

test("defaultOptionFor: room cards from the design and catalogue, engine price, lines that add up", () => {
  const o = defaultOptionFor(CTX, DESIGN.variants[1]!);
  assert.equal(o.label, "Quiet");
  assert.equal(o.tier, "premium");
  assert.equal(o.roomCards.length, 2);
  assert.equal(o.roomCards[0]!.unitName, "DEMO Whisper 25 wall unit");
  assert.deepEqual(o.roomCards[0]!.mediaIds, ["m-bed"]);
  assert.ok(o.roomCards[0]!.highlights.includes("19 dB on its quietest setting"));
  assert.match(o.roomCards[0]!.pipeNote!, /white trunking/);
  assert.deepEqual(o.outdoorMediaIds, ["m-out"]);
  assert.match(o.highlights[0]!, /As quiet as 19 dB/);
  assert.equal(o.pricingInputs?.basis, "engine");
  assert.equal(o.pricing.listNetPence, 450_000 * 1.18);
  assert.equal(o.priceLines.reduce((a, l) => a + l.amountPence, 0), o.pricing.totalPence);
  assert.match(o.priceLines[0]!.label, /Main bedroom, Living room: supply and installation/);
  assert.deepEqual(o.labour, { crewSize: 2, installerDays: 3, electricianDays: 0.5, techLeadDays: 1 });
});

test("defaultOptionFor: install-only prices cost-plus without equipment; nothing to price waits for a manual price", () => {
  const io = defaultOptionFor({ ...CTX, contractType: "install-only" }, DESIGN.variants[0]!);
  assert.equal(io.pricingInputs?.basis, "cost-plus");
  assert.equal(io.costLines.some((l) => l.category === "equipment"), false);
  assert.match(io.priceLines[0]!.label, /: installation$/);
  assert.match(io.priceLines[0]!.detail!, /supplied by you/);

  const blank = CATALOGUE.map((i) => ({ ...i, costPence: null }));
  const zeroRates = mergeSettings({
    ...READY,
    pricing: { ...READY.pricing, labourRates: { installerDayPence: 0, electricianDayPence: 0, techLeadDayPence: 0, surveyorHourPence: 0 } },
  });
  const nothing = defaultOptionFor({ ...CTX, catalogue: blank, settings: zeroRates, engineNetPence: 0 }, DESIGN.variants[0]!);
  assert.equal(nothing.pricingInputs?.basis, "manual");
  assert.equal(nothing.pricing.totalPence, 0);
  assert.ok(nothing.costLines.length > 0);
});

test("draftProposal: one option per variant, the default wording, validity from settings", () => {
  const p = draft();
  assert.equal(p.status, "draft");
  assert.equal(p.designId, "d1");
  assert.equal(p.designVersion, 2);
  assert.deepEqual(p.options.map((o) => o.label), ["Standard", "Quiet"]);
  assert.equal(p.validUntil, "2026-11-17");
  assert.equal(p.termsVersion, READY.legal.termsVersion);
  assert.equal(p.warranty, "DEMO: five years' parts once registered.");
  assert.deepEqual(p.guarantees, guaranteeLines(READY));
  assert.equal(p.contractType, "supply-and-install");
  assert.deepEqual(p.inclusions, DEFAULT_INCLUSIONS);
  assert.notEqual(p.inclusions, DEFAULT_INCLUSIONS, "a copy, so editing it can't change the defaults");
});

test("recomputeOption: a discount comes off the net, never shown as its own customer line; VAT is", () => {
  const p = draft();
  const o = recomputeOption(CTX, { ...p.options[0]!, pricingInputs: { basis: "engine", discountCode: "PILOT30" } });
  assert.equal(o.pricing.discount?.amountPence, 135_000);
  assert.equal(o.pricing.netPence, 315_000);
  assert.equal(o.priceLines.some((l) => l.kind === "discount"), false);
  assert.equal(o.priceLines.reduce((a, l) => a + l.amountPence, 0), 315_000);
  const vatCtx: OptionContext = { ...CTX, settings: mergeSettings({ ...READY, tax: { vatRegistered: true, defaultTaxCode: "standard-20", accountantConfirmed: true, rationale: "DEMO" } }) };
  const v = recomputeOption(vatCtx, { ...p.options[0]!, pricingInputs: { basis: "engine" } });
  assert.equal(v.priceLines.at(-1)!.kind, "fee");
  assert.equal(v.priceLines.at(-1)!.amountPence, 90_000);
  assert.equal(v.priceLines.reduce((a, l) => a + l.amountPence, 0), v.pricing.totalPence);
  assert.throws(() => recomputeOption(CTX, { ...p.options[0]!, designVariantId: "gone" }), /variant/);
  assert.equal(hasPilotDiscount({ ...p, options: [o] }), true);
  assert.equal(hasPilotDiscount(p), false);
});

/* ------------------------------------------------------------------ */
/* Issue                                                               */
/* ------------------------------------------------------------------ */

test("proposalIssueErrors: a healthy draft can issue", () => {
  assert.deepEqual(proposalIssueErrors(healthy(), READY, TODAY), []);
});

test("proposalIssueErrors: options, prices, validity, terms", () => {
  assert.ok(proposalIssueErrors({ ...healthy(), options: [] }, READY, TODAY).includes("Add at least one option."));
  const unpriced = healthy();
  unpriced.options[0] = { ...unpriced.options[0]!, pricing: { ...unpriced.options[0]!.pricing, netPence: 0, totalPence: 0 } };
  assert.ok(proposalIssueErrors(unpriced, READY, TODAY).includes("Standard isn't priced yet."));
  const broken = healthy();
  broken.options[0] = { ...broken.options[0]!, priceLines: broken.options[0]!.priceLines.slice(1) };
  assert.match(proposalIssueErrors(broken, READY, TODAY).join(" "), /doesn't add up/);
  assert.ok(proposalIssueErrors({ ...healthy(), validUntil: TODAY }, READY, TODAY).includes("The valid-until date must be after today."));
  assert.ok(proposalIssueErrors({ ...healthy(), validUntil: "" }, READY, TODAY).includes("Set a valid-until date."));
  assert.ok(proposalIssueErrors({ ...healthy(), termsVersion: " " }, READY, TODAY).includes("Set the terms version (settings)."));
  assert.match(proposalIssueErrors({ ...healthy(), status: "issued" }, READY, TODAY)[0]!, /Only a draft/);
});

test("proposalIssueErrors: a price above the online estimate needs a reason the customer sees", () => {
  const dear = { ...healthy(), instantPriceGbp: 1_000 };
  assert.match(proposalIssueErrors(dear, READY, TODAY).join(" "), /above the customer's online estimate/);
  assert.deepEqual(proposalIssueErrors({ ...dear, increaseReason: "Your survey found a second room to cool." }, READY, TODAY), []);
});

test("proposalIssueErrors: below the minimum margin needs an admin override", () => {
  const thin = draft();
  thin.options = thin.options.map((o) => recomputeOption(CTX, { ...o, pricingInputs: { basis: "manual", manualNetPence: 160_000, manualReason: "DEMO" } }));
  assert.ok(thin.options.every((o) => o.pricing.belowMinMargin));
  assert.match(proposalIssueErrors(thin, READY, TODAY).join(" "), /below the 25% minimum/);
  const overridden = { ...thin, marginOverride: { reason: "Founding pilot, agreed by the owner", by: "DEMO Ada", at: NOW } };
  assert.deepEqual(proposalIssueErrors(overridden, READY, TODAY), []);
});

test("proposalIssueErrors: unpriced cost lines fail closed until they're priced or an admin overrides", () => {
  // Priced with the catalogue's gaps left open: the margin on the priced lines alone looks fine.
  const generous = { basis: "manual" as const, manualNetPence: 900_000, manualReason: "DEMO survey price" };
  const gappy = draft();
  gappy.options = gappy.options.map((o) => recomputeOption(CTX, { ...o, pricingInputs: generous }));
  assert.ok(gappy.options.every((o) => o.pricing.unpricedCostLines > 0 && !o.pricing.belowMinMargin));
  const errors = proposalIssueErrors(gappy, READY, TODAY).join(" ");
  assert.match(errors, /Standard: 2 cost lines have no price, so the 25% minimum margin can't be checked/);
  // Typing the costs in clears it (and the margin is then judged on the full cost).
  const priced = { ...gappy, options: gappy.options.map((o) => recomputeOption(CTX, { ...o, pricingInputs: { ...generous, costOverrides: priceGaps(o) } })) };
  assert.ok(priced.options.every((o) => o.pricing.unpricedCostLines === 0));
  assert.doesNotMatch(proposalIssueErrors(priced, READY, TODAY).join(" "), /no price/);
  // So does an admin override with a reason; a blank reason doesn't.
  assert.doesNotMatch(proposalIssueErrors({ ...gappy, marginOverride: { reason: "Supplier quote on file", by: "DEMO Ada", at: NOW } }, READY, TODAY).join(" "), /no price/);
  assert.match(proposalIssueErrors({ ...gappy, marginOverride: { reason: " ", by: "DEMO Ada", at: NOW } }, READY, TODAY).join(" "), /no price/);
  // The project gate says the same (proposalCheckFor feeds it).
  assert.equal(proposalCheckFor(gappy, READY, TODAY).unpricedCostLines, 4);
  assert.equal(proposalCheckFor(priced, READY, TODAY).unpricedCostLines, 0);
});

test("cost-plus refuses to price while equipment is unpriced; other gaps price on what's known", () => {
  const o = draft().options[0]!;
  const blankKit = CTX.catalogue.map((i) => (i.kind === "indoor" || i.kind === "outdoor" ? { ...i, costPence: null } : i));
  assert.throws(() => recomputeOption({ ...CTX, catalogue: blankKit }, { ...o, pricingInputs: { basis: "cost-plus" } }), /needs the equipment priced: \d equipment line/);
  // Typing the unit costs in lets it price.
  const kitGaps = recomputeOption({ ...CTX, catalogue: blankKit }, { ...o, pricingInputs: { basis: "engine" } });
  const ok = recomputeOption({ ...CTX, catalogue: blankKit }, { ...o, pricingInputs: { basis: "cost-plus", costOverrides: priceGaps(kitGaps, 50_000) } });
  assert.ok(ok.pricing.listNetPence > 0);
  assert.equal(ok.pricing.unpricedCostLines, 0);
});

test("agreedPaymentsFor: the accepted proposal's frozen schedule, not today's settings", () => {
  const terms = { depositPct: 20, depositTiming: "on-acceptance" as const, balanceDueDays: 14, methods: ["bank-transfer" as const], cancellationDays: 14 };
  const accepted = { ...issued({ terms }), status: "accepted" as const };
  const live = mergeSettings({ ...READY, payments: { ...READY.payments, depositPct: 0, balanceDueDays: 3 } });
  assert.deepEqual(agreedPaymentsFor(accepted, live), { depositPct: 20, depositTiming: "on-acceptance", balanceDueDays: 14 });
  assert.equal(agreedPaymentsFor(issued({ terms }), live), undefined, "no contract yet: settings rule");
  assert.equal(agreedPaymentsFor(null, live), undefined);
});

test("Schedule 2 (j): the time we undertake to finish by is frozen at issue and stated plainly", () => {
  assert.equal(DEFAULT_SETTINGS.scheduling.installWithinWeeks, 8);
  // Junk or a window shorter than the cancellation period falls back to the default.
  assert.equal(mergeSettings({ scheduling: { installWithinWeeks: 1 } } as never).scheduling.installWithinWeeks, 8);
  assert.equal(mergeSettings({ scheduling: { installWithinWeeks: 6.5 } } as never).scheduling.installWithinWeeks, 8);
  assert.equal(mergeSettings({ scheduling: { installWithinWeeks: 10 } } as never).scheduling.installWithinWeeks, 10);
  // Frozen with the terms: a later settings change doesn't move what was offered.
  const offered = proposalTermsFrom(mergeSettings({ scheduling: { installWithinWeeks: 6 } } as never));
  assert.equal(offered.installWithinWeeks, 6);
  const today = mergeSettings({ scheduling: { installWithinWeeks: 12 } } as never);
  assert.equal(settingsForProposal(today, { terms: offered }).scheduling.installWithinWeeks, 6);
  // A proposal issued before the window was frozen gets today's settings.
  const { installWithinWeeks: _w, ...older } = offered;
  void _w;
  assert.equal(settingsForProposal(today, { terms: older }).scheduling.installWithinWeeks, 12);
  assert.match(performanceCommitment(6), /within 6 weeks of the day you accept, on dates agreed with you/);
  assert.equal(performanceDueOn("2026-10-19T15:30:00.000Z", 6), "2026-11-30");
});

test("proposalIssueErrors: VAT treatment and tax overrides", () => {
  const registered = mergeSettings({ ...READY, tax: { vatRegistered: true, defaultTaxCode: "zero-esm", accountantConfirmed: false, rationale: "DEMO" } });
  const ctx = { ...CTX, settings: registered };
  const p = draft({}, ctx);
  p.options = p.options.map((o) => {
    const gaps = priceGaps(recomputeOption(ctx, { ...o, pricingInputs: { basis: "cost-plus", targetMarginPct: 40 } }));
    return recomputeOption(ctx, { ...o, pricingInputs: { basis: "cost-plus", targetMarginPct: 40, costOverrides: gaps } });
  });
  assert.match(proposalIssueErrors(p, registered, TODAY).join(" "), /isn't confirmed by the accountant/);
  const withOverride = { ...p, taxOverride: { reason: "Accountant confirmed by phone", by: "DEMO Ada", at: NOW } };
  assert.deepEqual(proposalIssueErrors(withOverride, registered, TODAY), []);
  // The energy-saving materials zero rate is never offered after it ends.
  assert.match(proposalIssueErrors(withOverride, registered, "2027-04-01").join(" "), /0% VAT rate for energy-saving materials ended on 31 March 2027/);
  assert.doesNotMatch(proposalIssueErrors(withOverride, registered, "2027-03-31").join(" "), /energy-saving materials ended/);
  const confirmed = mergeSettings({ ...registered, tax: { ...registered.tax, accountantConfirmed: true } });
  const changedCode = { ...p, options: p.options.map((o) => ({ ...o, pricing: { ...o.pricing, taxCode: "standard-20" as const } })) };
  assert.match(proposalIssueErrors(changedCode, confirmed, TODAY).join(" "), /different tax code/);
  // Not registered: no VAT may be charged at all.
  const vatWhenNot = { ...healthy(), options: healthy().options.map((o) => ({ ...o, pricing: { ...o.pricing, taxCode: "standard-20" as const } })) };
  assert.match(proposalIssueErrors(vatWhenNot, READY, TODAY).join(" "), /aren't VAT registered/);
});

test("proposalIssueErrors: install-only can't use the engine price", () => {
  const p = { ...draft(), contractType: "install-only" as const };
  assert.match(proposalIssueErrors(p, READY, TODAY).join(" "), /engine price includes the equipment/);
});

/* ------------------------------------------------------------------ */
/* Acceptance                                                          */
/* ------------------------------------------------------------------ */

test("acceptanceErrors: a full, matching acceptance passes", () => {
  const p = issued();
  assert.deepEqual(acceptanceErrors(p, acceptance(p), TODAY), []);
  assert.deepEqual(acceptanceErrors(p, acceptance(p, { optionId: p.options[1]!.id, optionLabel: "Quiet", totalPence: p.options[1]!.pricing.totalPence }), TODAY), []);
});

test("acceptanceErrors: name, option, price, acknowledgements, terms", () => {
  const p = issued();
  assert.match(acceptanceErrors(p, acceptance(p, { name: "Alex" }), TODAY).join(" "), /full name/);
  assert.match(acceptanceErrors(p, acceptance(p, { name: "  Alex   1 " }), TODAY).join(" "), /full name/);
  assert.match(acceptanceErrors(p, acceptance(p, { optionId: "nope" }), TODAY).join(" "), /Choose one of the options/);
  assert.match(acceptanceErrors(p, acceptance(p, { totalPence: 1 }), TODAY).join(" "), /doesn't match/);
  assert.match(acceptanceErrors(p, acceptance(p, { optionLabel: "Quiet" }), TODAY).join(" "), /doesn't match/);
  assert.match(
    acceptanceErrors(p, { ...acceptance(p), acknowledgedCancellationInfo: false as unknown as true }, TODAY).join(" "),
    /cancellation rights/,
  );
  assert.match(acceptanceErrors(p, acceptance(p, { termsVersion: "old" }), TODAY).join(" "), /terms have changed/);
  assert.match(acceptanceErrors(p, acceptance(p, { cancellationNoticeVersion: "" }), TODAY).join(" "), /cancellation information/);
});

test("acceptanceErrors: only an issued, unexpired proposal can be accepted", () => {
  assert.match(acceptanceErrors(issued({ validUntil: "2026-10-17" }), acceptance(issued()), TODAY).join(" "), /valid until 17 Oct 2026/);
  assert.deepEqual(acceptanceErrors(issued({ validUntil: TODAY }), acceptance(issued()), TODAY), [], "valid on its last day");
  assert.match(acceptanceErrors(healthy(), acceptance(healthy()), TODAY)[0]!, /isn't open/);
  assert.match(acceptanceErrors(issued({ status: "accepted" }), acceptance(issued()), TODAY)[0]!, /already been accepted/);
  assert.equal(isProposalExpired({ validUntil: "2026-10-17" }, TODAY), true);
  assert.equal(isProposalExpired({ validUntil: TODAY }, TODAY), false);
});

test("acceptanceErrors: the loss-of-right acknowledgement belongs to install-only early starts only", () => {
  const supply = issued();
  assert.deepEqual(acceptanceErrors(supply, acceptance(supply, { earlyStartRequested: true }), TODAY), []);
  assert.match(acceptanceErrors(supply, acceptance(supply, { earlyStartRequested: true, acknowledgedLossOfRight: true }), TODAY).join(" "), /only applies/);
  const io = issued({ contractType: "install-only" });
  assert.match(acceptanceErrors(io, acceptance(io, { earlyStartRequested: true }), TODAY).join(" "), /lose the right to cancel/);
  assert.deepEqual(acceptanceErrors(io, acceptance(io, { earlyStartRequested: true, acknowledgedLossOfRight: true }), TODAY), []);
  assert.match(acceptanceErrors(io, acceptance(io, { acknowledgedLossOfRight: true }), TODAY).join(" "), /only applies/);
  assert.equal(isFullName("Jo O'Neill"), true);
  assert.equal(isFullName("Jo"), false);
});

/* ------------------------------------------------------------------ */
/* Versions and the customer view                                      */
/* ------------------------------------------------------------------ */

test("reviseProposal: a clean new draft; the original (even accepted) is untouched", () => {
  const p = issued({
    viewedAt: NOW,
    changeRequest: "Can the bedroom unit go on the other wall?",
    marginOverride: { reason: "DEMO", by: "DEMO Ada", at: NOW },
    increaseReason: "DEMO reason",
  });
  const accepted: ProposalRecord = { ...p, status: "accepted", acceptance: { ...acceptance(p), at: NOW } };
  const before = JSON.stringify(accepted);
  const next = reviseProposal(accepted, "prop-2", "2026-10-19T09:00:00.000Z");
  assert.equal(JSON.stringify(accepted), before, "never mutates the accepted one");
  assert.equal(next.id, "prop-2");
  assert.equal(next.version, 2);
  assert.equal(next.status, "draft");
  assert.equal(next.createdAt, "2026-10-19T09:00:00.000Z");
  for (const k of ["issuedAt", "issuedBy", "viewedAt", "acceptance", "changeRequest", "marginOverride", "taxOverride", "supersededBy", "declinedReason"] as const) {
    assert.equal(next[k], undefined, `${k} cleared`);
  }
  assert.equal(next.increaseReason, "DEMO reason", "wording carries over");
  assert.deepEqual(next.options, accepted.options);
  next.options[0]!.label = "Changed";
  assert.equal(accepted.options[0]!.label, "Standard", "a deep copy");
});

test("customerSafeProposal: no costs, margins, inputs, overrides, notes, list price or discount", () => {
  const p = issued({ marginOverride: { reason: "x", by: "y", at: NOW }, taxOverride: { reason: "x", by: "y", at: NOW }, internalNotes: "Owner's friend", draftRevision: 4 });
  p.options = p.options.map((o) => recomputeOption(CTX, { ...o, pricingInputs: { basis: "manual", manualNetPence: 500_000, manualReason: "secret", discountCode: "PILOT15" } }));
  const before = JSON.stringify(p);
  const safe = customerSafeProposal(p);
  assert.equal(JSON.stringify(p), before, "pure");
  assert.equal(safe.marginOverride, undefined);
  assert.equal(safe.taxOverride, undefined);
  assert.equal(safe.internalNotes, undefined);
  assert.equal(safe.draftRevision, undefined);
  for (const o of safe.options) {
    assert.deepEqual(o.costLines, []);
    assert.equal(o.pricingInputs, undefined);
    assert.equal(o.pricing.costPence, 0);
    assert.equal(o.pricing.grossMarginPct, 0);
    assert.equal(o.pricing.grossMarginPctBeforeDiscount, 0);
    assert.equal(o.pricing.contributionPence, 0);
    assert.equal(o.pricing.discount, undefined);
    assert.equal(o.pricing.manualReason, undefined);
    assert.equal(o.pricing.listNetPence, o.pricing.netPence);
    assert.equal(o.pricing.totalPence, 425_000);
    assert.deepEqual(o.labour, { crewSize: 2, installerDays: 0, electricianDays: 0, techLeadDays: 0 });
  }
  const json = JSON.stringify(safe);
  assert.doesNotMatch(json, /secret|Owner's friend|PILOT15|500000/);
});

test("proposalDocumentContent: the same before and after the customer views or accepts", () => {
  const p = issued();
  const viewed = { ...p, viewedAt: NOW };
  const accepted: ProposalRecord = { ...p, status: "accepted", acceptance: { ...acceptance(p), at: NOW } };
  assert.equal(JSON.stringify(proposalDocumentContent(p)), JSON.stringify(proposalDocumentContent(viewed)));
  assert.equal(JSON.stringify(proposalDocumentContent(p)), JSON.stringify(proposalDocumentContent(accepted)));
  const changed = { ...p, validUntil: "2026-12-01" };
  assert.notEqual(JSON.stringify(proposalDocumentContent(p)), JSON.stringify(proposalDocumentContent(changed)));
});

test("withoutDiscountLine: an older record's discount line is folded in, so the lines still add up and show no 'was' price", () => {
  const lines = [
    { id: "a", label: "Bedroom", amountPence: 350_308, kind: "system" as const },
    { id: "b", label: "Living room", amountPence: 408_692, kind: "system" as const },
    { id: "d", label: "Pilot discount", amountPence: -113_850, kind: "discount" as const },
    { id: "v", label: "VAT", amountPence: 129_030, kind: "fee" as const },
  ];
  const out = withoutDiscountLine(lines, 645_150);
  assert.equal(out.some((l) => l.kind === "discount"), false);
  assert.equal(out.filter((l) => l.kind === "system").reduce((a, l) => a + l.amountPence, 0), 645_150);
  assert.equal(out.find((l) => l.id === "v")!.amountPence, 129_030, "fees untouched");
  assert.ok(out[0]!.amountPence < 350_308);
  const plain = [{ id: "a", label: "A", amountPence: 100, kind: "system" as const }];
  assert.deepEqual(withoutDiscountLine(plain, 100), plain);
  const safe = customerSafeProposal({ ...issued(), options: [{ ...issued().options[0]!, priceLines: lines, pricing: { ...issued().options[0]!.pricing, netPence: 645_150, totalPence: 774_180, taxPence: 129_030 } }] });
  assert.equal(safe.options[0]!.priceLines.reduce((a, l) => a + l.amountPence, 0), 774_180);
});

test("pricingInputsOf: stored inputs win; older records read back to the same basis and discount", () => {
  const p = healthy();
  const stored = pricingInputsOf(p.options[0]!);
  assert.equal(stored.basis, "cost-plus");
  assert.equal(stored.targetMarginPct, 40);
  assert.deepEqual(stored.costOverrides, p.options[0]!.pricingInputs?.costOverrides);
  const old = recomputeOption(CTX, { ...p.options[0]!, pricingInputs: { basis: "cost-plus", targetMarginPct: 30, discountCode: "PILOT15" } });
  const { pricingInputs: _gone, ...legacy } = old;
  const derived = pricingInputsOf(legacy);
  assert.equal(derived.basis, "cost-plus");
  assert.equal(derived.discountCode, "PILOT15");
  assert.ok(derived.targetMarginPct! >= 29 && derived.targetMarginPct! <= 30);
  const again = recomputeOption(CTX, { ...legacy, pricingInputs: derived });
  assert.ok(Math.abs(again.pricing.netPence - old.pricing.netPence) <= 2_000, "reprices to about the same figure");
  const manual = pricingInputsOf({ pricing: { ...old.pricing, pricingBasis: "manual", listNetPence: 400_000, manualReason: "DEMO", discount: undefined } });
  assert.deepEqual(manual, { basis: "manual", manualNetPence: 400_000, manualReason: "DEMO" });
  const custom = pricingInputsOf({ pricing: { ...old.pricing, discount: { code: "PILOTCUSTOM", label: "x", reason: "Neighbour (DEMO)", amountPence: 10_000 } } });
  assert.equal(custom.customDiscountPence, 10_000);
  assert.equal(custom.discountReason, "Neighbour (DEMO)");
  const revised = reviseProposal({ ...p, options: [legacy] }, "prop-9", NOW);
  assert.equal(revised.options[0]!.pricingInputs?.basis, "cost-plus", "a revision keeps how it was priced");
});

test("price lines: whole pounds for every system but the last, which takes the rounding", () => {
  const twoSystems: DesignRecord = {
    ...DESIGN,
    variants: [{ ...variant("standard"), systems: [system("sys1", "single", ["bed"]), system("sys2", "single", ["living"])] }],
  };
  const o = defaultOptionFor({ ...CTX, design: twoSystems }, twoSystems.variants[0]!);
  const systems = o.priceLines.filter((l) => l.kind === "system");
  assert.equal(systems.length, 2);
  assert.equal(systems[0]!.amountPence % 100, 0);
  assert.equal(systems.reduce((a, l) => a + l.amountPence, 0), o.pricing.netPence);
});

test("unitHighlights: spec facts the blurb already makes aren't repeated", () => {
  const specs = { soundPressureLowDb: 19, heatingKw: 3.2, wifi: "Built-in Wi-Fi (DEMO app)" } as unknown as CatalogueItem["specs"];
  assert.deepEqual(unitHighlights({ customerBlurb: "As quiet as 19 dB(A) on its lowest setting, with Wi-Fi app control built in.", specs }), [
    "As quiet as 19 dB(A) on its lowest setting, with Wi-Fi app control built in.",
    "Heats in winter as well as cooling in summer",
  ]);
  assert.deepEqual(unitHighlights({ customerBlurb: "", specs }), ["19 dB on its quietest setting", "Heats in winter as well as cooling in summer", "App control"]);
  assert.deepEqual(unitHighlights({ customerBlurb: "Heats and cools a big room.", specs: { wifi: false } as unknown as CatalogueItem["specs"] }), ["Heats and cools a big room."]);
  assert.deepEqual(unitHighlights(undefined), []);
  // "App control" only when the spec says it's built in: never on "not built in", "optional" or a disagreement.
  for (const wifi of ["Not built in on MSZ-HR..VF; optional MELCloud Wi-Fi interface", "No, optional adapter", "Onecta app Wi-Fi. UK retailers disagree: Wi-Fi optional on some", "Yes"]) {
    assert.ok(!unitHighlights({ customerBlurb: "", specs: { wifi } as unknown as CatalogueItem["specs"] }).includes("App control"), wifi);
  }
  for (const wifi of ["Built-in Wi-Fi - Panasonic Comfort Cloud app", "Wi-Fi control as standard via Onecta app", "Built in (DEMO app)"]) {
    assert.ok(unitHighlights({ customerBlurb: "", specs: { wifi } as unknown as CatalogueItem["specs"] }).includes("App control"), wifi);
  }
  // The researched seed: no unit whose Wi-Fi text says otherwise gets "App control".
  for (const item of RESEARCHED_CATALOGUE.filter((i) => i.kind === "indoor")) {
    if (/not built in|optional|disagree/i.test(String(item.specs?.wifi ?? ""))) assert.ok(!unitHighlights(item).includes("App control"), item.id);
  }
});

test("contractTaxCode: the accepted option's own code; else settings as they must be charged", () => {
  const p = issued();
  const accepted: ProposalRecord = { ...p, status: "accepted", acceptance: { ...acceptance(p), at: NOW } };
  const chosen = accepted.options.find((o) => o.id === accepted.acceptance!.optionId)!;
  const reduced: ProposalRecord = {
    ...accepted,
    options: accepted.options.map((o) => (o.id === chosen.id ? { ...o, pricing: { ...o.pricing, taxCode: "reduced-5" } } : o)),
  };
  const registered = mergeSettings({ ...READY, tax: { ...READY.tax, vatRegistered: true, defaultTaxCode: "outside-scope" } });
  assert.equal(contractTaxCode(reduced, registered), "reduced-5", "the contract's code, whatever settings say now");
  // No accepted contract: a registered business with the shipped outside-scope default charges the standard rate.
  assert.equal(contractTaxCode(p, registered), "standard-20");
  assert.equal(contractTaxCode(null, registered), "standard-20");
  assert.equal(contractTaxCode(null, mergeSettings({ ...READY, tax: { ...READY.tax, vatRegistered: false } })), "outside-scope");
  // A junk code on the stored option isn't trusted.
  const junk: ProposalRecord = {
    ...accepted,
    options: accepted.options.map((o) => (o.id === chosen.id ? { ...o, pricing: { ...o.pricing, taxCode: "nonsense" as never } } : o)),
  };
  assert.equal(contractTaxCode(junk, registered), "standard-20");
});
