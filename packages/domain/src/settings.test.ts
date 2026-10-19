import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SETTINGS,
  TAX_CODES,
  effectiveTaxCode,
  financeOffered,
  isInServiceArea,
  mergeSettings,
  isPlaceholderPhone,
  schedule2Missing,
  type PilotSettings,
} from "./settings.ts";

test("defaults are the conservative pilot set", () => {
  const s = DEFAULT_SETTINGS;
  assert.equal(s.tax.vatRegistered, false);
  assert.equal(s.tax.defaultTaxCode, "outside-scope");
  assert.equal(s.tax.accountantConfirmed, false);
  assert.equal(s.pricing.minMarginPct, 25);
  assert.equal(s.pricing.contingencyPct, 5);
  assert.equal(s.pricing.quoteValidityDays, 30);
  assert.equal(s.pricing.requireEngineerSignoff, true);
  assert.deepEqual(s.pricing.labourRates, {
    installerDayPence: 22_000,
    electricianDayPence: 25_000,
    techLeadDayPence: 28_000,
    surveyorHourPence: 4_000,
  });
  assert.equal(s.pricing.premiumUpliftPct, 18);
  assert.deepEqual(s.discounts.map((d) => d.code), ["PILOT15", "PILOT30", "PILOTCUSTOM"]);
  assert.equal(s.discounts[0]!.pct, 15);
  assert.equal(s.discounts[1]!.pct, 30);
  assert.equal(s.discounts[2]!.pct, undefined); // an amount, set per job
  assert.equal(s.payments.depositPct, 0);
  assert.equal(s.payments.depositTiming, "on-acceptance");
  assert.equal(s.payments.balanceDueDays, 7);
  assert.deepEqual(s.payments.methods, ["bank-transfer", "card"]);
  assert.equal(s.payments.invoicePrefix, "DIH");
  assert.equal(s.payments.nextInvoiceNumber, 1);
  assert.equal(s.scheduling.installBlockDays, 3);
  assert.deepEqual(s.scheduling.surveySlotTimes, ["10:00", "13:00", "16:00"]);
  assert.equal(s.scheduling.surveyDurationMinutes, 90);
  assert.equal(s.scheduling.surveyFeeGbp, 0);
  assert.equal(s.scheduling.cancellationDays, 14);
  assert.deepEqual(s.scheduling.workingDays, [1, 2, 3, 4, 5]);
  assert.equal(s.serviceArea.outcodes.length, 17);
  assert.equal(s.sla.enabled, false);
  assert.deepEqual(s.warranty, { workmanshipYears: null, manufacturerSummary: null });
  assert.deepEqual(s.legal, { termsVersion: "pilot-draft-1", termsReviewed: false, cancellationReviewed: false });
  assert.equal(s.comms.smsSenderId, "DangItsHot");
  assert.equal(s.comms.smsSenderId.length <= 11, true); // alphanumeric sender id limit
  assert.deepEqual(s.finance, {});
  assert.equal(financeOffered(s), false);
  assert.equal(s.features.showPrototypeNav, false);
  // Schedule 2 details are business facts, never guessed: blank until set.
  assert.equal(s.company.geographicAddress, "");
  assert.equal(s.company.complaintsProcess, "");
  for (const key of ["adr", "workmanshipGuarantee", "reviewUrl"] as const) assert.equal(key in s.company, false, key);
});

test("schedule2Missing lists what the pre-contract information still needs, in plain words", () => {
  // The shipped "0800 000 0000" is a stand-in, not a number anyone answers.
  assert.deepEqual(schedule2Missing(DEFAULT_SETTINGS), ["geographic address", "phone", "complaints process", "guarantee statement (or explicit 'none')"]);
  const complete = mergeSettings({
    company: {
      geographicAddress: "DEMO, 1 Example Street, London SW16 2BE",
      phone: "020 7946 0123",
      complaintsProcess: "DEMO: call or email us; we reply within two working days.",
    },
    warranty: { workmanshipYears: 2, manufacturerSummary: null },
  });
  assert.deepEqual(schedule2Missing(complete), []);
  // "None offered" is fine, as long as it's said: 0 years, or a manufacturer summary.
  assert.deepEqual(schedule2Missing(mergeSettings({ ...complete, warranty: { workmanshipYears: 0, manufacturerSummary: null } })), []);
  assert.deepEqual(schedule2Missing(mergeSettings({ ...complete, warranty: { workmanshipYears: null, manufacturerSummary: "None offered." } })), []);
  assert.deepEqual(
    schedule2Missing(mergeSettings({ ...complete, warranty: { workmanshipYears: null, manufacturerSummary: "   " } })),
    ["guarantee statement (or explicit 'none')"],
  );
  const blanks = mergeSettings({ ...complete, company: { ...complete.company, tradingName: " ", phone: "", email: "", geographicAddress: "  " } });
  assert.deepEqual(schedule2Missing(blanks), ["trading name", "geographic address", "phone", "email"]);
  // ADR is "where applicable": never required.
  assert.equal(complete.company.adr, undefined);
});

test("isPlaceholderPhone: the stand-in and implausible numbers are not contact numbers", () => {
  assert.equal(isPlaceholderPhone("0800 000 0000"), true);
  assert.equal(isPlaceholderPhone(""), true);
  assert.equal(isPlaceholderPhone(null), true);
  assert.equal(isPlaceholderPhone("12345"), true);
  assert.equal(isPlaceholderPhone("020 7946 0123"), false);
  assert.equal(isPlaceholderPhone("+44 20 7946 0123"), false);
  assert.equal(isPlaceholderPhone("07700 900123"), false);
});

test("optional company text: kept when it's real text, dropped when blank, null or junk; review links are http(s)", () => {
  const s = mergeSettings({
    company: {
      adr: "DEMO dispute scheme, demo.example/disputes",
      workmanshipGuarantee: "DEMO: two years on our workmanship; call us to claim.",
      reviewUrl: "https://reviews.example/dang-its-hot",
      geographicAddress: 12,
      complaintsProcess: null,
    },
  });
  assert.equal(s.company.adr, "DEMO dispute scheme, demo.example/disputes");
  assert.match(s.company.workmanshipGuarantee!, /two years/);
  assert.equal(s.company.reviewUrl, "https://reviews.example/dang-its-hot");
  assert.equal(s.company.geographicAddress, ""); // wrong type: the default
  assert.equal(s.company.complaintsProcess, "");
  const junk = mergeSettings({ company: { adr: null, workmanshipGuarantee: "  ", reviewUrl: "javascript:alert(1)" } });
  for (const key of ["adr", "workmanshipGuarantee", "reviewUrl"] as const) assert.equal(key in junk.company, false, key);
  assert.equal(mergeSettings({ company: { reviewUrl: 5 } }).company.reviewUrl, undefined);
  assert.equal(mergeSettings({ company: { reviewUrl: "reviews.example/x" } }).company.reviewUrl, undefined);
  assert.equal(mergeSettings({ company: { reviewUrl: "http://reviews.example/x" } }).company.reviewUrl, "http://reviews.example/x");
  assert.deepEqual(mergeSettings(s), s, "idempotent");
});

test("every tax code has a label, a rate and a note", () => {
  assert.equal(TAX_CODES["standard-20"].ratePct, 20);
  assert.equal(TAX_CODES["reduced-5"].ratePct, 5);
  assert.equal(TAX_CODES["zero-esm"].ratePct, 0);
  assert.equal(TAX_CODES["outside-scope"].ratePct, 0);
  for (const code of Object.values(TAX_CODES)) assert.ok(code.label && code.note);
});

test("mergeSettings fills missing keys from the defaults", () => {
  assert.deepEqual(mergeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(mergeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(mergeSettings("junk"), DEFAULT_SETTINGS);
  assert.deepEqual(mergeSettings({}), DEFAULT_SETTINGS);

  const s = mergeSettings({ pricing: { minMarginPct: 30, labourRates: { installerDayPence: 24_000 } } });
  assert.equal(s.pricing.minMarginPct, 30);
  assert.equal(s.pricing.labourRates.installerDayPence, 24_000);
  assert.equal(s.pricing.labourRates.electricianDayPence, 25_000); // untouched sibling kept
  assert.equal(s.pricing.contingencyPct, 5);
  assert.equal(s.tax.defaultTaxCode, "outside-scope");
});

test("mergeSettings: arrays replace, wrong types fall back, nulls accept values", () => {
  const s = mergeSettings({
    serviceArea: { outcodes: ["SW16"] },
    discounts: [],
    pricing: { minMarginPct: "lots", contingencyPct: Number.NaN },
    sla: { enabled: "yes" },
    warranty: { workmanshipYears: 2, manufacturerSummary: "Per the manufacturer's terms, registered by us." },
    scheduling: "nope",
  });
  assert.deepEqual(s.serviceArea.outcodes, ["SW16"]);
  assert.deepEqual(s.discounts, []);
  assert.equal(s.pricing.minMarginPct, 25);
  assert.equal(s.pricing.contingencyPct, 5);
  assert.equal(s.sla.enabled, false);
  assert.equal(s.warranty.workmanshipYears, 2);
  assert.match(s.warranty.manufacturerSummary!, /manufacturer/);
  assert.deepEqual(s.scheduling, DEFAULT_SETTINGS.scheduling);
});

test("mergeSettings: union values and list items outside their set fall back", () => {
  const junk = mergeSettings({
    tax: { vatRegistered: true, defaultTaxCode: "foo" },
    payments: { depositTiming: "x", methods: ["card", "cheque", 7, "card"] },
    scheduling: { workingDays: [1, 2, 9, 2.5, "3"], surveySlotTimes: [10, "11:00"] },
    serviceArea: { outcodes: ["SW4", null, 3] },
    comms: { disabledEvents: ["survey-booked", { e: 1 }] },
    discounts: [{ code: "PILOT15", label: "x", pct: 15, reason: "r", active: true }, "junk", { label: "no code" }],
    warranty: { workmanshipYears: "two", manufacturerSummary: 5 },
  });
  assert.equal(junk.tax.defaultTaxCode, "outside-scope");
  assert.equal(effectiveTaxCode(junk), "standard-20"); // and never throws on TAX_CODES lookups
  assert.equal(TAX_CODES[effectiveTaxCode(junk)].ratePct, 20);
  assert.equal(junk.payments.depositTiming, "on-acceptance");
  assert.deepEqual(junk.payments.methods, ["card"]);
  assert.deepEqual(junk.scheduling.workingDays, [1, 2]);
  assert.deepEqual(junk.scheduling.surveySlotTimes, ["11:00"]);
  assert.deepEqual(junk.serviceArea.outcodes, ["SW4"]);
  assert.equal(isInServiceArea(junk, "SW4 7AA"), true);
  assert.deepEqual(junk.comms.disabledEvents, ["survey-booked"]);
  assert.deepEqual(junk.discounts.map((d) => d.code), ["PILOT15"]);
  assert.deepEqual(junk.warranty, { workmanshipYears: null, manufacturerSummary: null });

  // Nothing valid at all: the default list. An empty list is a choice and stays.
  assert.deepEqual(mergeSettings({ payments: { methods: ["cheque"] } }).payments.methods, DEFAULT_SETTINGS.payments.methods);
  assert.deepEqual(mergeSettings({ payments: { methods: [] } }).payments.methods, []);
  assert.equal(mergeSettings({ tax: { defaultTaxCode: "toString" } }).tax.defaultTaxCode, "outside-scope");
  assert.equal(mergeSettings({ tax: { defaultTaxCode: "reduced-5" } }).tax.defaultTaxCode, "reduced-5");
  assert.equal(mergeSettings({ payments: { depositTiming: "before-kit-order" } }).payments.depositTiming, "before-kit-order");
  assert.deepEqual(mergeSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
});

test("mergeSettings keeps optional company details and never aliases the defaults", () => {
  const s = mergeSettings({
    company: {
      vatNumber: "GB000000000",
      fgasCompanyCert: { body: "DEMO body", number: "DEMO-123", expiresOn: "2027-01-31" },
      bank: { accountName: "DEMO", sortCode: "00-00-00", accountNumber: "00000000" },
    },
  });
  assert.equal(s.company.vatNumber, "GB000000000");
  assert.equal(s.company.fgasCompanyCert?.number, "DEMO-123");
  assert.equal(s.company.legalName, DEFAULT_SETTINGS.company.legalName);
  s.serviceArea.outcodes.push("ZZ1");
  s.pricing.labourRates.installerDayPence = 1;
  assert.ok(!DEFAULT_SETTINGS.serviceArea.outcodes.includes("ZZ1"));
  assert.equal(DEFAULT_SETTINGS.pricing.labourRates.installerDayPence, 22_000);
});

test("isInServiceArea matches full postcodes and bare outcodes", () => {
  const s = DEFAULT_SETTINGS;
  assert.equal(isInServiceArea(s, "SW16 2BE"), true);
  assert.equal(isInServiceArea(s, "sw16 2be"), true);
  assert.equal(isInServiceArea(s, "SW162BE"), true);
  assert.equal(isInServiceArea(s, "SW16"), true);
  assert.equal(isInServiceArea(s, "CR8 1AA"), true);
  assert.equal(isInServiceArea(s, "E3 4AB"), true);
  assert.equal(isInServiceArea(s, "SW1A 1AA"), false);
  assert.equal(isInServiceArea(s, "SW1 1AA"), false); // SW1 isn't SW16
  assert.equal(isInServiceArea(s, "M1 1AE"), false);
  assert.equal(isInServiceArea(s, ""), false);
  const nowhere: PilotSettings = mergeSettings({ serviceArea: { outcodes: [] } });
  assert.equal(isInServiceArea(nowhere, "SW16 2BE"), false);
  const lower = mergeSettings({ serviceArea: { outcodes: [" sw4 "] } });
  assert.equal(isInServiceArea(lower, "SW4 7AA"), true);
});

test("effectiveTaxCode: outside scope until VAT registered", () => {
  assert.equal(effectiveTaxCode(DEFAULT_SETTINGS), "outside-scope");
  // A stale code is ignored while not registered.
  assert.equal(effectiveTaxCode(mergeSettings({ tax: { defaultTaxCode: "zero-esm" } })), "outside-scope");
  assert.equal(effectiveTaxCode(mergeSettings({ tax: { vatRegistered: true, defaultTaxCode: "zero-esm" } })), "zero-esm");
  assert.equal(effectiveTaxCode(mergeSettings({ tax: { vatRegistered: true, defaultTaxCode: "reduced-5" } })), "reduced-5");
  assert.equal(effectiveTaxCode(mergeSettings({ tax: { vatRegistered: true } })), "standard-20");
});

test("finance shows only with every credit-promotion fact on record, and nothing worked out", () => {
  const example =
    "DEMO Representative example: borrowing £5,000 over 48 months at a representative 9.9% APR (fixed), 48 monthly payments of £125.85. Total amount payable £6,040.80.";
  const full = { firmName: "DEMO Lending Ltd", frn: "123456", arrangement: "appointed-rep", approvalRef: "AR 987654", representativeExample: example };
  assert.equal(financeOffered(mergeSettings({ finance: full })), true);
  for (const key of Object.keys(full) as (keyof typeof full)[]) {
    assert.equal(financeOffered(mergeSettings({ finance: { ...full, [key]: "" } })), false, `without ${key}`);
  }
  assert.equal(financeOffered(mergeSettings({ finance: { ...full, frn: "12AB" } })), false, "not an FCA firm reference");
  assert.equal(financeOffered(mergeSettings({ finance: { ...full, arrangement: "trust-me" } })), false, "not a listed arrangement");
  assert.equal(financeOffered(mergeSettings({ finance: { ...full, representativeExample: "11.9% APR" } })), false, "not a full example");
  // The old switch on its own turns nothing on.
  const legacy = mergeSettings({ finance: { lenderConfigured: true } });
  assert.deepEqual(legacy.finance, {});
  assert.equal(financeOffered(legacy), false);
});
