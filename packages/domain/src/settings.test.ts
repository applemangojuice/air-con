import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SETTINGS,
  TAX_CODES,
  effectiveTaxCode,
  isInServiceArea,
  mergeSettings,
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
  assert.equal(s.finance.lenderConfigured, false);
  assert.equal(s.features.showPrototypeNav, false);
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
