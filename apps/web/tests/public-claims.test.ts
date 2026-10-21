import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, mergeSettings, type PilotSettings } from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";

registerAppResolver();
const claims = await import("../components/site/claims.ts");
const {
  addDaysIso,
  cancellationSummary,
  coverageFor,
  fgasClaim,
  gapsAsSurveyChecks,
  installDaysPhrase,
  installDurationCopy,
  listOutcodes,
  outcodeOf,
  paymentCopy,
  quoteConsentRecord,
  realPhone,
  slaCommitments,
  surveyPriceCopy,
  toPublicSettings,
  validUntil,
  vatCopy,
  warrantyCopy,
} = claims;

const TODAY = "2026-10-18";
const settings = (patch: Record<string, unknown> = {}): PilotSettings => mergeSettings({ ...DEFAULT_SETTINGS, ...patch });
const pub = (patch: Record<string, unknown> = {}) => toPublicSettings(settings(patch), TODAY);

test("defaults make no warranty, F-gas, finance, SLA or VAT-rate claims", () => {
  const ps = pub();
  assert.equal(warrantyCopy(ps), null, "no warranty years until settings say so");
  assert.equal(fgasClaim(ps), null, "no F-gas claim without a company certificate");
  assert.equal(ps.finance.offered, false);
  assert.deepEqual(slaCommitments(ps), [], "no 'money off automatically' while SLAs are off");
  assert.equal(vatCopy(ps).short, "No VAT to add", "not registered: no VAT line, the price is the price");
  assert.doesNotMatch(vatCopy(ps).long, /0%|zero/i);
  assert.equal(ps.company.phone, null, "the 0800 000 0000 placeholder is never printed");
  assert.equal(ps.showPrototypeNav, false);
});

test("the public subset carries nothing private", () => {
  const ps = pub({
    company: {
      ...DEFAULT_SETTINGS.company,
      bank: { accountName: "X", sortCode: "00-00-00", accountNumber: "12345678" },
      insurance: { provider: "Ins", policy: "P-1" },
    },
  });
  const json = JSON.stringify(ps);
  for (const secret of ["12345678", "P-1", "minMarginPct", "labourRates", "PILOT30", "overhead"]) {
    assert.ok(!json.includes(secret), `public settings leak ${secret}`);
  }
});

test("warranty copy comes only from settings", () => {
  assert.equal(warrantyCopy(pub({ warranty: { workmanshipYears: 2, manufacturerSummary: null } }))?.headline, "2-year workmanship guarantee");
  const maker = warrantyCopy(pub({ warranty: { workmanshipYears: null, manufacturerSummary: "Panasonic: 5 years when registered" } }));
  assert.equal(maker?.headline, "Manufacturer's warranty");
  assert.match(maker!.body, /registered/);
  assert.equal(warrantyCopy(pub({ warranty: { workmanshipYears: 0, manufacturerSummary: null } })), null, "an explicit 'none' isn't advertised");
});

test("with no warranty facts, the public pages promise no guarantee we may not hold", async () => {
  const { readFile } = await import("node:fs/promises");
  assert.doesNotMatch(claims.GUARANTEE_FALLBACK, /workmanship|guarantee/i);
  assert.match(claims.GUARANTEE_FALLBACK, /which warranties apply, in writing/);
  // The home page and the FAQ (and its structured data) fall back to it, never to a hard-coded promise.
  for (const page of ["../app/page.tsx", "../app/faq/page.tsx"]) {
    const src = await readFile(new URL(page, import.meta.url), "utf8");
    assert.doesNotMatch(src, /our workmanship guarantee/i, page);
    assert.match(src, /GUARANTEE_FALLBACK/, page);
  }
});

test("F-gas claim needs a complete, in-date company certificate", () => {
  const cert = (c: unknown) => pub({ company: { ...DEFAULT_SETTINGS.company, fgasCompanyCert: c } });
  assert.match(fgasClaim(cert({ body: "REFCOM", number: "F12345" }))!, /REFCOM F-gas company certificate \(no\. F12345\)/);
  assert.equal(fgasClaim(cert({ body: "REFCOM", number: "" })), null);
  assert.equal(fgasClaim(cert({ body: "REFCOM", number: "F1", expiresOn: "2026-10-17" })), null, "expired yesterday");
  assert.ok(fgasClaim(cert({ body: "REFCOM", number: "F1", expiresOn: "2026-10-18" })), "valid through its expiry day");
});

test("VAT: nothing specific about 0% unless registered and confirmed", () => {
  const unconfirmed = vatCopy(pub({ tax: { vatRegistered: true, defaultTaxCode: "zero-esm", accountantConfirmed: false, rationale: "" } }));
  assert.equal(unconfirmed.short, null);
  assert.doesNotMatch(unconfirmed.long, /0%/);
  const zero = vatCopy(pub({ tax: { vatRegistered: true, defaultTaxCode: "zero-esm", accountantConfirmed: true, rationale: "" } }));
  assert.equal(zero.short, "0% VAT");
  const std = vatCopy(pub({ tax: { vatRegistered: true, defaultTaxCode: "standard-20", accountantConfirmed: true, rationale: "" } }));
  assert.equal(std.short, "Includes VAT at 20%");
  assert.equal(pub().company.vatNumber, null, "no VAT number shown while unregistered");
});

test("install duration is one message from settings, never 'a single day' by default", () => {
  assert.equal(installDurationCopy(pub()), "Installed over up to three days");
  assert.equal(installDaysPhrase(pub()), "up to three days");
  const one = pub({ scheduling: { ...DEFAULT_SETTINGS.scheduling, installBlockDays: 1 } });
  assert.equal(installDurationCopy(one), "Installed in one day");
});

test("price validity runs quoteValidityDays from the quote date", () => {
  assert.equal(validUntil(pub(), "2026-10-18T09:00:00.000Z"), "2026-11-17");
  assert.equal(addDaysIso("2026-12-25", 10), "2027-01-04");
});

test("coverage uses the configured outcodes, and an empty list covers nowhere", () => {
  const ps = pub();
  assert.deepEqual(coverageFor(ps.serviceArea, "sw16 2be"), { covered: true, outcode: "SW16" });
  assert.deepEqual(coverageFor(ps.serviceArea, "SW162BE"), { covered: true, outcode: "SW16" });
  assert.deepEqual(coverageFor(ps.serviceArea, "E8 1AA"), { covered: false, outcode: "E8" });
  assert.equal(coverageFor([], "SW16 2BE").covered, false);
  assert.equal(coverageFor(ps.serviceArea, "").covered, false);
  assert.equal(outcodeOf("cr0 1aa"), "CR0");
  assert.equal(listOutcodes(["SW17", "SW2", "CR0"]), "CR0, SW2 and SW17");
});

test("phone numbers: real ones print, placeholders don't", () => {
  assert.equal(realPhone("0800 000 0000"), null);
  assert.equal(realPhone("020 8123 4567"), "020 8123 4567");
  assert.equal(realPhone("12"), null);
  assert.equal(realPhone(undefined), null);
});

test("survey is 'Free' only when the fee is zero", () => {
  assert.equal(surveyPriceCopy(pub()), "Free");
  assert.equal(surveyPriceCopy(pub({ scheduling: { ...DEFAULT_SETTINGS.scheduling, surveyFeeGbp: 150 } })), "£150");
});

test("payment and cancellation copy follow settings", () => {
  const none = paymentCopy(pub());
  assert.equal(none.deposit, "No deposit.");
  assert.match(none.balance, /once the installation is finished\. It's due within 7 days of our invoice/);
  assert.doesNotMatch(none.balance, /handover/, "one basis for the balance everywhere (round 10)");
  assert.match(none.methods, /bank transfer or card/);
  const dep = paymentCopy(pub({ payments: { ...DEFAULT_SETTINGS.payments, depositPct: 20 } }));
  assert.match(dep.deposit, /20% deposit is due when you accept/);
  assert.match(cancellationSummary(pub()), /14 days after the day your equipment is delivered/);
  assert.match(cancellationSummary(pub(), "install-only"), /within 14 days of the day you accept/);
});

test("SLA commitments appear only when switched on, without the outdated survey-fee promise", () => {
  const on = slaCommitments(pub({ sla: { enabled: true } }));
  assert.equal(on.length, 3);
  assert.ok(on.every((c) => !/£150|site visit|final quote/i.test(`${c.promise} ${c.remedy}`)));
});

test("example homes say which rooms they include, and the anchor is the cheapest whole-home example", async () => {
  const { exampleHomes, homeAnchor, roomsSummary } = await import("../components/site/examples.ts");
  const homes = exampleHomes();
  assert.equal(homes.length, 6);
  assert.ok(homes.every((h) => h.price > 0 && h.rooms.length > 0));
  const anchor = homeAnchor();
  assert.equal(anchor.price, Math.min(...homes.slice(3).map((h) => h.price)));
  assert.equal(roomsSummary(["Living room", "Kitchen", "Main bedroom"]), "3 rooms: Living room, kitchen and main bedroom");
  assert.equal(roomsSummary(["Bedroom", "Living room"]), "Bedroom and living room");
});

test("consent record: operational and marketing are separate, versioned facts", () => {
  const r = quoteConsentRecord({ marketing: false, hasPhone: true, at: "2026-10-18T10:00:00.000Z" });
  assert.equal(r.operational.given, true);
  assert.deepEqual(r.operational.channels, ["email", "sms"]);
  assert.equal(r.marketing.given, false);
  assert.deepEqual(r.marketing.channels, []);
  assert.equal(r.operational.version, r.marketing.version);
  assert.match(r.operational.text, /No sales calls and no marketing/);
  const m = quoteConsentRecord({ marketing: true, hasPhone: false, at: "2026-10-18T10:00:00.000Z" });
  assert.deepEqual(m.operational.channels, ["email"]);
  assert.deepEqual(m.marketing.channels, ["email"]);
});

test("finance: the lender's own example, word for word, with who provides it, and only with every detail on record", () => {
  const example = "DEMO Representative example: borrowing £5,000 over 48 months at a representative 9.9% APR (fixed). Total amount payable £6,040.80.";
  const full = { firmName: "DEMO Lending Ltd", frn: "123456", arrangement: "appointed-rep", approvalRef: "AR 987654", representativeExample: example };
  assert.equal(pub({ finance: { ...full, approvalRef: "" } }).finance.offered, false, "a missing detail shows nothing");
  assert.equal(pub({ finance: { lenderConfigured: true } }).finance.offered, false, "the old switch shows nothing");
  const ps = pub({ finance: full });
  assert.ok(ps.finance.offered);
  if (!ps.finance.offered) return;
  assert.equal(ps.finance.representativeExample, example, "verbatim");
  const lines = claims.financeDisclosure(ps.finance, ps.company.tradingName);
  assert.match(lines[0]!, /provided by DEMO Lending Ltd, authorised and regulated by the Financial Conduct Authority \(firm reference 123456\)/);
  assert.match(lines[1]!, /credit broker, not a lender, and an appointed representative .*AR 987654/);
  assert.doesNotMatch(JSON.stringify(ps.finance), /11\.9/);
});

test("the saved quote never asks for details it has no way to add: gaps read as what the surveyor checks", async () => {
  const { scoreConfidence } = await import("@aircon/domain");
  const empty = scoreConfidence({ rooms: [], outdoor: { location: "unsure", photos: [] }, electrics: { condition: "unsure", photos: [] } } as never);
  const bare = scoreConfidence({
    postcode: "SW16 9ZZ",
    property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
    rooms: [{ id: "r1", name: "Bedroom", type: "bedroom", size: "medium", floor: "first", glazing: "medium", orientation: "south", hasExternalWall: true, photos: [] }],
    outdoor: { location: "unsure", photos: [] },
    electrics: { condition: "unsure", photos: [] },
  } as never);
  const gaps = [...empty.gaps, ...bare.gaps];
  assert.ok(gaps.length >= 5, "every gap the engine can raise");
  const checks = gapsAsSurveyChecks(gaps);
  assert.deepEqual(checks, [
    "Which rooms you'd like heated and cooled.",
    "The wall in each room where its indoor unit goes.",
    "Where the outdoor unit goes.",
    "Your fuse board, for the new circuit.",
  ]);
  for (const c of checks) assert.doesNotMatch(c, /^(Add|Tell us|Check)\b/, c);
  assert.deepEqual(gapsAsSurveyChecks(["Something new the engine says"]), [], "an unknown gap isn't shown as an instruction");
  for (const band of Object.values(claims.BAND_COPY)) assert.doesNotMatch(band.body, /\bAdd them\b|photos would firm/i, band.body);
});

test("property pages and the mailing letter make no track-record or 'already designed' claims", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of ["../app/a/[id]/page.tsx", "../app/ops/collateral/letter/page.tsx"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8").replace(/&apos;/g, "'");
    for (const banned of [/already designed/i, /week in,? week out/i, /three doors down/i, /before knocking/i, /design work is already done/i, /enough to design the system/i]) {
      assert.doesNotMatch(src, banned, `${file}: ${banned}`);
    }
    assert.match(src, /estimate/i, `${file} says it's an estimate`);
  }
  // The /a sample says DEMO and never passes made-up facts off as public records.
  const page = readFileSync(new URL("../app/a/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /DEMO: a sample page\. This address and these facts are made up for the demo, not public records\./);
});

test("round 10: the terms, the proposal and the contract state one basis for the balance (our invoice, once the install is finished)", async () => {
  const { termsSections, termsPlainText } = await import("../lib/legal/terms.ts");
  const { paymentTerms } = await import("../components/proposal/copy.ts");
  const terms = termsPlainText(termsSections(pub())).join("\n");
  const proposal = paymentTerms(100_000, DEFAULT_SETTINGS).join("\n");
  for (const [where, text] of [["terms", terms], ["proposal", proposal]] as const) {
    assert.match(text, /once the installation is finished[\s\S]{0,40}due within 7 days of our invoice/, where);
    assert.doesNotMatch(text, /days of handover/, `${where}: no second deadline`);
  }
});
